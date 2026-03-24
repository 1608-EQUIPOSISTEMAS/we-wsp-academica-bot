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

const axios = require('axios');

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

module.exports = { sendText, sendButtons, sendButtonsWithHeader, sendList, sendCtaUrl };
