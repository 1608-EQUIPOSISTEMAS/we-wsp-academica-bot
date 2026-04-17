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
  console.log(`[chatwoot] addPrivateNote conv=${conversationId} content="${content.slice(0, 80)}..."`);
  const result = await postMessage(conversationId, {
    content,
    message_type: 'outgoing',
    private:      true,
  });
  console.log(`[chatwoot] addPrivateNote OK conv=${conversationId} msgId=${result?.id}`);
  return result;
}

// ── Cambiar estado de conversación ───────────────────────────────────────────

async function resolveConversation(conversationId) {
  try {
    await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/toggle_status`),
      { status: 'resolved' },
      { headers: getHeaders() }
    );
    console.log(`[chatwoot] Conversación ${conversationId} resuelta`);
  } catch (err) {
    console.error('[chatwoot] Error resolveConversation:', err.response?.data || err.message);
  }
}

async function openConversation(conversationId) {
  console.log('[chatwoot] Abriendo conversación:', conversationId);
  try {
    const response = await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/toggle_status`),
      { status: 'open' },
      { headers: getHeaders() }
    );
    console.log('[chatwoot] openConversation response:', response.status);
    console.log('[chatwoot] openConversation body:', JSON.stringify(response.data));
  } catch (err) {
    console.error('[chatwoot] Error openConversation:', err.response?.data || err.message);
  }
}

// ── Desactivar agent bot en una conversación ─────────────────────────────────

async function deactivateBot(conversationId) {
  try {
    await axios.patch(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}`),
      { agent_bot: null },
      { headers: getHeaders() }
    );
    console.log(`[chatwoot] Bot desactivado en conversación ${conversationId}`);
  } catch (err) {
    console.error('[chatwoot] Error deactivateBot:', err.response?.data || err.message);
  }
}

// ── Etiquetas ─────────────────────────────────────────────────────────────────

/** Reemplaza TODAS las etiquetas de la conversación (uso interno). */
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

/** Obtiene las etiquetas actuales de la conversación. */
async function getLabels(conversationId) {
  try {
    const { data } = await axios.get(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/labels`),
      { headers: getHeaders() }
    );
    return data.payload || [];
  } catch (err) {
    console.error('[chatwoot] Error getLabels:', err.response?.data || err.message);
    return [];
  }
}

/**
 * Añade y/o quita etiquetas sin sobrescribir las existentes.
 * @param {string|number} conversationId
 * @param {{ add?: string[], remove?: string[] }} opts
 */
async function updateLabels(conversationId, { add = [], remove = [] } = {}) {
  const current = await getLabels(conversationId);
  const updated  = [...new Set([...current.filter(l => !remove.includes(l)), ...add])];
  await setLabels(conversationId, updated);
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

// ── Asignación de agente ──────────────────────────────────────────────────────

async function assignAgent(conversationId, agentId) {
  if (!agentId) return;
  try {
    await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/assignments`),
      { assignee_id: Number(agentId) },
      { headers: getHeaders() }
    );
  } catch (err) {
    console.error('[chatwoot] Error assignAgent:', err.response?.data || err.message);
  }
}

/**
 * Desasigna el agente actual de la conversación (deja el campo vacío).
 * Necesario al hacer transfer para que el bot no quede como agente asignado
 * y la conversación entre limpia a la cola del equipo.
 */
async function unassignAgent(conversationId) {
  try {
    await axios.post(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/assignments`),
      { assignee_id: null },
      { headers: getHeaders() }
    );
  } catch (err) {
    console.error('[chatwoot] Error unassignAgent:', err.response?.data || err.message);
  }
}

// ── Consultar mensajes de una conversación ─────────────────────────────────

/**
 * Obtiene los mensajes de una conversación vía API de Chatwoot.
 * Retorna el array de mensajes (más recientes primero).
 */
async function getConversationMessages(conversationId) {
  try {
    const { data } = await axios.get(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`),
      { headers: getHeaders() }
    );
    return data.payload || [];
  } catch (err) {
    console.error('[chatwoot] Error getConversationMessages:', err.response?.data || err.message);
    return [];
  }
}

/**
 * Verifica si un asesor HUMANO ha enviado mensajes en la conversación.
 * Excluye explícitamente los mensajes del W|E BOT (sender.id = CHATWOOT_BOT_AGENT_ID).
 *
 * @param {number|string} conversationId
 * @param {number}        [sinceMs=0]  Solo considerar mensajes después de este timestamp (ms)
 * @returns {{ responded: boolean, respondedAt: number|null }}
 *
 * En la API de Chatwoot:
 *   message_type: 0=incoming, 1=outgoing, 2=activity
 *   sender.id del bot = CHATWOOT_BOT_AGENT_ID (default: 1)
 */
async function checkAgentReplied(conversationId, sinceMs = 0) {
  // ID del agente-bot en Chatwoot: sus mensajes no cuentan como respuesta humana.
  const botAgentId = Number(process.env.CHATWOOT_BOT_AGENT_ID || 1);

  const messages = await getConversationMessages(conversationId);

  for (const msg of messages) {
    if (
      msg.message_type === 1    &&   // outgoing (asesor → alumno)
      msg.private       === false &&  // no es nota privada
      msg.sender?.id             &&   // tiene sender identificado
      msg.sender.id !== botAgentId    // NO es el W|E BOT
    ) {
      const ts = msg.created_at ? msg.created_at * 1000 : Date.now();
      if (sinceMs && ts < sinceMs) continue;
      console.log(`[chatwoot] checkAgentReplied: asesor humano "${msg.sender?.name}" (id=${msg.sender?.id}) respondió en conv=${conversationId} ts=${new Date(ts).toISOString()}`);
      return { responded: true, respondedAt: ts };
    }
  }
  console.log(`[chatwoot] checkAgentReplied: sin respuesta humana en conv=${conversationId} (since=${sinceMs ? new Date(sinceMs).toISOString() : 'inicio'})`);
  return { responded: false, respondedAt: null };
}

// ── Helpers fire-and-forget ───────────────────────────────────────────────────

/**
 * Etiqueta un flujo y actualiza tema_consulta.
 * Usa phone para obtener el conversationId desde la sesión activa.
 */
function tagFlow(phone, labels, tema = null) {
  const convId = getSession(phone)?.conversationId;
  if (!convId) return;
  updateLabels(convId, { add: labels });
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

/**
 * Actualiza el contenido de un mensaje existente en Chatwoot.
 * Útil para reemplazar el JSON crudo de un Meta Flow por texto formateado.
 */
async function updateMessageContent(conversationId, messageId, content) {
  try {
    await axios.patch(
      apiUrl(`/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages/${messageId}`),
      { content },
      { headers: getHeaders() }
    );
  } catch (err) {
    console.error('[chatwoot] Error updateMessageContent:', err.response?.data || err.message);
  }
}

module.exports = {
  postMessage,
  addPrivateNote,
  resolveConversation,
  openConversation,
  deactivateBot,
  setLabels,
  getLabels,
  updateLabels,
  setCustomAttributes,
  assignTeam,
  assignAgent,
  unassignAgent,
  getConversationMessages,
  checkAgentReplied,
  tagFlow,
  tagAlumno,
  updateMessageContent,
};
