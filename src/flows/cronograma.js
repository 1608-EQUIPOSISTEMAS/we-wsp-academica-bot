const { sendText, sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }                   = require('../services/session');
const { tagFlow }                         = require('../services/chatwoot');
const { runTransfer }                     = require('./transfer');
const { showBotResuelto }                 = require('./resuelto');
const { getStudentCronograma }            = require('../services/database');

const MESES_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

function _formatDate(date) {
  if (!date) return null;
  const d     = new Date(date);
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = MESES_ES[d.getUTCMonth()];
  const year  = d.getUTCFullYear();
  return `${day} de ${month} de ${year}`;
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
        title:       (p.program_name || 'Programa').slice(0, 24),
        description: p.start_date ? _formatDate(p.start_date) : '',
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
    cronogramaOptions: programs,
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

// ── Selección del alumno ──────────────────────────────────────────────────────

async function handleCronogramaReply(phone, id, session) {
  const editionId = parseInt(id.replace('crono_', ''), 10);
  const programs  = session.cronogramaOptions || [];
  const program   = programs.find(p => Number(p.program_edition_id) === editionId);

  if (!program) {
    await sendText(phone, '⚠️ No pudimos identificar ese programa. Por favor intenta de nuevo.');
    return handleCronograma(phone, session);
  }

  const hasWhatsapp = !!program.whatsapp_link;
  const hasTeams    = !!program.teams_link;

  // Sin accesos publicados aún → transferir al asesor
  if (!hasWhatsapp && !hasTeams) {
    await sendText(
      phone,
      `📅 *${program.program_name}*\n\n` +
      `Aún no tenemos los accesos publicados para este programa.\n` +
      `Un asesor te puede dar más información 💙`
    );
    return runTransfer(phone, { ...session, ultimoTema: 'cronograma' });
  }

  // Construir mensaje con fecha(s) y links
  let msg = `📅 *${program.program_name}*\n`;
  if (program.start_date) msg += `🗓 Inicio: ${_formatDate(program.start_date)}\n`;
  if (program.end_date)   msg += `🏁 Fin: ${_formatDate(program.end_date)}\n`;
  msg += `\n🔗 *Acceso a tus clases:*\n`;
  if (hasWhatsapp) msg += `💬 WhatsApp: ${program.whatsapp_link}\n`;
  if (hasTeams)    msg += `🖥️ Teams: ${program.teams_link}\n`;

  await sendText(phone, msg.trim());

  updateSession(phone, { estado: 'resuelto_bot', resuelto_bot_at: Date.now() });
  await showBotResuelto(phone);
}

module.exports = { handleCronograma, handleCronogramaReply };
