const { sendText }                                                          = require('../services/whatsapp');
const { addPrivateNote, deactivateBot, setLabels, assignTeam, assignAgent } = require('../services/chatwoot');
const { updateSession }                                                     = require('../services/session');
const { isWithinBusinessHours, getScheduleText }                            = require('../services/schedule');

// ── Mapeo tema → equipo ───────────────────────────────────────────────────────
const TEAM_ACADEMICO = process.env.CHATWOOT_TEAM_ACADEMICO;
const TEAM_SOPORTE   = process.env.CHATWOOT_TEAM_SOPORTE;

const TOPIC_TEAM = {
  campus_virtual:       TEAM_ACADEMICO,
  certificacion:        TEAM_ACADEMICO,
  justificaciones:      TEAM_ACADEMICO,
  alumno_flex:          TEAM_ACADEMICO,
  cronograma:           TEAM_ACADEMICO,
  examenes_int:         TEAM_ACADEMICO,
  video_clases:         TEAM_ACADEMICO,
  materiales:           TEAM_ACADEMICO,
  reclamo_certificado:  TEAM_ACADEMICO,
  reclamo_activacion:   TEAM_ACADEMICO,
  reclamo_materiales:   TEAM_ACADEMICO,
  instaladores:         TEAM_SOPORTE,
  soporte_sap:          TEAM_SOPORTE,
  soporte_office:       TEAM_SOPORTE,
  soporte_instaladores: TEAM_SOPORTE,
};

// ── Nota privada compartida (dentro y fuera de horario) ───────────────────────
function buildNota(session, extraNote, fueraDeHorario = false) {
  const historialTexto = (session.historial || [])
    .map(m => `${m.role === 'bot' ? '🤖 Bot' : '👤 Alumno'}: ${m.content}`)
    .join('\n');

  let nota = fueraDeHorario ? `⏰ *FUERA DE HORARIO — consulta pendiente*\n\n` : '';
  nota    += `📋 *Datos del alumno*\n`;
  nota    += `• Nombre: ${session.nombre    || 'Desconocido'}\n`;
  nota    += `• Correo: ${session.correo    || 'N/A'}\n`;
  nota    += `• Último tema: ${session.ultimoTema || 'N/A'}\n`;
  if (extraNote)      nota += `\n📝 *Dato adicional:* ${extraNote}\n`;
  if (historialTexto) nota += `\n💬 *Historial del bot:*\n${historialTexto}`;
  return nota;
}

function applyLabelsAndAssign(convId, session, labels) {
  setLabels(convId, labels);
  const teamId = TOPIC_TEAM[session.ultimoTema];
  if (teamId) assignTeam(convId, teamId);
  assignAgent(convId, process.env.CHATWOOT_DEFAULT_AGENT_ID);
}

// ── Transfer dentro de horario ────────────────────────────────────────────────
async function runTransfer(phone, session, extraNote) {
  if (!isWithinBusinessHours()) {
    return runTransferFueraDeHorario(phone, session, extraNote);
  }

  // 1. Mensaje de espera al alumno
  await sendText(
    phone,
    `Entendido 💙 En breve un asesor del equipo académico te atenderá.\n\n` +
    `⏱️ Tiempo de espera estimado: *15 minutos*\n` +
    `Por favor, mantente atento a este chat.`
  );

  if (session.conversationId) {
    const convId = session.conversationId;
    addPrivateNote(convId, buildNota(session, extraNote)).catch(err =>
      console.error('[transfer] Error al agregar nota privada:', err)
    );
    applyLabelsAndAssign(convId, session, ['transfer-humano']);
    deactivateBot(convId);
  }

  updateSession(phone, {
    estado:             'en_atencion_humana',
    en_atencion_humana: true,
    transfer_replies:   0,
  });
}

// ── Transfer fuera de horario ─────────────────────────────────────────────────
async function runTransferFueraDeHorario(phone, session, extraNote) {
  const nombre = session.nombre || 'Alumno';

  await sendText(
    phone,
    `Hola ${nombre} 💙 Nuestro equipo académico atiende en el siguiente horario:\n\n` +
    `${getScheduleText()}\n\n` +
    `Tu consulta ha quedado registrada y un asesor te contactará al inicio del siguiente horario de atención 😊\n\n` +
    `Si tu consulta es urgente, también puedes escribirnos al correo:\n📧 pagos@we-educacion.com`
  );

  if (session.conversationId) {
    const convId = session.conversationId;
    addPrivateNote(convId, buildNota(session, extraNote, true)).catch(err =>
      console.error('[transfer] Error al agregar nota privada (fuera horario):', err)
    );
    applyLabelsAndAssign(convId, session, ['fuera-de-horario']);
    deactivateBot(convId);
  }

  updateSession(phone, {
    estado:             'en_atencion_humana',
    en_atencion_humana: true,
    transfer_replies:   0,
  });
}

module.exports = { runTransfer };
