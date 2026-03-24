const { sendText, sendButtons } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { tagFlow }               = require('../services/chatwoot');
const { runTransfer }           = require('./transfer');
const { showBotResuelto }       = require('./resuelto');

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

  await sendButtons(
    phone,
    `¿Pudiste completarlo?`,
    [
      { id: 'just_listo',      title: '✅ Listo, ya llené' },
      { id: 'just_link_falla', title: '❌ El link no abre' },
      { id: 'just_otra_duda',  title: '❓ Tengo otra duda' },
    ]
  );
}

async function handleJustificacionReply(phone, buttonId, session) {
  if (buttonId === 'just_listo') {
    tagFlow(phone, ['resuelto-bot', 'justificaciones']);
    await sendText(
      phone,
      `¡Perfecto! Tu justificación ha sido enviada 😊`
    );
    await showBotResuelto(phone);

  } else if (buttonId === 'just_link_falla') {
    await runTransfer(
      phone,
      { ...session, ultimoTema: 'justificaciones' },
      'Alumno reporta que el link de justificación no funciona'
    );

  } else if (buttonId === 'just_otra_duda') {
    await runTransfer(phone, { ...session, ultimoTema: 'justificaciones' });
  }
}

module.exports = { showJustificaciones, handleJustificacionReply };
