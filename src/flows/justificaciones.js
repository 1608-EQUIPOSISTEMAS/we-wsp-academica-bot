const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showBotResuelto }              = require('./resuelto');
const { showMenu }                     = require('./menu');

async function showJustificaciones(phone, session) {
  updateSession(phone, { estado: 'flow_justificacion_info', ultimoTema: 'justificaciones' });
  tagFlow(phone, ['bot-activo', 'justificaciones'], 'Justificaciones');

  await sendText(
    phone,
    `Entiendo. Si tuviste algún inconveniente y necesitas justificar una inasistencia o tardanza, ` +
    `puedes registrarlo rápidamente en este enlace: 👇\n` +
    `🔗 https://bit.ly/JTF-04`
  );

  await delay(1200);

  await sendText(
    phone,
    `ℹ️ *Dato importante:* Ten en cuenta que el límite permitido es de hasta 2 justificaciones por curso.`
  );

  await delay(1200);

  await sendButtons(
    phone,
    `Completa el formulario con calma. Cuando termines, confírmame por aquí para saber que todo salió bien. 😊`,
    [
      { id: 'just_listo',     title: '✅ Ya lo completé' },
      { id: 'form_problemas', title: '🆘 Necesito ayuda' },
      { id: 'menu_principal', title: '🔙 Menú principal' },
    ]
  );
}

async function handleJustificacionReply(phone, buttonId, session) {
  if (buttonId === 'just_listo') {
    tagFlow(phone, ['resuelto-bot', 'justificaciones']);
    await sendText(phone, `¡Perfecto! Tu justificación ha sido enviada 😊`);
    await showBotResuelto(phone);

  } else if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Justificaciones:* El alumno reporta problemas al completar el formulario de inasistencias.`
      ).catch(err => console.error('[bot] Error nota privada justificaciones:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'justificaciones' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showJustificaciones, handleJustificacionReply };
