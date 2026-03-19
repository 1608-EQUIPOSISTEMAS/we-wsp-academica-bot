/**
 * Chatwoot API — capa de bajo nivel + helpers de enriquecimiento.
 *
 * API pública:
 *   postMessage       — enviar mensaje a una conversación
 *   addPrivateNote    — nota interna para el agente
 *   setLabels         — reemplaza etiquetas de la conversación
 *   setCustomAttributes — actualiza atributos personalizados
 *   assignTeam        — asigna equipo a la conversación
 *   tagFlow           — fire-and-forget: etiquetas + tema_consulta
 *   tagAlumno         — fire-and-forget: datos del alumno verificado
 */

const axios = require('axios');

const { getSession } = require('./session');

const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1';

function getHeaders() {
  return {
    'api_access_token': process.env.CHATWOOT_API_TOKEN,
    'Content-Type':     'application/json',
  };
}

function apiUrl(path) {
  return `${process.env.CHATWOOT_API_URL}/api/v1${path}`;
}

// ── Mensajería ────────────────────────────────────────────────────────────────

async function postMessage(conversationId, payload) {
  try {
    const { data } = await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`),
      { private: false, ...payload },
      { headers: getHeaders() }
    );
    return data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[chatwoot] Error al enviar mensaje:', JSON.stringify(detail));
    throw err;
  }
}

async function addPrivateNote(conversationId, content) {
  return postMessage(conversationId, {
    content,
    message_type: 'outgoing',
    private:      true,
  });
}

// ── Etiquetas ─────────────────────────────────────────────────────────────────

async function setLabels(conversationId, labels) {
  try {
    await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/labels`),
      { labels },
      { headers: getHeaders() }
    );
  } catch (err) {
    console.error('[chatwoot] Error setLabels:', err.response?.data || err.message);
  }
}

// ── Atributos personalizados ──────────────────────────────────────────────────

async function setCustomAttributes(conversationId, attrs) {
  try {
    await axios.patch(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}`),
      { custom_attributes: attrs },
      { headers: getHeaders() }
    );
  } catch (err) {
    console.error('[chatwoot] Error setCustomAttributes:', err.response?.data || err.message);
  }
}

// ── Asignación de equipo ──────────────────────────────────────────────────────

async function assignTeam(conversationId, teamId) {
  if (!teamId) return;
  try {
    await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/assignments`),
      { team_id: Number(teamId) },
      { headers: getHeaders() }
    );
  } catch (err) {
    console.error('[chatwoot] Error assignTeam:', err.response?.data || err.message);
  }
}

// ── Helpers fire-and-forget ───────────────────────────────────────────────────

/**
 * Etiqueta un flujo y actualiza tema_consulta.
 * Usa phone para obtener el conversationId desde la sesión activa.
 */
function tagFlow(phone, labels, tema = null) {
  const convId = getSession(phone)?.conversationId;
  if (!convId) return;
  setLabels(convId, labels);
  if (tema) setCustomAttributes(convId, { tema_consulta: tema });
}

/**
 * Registra los datos del alumno verificado como atributos de la conversación.
 */
function tagAlumno(phone, nombre, correo) {
  const convId = getSession(phone)?.conversationId;
  if (!convId) return;
  setCustomAttributes(convId, {
    correo_alumno:    correo,
    nombre_alumno:    nombre,
    atendido_por_bot: true,
  });
}

module.exports = {
  postMessage,
  addPrivateNote,
  setLabels,
  setCustomAttributes,
  assignTeam,
  tagFlow,
  tagAlumno,
};
