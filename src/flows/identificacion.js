const { sendText, sendButtons, delay }        = require('../services/whatsapp');
const { findAlumnoByEmail,
        checkAndUpdateMembership }            = require('../services/database');
const { syncStudentFromOdoo }                 = require('../services/odoo');
const { updateSession }                       = require('../services/session');
const { tagFlow, tagAlumno }                  = require('../services/chatwoot');
const { showMenu }                            = require('./menu');
const { runTransfer }                         = require('./transfer');
const { isWithinBusinessHours, getScheduleText } = require('../services/schedule');

/** Quita todo lo que no sea dígito para comparar números de teléfono */
function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function startIdentificacion(phone) {
  const dentroHorario = isWithinBusinessHours();

  await sendText(
    phone,
    `👋 ¡Hola! Bienvenido/a a *W|E Educación Ejecutiva*\nSoy **Eva**, tu asistente W|E 😊\nEstoy aquí para ayudarte`
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  const segundoMensaje = dentroHorario
    ? `Por favor, indícame el correo electrónico con el que realizaste tu inscripción para poder brindarte una mejor atención`
    : `En este momento nuestros asesores no están disponibles, pero puedo ayudarte con consultas automáticas 🤖\n\n` +
      `⏰ *Horario de atención:*\n${getScheduleText()}\n\n` +
      `Por favor, indícame el correo electrónico con el que realizaste tu inscripción`;

  await sendText(phone, segundoMensaje);
  updateSession(phone, { estado: 'esperando_correo' });
  tagFlow(phone, ['bot-activo']);
}

/** Valida que el texto tenga estructura mínima de correo: algo@algo.algo */
function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

const MAX_INTENTOS_CORREO  = 5;
const RESET_INTENTOS_MS    = 60 * 60 * 1000; // 1 hora

/**
 * Incrementa el contador de intentos fallidos y, si se alcanza el límite,
 * transfiere directamente a un asesor.
 * El contador se resetea automáticamente si pasó más de 1 hora desde el
 * primer fallo (el usuario puede haber buscado su correo y vuelto).
 * Devuelve true si se transfirió (el caller debe hacer return).
 */
async function _registrarFalloCorreo(phone, session) {
  const ahora    = Date.now();
  const resetAt  = session.correo_intentos_reset_at || 0;
  const expirado = ahora - resetAt > RESET_INTENTOS_MS;

  const intentos = expirado ? 1 : (session.correo_intentos || 0) + 1;
  updateSession(phone, {
    correo_intentos:          intentos,
    correo_intentos_reset_at: expirado ? ahora : resetAt,
  });

  if (intentos >= MAX_INTENTOS_CORREO) {
    await sendText(
      phone,
      `Parece que estás teniendo dificultades para ingresar tu correo 😊\n` +
      `Un asesor te ayudará directamente.`
    );
    updateSession(phone, { ultimoTema: 'correo_no_encontrado' });
    await runTransfer(phone, { ...session, ultimoTema: 'correo_no_encontrado' });
    return true;
  }

  return false;
}

async function handleCorreo(phone, email, session) {
  const emailClean = email.trim().toLowerCase();

  // ── Validación de formato antes de consultar la DB o Odoo ────────────────
  if (!isValidEmail(emailClean)) {
    const transferido = await _registrarFalloCorreo(phone, session);
    if (transferido) return;

    const intentos  = session.correo_intentos || 0; // ya actualizado por _registrarFalloCorreo
    const restantes = MAX_INTENTOS_CORREO - intentos;
    await sendText(
      phone,
      `⚠️ Eso no parece un correo electrónico válido.\n` +
      `Por favor escribe tu correo de inscripción (ej: *nombre@gmail.com*) 📧` +
      (restantes === 1 ? `\n\n_Último intento disponible._` : '')
    );
    return;
  }

  let alumno;
  try {
    alumno = await findAlumnoByEmail(emailClean);
  } catch (err) {
    console.error('[identificacion] Error DB:', err);
    await sendText(phone, '⚠️ Hubo un error al verificar tu correo. Por favor intenta de nuevo.');
    return;
  }

  // ── Sync desde Odoo si el alumno no existe o aún no fue validado ──────────
  const needsSync = !alumno || alumno.flag_odoo_validation === false;
  if (needsSync) {
    await sendText(phone, `⏳ Validando información...`);
    try {
      await syncStudentFromOdoo(emailClean);
    } catch (err) {
      console.error('[identificacion] Error sync Odoo:', err.message);
      await sendText(
        phone,
        `Estamos experimentando demoras técnicas en la validación de tu historial.\n` +
        `Por favor, intenta de nuevo en unos minutos.`
      );
      return;
    }
    // Re-consultar después del sync
    try {
      alumno = await findAlumnoByEmail(emailClean);
    } catch (err) {
      console.error('[identificacion] Error DB post-sync:', err);
      await sendText(phone, '⚠️ Hubo un error al verificar tu correo. Por favor intenta de nuevo.');
      return;
    }
  }

  if (alumno) {
    if (needsSync) {
      await sendText(phone, `✅ Listo, validación completada`);
    }
    // ── Verificación de número (transparente — sin mensaje al alumno) ────────
    const sessionPhone  = normalizePhone(phone);
    const dbPhone       = normalizePhone(alumno.phone);
    const devBypass     = process.env.DEV_BYPASS_PHONE
      ? sessionPhone.endsWith(normalizePhone(process.env.DEV_BYPASS_PHONE))
      : false;
    // Aceptar si uno es sufijo del otro (maneja diferencias de código de país)
    const verified = devBypass || (
      sessionPhone.length > 0 && dbPhone.length > 0 &&
      (sessionPhone === dbPhone ||
       sessionPhone.endsWith(dbPhone) ||
       dbPhone.endsWith(sessionPhone))
    );

    if (devBypass) console.log(`[identificacion] DEV_BYPASS_PHONE activo — verified forzado (sesión=${sessionPhone})`);
    else           console.log(`[identificacion] phone verificado: ${verified} (sesión=${sessionPhone}, db=${dbPhone})`);

    // ── Verificar membresía VIP (actualiza ods_student_bot y retorna estado) ──
    let isMember    = false;
    let membershipTier = null;
    try {
      const mem   = await checkAndUpdateMembership(emailClean);
      isMember    = mem.isMember;
      membershipTier = mem.tier;
    } catch (err) {
      console.error('[identificacion] Error verificando membresía:', err.message);
      // No bloquear el flujo si la consulta de membresía falla
    }

    updateSession(phone, {
      nombre:          alumno.full_name,
      correo:          alumno.email,
      studentId:       alumno.id,
      odooPartnerId:   alumno.odoo_partner_id || null,
      verified,
      isMember,
      membershipTier,
      estado:          'menu',
    });
    tagAlumno(phone, alumno.full_name, alumno.email);
    const saludoInicial = (verified && isMember)
      ? `¡Hola ${alumno.full_name}! Qué gusto saludar a un miembro ${membershipTier} 🖤`
      : `✅ ¡Hola, ${alumno.full_name}! Te encontramos en el sistema 😊`;
    await sendText(phone, saludoInicial);
    await delay(500);
    await showMenu(phone, alumno.full_name);
  } else {
    const transferido = await _registrarFalloCorreo(phone, session);
    if (transferido) return;

    updateSession(phone, { estado: 'correo_no_encontrado' });
    await sendButtons(
      phone,
      `🔍 No encontramos ese correo en nuestro sistema.\n¿Qué deseas hacer?`,
      [
        { id: 'reintentar_correo', title: 'Intentar otro correo' },
        { id: 'hablar_asesor',    title: 'Hablar con un asesor' },
      ]
    );
  }
}

async function handleCorreoNoEncontrado(phone, buttonId, session) {
  if (buttonId === 'reintentar_correo') {
    updateSession(phone, { estado: 'esperando_correo' });
    await sendText(phone, 'Por favor, escribe nuevamente tu correo de inscripción:');
  } else if (buttonId === 'hablar_asesor') {
    updateSession(phone, { ultimoTema: 'correo_no_encontrado' });
    await runTransfer(phone, session);
  }
}

module.exports = { startIdentificacion, handleCorreo, handleCorreoNoEncontrado };
