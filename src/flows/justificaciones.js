const { sendText, sendFlow, sendList, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow, addPrivateNote }      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showMenu }                     = require('./menu');
const { getJustificablePrograms,
        createSolicitud }              = require('../services/database');

const FLOW_ID_JUSTIFICACION = '938590465470633';

const MESES_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

/** Elimina sufijos de versión interna (V1–V7) del texto. */
const _cleanVersion = (text) => text ? text.replace(/\s*V[1-7]\b/gi, '').trim() : '';

function _buildRowTitle(p) {
  const name = _cleanVersion(p.program_name || 'Programa');
  const abbr = _cleanVersion(p.abbreviation || '');
  const base = (name.length > 20 && abbr) ? abbr : name;
  return base.length > 24 ? base.slice(0, 21) + '...' : base;
}

function _buildRowDescription(p) {
  if (!p.start_date) return 'Sin fecha de inicio';
  const d         = new Date(p.start_date);
  const numeroDia = String(d.getUTCDate()).padStart(2, '0');
  const mes       = MESES_ES[d.getUTCMonth()];
  return `Inicio: ${numeroDia} de ${mes}`;
}

// ── Paso 1: Mostrar lista de programas del alumno ────────────────────────────

async function showJustificaciones(phone, session) {
  updateSession(phone, { estado: 'flow_justificacion_programa', ultimoTema: 'justificaciones' });
  tagFlow(phone, ['bot-activo', 'justificaciones'], 'Justificaciones');

  let programs;
  try {
    programs = await getJustificablePrograms(session.studentId);
  } catch (err) {
    console.error('[justificaciones] Error consultando programas:', err.message);
    return runTransfer(phone, { ...session, ultimoTema: 'justificaciones' });
  }

  if (!programs || programs.length === 0) {
    await sendText(
      phone,
      `No encontramos programas activos en tu cuenta para registrar una justificación 😊\n\n` +
      `Si crees que hay un error, un especialista puede ayudarte.`
    );
    await delay(500);
    await sendButtons(
      phone,
      '¿Qué deseas hacer?',
      [
        { id: 'hablar_asesor', title: '💬 Con un especialista' },
        { id: 'volver_menu',   title: '🔙 Menú principal' },
      ]
    );
    return;
  }

  // Guardar programas en sesión para recuperar el seleccionado después
  updateSession(phone, {
    justificacionOptions: programs.map(p => ({
      program_edition_id: p.program_edition_id,
      program_name:       p.program_name,
      abbreviation:       p.abbreviation,
      start_date:         p.start_date,
      renderedTitle:      _buildRowTitle(p),
    })),
  });

  // Agrupar por mes para las sections (máx 10 rows)
  const display = programs.slice(0, 10);
  const byMonth = new Map();
  for (const p of display) {
    const d   = p.start_date ? new Date(p.start_date) : null;
    const key = d ? `${MESES_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}` : 'Sin fecha';
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }

  const sections = [];
  for (const [month, progs] of byMonth) {
    sections.push({
      title: month,
      rows: progs.map(p => ({
        id:          `just_prog_${p.program_edition_id}`,
        title:       _buildRowTitle(p),
        description: _buildRowDescription(p),
      })),
    });
  }

  await sendList(
    phone,
    'Justificaciones',
    '¿En cuál de tus programas necesitas registrar la justificación? 📋\n\nSelecciona el programa:',
    'W|E Educación Ejecutiva',
    'Ver mis programas',
    sections
  );
}

// ── Paso 2: Alumno seleccionó programa → lanzar Meta Flow ────────────────────

async function handleJustificacionProgramaReply(phone, idOrText, session) {
  const programs = session.justificacionOptions || [];
  let program;

  if (idOrText && idOrText.startsWith('just_prog_')) {
    // Match por id (cuando Chatwoot envía content_attributes.id)
    const editionId = parseInt(idOrText.replace('just_prog_', ''), 10);
    program = programs.find(p => Number(p.program_edition_id) === editionId);
  } else {
    // Match por título renderizado (cuando Chatwoot solo envía texto)
    const input = (idOrText || '').trim().toUpperCase();
    program = programs.find(p => (p.renderedTitle || '').toUpperCase() === input);
  }

  if (!program) {
    await sendText(phone, '⚠️ No pudimos identificar ese programa. Intenta de nuevo.');
    return showJustificaciones(phone, session);
  }

  // Guardar programa seleccionado para unirlo con la respuesta del Flow
  updateSession(phone, {
    estado: 'flow_justificacion_flow',
    justificacionPrograma: {
      id:   program.program_edition_id,
      name: program.program_name,
    },
  });

  try {
    await sendFlow(
      phone,
      FLOW_ID_JUSTIFICACION,
      'Justificación 📋',
      `Programa: *${_cleanVersion(program.program_name)}*\n\nCompleta el formulario para registrar tu justificación.\n\n⚠️ Recuerda: el límite es de 2 justificaciones por curso.`,
      'W|E Educación Ejecutiva',
      'Llenar justificación'
    );
  } catch (err) {
    console.error('[justificaciones] Error enviando Flow:', err.response?.data || err.message);
    await sendText(phone, '⚠️ Hubo un problema al abrir el formulario. Voy a conectarte con un especialista.');
    return runTransfer(phone, { ...session, ultimoTema: 'justificaciones' });
  }
}

// ── Paso 3: Respuesta del Meta Flow recibida ─────────────────────────────────

async function handleJustificacionFlowResponse(phone, flowData, session) {
  const programa = session.justificacionPrograma || { name: 'No identificado' };

  const MOTIVOS = {
    salud: 'Salud', conectividad: 'Conectividad', energia: 'Energía eléctrica',
    trabajo: 'Trabajo', familiar: 'Familiar', viaje: 'Viaje', personal: 'Motivos personales',
  };

  const summary = [
    `📋 *Justificación registrada*\n`,
    `• *Programa:* ${_cleanVersion(programa.name)}`,
    `• *Tipo:* ${flowData.tipo === 'falta' ? 'Falta' : 'Tardanza'}`,
    `• *Sesión:* ${flowData.sesion}`,
    `• *Motivo:* ${MOTIVOS[flowData.motivo] || flowData.motivo}`,
    `• *Comentario:* ${flowData.comentario || '—'}`,
  ].join('\n');

  // Crear ticket para seguimiento del área académica
  let ticketNumber = null;
  try {
    const solicitud = await createSolicitud(
      session.studentId,
      session.conversationId,
      'JUSTIFICACION',
      _cleanVersion(programa.name),
      programa.program_edition_id || null,
      summary,
      phone
    );
    ticketNumber = solicitud.ticket_number;
    updateSession(phone, { lastTicketNumber: ticketNumber });
  } catch (err) {
    console.error('[justificaciones] Error creando ticket:', err.message);
  }

  // Nota privada con todos los datos para el equipo
  if (session.conversationId) {
    const nota = ticketNumber
      ? `${summary}\n\n🎫 *Ticket:* ${ticketNumber}`
      : summary;
    addPrivateNote(session.conversationId, nota)
      .catch(err => console.error('[justificaciones] Error nota privada:', err));
  }

  // Confirmar al alumno y transferir
  let msg = `✅ *¡Solicitud registrada!*\n\n` +
    `Tu justificación por *${flowData.tipo === 'falta' ? 'falta' : 'tardanza'}* en *${_cleanVersion(programa.name)}* ` +
    `fue registrada correctamente.\n\n`;
  if (ticketNumber) msg += `🎫 Tu número de ticket: *${ticketNumber}*\n\n`;
  msg += `Te voy a derivar con un asesor para que le dé seguimiento 💙`;

  await sendText(phone, msg);

  await runTransfer(
    phone,
    { ...session, ultimoTema: 'justificaciones' },
    `Justificación registrada — ${flowData.tipo === 'falta' ? 'Falta' : 'Tardanza'} en ${_cleanVersion(programa.name)}${ticketNumber ? ` | Ticket: ${ticketNumber}` : ''}`
  );
}

module.exports = { showJustificaciones, handleJustificacionProgramaReply, handleJustificacionFlowResponse };
