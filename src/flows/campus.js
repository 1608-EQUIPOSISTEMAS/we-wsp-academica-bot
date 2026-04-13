const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showBotResuelto }              = require('./resuelto');
const { showMenu }                     = require('./menu');

async function showCampus(phone, session) {
  updateSession(phone, { estado: 'flow_campus', ultimoTema: 'campus_virtual' });
  tagFlow(phone, ['bot-activo', 'campus-virtual'], 'Campus Virtual');

  const usuario = session?.correo || 'tu correo de inscripción';

  await sendText(
    phone,
    `Para ingresar a tu campus, ingresa mediante este link:\n` +
    `👉 https://we-educacion.com/web/login\n\n` +
    `• Usuario: *${usuario}*\n` +
    `• Contraseña: *1234567*`
  );

  await delay(500);
  await sendButtons(
    phone,
    `¿Pudiste ingresar sin problema?`,
    [
      { id: 'mat_ok',         title: '✅ Ya tengo acceso' },
      { id: 'form_problemas', title: '⚠️ Tengo problemas' },
      { id: 'menu_principal', title: '🔙 Menú principal' },
    ]
  );
}

async function handleCampusReply(phone, buttonId, session) {
  if (buttonId === 'mat_ok') {
    tagFlow(phone, ['resuelto-bot', 'campus-virtual']);
    await showBotResuelto(phone);

  } else if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Campus Virtual:* El alumno reporta problemas de acceso al campus virtual.`
      ).catch(err => console.error('[bot] Error nota privada campus:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'campus_virtual' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showCampus, handleCampusReply };
