const { sendText, sendButtons, delay }  = require('../services/whatsapp');
const { updateSession }                 = require('../services/session');
const { tagFlow, addPrivateNote }       = require('../services/chatwoot');
const { runTransfer }                   = require('./transfer');
const { showMenu }                      = require('./menu');

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

  await delay(500);
  await sendButtons(
    phone,
    `¿Qué deseas hacer?`,
    [
      { id: 'exam_formulario_ok', title: '✅ Llené el form' },
      { id: 'form_problemas',     title: '⚠️ Tengo problemas' },
      { id: 'menu_principal',     title: '🔙 Menú principal' },
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

  } else if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Exámenes Internacionales:* El alumno reporta problemas al completar el formulario de inscripción al examen.`
      ).catch(err => console.error('[bot] Error nota privada examenes:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'examenes_int' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showExamenes, handleExamenesReply };
