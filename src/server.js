require('dotenv').config();
const express = require('express');
const { handleIncoming } = require('./bot');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

// ── Webhook de Chatwoot Agent Bot (POST) ──────────────────────────────────────
app.post('/webhook/chatwoot', (req, res) => {
  // Responder 200 OK inmediato — Chatwoot espera respuesta rápida
  res.sendStatus(200);

  try {
    const payload = req.body;

    // Solo procesar eventos de mensaje nuevo
    if (payload.event !== 'message_created') return;

    // Solo mensajes entrantes del contacto (ignorar salientes, actividades internas)
    if (payload.message_type !== 'incoming') return;

    // Extraer datos del contacto y la conversación
    const conversationId = payload.conversation?.id;
    const rawPhone       = payload.sender?.phone_number;

    if (!conversationId || !rawPhone) {
      console.warn('[webhook] Payload sin conversationId o teléfono:', JSON.stringify(payload));
      return;
    }

    const phone = rawPhone.replace(/^\+/, ''); // normalizar: quitar '+' inicial

    const msg = {
      id:                payload.id,
      content:           payload.content,
      contentType:       payload.content_type   || 'text',
      contentAttributes: payload.content_attributes || {},
    };

    // Procesar de forma asíncrona (ya enviamos 200)
    handleIncoming(conversationId, phone, msg).catch(err =>
      console.error('[bot] Error al procesar mensaje:', err)
    );
  } catch (err) {
    console.error('[webhook] Error inesperado:', err);
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`[server] W|E Bot corriendo en puerto ${PORT}`);
  console.log(`[server] Webhook Chatwoot: POST /webhook/chatwoot`);
});
