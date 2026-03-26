const { sendText, sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }                  = require('../services/session');
const { tagFlow }                        = require('../services/chatwoot');
const { runTransfer }                    = require('./transfer');
const { getStudentPresencialPrograms, createSolicitud } = require('../services/database');
const { buildProgramRows, PAGE_SIZE }                   = require('../utils/programList');
const { isWithinBusinessHours, getScheduleText }        = require('../services/schedule');

// ── Texto de info Flex (compartido por Rama A y B) ────────────────────────────
const FLEX_INFO_TEXT =
  `📌 ¿Te interesa la modalidad Flex?\n` +
  `Recuerda que:\n\n` +
  `1️⃣ Todas las actividades deben hacerse de manera individual.\n` +
  `2️⃣ Necesitas una nota mínima de 12 y estar al día en tus pagos para obtener la certificación.\n` +
  `3️⃣ No hay costo adicional.\n` +
  `4️⃣ Debes presentar el avance y entrega final del proyecto en las fechas indicadas por el docente ` +
  `(Sesión 3 y última sesión).\n\n` +
  `🙋‍♀️ Para gestionar tu inscripción, llena este formulario:\n` +
  `👉 https://forms.gle/GuUVsvJwTcdSjaAr5`;

// ── Entrada principal ─────────────────────────────────────────────────────────

async function showAlumnoFlex(phone, session) {
  updateSession(phone, { estado: 'flow_alumno_flex', ultimoTema: 'alumno_flex' });
  tagFlow(phone, ['bot-activo', 'alumno-flex'], 'Alumno Flex');

  if (session.verified && session.studentId) {
    return _showFlexProgramList(phone, session);
  }
  return _showFlexRamaA(phone);
}

// ── Rama A — flujo genérico (no verificado) ───────────────────────────────────

async function _showFlexRamaA(phone) {
  await sendText(phone, FLEX_INFO_TEXT);
  await sendButtons(
    phone,
    `¿Qué deseas hacer ahora?`,
    [
      { id: 'flex_formulario_ok', title: '✅ Ya llené el form' },
      { id: 'flex_mas_dudas',     title: '❓ Tengo más dudas' },
    ]
  );
}

// ── Rama B — lista de programas presenciales ──────────────────────────────────

async function _showFlexProgramList(phone, session) {
  let programs;
  try {
    programs = await getStudentPresencialPrograms(session.studentId);
  } catch (err) {
    console.error('[alumno_flex] Error consultando programas:', err.message);
    return _showFlexRamaA(phone); // fallback graceful
  }

  if (programs.length === 0) {
    await sendText(
      phone,
      `No encontramos programas presenciales o en vivo activos en tu cuenta 😔\n` +
      `Si crees que es un error, un asesor puede ayudarte 💙`
    );
    await runTransfer(phone, { ...session, ultimoTema: 'alumno_flex' });
    return;
  }

  if (programs.length === 1) {
    updateSession(phone, { programOptions: programs, programPage: 0 });
    return _showFlexInfo(phone, programs[0]);
  }

  updateSession(phone, { estado: 'flow_flex_programa', programOptions: programs, programPage: 0 });
  await _sendFlexProgramPage(phone, programs, 0);
}

async function _sendFlexProgramPage(phone, programs, page) {
  const rows  = buildProgramRows(programs, page, 'flex');
  const total = programs.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const footer = pages > 1 ? `Página ${page + 1} de ${pages}` : 'Selecciona un programa';
  await sendList(
    phone,
    'Mis Programas',
    '¿Para cuál de tus programas deseas solicitar la modalidad Flex? ⚡',
    footer,
    '📋 Ver programas',
    [{ title: 'Programas Presenciales / En vivo', rows }]
  );
}

async function _showFlexInfo(phone, program) {
  updateSession(phone, {
    estado:             'flow_flex_info',
    pendingFlexProgram: program,
  });
  await sendText(phone, FLEX_INFO_TEXT);
  await sendButtons(
    phone,
    `¿Qué deseas hacer ahora?`,
    [
      { id: 'flex_formulario_ok', title: '✅ Ya llené el form' },
      { id: 'flex_mas_dudas',     title: '❓ Tengo más dudas' },
    ]
  );
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleAlumnoFlexReply(phone, buttonId, session) {

  // ── Paginación de programas ──────────────────────────────────────────────
  if (buttonId === 'prog_ver_mas' || buttonId === 'prog_anterior') {
    const programs    = session.programOptions || [];
    const currentPage = session.programPage ?? 0;
    const newPage     = buttonId === 'prog_ver_mas' ? currentPage + 1 : currentPage - 1;
    const safePage    = Math.max(0, Math.min(newPage, Math.ceil(programs.length / PAGE_SIZE) - 1));
    updateSession(phone, { programPage: safePage });
    return _sendFlexProgramPage(phone, programs, safePage);
  }

  // ── Rama B: selección de programa ───────────────────────────────────────
  const progMatch = buttonId?.match(/^flex_prog_(\d+)$/);
  if (progMatch) {
    const index   = parseInt(progMatch[1], 10);
    const program = (session.programOptions || [])[index];
    if (program) return _showFlexInfo(phone, program);
    return _showFlexRamaA(phone);
  }

  if (buttonId === 'flex_formulario_ok') {
    const program = session.pendingFlexProgram;

    // ── Rama B: alumno verificado con programa seleccionado → ticket ─────
    if (program && session.verified) {
      let solicitud;
      try {
        solicitud = await createSolicitud(
          session.studentId,
          session.conversationId,
          'SOLICITUD_FLEX',
          program.program_name,
          program.id,
          'Alumno llenó formulario de flex via bot',
          phone
        );
      } catch (err) {
        console.error('[alumno_flex] Error creando solicitud:', err.message);
        await sendText(phone, '⚠️ No pudimos registrar tu solicitud. Un asesor te contactará.');
        await runTransfer(phone, { ...session, ultimoTema: 'alumno_flex' });
        return;
      }

      const dentroHorario = isWithinBusinessHours();

      if (dentroHorario) {
        await sendText(
          phone,
          `✅ Tu solicitud de modalidad Flex ha sido registrada 📋\n\n` +
          `🎫 *Número de ticket: ${solicitud.ticket_number}*\n` +
          `📄 Programa: ${program.program_name}\n\n` +
          `Un asesor confirmará tu solicitud en breve 💙\n` +
          `⏱️ Tiempo estimado: 15 minutos`
        );
        await runTransfer(phone, { ...session, ultimoTema: 'alumno_flex' }, undefined, { skipTicket: true });
      } else {
        await sendText(
          phone,
          `✅ Tu solicitud de modalidad Flex ha sido registrada 📋\n\n` +
          `🎫 *Número de ticket: ${solicitud.ticket_number}*\n` +
          `📄 Programa: ${program.program_name}\n\n` +
          `Tu solicitud fue registrada exitosamente 😊\n` +
          `Un asesor la procesará al inicio del siguiente horario de atención.\n\n` +
          `⏰ ${getScheduleText()}`
        );
        updateSession(phone, { estado: 'menu', pendingFlexProgram: null });
      }
      return;
    }

    // ── Rama A: sin programa específico → transfer ───────────────────────
    updateSession(phone, { ultimoTema: 'alumno_flex' });
    tagFlow(phone, ['alumno-flex']);
    await runTransfer(phone, session);
    return;
  }

  if (buttonId === 'flex_mas_dudas') {
    updateSession(phone, { ultimoTema: 'alumno_flex' });
    tagFlow(phone, ['alumno-flex']);
    await runTransfer(phone, session);
  }
}

module.exports = { showAlumnoFlex, handleAlumnoFlexReply };
