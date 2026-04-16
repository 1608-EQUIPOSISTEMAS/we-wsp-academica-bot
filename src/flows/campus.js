const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showBotResuelto }              = require('./resuelto');
const { showMenu }                     = require('./menu');

async function showCampus(phone, session) {
  updateSession(phone, { estado: 'flow_campus', ultimoTema: 'campus_virtual' });
  tagFlow(phone, ['bot-activo', 'campus-virtual'], 'Campus Virtual');

  await sendButtons(
    phone,
    `¿Con qué te puedo ayudar sobre el Campus Virtual? 🎓`,
    [
      { id: 'campus_ingreso',     title: 'Ingresar al campus' },
      { id: 'campus_programa',    title: 'No veo mi programa' },
      { id: 'campus_desbloqueo',  title: 'Desbloqueo de campus' },
    ]
  );
}

async function handleCampusReply(phone, buttonId, session) {
  if (buttonId === 'campus_ingreso') {
    const usuario = session?.correo || 'tu correo de inscripción';
    await sendText(
      phone,
      `¡Claro! Puedes ingresar al Campus Virtual desde aquí 📚\n\n` +
      `🔗 https://we-educacion.com/web/login\n\n` +
      `En el login encontrarás dos campos:\n` +
      `• *Correo:* ${usuario}\n` +
      `• *Contraseña:* Si es tu primera vez o nunca la cambiaste, suele ser *1234567* o tu número de documento.\n\n` +
      `🔑 Si en algún momento cambiaste tu contraseña, usa esa. Y si no la recuerdas, en la misma página verás el enlace *"¿Olvidaste tu contraseña?"* para restablecerla fácilmente.`
    );
    await delay(1500);
    await sendButtons(
      phone,
      `Tómate tu tiempo. Si no puedes ingresar, avísame y lo resolvemos. 👇`,
      [
        { id: 'mat_ok',         title: '✅ Pude ingresar' },
        { id: 'form_problemas', title: '🆘 Tengo problemas' },
        { id: 'menu_principal', title: '🔙 Menú principal' },
      ]
    );

  } else if (buttonId === 'campus_programa') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Campus Virtual:* El alumno no encuentra su programa en el campus.`
      ).catch(err => console.error('[bot] Error nota privada campus:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'campus_programa' });

  } else if (buttonId === 'campus_desbloqueo') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Campus Virtual:* El alumno solicita desbloqueo de campus — derivar a Finanzas.`
      ).catch(err => console.error('[bot] Error nota privada campus:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'campus_desbloqueo' });

  } else if (buttonId === 'mat_ok') {
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
