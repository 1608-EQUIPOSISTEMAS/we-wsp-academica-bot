const { sendText, sendButtons }               = require('../services/whatsapp');
const { findAlumnoByEmail }                   = require('../services/database');
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

  const mensaje = dentroHorario
    ? `👋 ¡Hola! Bienvenido/a a *W|E Educación Ejecutiva* 💙\n\n` +
      `Para brindarte una mejor atención, por favor indícanos el correo con el que te inscribiste:`
    : `👋 ¡Hola! Bienvenido/a a *W|E Educación Ejecutiva* 💙\n\n` +
      `En este momento nuestros asesores no están disponibles, pero puedo ayudarte con consultas automáticas 🤖\n\n` +
      `⏰ *Horario de atención:*\n${getScheduleText()}\n\n` +
      `Por favor indícanos el correo con el que te inscribiste:`;

  await sendText(phone, mensaje);
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

  if (alumno) {
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

    updateSession(phone, {
      nombre:    alumno.full_name,
      correo:    alumno.email,
      studentId: alumno.id,
      verified,
      estado:    'menu',
    });
    tagAlumno(phone, alumno.full_name, alumno.email);
    await sendText(phone, `✅ ¡Hola, ${alumno.full_name}! Te encontramos en el sistema 😊`);
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
