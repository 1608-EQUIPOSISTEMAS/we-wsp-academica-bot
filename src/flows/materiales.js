const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showBotResuelto }              = require('./resuelto');
const { showMenu }                     = require('./menu');

async function showMateriales(phone, topic = 'materiales') {
  updateSession(phone, { estado: 'flow_materiales', ultimoTema: topic });
  tagFlow(phone, ['bot-activo', 'materiales'], 'Materiales / Video Clases');

  await sendText(
    phone,
    `Todos tus materiales y video clases están disponibles en tu campus virtual 📚\n` +
    `🔗 https://we-educacion.com/web/login`
  );

  await delay(500);
  await sendButtons(
    phone,
    `¿Pudiste acceder sin problema?`,
    [
      { id: 'mat_ok',         title: '✅ Ya tengo acceso' },
      { id: 'form_problemas', title: '⚠️ Tengo problemas' },
      { id: 'menu_principal', title: '🔙 Menú principal' },
    ]
  );
}

async function handleMaterialesReply(phone, buttonId, session) {
  if (buttonId === 'mat_ok') {
    tagFlow(phone, ['resuelto-bot', 'materiales']);
    await showBotResuelto(phone);

  } else if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Materiales:* El alumno reporta problemas para acceder a sus materiales o video clases en el campus virtual.`
      ).catch(err => console.error('[bot] Error nota privada materiales:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'materiales' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showMateriales, handleMaterialesReply };
