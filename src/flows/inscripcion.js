const { sendText, sendCtaUrl }     = require('../services/whatsapp');
const { updateSession }            = require('../services/session');
const { tagFlow }                  = require('../services/chatwoot');
const { findMembershipByEmail }    = require('../services/database');

async function showInscripcion(phone, session) {
  updateSession(phone, { estado: 'menu', ultimoTema: 'inscripcion' });
  tagFlow(phone, ['bot-activo', 'inscripcion'], 'Inscripción');

  let membership = { isMember: false };
  if (session.correo) {
    try {
      membership = await findMembershipByEmail(session.correo);
    } catch (err) {
      console.error('[inscripcion] Error consultando membresía:', err.message);
    }
  }

  if (membership.isMember) {
    await sendText(
      phone,
      `📩 Te comparto el link de inscripción para que puedas registrarte en el curso o programa de tu interés:\n` +
      `🔗 https://forms.gle/4dMmBtTuHaz1fYdb6\n\n` +
      `✨ Recuerda que con tu membresía activa tienes acceso ilimitado a todos los programas.\n` +
      `✅ No olvides revisar los horarios disponibles y elegir el que mejor se adapte a ti.\n\n` +
      `Si tienes dudas o necesitas ayuda con el registro, ¡estoy para ayudarte! 💬😊`
    );
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
  }
}

module.exports = { showInscripcion };
