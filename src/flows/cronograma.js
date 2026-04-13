const { sendText, sendButtons, sendList, delay } = require('../services/whatsapp');
const { updateSession }                   = require('../services/session');
const { tagFlow }                         = require('../services/chatwoot');
const { runTransfer }                     = require('./transfer');
const { showBotResuelto }                 = require('./resuelto');
const { getStudentCronograma,
        getProgramModules }               = require('../services/database');

const MESES_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

const DIAS_ES = [
  'Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado',
];

function _formatDate(date) {
  if (!date) return null;
  const d     = new Date(date);
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = MESES_ES[d.getUTCMonth()];
  const year  = d.getUTCFullYear();
  return `${day} de ${month} de ${year}`;
}

/** Elimina sufijos de versión interna (V1–V7) del texto. */
const _cleanVersion = (text) => text ? text.replace(/\s*V[1-7]\b/gi, '').trim() : '';

/**
 * Título de la fila: usa abbreviation si el nombre completo supera 20 chars,
 * truncando a 24 como seguridad final ante el límite de WhatsApp.
 * Ambos strings pasan por _cleanVersion antes de evaluarse.
 */
function _buildRowTitle(p) {
  const name = _cleanVersion(p.program_name || 'Programa');
  const abbr = _cleanVersion(p.abbreviation || '');
  const base = (name.length > 20 && abbr) ? abbr : name;
  return base.length > 24 ? base.slice(0, 21) + '...' : base;
}

/** Deduce el tipo de programa a partir del nombre. */
function _deduceTipo(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('diplomado'))      return 'Diplomado';
  if (n.includes('especializaci'))  return 'Especialización';
  if (n.includes('pee'))            return 'PEE';
  return 'Curso';
}

/**
 * Descripción de la fila: "09 Martes | Diplomado"
 * Prioriza program_type (campo real de la DB vía catalog.description).
 * Cae en _deduceTipo como fallback si no viene del query.
 */
function _buildRowDescription(p) {
  const tipo = p.program_type || _deduceTipo(p.program_name);
  if (!p.start_date) return tipo;
  const d         = new Date(p.start_date);
  const numeroDia = String(d.getUTCDate()).padStart(2, '0');
  const nombreDia = DIAS_ES[d.getUTCDay()];
  return `${numeroDia} ${nombreDia} | ${tipo}`;
}

/** Agrupa los programas por mes (clave "Mes Año") y genera las sections para sendList. */
function _buildSections(programs) {
  const byMonth = new Map();

  for (const p of programs) {
    const d   = p.start_date ? new Date(p.start_date) : null;
    const key = d
      ? `${MESES_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
      : 'Sin fecha';
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }

  const sections = [];
  for (const [month, progs] of byMonth) {
    if (sections.length >= 10) break; // límite WhatsApp: 10 sections
    sections.push({
      title: month,
      rows:  progs.slice(0, 10).map(p => ({
        id:          `crono_${p.program_edition_id}`,
        title:       _buildRowTitle(p),
        description: _buildRowDescription(p),
      })),
    });
  }
  return sections;
}

// ── Entrada principal ─────────────────────────────────────────────────────────

async function handleCronograma(phone, session) {
  tagFlow(phone, ['bot-activo', 'cronograma'], 'Cronograma');

  let programs;
  try {
    programs = await getStudentCronograma(session.studentId);
  } catch (err) {
    console.error('[cronograma] Error consultando programas:', err.message);
    return runTransfer(phone, { ...session, ultimoTema: 'cronograma' });
  }

  if (!programs || programs.length === 0) {
    await sendText(
      phone,
      `No encontramos programas En Vivo activos registrados en tu cuenta 😊\n\n` +
      `Si crees que hay un error o necesitas el cronograma de un programa específico, ` +
      `un asesor puede ayudarte.`
    );
    await delay(500);
    await sendButtons(
      phone,
      '¿Qué deseas hacer?',
      [
        { id: 'hablar_asesor', title: '💬 Hablar con asesor' },
        { id: 'volver_menu',   title: '🔙 Menú principal' },
      ]
    );
    return;
  }

  updateSession(phone, {
    estado:            'flow_cronograma',
    // Enriquecer cada programa con el título exacto renderizado en el menú,
    // para que bot.js pueda hacer match cuando WhatsApp devuelve ese texto.
    cronogramaOptions: programs.map(p => ({ ...p, renderedTitle: _buildRowTitle(p) })),
  });

  const sections = _buildSections(programs);

  await sendList(
    phone,
    'Mis Programas En Vivo',
    `📅 Aquí están tus programas activos.\nSelecciona uno para ver el acceso a clases:`,
    'W|E Educación Ejecutiva',
    '📅 Ver mis programas',
    sections
  );
}

// ── Helpers de mensaje ────────────────────────────────────────────────────────

/** Construye la línea de links según los que estén disponibles. */
function _buildLinks(program) {
  const parts = [];
  if (program.whatsapp_link) parts.push(`💬 WhatsApp: ${program.whatsapp_link}`);
  if (program.teams_link)    parts.push(`🖥️ Teams: ${program.teams_link}`);
  return parts.join(' | ');
}

/** Alterna entre 📘 y 📗 por índice para diferenciar módulos visualmente. */
function _moduleIcon(index) {
  return index % 2 === 0 ? '📘' : '📗';
}

// ── Selección del alumno ──────────────────────────────────────────────────────

async function handleCronogramaReply(phone, id, session) {
  const editionId = parseInt(id.replace('crono_', ''), 10);
  const programs  = session.cronogramaOptions || [];
  const program   = programs.find(p => Number(p.program_edition_id) === editionId);

  if (!program) {
    await sendText(phone, '⚠️ No pudimos identificar ese programa. Por favor intenta de nuevo.');
    return handleCronograma(phone, session);
  }

  // ── Verificar si es un Diplomado con módulos hijos ────────────────────────
  let modules = [];
  try {
    modules = await getProgramModules(editionId);
  } catch (err) {
    console.error('[cronograma] Error consultando módulos:', err.message);
    // No bloquear — si falla, tratar como curso suelto
  }

  // ── DIPLOMADO: tiene módulos → mensaje "Todo en Uno" ─────────────────────
  if (modules.length > 0) {
    let msg = `🎓 *${program.program_name}*\n`;
    msg += `Aquí tienes los accesos para tus módulos:\n`;

    for (const [i, mod] of modules.entries()) {
      const links = _buildLinks(mod);
      msg += `\n${_moduleIcon(i)} *${_cleanVersion(mod.program_name)}*`;
      if (mod.start_date) msg += ` (Inicio: ${_formatDate(mod.start_date)})`;
      msg += `\n`;
      if (links) {
        msg += `🔗 ${links}\n`;
      } else {
        msg += `⏳ Accesos aún no publicados\n`;
      }
    }

    await sendText(phone, msg.trim());
    updateSession(phone, { estado: 'resuelto_bot', resuelto_bot_at: Date.now() });
    await delay(500);
    await showBotResuelto(phone);
    return;
  }

  // ── CURSO SUELTO: sin módulos → mensaje estándar ──────────────────────────
  const hasWhatsapp = !!program.whatsapp_link;
  const hasTeams    = !!program.teams_link;

  if (!hasWhatsapp && !hasTeams) {
    await sendText(
      phone,
      `📅 *${program.program_name}*\n\n` +
      `Aún no tenemos los accesos publicados para este programa.\n` +
      `Un asesor te puede dar más información 💙`
    );
    return runTransfer(phone, { ...session, ultimoTema: 'cronograma' });
  }

  let msg = `📅 *${program.program_name}*\n`;
  if (program.start_date) msg += `🗓 Inicio: ${_formatDate(program.start_date)}\n`;
  if (program.end_date)   msg += `🏁 Fin: ${_formatDate(program.end_date)}\n`;
  msg += `\n🔗 *Acceso a tus clases:*\n`;
  if (hasWhatsapp) msg += `💬 WhatsApp: ${program.whatsapp_link}\n`;
  if (hasTeams)    msg += `🖥️ Teams: ${program.teams_link}\n`;

  await sendText(phone, msg.trim());
  updateSession(phone, { estado: 'resuelto_bot', resuelto_bot_at: Date.now() });
  await delay(500);
  await showBotResuelto(phone);
}

module.exports = { handleCronograma, handleCronogramaReply };
