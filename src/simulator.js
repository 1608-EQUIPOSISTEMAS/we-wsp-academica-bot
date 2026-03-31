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
 *
 * Comandos especiales:
 *   /reset          → reinicia la sesión
 *   /sesion         → muestra estado actual de la sesión
 *   /verificado     → simula alumno VERIFICADO (Juan Pérez — phone coincide con DB)
 *   /noverificado   → simula alumno NO VERIFICADO (Ana Martínez — phone diferente)
 *   /resuelto       → simula que el asesor resolvió la conv. (envía CSAT)
 *   /asesor [msg]   → simula respuesta del asesor humano en Chatwoot
 *   /tick           → ejecuta un ciclo del monitor de inactividad manualmente
 *   /fastforward N  → retrocede timestamps N minutos (simula paso del tiempo)
 *   /salir          → cierra el simulador
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
  red:     '\x1b[31m',
  bgBlue:  '\x1b[44m',
  bgGreen: '\x1b[42m',
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
  sendCtaUrl: async (_phone, bodyText, displayText, url) => {
    clearPending();
    renderText(`${bodyText}\n🔗 [${displayText}] → ${url}`);
  },
};

// ── Estado de mensajes simulados del asesor ─────────────────────────────────
const asesorMessages = [];   // { content, created_at (seconds), sender: { id, type, name } }

function addAsesorMessage(content) {
  asesorMessages.push({
    message_type: 1,
    private:      false,
    content,
    created_at:   Math.floor(Date.now() / 1000),
    sender:       { id: 99999, type: 'user', name: 'Asesor Simulado' },
  });
}

// ── Mock de chatwoot.js ───────────────────────────────────────────────────────
const chatwootMock = {
  postMessage:           async () => {},
  addPrivateNote:        async (_convId, content) => { renderPrivateNote(content); },
  resolveConversation:   async () => { tag(c.magenta, 'CHATWOOT', 'Conversación resuelta'); },
  openConversation:      async () => {},
  deactivateBot:         async () => {},
  setLabels:             async (_convId, labels) => { tag(c.dim, 'LABELS', labels.join(', ')); },
  setCustomAttributes:   async () => {},
  assignTeam:            async () => {},
  assignAgent:           async () => {},
  tagFlow:               () => {},
  tagAlumno:             () => {},
  findMembershipByEmail: async () => ({ type: null, isMember: false }),
  getConversationMessages: async () => asesorMessages,
  checkAgentReplied:     async (_convId, sinceMs = 0) => {
    for (const msg of asesorMessages) {
      const ts = msg.created_at * 1000;
      if (sinceMs && ts < sinceMs) continue;
      return { responded: true, respondedAt: ts };
    }
    return { responded: false, respondedAt: null };
  },
};

// ── Inyectar mocks ANTES de cargar bot.js ─────────────────────────────────────
function injectMock(relativePath, mockExports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports: mockExports, parent: null, children: [], paths: [],
  };
}

// ── Mock de ai.js — wrapper del módulo real con salida con estilo ─────────────
// Cargamos el módulo real primero, luego lo envolvemos para mostrar el intent
// de forma visual en el simulador (la llamada real a OpenAI sigue ocurriendo).
const realAi = require('./services/ai');
injectMock('./services/ai', {
  detectIntent: async (text, state) => {
    const result = await realAi.detectIntent(text, state);
    const confBar  = result.confidence >= 0.75
      ? `${c.green}●${c.reset}`
      : `${c.red}●${c.reset}`;
    const complaintLabel = result.is_complaint
      ? ` ${c.red}⚠ queja${c.reset}`
      : '';
    process.stdout.write(
      `\n  ${c.magenta}${c.bold}[INTENT]${c.reset} ` +
      `${c.bold}${result.intent}${c.reset}  ` +
      `conf: ${confBar} ${result.confidence.toFixed(2)}` +
      `${complaintLabel}\n`
    );
    return result;
  },
});

injectMock('./services/whatsapp', whatsappMock);
injectMock('./services/chatwoot', chatwootMock);

// ── Cargar módulos reales ─────────────────────────────────────────────────────
const { handleIncoming } = require('./bot');
const { getSession, deleteSession, updateSession } = require('./services/session');
const { runInactivityCycle } = require('./services/inactivity');

// ── Estado del simulador ──────────────────────────────────────────────────────
// PHONE por defecto: número genérico (sin verificación)
let PHONE    = '5491100000000';
let CONV_ID  = 'sim-conv-001';
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
    s.nombre     ? `nombre=${s.nombre}`     : null,
    s.correo     ? `correo=${s.correo}`      : null,
    s.ultimoTema ? `tema=${s.ultimoTema}`    : null,
    s.verified          ? `${c.green}✓ verificado${c.reset}` : `${c.red}✗ no-verificado${c.reset}`,
    s.studentId         ? `studentId=${s.studentId}` : null,
    s.asesor_respondio  ? `${c.green}asesor✓${c.reset}` : null,
    s.csat_sent         ? `${c.cyan}csat-enviado${c.reset}` : null,
    s.lastTicketNumber  ? `ticket=${s.lastTicketNumber}` : null,
    `historial=${s.historial.length} msgs`,
  ].filter(Boolean);
  tag(c.yellow, 'SESIÓN', parts.join('  '));
  // Mostrar detalles de inactividad si estamos en atención humana
  if (s.en_atencion_humana) {
    const now = Date.now();
    const inactParts = [
      s.transfer_at           ? `transfer: hace ${Math.floor((now - s.transfer_at) / 60000)}m` : null,
      s.asesor_respondio_at   ? `asesor: hace ${Math.floor((now - s.asesor_respondio_at) / 60000)}m` : null,
      s.ultimaActividad       ? `actividad: hace ${Math.floor((now - s.ultimaActividad) / 60000)}m` : null,
      s.transfer_wait_msg_sent ? `${c.yellow}CASO2-enviado${c.reset}` : null,
      s.asesor_inactivity_msg_sent ? `${c.yellow}CASO3-enviado${c.reset}` : null,
      s.alumno_respondio_post_asesor ? `${c.green}alumno-respondio${c.reset}` : null,
      s.asesor_no_responde_msg_sent ? `${c.yellow}CASO3B-1-enviado${c.reset}` : null,
      s.asesor_no_responde_alumno_msg_sent ? `${c.yellow}CASO3B-2-enviado${c.reset}` : null,
    ].filter(Boolean);
    if (inactParts.length) {
      process.stdout.write(`  ${c.dim}Inactividad: ${inactParts.join(' | ')}${c.reset}\n`);
    }
  }
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

// ── Cambio de modo simulación ─────────────────────────────────────────────────
async function switchMode(newPhone, label, email) {
  PHONE   = newPhone;
  CONV_ID = `sim-conv-${newPhone.slice(-4)}`;
  deleteSession(PHONE);
  clearPending();
  tag(c.bgGreen, 'MODO', label);
  if (email) {
    process.stdout.write(`  ${c.dim}Correo de prueba: ${email}${c.reset}\n\n`);
  }
  await processInput('hola');
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
    `    /reset          → reinicia la sesión\n` +
    `    /sesion         → muestra estado actual de la sesión\n` +
    `    /verificado     → alumno VERIFICADO (Juan Pérez — phone coincide con DB)\n` +
    `    /noverificado   → alumno NO VERIFICADO (Ana Martínez — phone diferente)\n` +
    `    /resuelto       → simula que el asesor resolvió la conv. (envía CSAT)\n` +
    `    /asesor [msg]   → simula respuesta del asesor humano\n` +
    `    /tick           → ejecuta un ciclo del monitor de inactividad\n` +
    `    /fastforward N  → avanza el tiempo N minutos (retrocede timestamps)\n` +
    `    /salir          → cierra el simulador\n${c.reset}\n`
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
      deleteSession(PHONE);
      clearPending();
      tag(c.yellow, 'SESIÓN', `Sesión eliminada para ${PHONE} — el próximo mensaje iniciará de cero`);
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

    // ── Caso de prueba: alumno VERIFICADO ───────────────────────────────────
    // Phone 51922495159 coincide con juan.perez@gmail.com en la DB de prueba
    if (input === '/verificado') {
      await switchMode(
        '51922495159',
        'Simulando alumno VERIFICADO → juan.perez@gmail.com (phone = 51922495159)',
        'juan.perez@gmail.com'
      );
      rl.prompt();
      return;
    }

    // ── Caso de prueba: alumno NO VERIFICADO ─────────────────────────────────
    // Phone 51900099999 NO coincide con ana.martinez@outlook.com (51944444444)
    if (input === '/noverificado') {
      await switchMode(
        '51900099999',
        'Simulando alumno NO VERIFICADO → ana.martinez@outlook.com (phone distinto)',
        'ana.martinez@outlook.com'
      );
      rl.prompt();
      return;
    }

    // ── /asesor [msg] — simular respuesta del asesor humano ─────────────────
    if (input.startsWith('/asesor')) {
      const msg = input.replace('/asesor', '').trim() || 'Hola, soy el asesor. ¿En qué te puedo ayudar?';
      addAsesorMessage(msg);
      tag(c.bgGreen, 'ASESOR', `"${msg}" (ts=${new Date().toISOString()})`);
      process.stdout.write(`  ${c.dim}(El próximo /tick detectará esta respuesta vía polling)${c.reset}\n\n`);
      rl.prompt();
      return;
    }

    // ── /tick — ejecutar un ciclo del monitor de inactividad ──────────────
    if (input === '/tick') {
      tag(c.yellow, 'TICK', 'Ejecutando ciclo de inactividad...');
      process.stdout.write('\n');
      await runInactivityCycle();
      process.stdout.write('\n');
      showSession();
      process.stdout.write('\n');
      rl.prompt();
      return;
    }

    // ── /fastforward N — retroceder timestamps N minutos ──────────────────
    if (input.startsWith('/fastforward')) {
      const minutes = parseInt(input.replace('/fastforward', '').trim(), 10);
      if (isNaN(minutes) || minutes <= 0) {
        tag(c.red, 'ERROR', 'Uso: /fastforward N  (donde N = minutos a avanzar)');
        rl.prompt();
        return;
      }
      const shiftMs = minutes * 60 * 1000;
      const sess = getSession(PHONE);
      if (!sess) {
        tag(c.red, 'ERROR', 'No hay sesión activa');
        rl.prompt();
        return;
      }
      const fields = [
        'ultimaActividad', 'ultimaInteraccion', 'transfer_at',
        'resuelto_bot_at', 'asesor_respondio_at', 'csat_sent_at',
      ];
      const shifted = {};
      for (const f of fields) {
        if (sess[f]) shifted[f] = sess[f] - shiftMs;
      }
      updateSession(PHONE, shifted);
      // Also shift asesor mock messages
      for (const msg of asesorMessages) {
        msg.created_at = msg.created_at - (minutes * 60);
      }
      tag(c.yellow, 'FASTFORWARD', `Timestamps retrocedidos ${minutes} min`);
      showSession();
      process.stdout.write('\n');
      rl.prompt();
      return;
    }

    // ── Simular conversación resuelta por asesor (dispara CSAT) ─────────────
    if (input === '/resuelto') {
      tag(c.bgGreen, 'MODO', 'Simulando conversación resuelta por asesor → CSAT');
      await require('./services/whatsapp').sendList(
        PHONE,
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
      updateSession(PHONE, { estado: 'esperando_csat', csat_sent: true, csat_sent_at: Date.now() });
      process.stdout.write('\n');
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
