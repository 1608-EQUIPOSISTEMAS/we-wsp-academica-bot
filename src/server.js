require('dotenv').config();
const express   = require('express');
const rateLimit = require('express-rate-limit');
const axios     = require('axios');

const { handleIncoming }                                         = require('./bot');
const { postMessage, updateLabels }                              = require('./services/chatwoot');
const { getSession, deleteSession, updateSession,
        updateSessionByConvId, getAllSessions }                  = require('./services/session');
const { sendText, sendList }                                     = require('./services/whatsapp');
const { startInactivityWatcher }                                 = require('./services/inactivity');
const { handleMetaFlowResponse }                                 = require('./services/metaWebhook');
const log                                                        = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 3006;

// ── Handlers globales de errores no capturados ────────────────────────────────
// Garantizan que cualquier excepción que se escape de un try/catch llegue
// a stderr y sea capturada por docker logs.
process.on('uncaughtException', (err) => {
  log.error('process', 'uncaughtException — el proceso puede ser inestable', {
    error: err.message,
    stack: err.stack?.split('\n').slice(0, 5).join(' | '),
  });
  // No hacemos process.exit() — Docker restart:always lo reiniciará si es fatal.
});

process.on('unhandledRejection', (reason) => {
  log.error('process', 'unhandledRejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack:  reason instanceof Error ? reason.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
  });
});

// ── Health interval — métricas de sesiones cada hora ─────────────────────────
setInterval(() => {
  const sessions     = getAllSessions();
  const total        = sessions.size;
  const enHumana     = [...sessions.values()].filter(s => s.en_atencion_humana).length;
  const esperandoCsat = [...sessions.values()].filter(s => s.estado === 'esperando_csat').length;

  log.info('health', 'Sesiones activas en memoria', {
    total,
    en_atencion_humana: enHumana,
    esperando_csat:     esperandoCsat,
    pendingDebounce:    pendingMessages.size,
  });
}, 60 * 60 * 1000); // cada hora

// ── Necesario cuando el servidor corre detrás de un proxy/ngrok/reverse-proxy ─
app.set('trust proxy', 1);
app.use(express.json());

// ── Escudo 1: Rate limit HTTP por IP (100 req/min) ────────────────────────────
const webhookLimiter = rateLimit({
  windowMs:         60 * 1000,
  max:              100,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests' },
  handler: (req, res, _next, options) => {
    log.warn('rate-limit', 'IP bloqueada por exceso de requests', {
      ip:      req.ip,
      max:     options.max,
      windowS: 60,
    });
    res.status(429).json(options.message);
  },
});

// ── Debounce anti-flood (1.5s por teléfono) ───────────────────────────────────
const DEBOUNCE_MS     = 1500;
const pendingMessages = new Map(); // phone → { timer, conversationId, texts[], msg }

function scheduleMessage(conversationId, phone, msg) {
  const existing = pendingMessages.get(phone);

  const isText   = !msg.contentAttributes?.type;
  const incoming = isText ? (msg.content || '').trim() : null;

  let texts = existing ? existing.texts : [];
  if (existing) clearTimeout(existing.timer);

  if (incoming) {
    texts = [...texts, incoming];
  } else {
    texts = [];
  }

  const timer = setTimeout(() => {
    pendingMessages.delete(phone);

    const finalMsg = texts.length > 1
      ? { ...msg, content: texts.join(' ') }
      : msg;

    if (texts.length > 1) {
      log.info('debounce', 'Mensajes fusionados', {
        phone,
        count:   texts.length,
        content: finalMsg.content.slice(0, 80),
      });
    }

    handleIncoming(conversationId, phone, finalMsg).catch(err => {
      const session = getSession(phone);
      log.error('bot', 'Error al procesar mensaje entrante', {
        phone,
        convId:      conversationId,
        error:       err.message,
        stack:       err.stack?.split('\n').slice(0, 4).join(' | '),
        // Estado de sesión en el momento del fallo — clave para auditoría
        sessionEstado:     session?.estado      ?? 'sin-sesion',
        sessionUltimoTema: session?.ultimoTema  ?? null,
        sessionVerified:   session?.verified    ?? false,
      });
    });
  }, DEBOUNCE_MS);

  pendingMessages.set(phone, { timer, conversationId, texts, msg });
}

// ── Escudo 2: Anti-spam por teléfono (10 msgs/min) ───────────────────────────
const PHONE_RATE_WINDOW_MS = 60 * 1000;
const PHONE_RATE_MAX       = 10;
const phoneRateMap         = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [phone, state] of phoneRateMap) {
    if (now - state.windowStart > PHONE_RATE_WINDOW_MS) {
      phoneRateMap.delete(phone);
    }
  }
}, PHONE_RATE_WINDOW_MS);

function checkPhoneRate(phone) {
  const now   = Date.now();
  const state = phoneRateMap.get(phone);

  if (!state || now - state.windowStart > PHONE_RATE_WINDOW_MS) {
    phoneRateMap.set(phone, { count: 1, windowStart: now, warned: false });
    return 'ok';
  }

  state.count++;
  if (state.count <= PHONE_RATE_MAX) return 'ok';

  if (!state.warned) {
    state.warned = true;
    log.warn('rate-limit', 'Phone excedió límite — enviando aviso', {
      phone, max: PHONE_RATE_MAX, windowS: 60,
    });
    return 'warn';
  }
  log.warn('rate-limit', 'Phone bloqueado (spam continuo)', {
    phone, count: state.count,
  });
  return 'blocked';
}

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
      log.error('webhook', 'Error enviando despedida', {
        phone, error: err.response?.data || err.message,
      });
    }
  }
}

/**
 * Hand-back al bot tras resolución manual por asesor.
 * Si la sesión existe y tiene correo (alumno identificado) → vuelve al menú.
 * Si no hay sesión o no hay correo → deleteSession (usuario anónimo, bot arranca de cero).
 */
async function _handBackToBot(phone, session) {
  if (!session?.correo) {
    // Sin identificación previa → no tiene sentido volver al menú, limpiar
    deleteSession(phone);
    return;
  }

  updateSession(phone, {
    en_atencion_humana:         false,
    fuera_de_horario:           false,
    estado:                     'menu',
    transfer_replies:           0,
    asesor_respondio:           false,
    asesor_inactivity_msg_sent: false,
    transfer_wait_msg_sent:     false,
  });

  try {
    const { showMenu } = require('./flows/menu');
    await sendText(
      phone,
      `¡Espero que nuestro equipo te haya sido de gran ayuda! ✨ Si necesitas algo más, aquí sigo disponible para ti.`
    );
    await showMenu(phone, session.nombre);
    log.info('webhook', 'Hand-back al bot completado', { phone });
  } catch (err) {
    if (!isWindowExpiredError(err)) {
      log.error('webhook', 'Error en hand-back al bot', {
        phone, error: err.response?.data || err.message,
      });
    }
    // Si falla el envío (ventana cerrada, etc.) limpiamos la sesión
    deleteSession(phone);
  }
}

async function sendCsatSurvey(phone, session) {
  try {
    await sendList(
      phone,
      '📊 Encuesta de calidad',
      'Para W|E Educación Ejecutiva tu opinión es clave. ¿Cómo calificarías la atención que te brindó nuestro asesor hoy? 🌟',
      'W|E Educación Ejecutiva',
      'Ver opciones',
      [{
        title: 'Calificación',
        rows: [
          { id: 'csat_5', title: '⭐⭐⭐⭐⭐', description: 'Excelente' },
          { id: 'csat_4', title: '⭐⭐⭐⭐',   description: 'Buena' },
          { id: 'csat_3', title: '⭐⭐⭐',     description: 'Regular' },
          { id: 'csat_2', title: '⭐⭐',       description: 'Mala' },
          { id: 'csat_1', title: '⭐',         description: 'Muy mala' },
        ],
      }]
    );

    updateSession(phone, {
      estado:       'esperando_csat',
      csat_sent:    true,
      csat_sent_at: Date.now(),
    });

    const convId = session?.conversationId;
    if (convId) updateLabels(convId, { add: ['csat-enviado'], remove: ['enviar-csat'] }).catch(() => {});

    log.info('webhook', 'CSAT enviado', { phone, convId: session?.conversationId });
  } catch (err) {
    if (!isWindowExpiredError(err)) {
      log.error('webhook', 'Error enviando CSAT', {
        phone, convId: session?.conversationId,
        error: err.response?.data || err.message,
      });
    }
    deleteSession(phone);
  }
}

// ── Webhook de Chatwoot Agent Bot ─────────────────────────────────────────────
app.post('/webhook/chatwoot', webhookLimiter, (req, res) => {
  res.sendStatus(200);

  try {
    const payload = req.body;
    const event   = payload.event;

    // ── Filtro de Inbox: ignorar eventos de otras bandejas ───────────────────
    const INBOX_ID       = process.env.CHATWOOT_INBOX_ID ? Number(process.env.CHATWOOT_INBOX_ID) : null;
    const payloadInboxId = payload?.inbox?.id;
    if (INBOX_ID && payloadInboxId && payloadInboxId !== INBOX_ID) {
      log.debug('webhook', 'Evento ignorado — inbox diferente', {
        inboxEsperado: INBOX_ID,
        inboxRecibido: payloadInboxId,
        event,
      });
      return;
    }

    // ── [DEBUG] Logger espía para Meta Flow responses ────────────────────────
    // Activo solo con DEBUG_FLOW_RESPONSE=true en .env
    // Imprime el payload completo cuando detecta una respuesta de Flow.
    if (
      process.env.DEBUG_FLOW_RESPONSE === 'true' &&
      event === 'message_created' &&
      payload.message_type === 'incoming'
    ) {
      const content    = (payload.content || '').toLowerCase();
      const isFlowResp = content.includes('respuesta enviada') ||
                         content.includes('response sent')     ||
                         payload.content_type === 'input_csat' ||
                         payload.content_attributes?.type === 'input_select' ||
                         payload.content_attributes?.items !== undefined;

      if (isFlowResp || process.env.DEBUG_FLOW_RESPONSE === 'verbose') {
        log.info('debug-flow', '══ META FLOW RESPONSE PAYLOAD COMPLETO ══', {
          event,
          content:            payload.content,
          content_type:       payload.content_type,
          content_attributes: payload.content_attributes,
          source_id:          payload.source_id || payload.id,
          message_type:       payload.message_type,
          sender:             payload.sender,
          conversation_id:    payload.conversation?.id,
          // Campos que Meta podría inyectar vía Chatwoot
          additional_attributes: payload.additional_attributes,
          meta:               payload.meta,
          raw_payload_keys:   Object.keys(payload),
        });
        // Dump completo por si algún campo está anidado inesperadamente
        console.log('[debug-flow] RAW PAYLOAD:\n' + JSON.stringify(payload, null, 2));
      }
    }

    // ── Mensaje nuevo del alumno ─────────────────────────────────────────────
    if (event === 'message_created') {

      // ── Asesor humano respondió ──────────────────────────────────────────────
      if (
        payload.message_type !== 'incoming' &&
        !payload.private &&
        payload.sender?.type === 'agent'
      ) {
        const convId = payload.conversation?.id;
        log.info('webhook', 'Agente escribió en conversación', {
          convId,
          senderName:  payload.sender?.name,
          messageType: payload.message_type,
        });
        if (convId) {
          const updated = updateSessionByConvId(convId, {
            asesor_respondio:    true,
            asesor_respondio_at: Date.now(),
          });
          log.info('webhook', 'Flag asesor_respondio actualizado', {
            convId, sessionActualizada: !!updated,
          });
        }
        return;
      }

      if (payload.message_type !== 'incoming') return;

      const conversationId = payload.conversation?.id;
      const rawPhone       = payload.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        log.warn('webhook', 'message_created sin conversationId o teléfono', {
          convId: conversationId, hasPhone: !!rawPhone,
        });
        return;
      }

      const phone = rawPhone.replace(/^\+/, '');

      // ── Log de auditoría: campos clave del payload entrante ────────────────
      log.info('webhook', 'Mensaje entrante recibido', {
        phone,
        convId:      conversationId,
        contentType: payload.content_type || 'text',
        hasInteractive: !!payload.content_attributes?.type,
        interactiveType: payload.content_attributes?.type || null,
        contentPreview: (payload.content || '').slice(0, 60) || null,
      });

      // ── Escudo 2: anti-spam por teléfono ──────────────────────────────────
      const rateResult = checkPhoneRate(phone);
      if (rateResult === 'warn') {
        sendText(phone,
          `Estás enviando mensajes muy rápido. Por favor, espera 1 minuto antes de continuar. ⏳`
        ).catch(() => {});
        return;
      }
      if (rateResult === 'blocked') return;

      const msg = {
        id:                payload.id,
        content:           payload.content,
        contentType:       payload.content_type    || 'text',
        contentAttributes: payload.content_attributes || {},
      };

      scheduleMessage(conversationId, phone, msg);
      return;
    }

    // ── Conversación resuelta ────────────────────────────────────────────────
    if (event === 'conversation_status_changed') {
      const status = payload.status;
      const currSt = payload.current_status;
      const prevSt = payload.previous_status;

      log.info('webhook', 'conversation_status_changed', {
        status, currSt, prevSt, id: payload.id,
      });

      if (status !== 'resolved') {
        log.debug('webhook', 'conversation_status_changed ignorado', { status });
        return;
      }
      if (currSt !== undefined && currSt !== 'resolved') {
        log.debug('webhook', 'conversation_status_changed ignorado', { currSt });
        return;
      }

      const conversationId = payload.id || payload.conversation?.id;
      const rawPhone       = payload.contact?.phone_number
                          || payload.meta?.sender?.phone_number
                          || payload.conversation?.meta?.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        log.warn('webhook', 'conversation_status_changed (resolved) sin datos suficientes', {
          hasConvId: !!conversationId, hasPhone: !!rawPhone,
        });
        return;
      }

      const phone   = rawPhone.replace(/^\+/, '');
      const session = getSession(phone);

      log.info('webhook', 'Conversación resuelta', {
        phone, convId: conversationId, resolvedBy: session?.resolved_by || 'agent',
      });

      if (session?.resolved_by === 'inactivity') {
        sendSimpleGoodbye(phone).finally(() => deleteSession(phone));
      } else {
        _handBackToBot(phone, session);
      }
      return;
    }

    // ── Fallback: conversation_resolved ─────────────────────────────────────
    if (event === 'conversation_resolved') {
      log.info('webhook', 'conversation_resolved (fallback)', {
        id: payload.id || payload.conversation?.id,
      });

      const conversationId = payload.id || payload.conversation?.id;
      const rawPhone       = payload.contact?.phone_number
                          || payload.meta?.sender?.phone_number
                          || payload.conversation?.meta?.sender?.phone_number;

      if (!conversationId || !rawPhone) {
        log.warn('webhook', 'conversation_resolved sin datos suficientes');
        return;
      }

      const phone   = rawPhone.replace(/^\+/, '');
      const session = getSession(phone);

      if (session?.resolved_by === 'inactivity') {
        sendSimpleGoodbye(phone).finally(() => deleteSession(phone));
      } else {
        _handBackToBot(phone, session);
      }
      return;
    }

    // ── Conversación reabierta ───────────────────────────────────────────────
    if (event === 'conversation_reopened') {
      const rawPhone = payload.contact?.phone_number
                    || payload.meta?.sender?.phone_number;
      if (rawPhone) {
        log.info('webhook', 'Conversación reabierta — sesión conservada', {
          phone: rawPhone.replace(/^\+/, ''),
        });
      }
      return;
    }

    // ── Conversación actualizada ─────────────────────────────────────────────
    if (event === 'conversation_updated') {
      const rawPhone = payload.contact?.phone_number
                    || payload.meta?.sender?.phone_number;
      const convId   = payload.id || payload.conversation?.id;
      const labels   = payload.labels || payload.conversation?.labels || [];

      if (labels.includes('enviar-csat') && rawPhone && convId) {
        const phone   = rawPhone.replace(/^\+/, '');
        const session = getSession(phone);

        if (session?.csat_sent || session?.estado === 'esperando_csat') {
          log.info('webhook', 'enviar-csat ignorado — CSAT ya enviado', { phone, convId });
        } else if (labels.includes('csat-enviado') || labels.includes('csat-completado')) {
          log.info('webhook', 'enviar-csat ignorado — label ya presente', { phone, convId });
        } else {
          log.info('webhook', 'enviar-csat detectado → disparando CSAT', { phone, convId });
          updateSession(phone, { conversationId: convId });
          sendCsatSurvey(phone, getSession(phone) || {});
        }
      }

      const agentId = payload.meta?.assignee?.id
                   || payload.conversation?.meta?.assignee?.id;
      if (rawPhone && agentId) {
        const phone = rawPhone.replace(/^\+/, '');
        updateSession(phone, { conv_assigned_agent: agentId });
        log.info('webhook', 'Agente asignado a conversación', { phone, agentId, convId });
      }
      return;
    }

    // ── message_updated — confirmaciones de entrega, ignorar ─────────────────
    if (event === 'message_updated') {
      log.debug('webhook', 'message_updated ignorado (delivery status)');
      return;
    }

    // ── Evento no manejado ───────────────────────────────────────────────────
    log.warn('webhook', 'Evento no manejado', { event });

  } catch (err) {
    log.error('webhook', 'Error inesperado en handler de webhook', {
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }
});

// ── Middleware Transparente de Meta ───────────────────────────────────────────
// El bot es el webhook primario ante Meta. Cada payload recibido se reenvía
// a Chatwoot (proxy) y, si contiene un nfm_reply, se intercepta para procesar
// la respuesta del Flow antes de que Chatwoot pueda descartarla.

app.get('/webhook/meta', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    log.info('meta-webhook', 'Verificación de Meta exitosa');
    return res.status(200).send(challenge);
  }

  log.warn('meta-webhook', 'Verificación de Meta fallida', {
    mode, tokenMatch: token === process.env.META_VERIFY_TOKEN,
  });
  return res.sendStatus(403);
});

app.post('/webhook/meta', webhookLimiter, async (req, res) => {
  // 1. Respuesta inmediata a Meta (requerido en < 20s)
  res.sendStatus(200);

  const body = req.body;

  // ── Log de entrada para diagnóstico ─────────────────────────────────────────
  const incomingMessages = body?.entry?.[0]?.changes?.[0]?.value?.messages || [];
  log.info('meta-webhook', 'POST recibido', {
    entries:  (body?.entry || []).length,
    msgCount: incomingMessages.length,
    types:    incomingMessages.map(m => m.type),
    interactiveTypes: incomingMessages
      .filter(m => m.type === 'interactive')
      .map(m => m.interactive?.type),
  });

  // 2. Proxy transparente → reenviar a Chatwoot sin bloquear
  const chatwootWebhookUrl = process.env.CHATWOOT_META_WEBHOOK_URL;
  if (chatwootWebhookUrl) {
    axios.post(chatwootWebhookUrl, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    }).catch(err => {
      log.error('meta-webhook', 'Error reenviando payload a Chatwoot', {
        url:   chatwootWebhookUrl,
        error: err.message,
      });
    });
  } else {
    log.warn('meta-webhook', 'CHATWOOT_META_WEBHOOK_URL no definida — proxy desactivado');
  }

  // 3. Interceptar nfm_reply para procesar respuestas de Meta Flow
  try {
    const entries = body?.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const messages = change.value?.messages || [];
        for (const message of messages) {

          if (message.type !== 'interactive') continue;
          if (message.interactive?.type !== 'nfm_reply') continue;

          const nfmReply = message.interactive.nfm_reply;
          const rawPhone = message.from;
          if (!rawPhone || !nfmReply) continue;

          const phone = rawPhone.replace(/^\+/, '');

          let flowData;
          try {
            flowData = JSON.parse(nfmReply.response_json || '{}');
          } catch (parseErr) {
            log.error('meta-webhook', 'Error parseando response_json', {
              phone, error: parseErr.message,
            });
            continue;
          }

          log.info('meta-webhook', 'nfm_reply interceptado', {
            phone,
            flowName: nfmReply.name || 'unknown',
            fields:   Object.keys(flowData),
          });

          await handleMetaFlowResponse(phone, flowData);
        }
      }
    }
  } catch (err) {
    log.error('meta-webhook', 'Error procesando nfm_reply', {
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }
});

// ── Health check HTTP ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const sessions = getAllSessions();
  res.json({
    status:   'ok',
    uptime:   Math.floor(process.uptime()),
    sessions: sessions.size,
  });
});

// ── Arranque ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log.info('server', 'W|E Bot arrancado', {
    port:          PORT,
    env:           process.env.NODE_ENV || 'development',
    webhookCw:     'POST /webhook/chatwoot',
    webhookMeta:   'POST /webhook/meta',
    health:        'GET /health',
  });
  startInactivityWatcher();
});
