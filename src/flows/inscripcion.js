const { sendText, sendCtaUrl, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                     = require('../services/session');
const { tagFlow }                           = require('../services/chatwoot');
const { runTransfer }                       = require('./transfer');
const { showMenu }                          = require('./menu');
const { showBotCsat }                       = require('./resuelto');

async function showInscripcion(phone, session) {
  updateSession(phone, { ultimoTema: 'inscripcion' });
  tagFlow(phone, ['bot-activo', 'inscripcion'], 'Inscripción');

  if (session.verified === true && session.isMember === true) {
    const tier = session.membershipTier;
    const tierBeneficio = tier === 'WE BLACK'
      ? `✨ Como miembro *${tier}*, puedes inscribirte en programas de forma *ilimitada* — ¡es uno de tus grandes beneficios!`
      : tier === 'WE PLAT'
      ? `🥈 Como miembro *${tier}*, puedes inscribirte en hasta *5 programas* como parte de tu membresía.`
      : `✨ Como miembro *${tier}*, puedes inscribirte en hasta *2 programas* como parte de tu membresía.`;

    await sendText(
      phone,
      `${tierBeneficio}\n\n` +
      `📩 Aquí tienes el link de inscripción:\n` +
      `🔗 https://forms.gle/4dMmBtTuHaz1fYdb6\n\n` +
      `✅ No olvides revisar los horarios disponibles y elegir el que mejor se adapte a ti.\n\n` +
      `Si tienes dudas o necesitas ayuda con el registro, ¡estoy para ayudarte! 💬😊`
    );
    await delay(500);
    await sendButtons(phone, `¿Pudiste completar tu registro? 😊`, [
      { id: 'insc_registrado', title: '✅ Ya me registré' },
      { id: 'insc_duda',       title: '❓ Tengo una duda' },
      { id: 'insc_menu',       title: '🏠 Menú principal' },
    ]);
  } else {
    const salesPhone = process.env.PHONE_SALES || '51999606366';
    const salesName  = process.env.NAME_SALES  || 'nuestra asesora';
    const waUrl      = `https://wa.me/${salesPhone}?text=Hola%2C%20soy%20alumno%20de%20W%7CE%20Educaci%C3%B3n%20Ejecutiva%20y%20quisiera%20recibir%20asesor%C3%ADa%20sobre%20inscripci%C3%B3n%20a%20un%20programa%20%F0%9F%98%8A`;
    await sendText(
      phone,
      `Para orientarte con tu inscripción, te conectaré con ${salesName} de nuestro equipo 👩‍💻\n` +
      `📌 *+${salesPhone}*`
    );
    await delay(500);
    await sendCtaUrl(
      phone,
      `Toca el botón para escribirle directamente por WhatsApp 👇`,
      `Contactar asesor`,
      waUrl
    );
    await delay(500);
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
        `¡Listo! Tu inscripción fue registrada correctamente. 📝 El equipo académico revisará tu solicitud.`
      );
      return showBotCsat(phone);

    case 'insc_duda':
      return runTransfer(phone, session, 'Duda sobre inscripción');

    case 'insc_menu':
      return showMenu(phone, session.nombre);

    default:
      return showMenu(phone, session.nombre);
  }
}

module.exports = { showInscripcion, handleInscripcionReply };
