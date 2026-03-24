const { sendButtons }     = require('../services/whatsapp');
const { updateSession }   = require('../services/session');
const { tagFlow }         = require('../services/chatwoot');
const { askReclamoDatos } = require('./reclamo');
const { showBotResuelto } = require('./resuelto');

async function showMateriales(phone, topic = 'materiales') {
  updateSession(phone, { estado: 'flow_materiales', ultimoTema: topic });
  tagFlow(phone, ['bot-activo', 'materiales'], 'Materiales / Video Clases');
  await sendButtons(
    phone,
    `Todos tus materiales y video clases están disponibles en tu campus virtual 📚\n` +
    `🔗 https://we-educacion.com/web/login\n\n` +
    `¿Necesitas ayuda para acceder?`,
    [
      { id: 'mat_ok',        title: '✅ Ya tengo acceso' },
      { id: 'mat_no_acceso', title: '❌ No veo materiales' },
    ]
  );
}

async function handleMaterialesReply(phone, buttonId, session) {
  if (buttonId === 'mat_ok') {
    tagFlow(phone, ['resuelto-bot', 'materiales']);
    await showBotResuelto(phone);

  } else if (buttonId === 'mat_no_acceso') {
    await askReclamoDatos(phone, 'reclamo_materiales');
  }
}

module.exports = { showMateriales, handleMaterialesReply };
