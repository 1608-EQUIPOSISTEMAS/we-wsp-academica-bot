const { sendText, sendButtons, delay }        = require('../services/whatsapp');
const { updateSession, deleteSession }        = require('../services/session');
const { setLabels, resolveConversation }      = require('../services/chatwoot');

async function showBotResuelto(phone) {
  updateSession(phone, {
    estado:          'resuelto_bot',
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
    // Antes de despedirnos, pedimos calificación del bot
    updateSession(phone, { estado: 'flow_bot_csat' });
    await delay(500);
    await sendButtons(
      phone,
      `¡Genial! Para seguir mejorando, ¿qué tal te pareció mi atención automática hoy? 🤖`,
      [
        { id: 'bot_csat_good', title: '🟢 Excelente' },
        { id: 'bot_csat_ok',   title: '🟡 Regular' },
        { id: 'bot_csat_bad',  title: '🔴 Mejorable' },
      ]
    );
  } else {
    // bot_resuelto_menu o cualquier otra respuesta → menú principal
    const { showMenu } = require('./menu');
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showBotResuelto, handleBotResuelto };
