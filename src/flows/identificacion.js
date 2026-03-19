const { sendText, sendButtons } = require('../services/whatsapp');
const { findAlumnoByEmail }     = require('../services/database');
const { updateSession }         = require('../services/session');
const { tagFlow, tagAlumno }    = require('../services/chatwoot');
const { showMenu }              = require('./menu');
const { runTransfer }           = require('./transfer');

async function startIdentificacion(phone) {
  await sendText(
    phone,
    `👋 ¡Hola! Bienvenido/a a *W|E Educación Ejecutiva* 💙\n\n` +
    `Para brindarte una mejor atención, por favor indícanos el correo con el que te inscribiste:`
  );
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
    updateSession(phone, {
      nombre: alumno.full_name,
      correo: alumno.email,
      estado: 'menu',
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
