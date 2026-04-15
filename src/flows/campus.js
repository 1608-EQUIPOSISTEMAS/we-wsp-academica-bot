const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showBotResuelto }              = require('./resuelto');
const { showMenu }                     = require('./menu');

async function showCampus(phone, session) {
  updateSession(phone, { estado: 'flow_campus', ultimoTema: 'campus_virtual' });
  tagFlow(phone, ['bot-activo', 'campus-virtual'], 'Campus Virtual');

  const usuario = session?.correo || 'tu correo de inscripción';

  await sendText(
    phone,
    `¡Claro que sí! Todo tu material de estudio y las clases grabadas te esperan en el Campus Virtual 📚\n\n` +
    `🔗 Puedes ingresar desde aquí: https://we-educacion.com/web/login\n\n` +
    `• Usuario: *${usuario}*\n` +
    `🔑 *Tip de acceso:* Si es tu primera vez o nunca cambiaste tu clave, suele ser *1234567* o tu número de documento.`
  );

  await delay(1500);
  await sendButtons(
    phone,
    `Tómate tu tiempo para intentar ingresar. Si no recuerdas tu contraseña o tienes algún inconveniente, avísame y lo resolvemos. 👇`,
    [
      { id: 'mat_ok',         title: '✅ Pude ingresar bien' },
      { id: 'form_problemas', title: '🆘 Tengo problemas' },
      { id: 'menu_principal', title: '🔙 Menú principal' },
    ]
  );
}

async function handleCampusReply(phone, buttonId, session) {
  if (buttonId === 'mat_ok') {
    tagFlow(phone, ['resuelto-bot', 'campus-virtual']);
    await showBotResuelto(phone);

  } else if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Campus Virtual:* El alumno reporta problemas de acceso al campus virtual.`
      ).catch(err => console.error('[bot] Error nota privada campus:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'campus_virtual' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showCampus, handleCampusReply };
