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
    ultimaInteraccion:   Date.now(),
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

module.exports = {
  getSession,
  createSession,
  getOrCreateSession,
  updateSession,
  deleteSession,
  addToHistory,
  getAllSessions,
};
