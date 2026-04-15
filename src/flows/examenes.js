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
    `¡Excelente! 🌟 Rendir tu examen internacional es un gran paso. Para gestionar tu inscripción, sigue estos dos sencillos pasos:`
  );

  await delay(1200);

  await sendText(
    phone,
    `1️⃣ Completa tus datos en este formulario: https://forms.gle/GuUVsvJwTcdSjaAr5\n` +
    `2️⃣ Sube una captura de pantalla de *esta conversación* dentro de ese mismo formulario para validar tu solicitud. 📸\n\n` +
    `⏳ *Nota: Este trámite de validación toma entre 10 y 15 días hábiles.*`
  );

  await delay(1200);

  await sendButtons(
    phone,
    `Tómate tu tiempo para llenarlo con calma. Cuando termines, avísame por aquí, o dime si tienes alguna duda con el proceso. 👇`,
    [
      { id: 'exam_formulario_ok', title: '✅ Ya lo completé' },
      { id: 'form_problemas',     title: '🆘 Necesito ayuda' },
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
