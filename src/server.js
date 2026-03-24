require('dotenv').config();
const express = require('express');

const { handleIncoming }              = require('./bot');
const { postMessage }                 = require('./services/chatwoot');
const { deleteSession, updateSession } = require('./services/session');
const { startInactivityWatcher }      = require('./services/inactivity');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

// ── Códigos Meta de ventana de 24h expirada ───────────────────────────────────
const WINDOW_EXPIRED_CODES = new Set([131047, 131026]);

function isWindowExpiredError(err) {
  const data = err.response?.data;
  if (!data) return false;
  // Chatwoot puede devolver el código en distintas rutas según la versión
  const code = data.error_code
            || data.meta?.error_code
            || data.error?.code
            || data.errors?.[0]?.code;
  if (WINDOW_EXPIRED_CODES.has(Number(code))) return true;
  // Fallback: buscar el código como string en el body serializado
  return JSON.stringify(data).includes('131047');
}

async function sendClosingMessage(conversationId, phone) {
  try {
    await postMessage(conversationId, {
      content:      `¡Gracias por contactarnos! 😊\nSi necesitas algo más, escríbenos cuando quieras.\n💙 W|E Educación Ejecutiva`,
      message_type: 'outgoing',
      content_type: 'text',
    });
  } catch (err) {
    if (isWindowExpiredError(err)) {
      console.log(`[webhook] Conversación resuelta sin mensaje (ventana 24h expirada) | phone=${phone} conv=${conversationId}`);
    } else {
      console.error(`[webhook] Error enviando mensaje de cierre | phone=${phone}:`, err.response?.data || err.message);
    }
  }
}

// ── Webhook de Chatwoot Agent Bot ─────────────────────────────────────────────
app.post('/webhook/chatwoot', (req, res) => {
  res.sendStatus(200); // responder siempre 200 inmediato

  try {
    const payload = req.body;
    const event   = payload.event;

    // ── Mensaje nuevo del alumno ─────────────────────────────────────────────
    if (event === 'message_created') {
      if (payload.message_type !== 'incoming') return;

      const conversationId = payload.conversation?.id;
      const rawPhone       = payload.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        console.warn('[webhook] message_created sin conversationId o teléfono');
        return;
      }

      const phone = rawPhone.replace(/^\+/, '');
      const msg   = {
        id:                payload.id,
        content:           payload.content,
        contentType:       payload.content_type    || 'text',
        contentAttributes: payload.content_attributes || {},
      };

      handleIncoming(conversationId, phone, msg).catch(err =>
        console.error('[bot] Error al procesar mensaje:', err)
      );
      return;
    }

    // ── Cambio de estado de conversación ────────────────────────────────────
    // Chatwoot envía "conversation_status_changed" para TODOS los cambios:
    // creación (pending→open), resolución (open→resolved), reapertura, etc.
    // Solo actuamos cuando es un cierre real: open → resolved.
    if (event === 'conversation_status_changed') {
      const status   = payload.status;
      const currSt   = payload.current_status;
      const prevSt   = payload.previous_status;

      // Log completo para debug — ayuda a entender la estructura real del payload
      console.log(`[webhook] conversation_status_changed | status=${status} | current=${currSt} | previous=${prevSt} | id=${payload.id} | payload:`, JSON.stringify(payload));

      // Ignorar todo excepto el cierre real: open → resolved
      if (status !== 'resolved' || currSt !== 'resolved' || prevSt !== 'open') {
        console.log(`[webhook] conversation_status_changed ignorado (no es cierre real)`);
        return;
      }

      const conversationId = payload.id || payload.conversation?.id;
      const rawPhone       = payload.contact?.phone_number
                          || payload.meta?.sender?.phone_number
                          || payload.conversation?.meta?.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        console.warn('[webhook] conversation_status_changed (resolved) sin datos suficientes');
        return;
      }

      const phone = rawPhone.replace(/^\+/, '');
      console.log(`[webhook] Conversación resuelta: phone=${phone} conv=${conversationId}`);

      sendClosingMessage(conversationId, phone);
      deleteSession(phone);
      return;
    }

    // ── Fallback: conversation_resolved (por si Chatwoot lo envía también) ───
    if (event === 'conversation_resolved') {
      console.log(`[webhook] conversation_resolved recibido | payload:`, JSON.stringify(payload));

      const conversationId = payload.id || payload.conversation?.id;
      const rawPhone       = payload.contact?.phone_number
                          || payload.meta?.sender?.phone_number
                          || payload.conversation?.meta?.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        console.warn('[webhook] conversation_resolved sin datos suficientes');
        return;
      }

      const phone = rawPhone.replace(/^\+/, '');
      console.log(`[webhook] Conversación resuelta (fallback): phone=${phone} conv=${conversationId}`);

      sendClosingMessage(conversationId, phone);
      deleteSession(phone);
      return;
    }

    // ── Conversación reabierta ───────────────────────────────────────────────
    if (event === 'conversation_reopened') {
      const rawPhone = payload.contact?.phone_number
                    || payload.meta?.sender?.phone_number;
      if (rawPhone) {
        const phone = rawPhone.replace(/^\+/, '');
        console.log(`[webhook] Conversación reabierta: phone=${phone} — sesión conservada`);
      }
      return;
    }

    // ── Agente asignado a la conversación ────────────────────────────────────
    if (event === 'conversation_updated') {
      const rawPhone = payload.contact?.phone_number
                    || payload.meta?.sender?.phone_number;
      const agentId  = payload.meta?.assignee?.id
                    || payload.conversation?.meta?.assignee?.id;

      if (rawPhone && agentId) {
        const phone = rawPhone.replace(/^\+/, '');
        updateSession(phone, { conv_assigned_agent: agentId });
        console.log(`[webhook] Agente asignado: phone=${phone} agent=${agentId}`);
      }
      return;
    }

    // ── message_updated — confirmaciones de entrega, ignorar silenciosamente ─
    if (event === 'message_updated') {
      console.log(`[webhook] message_updated ignorado (delivery status)`);
      return;
    }

    // ── Evento no manejado — loggear para debug ──────────────────────────────
    console.log(`[webhook] Evento no manejado: ${event} | payload:`, JSON.stringify(payload));

  } catch (err) {
    console.error('[webhook] Error inesperado:', err);
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`[server] W|E Bot corriendo en puerto ${PORT}`);
  console.log(`[server] Webhook Chatwoot: POST /webhook/chatwoot`);
  startInactivityWatcher();
});
