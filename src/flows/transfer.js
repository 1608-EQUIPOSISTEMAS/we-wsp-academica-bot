const { sendText }                                                          = require('../services/whatsapp');
const { addPrivateNote, deactivateBot, setLabels, assignTeam, assignAgent, openConversation } = require('../services/chatwoot');
const { updateSession }                                                     = require('../services/session');
const { isWithinBusinessHours, getScheduleText }                            = require('../services/schedule');
const { createSolicitud }                                                   = require('../services/database');

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

// ── Mapeo tema → tipo de solicitud en DB ─────────────────────────────────────
const TIPO_MAP = {
  campus_virtual:        'CAMPUS_ACCESO',
  reclamo_activacion:    'CAMPUS_ACCESO',
  reclamo_certificado:   'CERTIFICADO_PENDIENTE',
  instaladores:          'INSTALADOR_SAP',
  soporte_sap:           'INSTALADOR_SAP',
  soporte_instaladores:  'INSTALADOR_SAP',
  soporte_office:        'INSTALADOR_OFFICE',
  grupo_whatsapp:        'GRUPO_WHATSAPP',
  justificaciones:       'JUSTIFICACION',
  examenes_int:          'EXAMENES_INT',
  cronograma:            'CRONOGRAMA',
  funciones_docente:     'FUNCIONES_DOCENTE',
  inscripcion:           'INSCRIPCION',
  alumno_flex:           'SOLICITUD_FLEX',
  hablar_asesor:         'CONSULTA_GENERAL',
  'fuera-de-horario':    'FUERA_DE_HORARIO',
  verificacion_fallida:  'VERIFICACION_FALLIDA',
  correo_no_encontrado:  'VERIFICACION_FALLIDA',
};

function getTipo(ultimoTema) {
  return TIPO_MAP[ultimoTema] || 'CONSULTA_GENERAL';
}

// ── Nota privada para Chatwoot ────────────────────────────────────────────────
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

// ── Notes para la DB (resumen del historial del alumno) ──────────────────────
function buildDbNotes(session, extraNote) {
  const recentMsgs = (session.historial || [])
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => m.content)
    .join(' | ');

  let notes = `Tema: ${session.ultimoTema || 'general'}`;
  if (recentMsgs) notes += ` | Mensajes: ${recentMsgs}`;
  if (extraNote)  notes += ` | ${extraNote}`;
  return notes;
}

function applyLabelsAndAssign(convId, session, labels) {
  setLabels(convId, labels);
  const teamId = TOPIC_TEAM[session.ultimoTema];
  if (teamId) assignTeam(convId, teamId);
  assignAgent(convId, process.env.CHATWOOT_DEFAULT_AGENT_ID);
}

// ── Transfer principal ────────────────────────────────────────────────────────
/**
 * @param {string}  phone
 * @param {Object}  session
 * @param {string}  [extraNote]
 * @param {Object}  [opts]
 * @param {boolean} [opts.skipTicket=false]  true cuando el flujo ya creó su propio ticket
 *                                           (certificados Rama B, alumno_flex Rama B)
 */
async function runTransfer(phone, session, extraNote, opts = {}) {
  const { skipTicket = false } = opts;

  // ── 1. Crear ticket en DB (salvo que el flujo llamante ya lo haya creado) ──
  let solicitud = null;
  if (!skipTicket) {
    try {
      const tipo = getTipo(session.ultimoTema);
      solicitud  = await createSolicitud(
        session.studentId   || null,
        session.conversationId,
        tipo,
        null,   // programName — no aplica en transfer genérico
        null,
        buildDbNotes(session, extraNote),
        phone
      );
    } catch (err) {
      console.error('[transfer] Error creando solicitud:', err.message);
      // No bloquear el transfer por este error
    }
  }

  if (!isWithinBusinessHours()) {
    return _transferFueraDeHorario(phone, session, extraNote, solicitud);
  }
  return _transferDentroHorario(phone, session, extraNote, solicitud);
}

// ── Dentro de horario ─────────────────────────────────────────────────────────
async function _transferDentroHorario(phone, session, extraNote, solicitud) {
  const tipo = getTipo(session.ultimoTema);

  if (solicitud && tipo !== 'CONSULTA_GENERAL') {
    await sendText(
      phone,
      `🎫 *Tu número de ticket: ${solicitud.ticket_number}*\n` +
      `Un asesor te atenderá en breve 💙\n\n` +
      `⏱️ Tiempo de espera estimado: *15 minutos*\n` +
      `Por favor, mantente atento a este chat.`
    );
  } else {
    await sendText(
      phone,
      `Entendido 💙 En breve un asesor del equipo académico te atenderá.\n\n` +
      `⏱️ Tiempo de espera estimado: *15 minutos*\n` +
      `Por favor, mantente atento a este chat.`
    );
  }

  if (session.conversationId) {
    const convId = session.conversationId;
    // PENDING → OPEN: la conversación aparece en la cola de asesores
    await openConversation(convId);
    addPrivateNote(convId, buildNota(session, extraNote)).catch(err =>
      console.error('[transfer] Error al agregar nota privada:', err)
    );
    applyLabelsAndAssign(convId, session, ['transfer-humano']);
    deactivateBot(convId);
  }

  updateSession(phone, {
    estado:               'en_atencion_humana',
    en_atencion_humana:   true,
    transfer_replies:     0,
    transfer_at:          Date.now(),
    transfer_wait_msg_sent: false,
    asesor_respondio:     false,
    asesor_inactivity_msg_sent: false,
    ...(solicitud ? { lastTicketNumber: solicitud.ticket_number } : {}),
  });
}

// ── Fuera de horario ──────────────────────────────────────────────────────────
async function _transferFueraDeHorario(phone, session, extraNote, solicitud) {
  const nombre = session.nombre || 'Alumno';
  const tipo   = getTipo(session.ultimoTema);

  if (solicitud && tipo !== 'CONSULTA_GENERAL') {
    await sendText(
      phone,
      `🎫 *Tu número de ticket: ${solicitud.ticket_number}*\n` +
      `Tu consulta ha quedado registrada 😊\n\n` +
      `⏰ Nuestro equipo atiende:\n${getScheduleText()}\n\n` +
      `Un asesor te contactará al inicio del siguiente horario de atención.`
    );
  } else {
    await sendText(
      phone,
      `Hola ${nombre} 💙 Nuestro equipo académico atiende en el siguiente horario:\n\n` +
      `${getScheduleText()}\n\n` +
      `Tu consulta ha quedado registrada y un asesor te contactará al inicio del siguiente horario de atención 😊` 
    );
  }

  if (session.conversationId) {
    const convId = session.conversationId;
    // PENDING → OPEN: la conversación aparece en la cola de asesores
    await openConversation(convId);
    addPrivateNote(convId, buildNota(session, extraNote, true)).catch(err =>
      console.error('[transfer] Error al agregar nota privada (fuera horario):', err)
    );
    applyLabelsAndAssign(convId, session, ['fuera-de-horario']);
    deactivateBot(convId);
  }

  updateSession(phone, {
    estado:               'en_atencion_humana',
    en_atencion_humana:   true,
    fuera_de_horario:     true,
    transfer_replies:     0,
    transfer_at:          Date.now(),
    transfer_wait_msg_sent: false,
    asesor_respondio:     false,
    asesor_inactivity_msg_sent: false,
    ...(solicitud ? { lastTicketNumber: solicitud.ticket_number } : {}),
  });
}

module.exports = { runTransfer };
