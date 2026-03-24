const { sendText, sendButtons } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { tagFlow }               = require('../services/chatwoot');
const { runTransfer }           = require('./transfer');

async function showExamenes(phone) {
  updateSession(phone, { estado: 'flow_examenes', ultimoTema: 'examenes_int' });
  tagFlow(phone, ['bot-activo', 'examenes-int'], 'Exámenes Internacionales');

  await sendText(
    phone,
    `Para iniciar el proceso de tu Examen *internacional* es importante lo siguiente:\n\n` +
    `1️⃣ Llena el siguiente formulario: 🙋🏻‍♀️\n` +
    `👉 https://forms.gle/GuUVsvJwTcdSjaAr5\n\n` +
    `2️⃣ Adjunta la captura de pantalla de esta conversación para validar tu inscripción 🤝🏻\n\n` +
    `🚨 *Este proceso tiene una duración de entre 10 a 15 días hábiles.* ✨`
  );

  await sendButtons(
    phone,
    `¿Qué deseas hacer?`,
    [
      { id: 'exam_formulario_ok', title: '✅ Llené el form' },
      { id: 'exam_pregunta',      title: '❓ Una pregunta' },
    ]
  );
}

async function handleExamenesReply(phone, buttonId, session) {
  if (buttonId === 'exam_formulario_ok') {
    await sendText(
      phone,
      `¡Perfecto! 🎉 En breve un asesor confirmará tu inscripción y te dará seguimiento.\n` +
      `⏱️ Tiempo estimado: 15 minutos 💙`
    );
    await runTransfer(phone, { ...session, ultimoTema: 'examenes_int' });

  } else if (buttonId === 'exam_pregunta') {
    await runTransfer(phone, { ...session, ultimoTema: 'examenes_int' });
  }
}

module.exports = { showExamenes, handleExamenesReply };
