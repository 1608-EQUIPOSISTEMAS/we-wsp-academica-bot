const { sendButtons }     = require('../services/whatsapp');
const { updateSession }   = require('../services/session');
const { tagFlow }         = require('../services/chatwoot');
const { askReclamoDatos } = require('./reclamo');

async function showCampus(phone) {
  updateSession(phone, { estado: 'flow_campus', ultimoTema: 'campus_virtual' });
  tagFlow(phone, ['bot-activo', 'campus-virtual'], 'Campus Virtual');
  await sendButtons(
    phone,
    `Que tal 😊 Puedes ingresar a tu campus virtual aquí:\n` +
    `🔗 https://intranet.we-educacion.com/\n\n` +
    `Tus credenciales las encuentras en el correo de confirmación enviado desde *pagos@we-educacion.com*\n` +
    `• Usuario: tu correo de inscripción\n` +
    `• Contraseña inicial: 1234567\n\n` +
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
    updateSession(phone, { estado: 'menu' });
    const { showMenu } = require('./menu');
    await showMenu(phone, session.nombre);

  } else if (buttonId === 'campus_no') {
    await askReclamoDatos(phone, 'reclamo_activacion');
  }
}

module.exports = { showCampus, handleCampusReply };
