const { sendTextDirect }                                                    = require('../services/whatsapp');
const { addPrivateNote, deactivateBot, updateLabels, assignTeam, unassignAgent, openConversation } = require('../services/chatwoot');
const { updateSession }                                                     = require('../services/session');
const { isWithinBusinessHours, getScheduleText }                            = require('../services/schedule');
const { createSolicitud }                                                   = require('../services/database');
const log                                                                   = require('../utils/logger');

// ── Mapeo tema → equipo ───────────────────────────────────────────────────────
const TEAM_ACADEMICO = process.env.CHATWOOT_TEAM_ACADEMICO;
const TEAM_FINANZAS  = process.env.CHATWOOT_TEAM_FINANZAS;
const TEAM_GENERAL   = process.env.CHATWOOT_TEAM_GENERAL;

const TOPIC_TEAM = {
  campus_virtual:       TEAM_ACADEMICO,
  certificacion:        TEAM_ACADEMICO,
  justificaciones:      TEAM_ACADEMICO,
  alumno_flex:          TEAM_ACADEMICO,
  cronograma:           TEAM_ACADEMICO,
  examenes_int:         TEAM_ACADEMICO,
  materiales:           TEAM_ACADEMICO,
  reclamo_certificado:       TEAM_ACADEMICO,
  reclamo_activacion:        TEAM_ACADEMICO,
  reclamo_materiales:        TEAM_ACADEMICO,
  certificacion_avanzada:    TEAM_ACADEMICO,
  instaladores:         TEAM_ACADEMICO,
  soporte_sap:          TEAM_ACADEMICO,
  soporte_office:       TEAM_ACADEMICO,
  soporte_instaladores: TEAM_ACADEMICO,
  pagos:                TEAM_FINANZAS,
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
  justificaciones:       'JUSTIFICACION',
  examenes_int:          'EXAMENES_INT',
  cronograma:            'CRONOGRAMA',
  inscripcion:           'INSCRIPCION',
  alumno_flex:           'SOLICITUD_FLEX',
  hablar_asesor:         'CONSULTA_GENERAL',
  pagos:                 'CONSULTA_PAGOS',
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
  updateLabels(convId, { add: labels });
  const teamId = TOPIC_TEAM[session.ultimoTema] || TEAM_GENERAL;
  log.info('transfer', 'Asignando equipo', {
    convId: convId,
    ultimoTema: session.ultimoTema,
    teamId,
    fallback: !TOPIC_TEAM[session.ultimoTema],
  });
  assignTeam(convId, teamId);
  // Desasignar el bot como agente para que la conversación entre
  // limpia a la cola del equipo y una asesora pueda auto-asignársela.
  unassignAgent(convId).catch(err =>
    console.error('[transfer] Error al desasignar agente:', err)
  );
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
    await sendTextDirect(
      phone,
      `¡Entendido! Voy a transferirte con un humano de nuestro equipo para que te ayude mejor con esto. 🧑‍💻\n\n` +
      `💡 *Dato:* Ya le compartí nuestro historial de chat para que tenga todo el contexto y no tengas que repetir nada. ` +
      `Tu número de seguimiento es el *#${solicitud.ticket_number}*.\n\n` +
      `⏱️ El tiempo estimado de respuesta es de unos *15 minutos*. Te escribiremos por aquí mismo, ¡así que no te vayas lejos!`
    );
  } else {
    await sendTextDirect(
      phone,
      `¡Entendido! Voy a conectarte con uno de nuestros asesores para que te ayude con tu consulta. 🧑‍💻\n\n` +
      `💡 *Dato:* Ya le compartí nuestra conversación para que tenga todo el contexto.\n\n` +
      `⏱️ El tiempo estimado de respuesta es de unos *15 minutos*. Te escribiremos por aquí mismo. ☕`
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
    await sendTextDirect(
      phone,
      `¡Entendido! He dejado tu caso registrado con el número *#${solicitud.ticket_number}*. 📝\n\n` +
      `Como ahora mismo nuestro equipo humano está descansando 🌙, te responderemos apenas volvamos a conectarnos.\n\n` +
      `⏰ *Nuestro horario:*\n${getScheduleText()}\n\n` +
      `¡Hablamos pronto!`
    );
  } else {
    await sendTextDirect(
      phone,
      `¡Entendido! He dejado una nota a nuestro equipo para que revisen tu caso apenas se conecten. 📝\n\n` +
      `Como ahora mismo están descansando 🌙, te responderemos al inicio de nuestro turno.\n\n` +
      `⏰ *Nuestro horario:*\n${getScheduleText()}\n\n` +
      `¡Hablamos pronto!`
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
