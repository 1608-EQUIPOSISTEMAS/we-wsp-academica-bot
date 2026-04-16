const { sendText, sendButtons, delay }        = require('../services/whatsapp');
const { showMenu }                            = require('./menu');
const { findAlumnoByEmail,
        checkAndUpdateMembership }            = require('../services/database');
const { syncStudentFromOdoo }                 = require('../services/odoo');
const { updateSession }                       = require('../services/session');
const { tagFlow, tagAlumno }                  = require('../services/chatwoot');
const { runTransfer }                         = require('./transfer');
const { isWithinBusinessHours, getScheduleText } = require('../services/schedule');

/** Quita todo lo que no sea dígito para comparar números de teléfono */
function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

/**
 * Extrae el primer nombre de un full_name en MAYÚSCULAS y lo convierte a Title Case.
 * "ELIUTH DAVID SEGUIL MACHCO" → "Eliuth"
 */
function _toFirstName(fullName) {
  if (!fullName) return '';
  const first = String(fullName).trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

async function startIdentificacion(phone) {
  const dentroHorario = isWithinBusinessHours();

  await sendText(
    phone,
    `¡Hola! 👋 Soy *Eva*, tu asistente virtual en _W|E Educación Ejecutiva_. ¡Qué gusto saludarte!`
  );

  await delay(1200);

  if (dentroHorario) {
    await sendText(
      phone,
      `Estoy aquí para ayudarte a resolver tus consultas académicas al instante ⚡`
    );
  } else {
    await sendText(
      phone,
      `En este momento nuestro equipo humano está descansando 🌙 _(están disponibles ${getScheduleText()})_, ` +
      `¡pero no te preocupes! Yo estoy aquí 24/7 para ayudarte a resolver tus consultas académicas al instante ⚡`
    );
  }

  await delay(1200);

  await sendText(
    phone,
    `Para poder buscar tu expediente en nuestro sistema y darte información exacta, ` +
    `¿podrías escribirme el correo electrónico con el que realizaste tu inscripción? 📧`
  );

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
      `Un especialista de nuestro equipo te escribirá por aquí para ayudarte directamente.`
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

    const intentos  = session.correo_intentos || 0;
    const restantes = MAX_INTENTOS_CORREO - intentos;
    await sendText(
      phone,
      `Hmm, eso no parece un correo electrónico válido 🤔\n` +
      `Recuerda que suele tener el formato *nombre@ejemplo.com*. ¿Podrías escribirlo de nuevo?` +
      (restantes === 1 ? `\n\n_Este es tu último intento disponible._` : '')
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
        `Uy, parece que nuestro sistema está tomando una pequeña siesta 😴 Estamos teniendo un contratiempo técnico, pero en unos minutos debería resolverse.\n` +
        `Por favor, intenta de nuevo en un momento.`
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
    // ── Verificación de número (transparente — sin mensaje al alumno) ────────
    const sessionPhone  = normalizePhone(phone);
    const dbPhone       = normalizePhone(alumno.phone);
    const devBypass     = process.env.DEV_BYPASS_PHONE
      ? sessionPhone.endsWith(normalizePhone(process.env.DEV_BYPASS_PHONE))
      : false;
    const verified = devBypass || (
      sessionPhone.length > 0 && dbPhone.length > 0 &&
      (sessionPhone === dbPhone ||
       sessionPhone.endsWith(dbPhone) ||
       dbPhone.endsWith(sessionPhone))
    );

    if (devBypass) console.log(`[identificacion] DEV_BYPASS_PHONE activo — verified forzado (sesión=${sessionPhone})`);
    else           console.log(`[identificacion] phone verificado: ${verified} (sesión=${sessionPhone}, db=${dbPhone})`);

    // ── Verificar membresía VIP ───────────────────────────────────────────────
    let isMember       = false;
    let membershipTier = null;
    try {
      const mem  = await checkAndUpdateMembership(emailClean);
      isMember   = mem.isMember;
      membershipTier = mem.tier;
    } catch (err) {
      console.error('[identificacion] Error verificando membresía:', err.message);
    }

    const primerNombre = _toFirstName(alumno.full_name);

    updateSession(phone, {
      nombre:        alumno.full_name,
      correo:        alumno.email,
      studentId:     alumno.id,
      odooPartnerId: alumno.odoo_partner_id || null,
      verified,
      isMember,
      membershipTier,
      estado:        'menu',
    });
    tagAlumno(phone, alumno.full_name, alumno.email);

    const tierEmoji = { 'WE BLACK': '🖤', 'WE GOLD': '✨', 'WE PLAT': '🥈' };
    const saludoTexto = (verified && isMember)
      ? `¡${primerNombre}! Qué gusto saludar a un miembro ${membershipTier} ${tierEmoji[membershipTier] ?? '⭐'} ¿En qué puedo ayudarte hoy?`
      : `¡${primerNombre}! 👋 Te encontré en el sistema. ¿En qué te puedo ayudar hoy?`;

    await sendText(phone, saludoTexto);
    await delay(800);
    await showMenu(phone, primerNombre);
  } else {
    const transferido = await _registrarFalloCorreo(phone, session);
    if (transferido) return;

    updateSession(phone, { estado: 'correo_no_encontrado' });
    await sendButtons(
      phone,
      `Uy, busqué por todas partes pero no logré encontrar ese correo en nuestros registros 🕵️‍♀️\n¿Es posible que te hayas inscrito con otro?`,
      [
        { id: 'reintentar_correo', title: 'Intentar otro correo' },
        { id: 'hablar_asesor',     title: 'Hablar con un asesor' },
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
