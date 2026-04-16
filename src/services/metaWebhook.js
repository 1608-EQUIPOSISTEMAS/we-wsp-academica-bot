const { addPrivateNote } = require('./chatwoot');
const { getSession }     = require('./session');
const { runTransfer }    = require('../flows/transfer');
const log                = require('../utils/logger');

// ── Etiquetas legibles para los campos del Flow ───────────────────────────────
const FIELD_LABELS = {
  tipo_examen: 'Tipo de examen',
  dias:        'Días disponibles',
  horario:     'Horario tentativo',
  simulador:   'Simulador de práctica (S/50)',
};

/**
 * Convierte el objeto de respuesta del Flow en una nota privada formateada.
 */
function _buildSummary(data) {
  const lines = ['📊 *Solicitud de Examen Internacional (Meta Flow)*\n'];
  for (const [key, value] of Object.entries(data)) {
    const label = FIELD_LABELS[key] || key;
    const val   = Array.isArray(value) ? value.join(', ') : String(value);
    lines.push(`• *${label}:* ${val}`);
  }
  return lines.join('\n');
}

/**
 * Procesa la respuesta de un Meta Flow de examen internacional.
 *
 * @param {string} phone    - Teléfono normalizado (sin +, ej: "51922495159")
 * @param {Object} flowData - Objeto parseado del response_json del nfm_reply
 */
async function handleMetaFlowResponse(phone, flowData) {
  const session = getSession(phone);
  const convId  = session?.conversationId;
  const summary = _buildSummary(flowData);

  log.info('meta-flow', 'Flow response procesado', {
    phone,
    convId,
    tipoExamen: flowData.tipo_examen || 'N/A',
    simulador:  flowData.simulador   || 'N/A',
  });

  // ── Inyectar nota privada en la conversación activa ───────────────────────
  if (convId) {
    await addPrivateNote(convId, summary).catch(err =>
      log.error('meta-flow', 'Error añadiendo nota privada', {
        phone, convId, error: err.message,
      })
    );
  } else {
    log.warn('meta-flow', 'Sin conversationId en sesión — nota privada omitida', { phone });
  }

  // ── Transferir a asesor con contexto del examen ───────────────────────────
  await runTransfer(
    phone,
    { ...session, ultimoTema: 'examenes_int', conversationId: convId },
    `Flow completado — Examen: ${flowData.tipo_examen || 'N/A'}`
  );
}

module.exports = { handleMetaFlowResponse };
