/**
 * Capa de mensajería — arquitectura híbrida.
 *
 * sendText()              → Chatwoot API (el mensaje ya aparece en el chat)
 * sendButtons()           → Meta API directa (interactivo real) +
 * sendButtonsWithHeader()    nota privada en Chatwoot para visibilidad del agente
 * sendList()
 *
 * La nota privada es fire-and-forget: su fallo nunca bloquea la entrega
 * del mensaje interactivo al alumno.
 */

const axios    = require('axios');
const FormData = require('form-data');

const { getSession }               = require('./session');
const { postMessage, addPrivateNote } = require('./chatwoot');

// ── Límites WhatsApp ──────────────────────────────────────────────────────────
const WA_LIMITS = {
  buttonTitle:     20,
  listButtonLabel: 20,
  rowTitle:        24,
  rowDescription:  72,
};

function trunc(value, max, label) {
  if (typeof value === 'string' && value.length > max) {
    console.warn(`[whatsapp] WARN: "${label}" excede ${max} chars (${value.length}) → truncado: "${value}"`);
    return value.slice(0, max - 1) + '…';
  }
  return value;
}

function validateWhatsAppLimits({ buttons, buttonLabel, sections }) {
  if (buttons) {
    buttons = buttons.map(btn => ({
      ...btn,
      title: trunc(btn.title, WA_LIMITS.buttonTitle, `button.title[${btn.id}]`),
    }));
  }
  if (buttonLabel !== undefined) {
    buttonLabel = trunc(buttonLabel, WA_LIMITS.listButtonLabel, 'list.buttonLabel');
  }
  if (sections) {
    sections = sections.map(section => ({
      ...section,
      rows: section.rows.map(row => ({
        ...row,
        title:       trunc(row.title,       WA_LIMITS.rowTitle,       `row.title[${row.id}]`),
        description: trunc(row.description, WA_LIMITS.rowDescription, `row.description[${row.id}]`),
      })),
    }));

    const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
    if (totalRows > 10) {
      console.warn(`[whatsapp] WARN: Total de filas en lista (${totalRows}) excede el límite de 10.`);
    }
  }
  return { buttons, buttonLabel, sections };
}

// ── Helpers — Chatwoot ────────────────────────────────────────────────────────
function getConvId(phone) {
  const session = getSession(phone);
  if (!session?.conversationId) {
    throw new Error(`[messaging] Sin conversationId en sesión para ${phone}`);
  }
  return session.conversationId;
}

// ── Helpers — Meta API ────────────────────────────────────────────────────────
const META_BASE = 'https://graph.facebook.com/v20.0';

function metaHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function metaSend(payload) {
  try {
    const url = `${META_BASE}/${process.env.WHATSAPP_PHONE_ID}/messages`;
    const { data } = await axios.post(url, payload, { headers: metaHeaders() });
    return data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[whatsapp] Error Meta API:', JSON.stringify(detail));
    throw err;
  }
}

// ── Helpers — notas privadas ──────────────────────────────────────────────────
function buildButtonsNote(body, buttons) {
  let nota = `🤖 Bot mostró opciones al alumno:\n${body}\n`;
  buttons.forEach((btn, i) => { nota += `\n${i + 1}. ${btn.title}`; });
  return nota;
}

function buildListNote(header, sections) {
  let nota  = `🤖 Bot mostró menú al alumno:\n*${header}*\n`;
  let count = 1;
  sections.forEach(section => {
    nota += `\n${section.title}:\n`;
    section.rows.forEach(row => { nota += `${count++}. ${row.title}\n`; });
  });
  return nota.trim();
}

// ── API pública ───────────────────────────────────────────────────────────────
async function sendText(phone, body) {
  await postMessage(getConvId(phone), {
    content:      body,
    message_type: 'outgoing',
    content_type: 'text',
  });
}

/**
 * Envía texto directo por Meta API (no crea mensaje outgoing de agente en Chatwoot).
 * Usar para mensajes automáticos post-transfer (inactividad, espera, cierre) para que
 * checkAgentReplied no los confunda con respuestas del asesor humano.
 * Añade nota privada en Chatwoot para que el asesor vea qué envió el bot.
 */
async function sendTextDirect(phone, body) {
  await metaSend({
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'text',
    text: { body },
  });
  const session = getSession(phone);
  if (session?.conversationId) {
    addPrivateNote(session.conversationId, `🤖 Bot (automático):\n${body}`)
      .catch(err => console.error('[whatsapp] Error nota privada sendTextDirect:', err));
  }
}

async function sendButtons(phone, body, buttons) {
  ({ buttons } = validateWhatsAppLimits({ buttons }));
  // 1. Interactivo real via Meta API
  await metaSend({
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(btn => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
    },
  });

  // 2. Nota privada en Chatwoot — fire-and-forget
  addPrivateNote(getConvId(phone), buildButtonsNote(body, buttons))
    .catch(err => console.error('[whatsapp] Error en nota privada:', err));
}

async function sendButtonsWithHeader(phone, header, body, footer, buttons) {
  ({ buttons } = validateWhatsAppLimits({ buttons }));
  // 1. Interactivo real via Meta API
  await metaSend({
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: header },
      body:   { text: body },
      footer: { text: footer },
      action: {
        buttons: buttons.map(btn => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
    },
  });

  // 2. Nota privada en Chatwoot — fire-and-forget
  addPrivateNote(getConvId(phone), buildButtonsNote(`*${header}*\n${body}`, buttons))
    .catch(err => console.error('[whatsapp] Error en nota privada:', err));
}

async function sendList(phone, header, body, footer, buttonLabel, sections) {
  ({ buttonLabel, sections } = validateWhatsAppLimits({ buttonLabel, sections }));
  // 1. Lista interactiva real via Meta API
  await metaSend({
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: header },
      body:   { text: body },
      footer: { text: footer },
      action: { button: buttonLabel, sections },
    },
  });

  // 2. Nota privada en Chatwoot — fire-and-forget
  addPrivateNote(getConvId(phone), buildListNote(header, sections))
    .catch(err => console.error('[whatsapp] Error en nota privada:', err));
}

// ── Envío de documentos PDF ───────────────────────────────────────────────────

/**
 * Sube un PDF en base64 a la Media API de Meta y retorna el media_id.
 * @param {string} base64String — contenido del PDF en base64
 * @param {string} filename     — nombre del archivo (ej: 'Certificado.pdf')
 * @returns {string} media_id
 */
async function _uploadMedia(base64String, filename) {
  const buffer = Buffer.from(base64String, 'base64');
  const form   = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename, contentType: 'application/pdf' });

  const url = `${META_BASE}/${process.env.WHATSAPP_PHONE_ID}/media`;
  const { data } = await axios.post(url, form, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      ...form.getHeaders(),
    },
  });

  if (!data?.id) throw new Error(`Meta Media API no retornó id: ${JSON.stringify(data)}`);
  return data.id;
}

/**
 * Envía un documento ya subido (por media_id) al número destino.
 * @param {string} phone    — número sin '+'
 * @param {string} mediaId  — id obtenido de _uploadMedia
 * @param {string} filename — nombre que verá el alumno al descargar
 * @param {string} caption  — texto que acompaña al documento
 */
async function _sendMediaId(phone, mediaId, filename, caption) {
  await metaSend({
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'document',
    document: {
      id:       mediaId,
      filename,
      caption,
    },
  });
}

/**
 * Orquesta la subida y el envío de un PDF en base64 por WhatsApp.
 * Añade nota privada en Chatwoot para visibilidad del asesor.
 *
 * @param {string} phone         — número del alumno sin '+'
 * @param {string} base64String  — PDF en base64
 * @param {string} filename      — nombre del archivo (ej: 'Certificado.pdf')
 * @param {string} caption       — mensaje que acompaña al PDF
 */
async function sendBase64Pdf(phone, base64String, filename, caption) {
  try {
    const mediaId = await _uploadMedia(base64String, filename);
    await _sendMediaId(phone, mediaId, filename, caption);

    const session = getSession(phone);
    if (session?.conversationId) {
      addPrivateNote(session.conversationId, `🤖 Bot envió PDF: ${filename}\n${caption}`)
        .catch(err => console.error('[whatsapp] Error nota privada sendBase64Pdf:', err));
    }
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[whatsapp] Error enviando PDF:', JSON.stringify(detail));
    throw err;
  }
}

async function sendCtaUrl(phone, bodyText, displayText, url) {
  // 1. Mensaje interactivo CTA via Meta API
  await metaSend({
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: bodyText },
      action: {
        name: 'cta_url',
        parameters: { display_text: displayText, url },
      },
    },
  });

  // 2. Nota privada en Chatwoot — fire-and-forget
  addPrivateNote(getConvId(phone), `🤖 Bot mostró enlace CTA:\n${bodyText}\n→ ${displayText}: ${url}`)
    .catch(err => console.error('[whatsapp] Error en nota privada CTA:', err));
}

module.exports = { sendText, sendTextDirect, sendButtons, sendButtonsWithHeader, sendList, sendCtaUrl, sendBase64Pdf };
