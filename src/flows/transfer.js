const { sendText }                        = require('../services/whatsapp');
const { addPrivateNote, setLabels, assignTeam } = require('../services/chatwoot');
const { updateSession }                   = require('../services/session');

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

async function runTransfer(phone, session, extraNote) {
  // 1. Mensaje de despedida al alumno
  await sendText(
    phone,
    `Entendido 💙 En breve un asesor del equipo académico te atenderá.\n\n` +
    `⏱️ Tiempo de espera estimado: *15 minutos*\n` +
    `Por favor, mantente atento a este chat.`
  );

  if (session.conversationId) {
    const convId = session.conversationId;

    // 2. Nota privada con contexto estructurado
    const historialTexto = (session.historial || [])
      .map(m => `${m.role === 'bot' ? '🤖 Bot' : '👤 Alumno'}: ${m.content}`)
      .join('\n');

    let nota  = `📋 *Datos del alumno*\n`;
    nota     += `• Nombre: ${session.nombre    || 'Desconocido'}\n`;
    nota     += `• Correo: ${session.correo    || 'N/A'}\n`;
    nota     += `• Último tema: ${session.ultimoTema || 'N/A'}\n`;
    if (extraNote)       nota += `\n📝 *Dato adicional:* ${extraNote}\n`;
    if (historialTexto)  nota += `\n💬 *Historial del bot:*\n${historialTexto}`;

    addPrivateNote(convId, nota).catch(err =>
      console.error('[transfer] Error al agregar nota privada:', err)
    );

    // 3. Etiqueta "transfer-humano"
    setLabels(convId, ['transfer-humano']);

    // 4. Asignar equipo según el tema
    const teamId = TOPIC_TEAM[session.ultimoTema];
    if (teamId) assignTeam(convId, teamId);
  }

  // 5. Marcar sesión como transferida — el bot deja de responder
  updateSession(phone, { estado: 'transferido', transfer_replies: 0 });
}

module.exports = { runTransfer };
