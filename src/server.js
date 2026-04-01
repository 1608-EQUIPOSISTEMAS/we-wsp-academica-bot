require('dotenv').config();
const express = require('express');

const { handleIncoming }                                         = require('./bot');
const { postMessage, updateLabels }                              = require('./services/chatwoot');
const { getSession, deleteSession, updateSession,
        updateSessionByConvId }                                  = require('./services/session');
const { sendText, sendList }                                     = require('./services/whatsapp');
const { startInactivityWatcher }                                 = require('./services/inactivity');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

// ── Códigos Meta de ventana de 24h expirada ───────────────────────────────────
const WINDOW_EXPIRED_CODES = new Set([131047, 131026]);

function isWindowExpiredError(err) {
  const data = err.response?.data;
  if (!data) return false;
  const code = data.error_code
            || data.meta?.error_code
            || data.error?.code
            || data.errors?.[0]?.code;
  if (WINDOW_EXPIRED_CODES.has(Number(code))) return true;
  return JSON.stringify(data).includes('131047');
}

// ── Mensajes de cierre ────────────────────────────────────────────────────────

async function sendSimpleGoodbye(phone) {
  try {
    await sendText(
      phone,
      `¡Gracias por contactarnos! 😊\n` +
      `Que tengas un excelente día 💙\n` +
      `*W|E Educación Ejecutiva*`
    );
  } catch (err) {
    if (!isWindowExpiredError(err)) {
      console.error(`[webhook] Error enviando despedida: phone=${phone}:`, err.response?.data || err.message);
    }
  }
}

async function sendCsatSurvey(phone, session) {
  try {
    await sendList(
      phone,
      'Encuesta de satisfacción',
      '¿Cómo calificarías tu atención hoy? 😊\nPor favor selecciona una opción:',
      'W|E Educación Ejecutiva',
      'Ver opciones',
      [{
        title: 'Calificación',
        rows: [
          { id: 'csat_1', title: '⭐ 1',         description: 'Muy malo' },
          { id: 'csat_2', title: '⭐⭐ 2',       description: 'Malo' },
          { id: 'csat_3', title: '⭐⭐⭐ 3',     description: 'Regular' },
          { id: 'csat_4', title: '⭐⭐⭐⭐ 4',   description: 'Bueno' },
          { id: 'csat_5', title: '⭐⭐⭐⭐⭐ 5', description: 'Excelente' },
        ],
      }]
    );

    updateSession(phone, {
      estado:       'esperando_csat',
      csat_sent:    true,
      csat_sent_at: Date.now(),
    });

    // Quitar 'enviar-csat' (evita re-disparo) y añadir 'csat-enviado' (guard anti-eco)
    // conservando las etiquetas existentes del ticket.
    const convId = session?.conversationId;
    if (convId) updateLabels(convId, { add: ['csat-enviado'], remove: ['enviar-csat'] }).catch(() => {});

    console.log(`[webhook] CSAT enviado: phone=${phone}`);
  } catch (err) {
    if (!isWindowExpiredError(err)) {
      console.error(`[webhook] Error enviando CSAT: phone=${phone}:`, err.response?.data || err.message);
    }
    // Si falla el envío de CSAT, limpiar sesión de todas formas
    deleteSession(phone);
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

      // ── Asesor humano respondió ────────────────────────────────────────────
      // Detectar cuando el asesor (no el bot) envía un mensaje al alumno.
      if (
        payload.message_type !== 'incoming' &&
        !payload.private &&
        payload.sender?.type === 'agent'
      ) {
        const convId = payload.conversation?.id;
        console.log(`[webhook] Agente escribió:`, {
          convId,
          convIdType:   typeof convId,
          senderType:   payload.sender?.type,
          senderName:   payload.sender?.name,
          messageType:  payload.message_type,
          private:      payload.private,
        });
        if (convId) {
          const updated = updateSessionByConvId(convId, {
            asesor_respondio:    true,
            asesor_respondio_at: Date.now(),
          });
          console.log(`[webhook] Asesor respondió en conv=${convId} | sesión actualizada: ${updated ? 'SÍ' : 'NO'}`);
        }
        return;
      }

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

    // ── Conversación resuelta ────────────────────────────────────────────────
    // Chatwoot envía "conversation_status_changed" para todos los cambios.
    // Solo actuamos cuando es un cierre real: open → resolved.
    if (event === 'conversation_status_changed') {
      const status = payload.status;
      const currSt = payload.current_status;
      const prevSt = payload.previous_status;

      console.log(`[webhook] conversation_status_changed | status=${status} | current=${currSt} | previous=${prevSt} | id=${payload.id}`);

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

      const phone   = rawPhone.replace(/^\+/, '');
      const session = getSession(phone);

      console.log(`[webhook] Conversación resuelta: phone=${phone} conv=${conversationId} resolved_by=${session?.resolved_by || 'agent'}`);

      // CSAT ya no se envía aquí — se dispara por etiqueta 'enviar-csat' en conversation_updated.
      // Solo procesamos el cierre por inactividad (goodbye simple).
      if (session?.resolved_by === 'inactivity') {
        sendSimpleGoodbye(phone).finally(() => deleteSession(phone));
      }
      return;
    }

    // ── Fallback: conversation_resolved ─────────────────────────────────────
    if (event === 'conversation_resolved') {
      console.log(`[webhook] conversation_resolved recibido (fallback) | payload:`, JSON.stringify(payload));

      const conversationId = payload.id || payload.conversation?.id;
      const rawPhone       = payload.contact?.phone_number
                          || payload.meta?.sender?.phone_number
                          || payload.conversation?.meta?.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        console.warn('[webhook] conversation_resolved sin datos suficientes');
        return;
      }

      const phone   = rawPhone.replace(/^\+/, '');
      const session = getSession(phone);

      if (session?.resolved_by === 'inactivity') {
        sendSimpleGoodbye(phone).finally(() => deleteSession(phone));
      }
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

    // ── Conversación actualizada (etiquetas, agente asignado, etc.) ─────────────
    if (event === 'conversation_updated') {
      const rawPhone = payload.contact?.phone_number
                    || payload.meta?.sender?.phone_number;
      const convId   = payload.id || payload.conversation?.id;
      const labels   = payload.labels || payload.conversation?.labels || [];

      // ── Trigger CSAT: asesor añadió etiqueta 'enviar-csat' ─────────────────
      if (labels.includes('enviar-csat') && rawPhone && convId) {
        const phone   = rawPhone.replace(/^\+/, '');
        const session = getSession(phone);

        if (session?.csat_sent || session?.estado === 'esperando_csat') {
          console.log(`[webhook] enviar-csat ignorado — CSAT ya enviado (sesión activa): phone=${phone}`);
        } else if (labels.includes('csat-enviado') || labels.includes('csat-completado')) {
          console.log(`[webhook] enviar-csat ignorado — CSAT ya procesado (label): phone=${phone}`);
        } else {
          console.log(`[webhook] enviar-csat detectado → disparando CSAT: phone=${phone} conv=${convId}`);
          // Asegurar que la sesión tenga conversationId para que sendList funcione
          updateSession(phone, { conversationId: convId });
          sendCsatSurvey(phone, getSession(phone) || {});
        }
      }

      // ── Agente asignado ─────────────────────────────────────────────────────
      // NOTA: conversation_updated se dispara al asignar agente (incluso por el bot).
      // NO usarlo para detectar asesor_respondio — eso se verifica vía polling API.
      const agentId = payload.meta?.assignee?.id
                   || payload.conversation?.meta?.assignee?.id;
      if (rawPhone && agentId) {
        const phone = rawPhone.replace(/^\+/, '');
        updateSession(phone, { conv_assigned_agent: agentId });
        console.log(`[webhook] Agente asignado: phone=${phone} agent=${agentId}`);
      }
      return;
    }

    // ── message_updated — confirmaciones de entrega, ignorar ─────────────────
    if (event === 'message_updated') {
      console.log(`[webhook] message_updated ignorado (delivery status)`);
      return;
    }

    // ── Evento no manejado ───────────────────────────────────────────────────
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
