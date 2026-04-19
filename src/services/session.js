const SESSION_TTL_MS  = 24 * 60 * 60 * 1000; // 24 horas
const CLEANUP_INTERVAL = 60 * 60 * 1000;      // limpiar cada hora

const sessions = new Map();

function getSession(phone) {
  const session = sessions.get(phone);
  if (!session) return null;

  const expired = Date.now() - session.ultimaInteraccion > SESSION_TTL_MS;
  if (expired) {
    sessions.delete(phone);
    return null;
  }
  return session;
}

function createSession(phone) {
  const session = {
    conversationId:      null,   // ID de conversación en Chatwoot
    nombre:              null,
    correo:              null,
    estado:              'inicio',
    ultimoTema:          null,
    pendingData:         null,   // datos temporales entre pasos de un flow
    historial:           [],
    en_atencion_humana:  false,  // true mientras un agente humano atiende
    conv_assigned_agent: null,   // ID del agente asignado
    ultimaActividad:     Date.now(), // última vez que el alumno envió un mensaje
    resuelto_bot_at:     null,   // timestamp cuando se preguntó "¿Algo más?"
    estado_inactividad:  null,   // null | 'advertido' | 'resuelto'
    bot_inactivity_warn1_sent: false,  // CASO 0A: primer aviso bot enviado
    bot_inactivity_warn2_sent: false,  // CASO 0B: segundo aviso bot enviado
    ultimaInteraccion:   Date.now(),
    // ── Identificación y verificación ──────────────────────────────────────
    verified:            false,  // true si phone de sesión coincide con phone en DB
    studentId:           null,   // id en ods_student_bot (si fue encontrado)
    // ── Selección de programas en flujos B ──────────────────────────────────
    programOptions:      null,   // array COMPLETO de programas del alumno
    programPage:         0,      // página actual de la lista paginada (0-based)
    pendingFlexProgram:  null,   // programa seleccionado para solicitud flex
    // ── Transfer / atención humana ───────────────────────────────────────────
    transfer_at:              null,   // timestamp cuando se hizo transfer
    transfer_wait_msg_sent:   false,  // true cuando se envió msg "lamentamos la espera"
    asesor_respondio:         false,  // true cuando el asesor envió su primer mensaje
    asesor_respondio_at:      null,
    alumno_respondio_post_asesor: false, // true cuando el alumno escribió después del asesor
    asesor_inactivity_msg_sent: false, // true cuando se envió msg "¿sigues ahí?"
    asesor_no_responde_msg_sent:       false, // true cuando se envió nota privada al asesor
    asesor_no_responde_alumno_msg_sent: false, // true cuando se envió msg de espera al alumno
    fuera_de_horario:         false,  // true cuando el transfer ocurrió fuera de horario
    resolved_by:              null,   // null | 'inactivity'
    // ── CSAT ────────────────────────────────────────────────────────────────
    csat_sent:        false,
    csat_sent_at:     null,
    lastTicketNumber: null,   // último ticket generado en esta sesión
  };
  sessions.set(phone, session);
  return session;
}

function getOrCreateSession(phone) {
  return getSession(phone) || createSession(phone);
}

function updateSession(phone, data) {
  const session = getOrCreateSession(phone);
  Object.assign(session, data, { ultimaInteraccion: Date.now() });
  sessions.set(phone, session);
  return session;
}

function deleteSession(phone) {
  sessions.delete(phone);
}

function addToHistory(phone, role, content) {
  const session = getOrCreateSession(phone);
  session.historial.push({ role, content });
  // Mantener solo los últimos 10 mensajes
  if (session.historial.length > 10) {
    session.historial = session.historial.slice(-10);
  }
  session.ultimaInteraccion = Date.now();
  sessions.set(phone, session);
}

// Limpiar sesiones expiradas periódicamente
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [phone, session] of sessions.entries()) {
    if (now - session.ultimaInteraccion > SESSION_TTL_MS) {
      sessions.delete(phone);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[session] Sesiones expiradas eliminadas: ${cleaned}`);
  }
}, CLEANUP_INTERVAL);

function getAllSessions() {
  return sessions;
}

/**
 * Busca la sesión activa que tenga conversationId === convId y la actualiza.
 * Útil para eventos de webhook donde sólo tenemos el ID de conversación.
 */
function updateSessionByConvId(convId, data) {
  if (!convId) return null;
  const target = String(convId);
  console.log(`[session] updateSessionByConvId buscando convId=${target} (type=${typeof convId}) en ${sessions.size} sesiones`);
  for (const [phone, session] of sessions.entries()) {
    const stored = String(session.conversationId);
    if (stored === target) {
      console.log(`[session] ✓ Encontrada sesión para convId=${target} → phone=${phone}`);
      Object.assign(session, data);
      sessions.set(phone, session);
      return session;
    }
  }
  console.log(`[session] ✗ No se encontró sesión para convId=${target}. Sesiones activas:`,
    [...sessions.entries()].map(([p, s]) => `${p}→conv=${s.conversationId}(${typeof s.conversationId})`).join(', ') || 'ninguna'
  );
  return null;
}

module.exports = {
  getSession,
  createSession,
  getOrCreateSession,
  updateSession,
  updateSessionByConvId,
  deleteSession,
  addToHistory,
  getAllSessions,
};
