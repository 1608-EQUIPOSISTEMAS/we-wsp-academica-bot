const { addPrivateNote } = require('./chatwoot');
const { getSession }     = require('./session');
const { runTransfer }    = require('../flows/transfer');
const { handleJustificacionFlowResponse } = require('../flows/justificaciones');
const log                = require('../utils/logger');

// ── Etiquetas legibles para los campos del Flow de Exámenes ──────────────────
const EXAM_LABELS = {
  tipo_examen: 'Tipo de examen',
  dias:        'Días disponibles',
  horario:     'Horario tentativo',
  simulador:   'Simulador de práctica (S/50)',
};

function _buildExamSummary(data) {
  const lines = ['📊 *Solicitud de Examen Internacional (Meta Flow)*\n'];
  for (const [key, value] of Object.entries(data)) {
    const label = EXAM_LABELS[key] || key;
    const val   = Array.isArray(value) ? value.join(', ') : String(value);
    lines.push(`• *${label}:* ${val}`);
  }
  return lines.join('\n');
}

/**
 * Router central de Meta Flows.
 * Detecta qué Flow respondió el alumno según los campos del payload
 * y delega al handler correspondiente.
 */
async function handleMetaFlowResponse(phone, flowData) {
  const session = getSession(phone);

  // ── Flow de Justificaciones (tiene campo "tipo" con falta/tardanza + "sesion") ──
  if (flowData.tipo && flowData.sesion && flowData.motivo) {
    log.info('meta-flow', 'Flow de Justificación detectado', { phone, tipo: flowData.tipo });
    return handleJustificacionFlowResponse(phone, flowData, session);
  }

  // ── Flow de Exámenes Internacionales (tiene campo "tipo_examen") ──
  if (flowData.tipo_examen) {
    const convId  = session?.conversationId;
    const summary = _buildExamSummary(flowData);

    log.info('meta-flow', 'Flow de Examen detectado', {
      phone, convId,
      tipoExamen: flowData.tipo_examen,
    });

    if (convId) {
      await addPrivateNote(convId, summary).catch(err =>
        log.error('meta-flow', 'Error añadiendo nota privada', { phone, convId, error: err.message })
      );
    }

    await runTransfer(
      phone,
      { ...session, ultimoTema: 'examenes_int', conversationId: convId },
      `Flow completado — Examen: ${flowData.tipo_examen}`
    );
    return;
  }

  // ── Flow no reconocido ──
  log.warn('meta-flow', 'Flow response con campos no reconocidos', {
    phone, fields: Object.keys(flowData),
  });
}

module.exports = { handleMetaFlowResponse };
