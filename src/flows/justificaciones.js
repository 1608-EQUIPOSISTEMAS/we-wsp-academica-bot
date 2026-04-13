const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showBotResuelto }              = require('./resuelto');
const { showMenu }                     = require('./menu');

async function showJustificaciones(phone, session) {
  updateSession(phone, { estado: 'flow_justificacion_info', ultimoTema: 'justificaciones' });
  tagFlow(phone, ['bot-activo', 'justificaciones'], 'Justificaciones');

  const nombre = session?.nombre || 'Alumno';

  await sendText(
    phone,
    `¡Hola ${nombre}! ☀️\n` +
    `Para que puedas justificar tu inasistencia o tardanza, te envío el link aquí 👇🏼\n\n` +
    `📌 https://bit.ly/JTF-04\n\n` +
    `🚨 *Recuerda:* Solo puedes justificar hasta 2 inasistencias o tardanzas por curso.`
  );

  await delay(500);
  await sendButtons(
    phone,
    `¿Pudiste completarlo?`,
    [
      { id: 'just_listo',     title: '✅ Listo, ya llené' },
      { id: 'form_problemas', title: '⚠️ Tengo problemas' },
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
