const { sendText, sendButtons }               = require('../services/whatsapp');
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

async function handleCorreo(phone, email, session) {
  const emailClean = email.trim().toLowerCase();

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
    const sessionPhone = normalizePhone(phone);
    const dbPhone      = normalizePhone(alumno.phone);
    // Aceptar si uno es sufijo del otro (maneja diferencias de código de país)
    const verified =
      sessionPhone.length > 0 && dbPhone.length > 0 &&
      (sessionPhone === dbPhone ||
       sessionPhone.endsWith(dbPhone) ||
       dbPhone.endsWith(sessionPhone));

    console.log(`[identificacion] phone verificado: ${verified} (sesión=${sessionPhone}, db=${dbPhone})`);

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
    await showMenu(phone, alumno.full_name);
  } else {
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
