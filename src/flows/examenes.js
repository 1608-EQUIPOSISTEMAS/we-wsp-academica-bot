const { sendFlow, sendButtons }         = require('../services/whatsapp');
const { updateSession }                 = require('../services/session');
const { tagFlow, addPrivateNote }       = require('../services/chatwoot');
const { runTransfer }                   = require('./transfer');
const { showMenu }                      = require('./menu');

const FLOW_ID_EXAMENES = '2197154941030160';

async function showExamenes(phone) {
  updateSession(phone, { estado: 'flow_examenes', ultimoTema: 'examenes_int' });
  tagFlow(phone, ['bot-activo', 'examenes-int'], 'Exámenes Internacionales');

  await sendFlow(
    phone,
    FLOW_ID_EXAMENES,
    'Exámenes Internacionales 🎓',
    'Completa el formulario con tus datos para iniciar el trámite de inscripción a tu examen de certificación internacional.\n\n⏳ El proceso de validación toma entre 10 y 15 días hábiles.',
    'W|E Educación Ejecutiva',
    'Solicitar examen'
  );
}

async function handleExamenesReply(phone, buttonId, session) {
  if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Exámenes Internacionales:* El alumno reporta problemas con el formulario del examen.`
      ).catch(err => console.error('[bot] Error nota privada examenes:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'examenes_int' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showExamenes, handleExamenesReply };
