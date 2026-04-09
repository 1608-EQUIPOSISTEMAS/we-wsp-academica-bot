const { sendText, sendCtaUrl, sendButtons } = require('../services/whatsapp');
const { updateSession }                     = require('../services/session');
const { tagFlow }                           = require('../services/chatwoot');
const { runTransfer }                       = require('./transfer');
const { showMenu }                          = require('./menu');

async function showInscripcion(phone, session) {
  updateSession(phone, { ultimoTema: 'inscripcion' });
  tagFlow(phone, ['bot-activo', 'inscripcion'], 'Inscripción');

  if (session.verified === true && session.isMember === true) {
    await sendText(
      phone,
      `📩 Te comparto el link de inscripción para que puedas registrarte en el curso o programa de tu interés:\n` +
      `🔗 https://forms.gle/4dMmBtTuHaz1fYdb6\n\n` +
      `✨ Recuerda que con tu membresía activa tienes acceso ilimitado a todos los programas.\n` +
      `✅ No olvides revisar los horarios disponibles y elegir el que mejor se adapte a ti.\n\n` +
      `Si tienes dudas o necesitas ayuda con el registro, ¡estoy para ayudarte! 💬😊`
    );
    await sendButtons(phone, `¿Pudiste completar tu registro? 😊`, [
      { id: 'insc_registrado', title: '✅ Ya me registré' },
      { id: 'insc_duda',       title: '❓ Tengo una duda' },
      { id: 'insc_menu',       title: '🏠 Menú principal' },
    ]);
  } else {
    await sendText(
      phone,
      `Para que te asesoren en todas tus consultas y dudas, te comparto el número de una Asesora Experta 👩‍💻\n` +
      `📌 *Arleth* (asesora comercial)\n` +
      `👉 +51 999 606 366`
    );
    await sendCtaUrl(
      phone,
      `Para asesorarte con tu inscripción, contáctate con nuestra asesora experta 👩‍💻`,
      `Contactar a Arleth`,
      `https://wa.me/51999606366?text=Hola%20Arleth%2C%20soy%20alumno%20de%20W%7CE%20Educaci%C3%B3n%20Ejecutiva%20y%20quisiera%20recibir%20asesor%C3%ADa%20sobre%20inscripci%C3%B3n%20a%20un%20programa%20%F0%9F%98%8A`
    );
    await sendButtons(phone, `¿Necesitas algo más?`, [
      { id: 'insc_menu', title: '🏠 Menú principal' },
    ]);
  }

  updateSession(phone, { estado: 'flow_inscripcion_confirm' });
}

async function handleInscripcionReply(phone, id, session) {
  switch (id) {
    case 'insc_registrado':
      await sendText(
        phone,
        `¡Perfecto! 🎉 Tu registro fue enviado.\n` +
        `El equipo académico revisará tu solicitud\n` +
        `y te confirmará en breve 💙`
      );
      return showMenu(phone, session.nombre);

    case 'insc_duda':
      return runTransfer(phone, session, 'Duda sobre inscripción');

    case 'insc_menu':
      return showMenu(phone, session.nombre);

    default:
      return showMenu(phone, session.nombre);
  }
}

module.exports = { showInscripcion, handleInscripcionReply };
