const { addPrivateNote, tagFlow }  = require('./chatwoot');
const { getSession, updateSession } = require('./session');
const { sendText, delay }         = require('./whatsapp');
const { createSolicitud }         = require('./database');
const { showBotResuelto }         = require('../flows/resuelto');
const { handleJustificacionFlowResponse } = require('../flows/justificaciones');
const log                         = require('../utils/logger');

// ── Deduplicación: evita procesar el mismo Flow 2 veces ─────────────────────
// (Chatwoot parcheado y Meta webhook pueden disparar ambos)
const _processedFlows = new Set();
const DEDUP_TTL_MS    = 60_000; // limpiar después de 1 min

function _dedupKey(phone, flowData) {
  const keys = Object.keys(flowData).sort().join(',');
  const vals = Object.values(flowData).map(v => Array.isArray(v) ? v.join('|') : String(v)).join(',');
  return `${phone}:${keys}:${vals}`;
}

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
  // ── Deduplicación ──────────────────────────────────────────────────────────
  const key = _dedupKey(phone, flowData);
  if (_processedFlows.has(key)) {
    log.info('meta-flow', 'Flow duplicado ignorado', { phone });
    return;
  }
  _processedFlows.add(key);
  setTimeout(() => _processedFlows.delete(key), DEDUP_TTL_MS);

  const session = getSession(phone);

  // ── Flow de Justificaciones (tiene campo "tipo" con falta/tardanza + "sesion") ──
  if (flowData.tipo && flowData.sesion && flowData.motivo) {
    log.info('meta-flow', 'Flow de Justificación detectado', { phone, tipo: flowData.tipo });
    return handleJustificacionFlowResponse(phone, flowData, session);
  }

  // ── Flow de Exámenes Internacionales (tiene campo "tipo_examen") ──
  if (flowData.tipo_examen) {
    if (!session) {
      log.warn('meta-flow', 'Flow de Examen recibido sin sesión activa', { phone });
      return;
    }

    const convId  = session.conversationId;
    const summary = _buildExamSummary(flowData);

    log.info('meta-flow', 'Flow de Examen detectado', {
      phone, convId,
      tipoExamen: flowData.tipo_examen,
    });

    // Crear ticket para seguimiento del área académica
    let ticketNumber = null;
    try {
      const solicitud = await createSolicitud(
        session.studentId,
        convId,
        'EXAMEN_INTERNACIONAL',
        flowData.tipo_examen,
        null,
        summary,
        phone
      );
      ticketNumber = solicitud.ticket_number;
      updateSession(phone, { lastTicketNumber: ticketNumber });
    } catch (err) {
      log.error('meta-flow', 'Error creando ticket de examen', { phone, error: err.message });
    }

    if (convId) {
      const nota = ticketNumber
        ? `${summary}\n\n🎫 *Ticket:* ${ticketNumber}`
        : summary;
      await addPrivateNote(convId, nota).catch(err =>
        log.error('meta-flow', 'Error añadiendo nota privada', { phone, convId, error: err.message })
      );
    }

    let msg = `✅ *¡Solicitud enviada!*\n\n` +
      `Tu solicitud de examen *${flowData.tipo_examen}* ya fue derivada al área académica.\n\n`;
    if (ticketNumber) msg += `🎫 Tu número de ticket: *${ticketNumber}*\n\n`;
    msg += `Apenas tengan una respuesta, se contactarán contigo 💙`;

    await sendText(phone, msg);

    tagFlow(phone, ['resuelto-bot', 'examenes-int']);
    updateSession(phone, { estado: 'resuelto_bot', resuelto_bot_at: Date.now() });
    await delay(1500);
    await showBotResuelto(phone);
    return;
  }

  // ── Flow no reconocido ──
  log.warn('meta-flow', 'Flow response con campos no reconocidos', {
    phone, fields: Object.keys(flowData),
  });
}

module.exports = { handleMetaFlowResponse };
