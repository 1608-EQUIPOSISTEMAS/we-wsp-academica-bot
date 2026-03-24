const { sendButtons }     = require('../services/whatsapp');
const { updateSession }   = require('../services/session');
const { tagFlow }         = require('../services/chatwoot');
const { askReclamoDatos } = require('./reclamo');
const { showBotResuelto } = require('./resuelto');

async function showCampus(phone, session) {
  updateSession(phone, { estado: 'flow_campus', ultimoTema: 'campus_virtual' });
  tagFlow(phone, ['bot-activo', 'campus-virtual'], 'Campus Virtual');

  const usuario = session?.correo || 'tu correo de inscripción';

  await sendButtons(
    phone,
    `Para ingresar a tu campus, ingresa mediante este link:\n` +
    `👉 https://we-educacion.com/web/login\n\n` +
    `• Usuario: *${usuario}*\n` +
    `• Contraseña: *1234567*\n\n` +
    `¿Pudiste ingresar sin problema?`,
    [
      { id: 'campus_ok', title: '✅ Sí, gracias' },
      { id: 'campus_no', title: '❌ No pude ingresar' },
    ]
  );
}

async function handleCampusReply(phone, buttonId, session) {
  if (buttonId === 'campus_ok') {
    tagFlow(phone, ['resuelto-bot', 'campus-virtual']);
    await showBotResuelto(phone);

  } else if (buttonId === 'campus_no') {
    await askReclamoDatos(phone, 'reclamo_activacion');
  }
}

module.exports = { showCampus, handleCampusReply };
