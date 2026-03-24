const { sendText, sendButtons }               = require('../services/whatsapp');
const { updateSession, deleteSession }        = require('../services/session');
const { setLabels, resolveConversation }      = require('../services/chatwoot');

async function showBotResuelto(phone) {
  updateSession(phone, {
    estado:         'resuelto_bot',
    resuelto_bot_at: Date.now(),
  });
  await sendButtons(
    phone,
    `¿Hay algo más en lo que pueda ayudarte? 😊`,
    [
      { id: 'bot_resuelto_no',   title: '✅ No, es todo' },
      { id: 'bot_resuelto_menu', title: '📋 Ver menú' },
    ]
  );
}

async function handleBotResuelto(phone, buttonId, session) {
  if (buttonId === 'bot_resuelto_no') {
    await sendText(phone, `¡Perfecto! Que tengas un buen día 💙`);
    if (session.conversationId) {
      setLabels(session.conversationId, ['resuelto-bot']);
      resolveConversation(session.conversationId);
    }
    deleteSession(phone);

  } else {
    // bot_resuelto_menu o cualquier otra respuesta → menú principal
    const { showMenu } = require('./menu');
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showBotResuelto, handleBotResuelto };
