/**
 * Simulador de consola — W|E WhatsApp Bot
 *
 * Arquitectura híbrida:
 *   sendText      → Chatwoot API       ← mock: render en consola
 *   sendButtons   → Meta API + nota    ← mock: render + nota en consola
 *   sendList      → Meta API + nota    ← mock: render + nota en consola
 *   transfer      → addPrivateNote     ← mock: render nota en consola
 *
 * DB y IA/RAG son REALES.
 *
 * Uso: npm run simulate
 *
 * Interacción con botones / listas:
 *   • Número  (ej: 1, 2)       → selecciona esa opción
 *   • ID directo (ej: campus_virtual)
 *   • Texto libre              → activa la IA/RAG
 */

require('dotenv').config();

const readline = require('readline');
const crypto   = require('crypto');

// ── Colores ANSI ──────────────────────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  bgBlue:  '\x1b[44m',
};

function tag(color, label, text) {
  process.stdout.write(`${color}${c.bold}[${label}]${c.reset} ${text}\n`);
}

// ── Estado de UI para opciones activas ───────────────────────────────────────
let pendingOptions = null;

function setPending(options) { pendingOptions = options; }
function clearPending()      { pendingOptions = null; }

// ── Renderers ─────────────────────────────────────────────────────────────────
function renderText(body) {
  const lines = body.split('\n');
  tag(c.green, 'BOT', lines[0]);
  lines.slice(1).forEach(l => process.stdout.write(`        ${l}\n`));
}

function renderButtons(body, buttons) {
  renderText(body);
  process.stdout.write('\n');
  buttons.forEach((btn, i) => {
    process.stdout.write(
      `  ${c.blue}${c.bold}[${i + 1}]${c.reset} ${btn.title}  ${c.dim}(${btn.id})${c.reset}\n`
    );
  });
  process.stdout.write('\n');
  setPending(buttons.map(b => ({ id: b.id, label: b.title })));
}

function renderList(header, body, footer, sections) {
  process.stdout.write(
    `${c.bgBlue}${c.bold} ${header} ${c.reset}  ${c.dim}${footer}${c.reset}\n`
  );
  renderText(body);
  process.stdout.write('\n');

  const allOptions = [];
  sections.forEach(section => {
    process.stdout.write(`  ${c.yellow}${c.bold}── ${section.title} ──${c.reset}\n`);
    section.rows.forEach(row => {
      const idx = allOptions.length + 1;
      process.stdout.write(
        `  ${c.blue}${c.bold}[${idx}]${c.reset} ${row.title}` +
        `  ${c.dim}${row.description || ''}  (${row.id})${c.reset}\n`
      );
      allOptions.push({ id: row.id, label: row.title });
    });
  });
  process.stdout.write('\n');
  setPending(allOptions);
}

function renderPrivateNote(content) {
  const divider = `${c.magenta}${'─'.repeat(60)}${c.reset}`;
  process.stdout.write(`\n${divider}\n`);
  tag(c.magenta, 'NOTA PRIVADA CHATWOOT', '(solo visible para agentes)');
  content.split('\n').forEach(l =>
    process.stdout.write(`  ${c.dim}${l}${c.reset}\n`)
  );
  process.stdout.write(`${divider}\n\n`);
}

// ── Mock de whatsapp.js ───────────────────────────────────────────────────────
// Intercepta el nivel más alto para que ni Meta API ni Chatwoot se llamen.
const whatsappMock = {
  sendText: async (_phone, body) => {
    clearPending();
    renderText(body);
  },
  sendButtons: async (_phone, body, buttons) => {
    clearPending();
    renderButtons(body, buttons);
  },
  sendButtonsWithHeader: async (_phone, header, body, footer, buttons) => {
    clearPending();
    renderButtons(`*${header}*\n${body}\n${c.dim}${footer}${c.reset}`, buttons);
  },
  sendList: async (_phone, header, body, footer, _btnLabel, sections) => {
    clearPending();
    renderList(header, body, footer, sections);
  },
};

// ── Mock de chatwoot.js ───────────────────────────────────────────────────────
// Intercepta addPrivateNote usado directamente por transfer.js
const chatwootMock = {
  postMessage:    async () => {},
  addPrivateNote: async (_convId, content) => { renderPrivateNote(content); },
};

// ── Inyectar mocks ANTES de cargar bot.js ─────────────────────────────────────
function injectMock(relativePath, mockExports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports: mockExports, parent: null, children: [], paths: [],
  };
}

injectMock('./services/whatsapp', whatsappMock);
injectMock('./services/chatwoot', chatwootMock);

// ── Cargar módulos reales ─────────────────────────────────────────────────────
const { handleIncoming } = require('./bot');
const { getSession }     = require('./services/session');

// ── Constantes del simulador ──────────────────────────────────────────────────
const PHONE   = '5491100000000';
const CONV_ID = 'sim-conv-001';
let msgCounter = 0;

function fakeId() {
  return `sim_${++msgCounter}_${crypto.randomBytes(3).toString('hex')}`;
}

function buildTextMsg(text) {
  return { id: fakeId(), content: text, contentType: 'text', contentAttributes: {} };
}

function buildInteractiveMsg(optId, optTitle) {
  return {
    id:                fakeId(),
    content:           optTitle,
    contentType:       'interactive',
    contentAttributes: { type: 'list_reply', id: optId },
  };
}

// ── Estado de sesión ──────────────────────────────────────────────────────────
function showSession() {
  const s = getSession(PHONE);
  if (!s) { tag(c.yellow, 'SESIÓN', 'sin sesión activa'); return; }
  const parts = [
    `estado=${s.estado}`,
    s.nombre     ? `nombre=${s.nombre}` : null,
    s.correo     ? `correo=${s.correo}`  : null,
    s.ultimoTema ? `tema=${s.ultimoTema}` : null,
    `historial=${s.historial.length} msgs`,
  ].filter(Boolean);
  tag(c.yellow, 'SESIÓN', parts.join('  '));
}

// ── Procesar entrada ──────────────────────────────────────────────────────────
async function processInput(raw) {
  const input = raw.trim();
  if (!input) return;

  let msg;

  if (pendingOptions) {
    const num   = parseInt(input, 10);
    const byNum = !isNaN(num) && num >= 1 && num <= pendingOptions.length
      ? pendingOptions[num - 1] : null;
    const byId  = pendingOptions.find(o => o.id === input);
    const opt   = byNum || byId;

    if (opt) {
      clearPending();
      tag(c.cyan, 'TÚ', `${input}  ${c.dim}→ ${opt.label} (${opt.id})${c.reset}`);
      msg = buildInteractiveMsg(opt.id, opt.label);
    } else {
      clearPending();
      tag(c.cyan, 'TÚ', input);
      msg = buildTextMsg(input);
    }
  } else {
    tag(c.cyan, 'TÚ', input);
    msg = buildTextMsg(input);
  }

  process.stdout.write('\n');
  await handleIncoming(CONV_ID, PHONE, msg);
  process.stdout.write('\n');
  showSession();
  process.stdout.write('\n');
}

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner() {
  const line = '═'.repeat(56);
  process.stdout.write(
    `\n${c.cyan}${c.bold}╔${line}╗\n` +
    `║       W|E Bot — Simulador de Consola                  ║\n` +
    `║       Arquitectura: Chatwoot Agent Bot (híbrido)      ║\n` +
    `╚${line}╝${c.reset}\n\n`
  );
  process.stdout.write(
    `${c.dim}  Escribe mensajes como si fueras un alumno de WhatsApp.\n` +
    `  Cuando el bot muestre opciones, responde con:\n` +
    `    • Un número  (ej: 1, 2, 3)\n` +
    `    • El ID directamente  (ej: campus_virtual)\n` +
    `    • Texto libre para activar la IA/RAG\n\n` +
    `  Comandos especiales:\n` +
    `    /reset   → reinicia la sesión\n` +
    `    /sesion  → muestra estado actual de la sesión\n` +
    `    /salir   → cierra el simulador\n${c.reset}\n`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const { testConnection } = require('./services/database');
    await testConnection();
    tag(c.green, 'DB', 'Conexión a PostgreSQL OK');
  } catch (err) {
    tag(c.yellow, 'DB', `Sin conexión a PostgreSQL (${err.message}) — verificación de correos fallará`);
  }

  printBanner();

  process.stdout.write(`${c.dim}  [Iniciando sesión automáticamente...]\n\n${c.reset}`);
  await processInput('hola');

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: `${c.cyan}${c.bold}> ${c.reset}`,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input === '/salir' || input === '/exit') {
      process.stdout.write('\n👋 Simulador cerrado.\n');
      process.exit(0);
    }
    if (input === '/reset') {
      const { deleteSession } = require('./services/session');
      deleteSession(PHONE);
      clearPending();
      tag(c.yellow, 'SESIÓN', 'Sesión eliminada — el próximo mensaje iniciará de cero');
      process.stdout.write('\n');
      rl.prompt();
      return;
    }
    if (input === '/sesion') {
      showSession();
      process.stdout.write('\n');
      rl.prompt();
      return;
    }

    if (input) await processInput(input);
    rl.prompt();
  });

  rl.on('close', () => {
    process.stdout.write('\n👋 Simulador cerrado.\n');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Error fatal en el simulador:', err);
  process.exit(1);
});
