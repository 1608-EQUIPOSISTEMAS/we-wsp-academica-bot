const { sendText, sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }                  = require('../services/session');
const { tagFlow }                        = require('../services/chatwoot');
const { runTransfer }                    = require('./transfer');
const { showMenu }                       = require('./menu');
const { askReclamoDatos }                = require('./reclamo');
const { showBotResuelto }               = require('./resuelto');
const { getAllStudentPrograms, createSolicitud } = require('../services/database');
const { buildProgramRows, PAGE_SIZE }            = require('../utils/programList');
const { isWithinBusinessHours, getScheduleText } = require('../services/schedule');

// ── Tabla de tiempos (Rama A) ─────────────────────────────────────────────────
const CERT_INFO = {
  cert_pres_curso: {
    dias:  '7 días hábiles',
    donde: 'tu *campus virtual*',
    nota:  'Los días hábiles no cuentan fines de semana ni feriados.',
  },
  cert_pres_prog: {
    dias:  '30 días hábiles',
    donde: 'tu *correo de inscripción*',
    nota:  'Los días hábiles no cuentan fines de semana ni feriados.',
  },
  cert_online_curso: {
    dias:  '3 días hábiles',
    donde: 'tu *campus virtual*',
    nota:  'Los días hábiles no cuentan fines de semana ni feriados.',
  },
  cert_online_espec: {
    dias:  '7 días hábiles',
    donde: 'tu *correo de inscripción*',
    nota:  'Los días hábiles no cuentan fines de semana ni feriados.',
  },
};

// ── Entrada principal ─────────────────────────────────────────────────────────

async function showCertificados(phone, session) {
  updateSession(phone, { estado: 'flow_cert_modalidad', ultimoTema: 'certificacion' });
  tagFlow(phone, ['bot-activo', 'certificados'], 'Certificación');

  if (session.verified && session.studentId) {
    return _showCertProgramList(phone, session);
  }
  return _showCertRamaA(phone);
}

// ── Rama A — flujo genérico (no verificado) ───────────────────────────────────

async function _showCertRamaA(phone) {
  await sendButtons(
    phone,
    `¿Tu programa es presencial/en vivo u online?`,
    [
      { id: 'cert_pres_en_vivo', title: '🏫 Pres. / En vivo' },
      { id: 'cert_online',       title: '💻 Online' },
    ]
  );
}

// ── Rama B — lista de programas personalizados ────────────────────────────────

async function _showCertProgramList(phone, session) {
  let programs;
  try {
    programs = await getAllStudentPrograms(session.studentId);
  } catch (err) {
    console.error('[certificados] Error consultando programas:', err.message);
    return _showCertRamaA(phone); // fallback graceful
  }

  if (programs.length === 0) {
    return _showCertRamaA(phone);
  }

  if (programs.length === 1) {
    updateSession(phone, { programOptions: programs, programPage: 0 });
    return _handleCertProgramSelected(phone, 0, session);
  }

  updateSession(phone, { estado: 'flow_cert_programa', programOptions: programs, programPage: 0 });
  await _sendCertProgramPage(phone, programs, 0);
}

async function _sendCertProgramPage(phone, programs, page) {
  const rows = buildProgramRows(programs, page, 'cert');
  const total = programs.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const footer = pages > 1 ? `Página ${page + 1} de ${pages}` : 'Selecciona un programa';
  await sendList(
    phone,
    'Mis Programas',
    '¿Sobre cuál de tus programas tienes consulta de certificación? 📋',
    footer,
    '📋 Ver programas',
    [{ title: 'Tus programas', rows }]
  );
}

async function _handleCertProgramSelected(phone, index, session) {
  const programs = session.programOptions || [];
  const program  = programs[index];

  if (!program) {
    await sendText(phone, '⚠️ No pudimos identificar el programa. Por favor intenta de nuevo.');
    return _showCertProgramList(phone, session);
  }

  const certStatus = program.certificate_status || 'PENDIENTE';

  // ── EMITIDO con URL ──────────────────────────────────────────────────────
  if (certStatus === 'EMITIDO' && program.certificate_url) {
    // Combinamos info + botones en un solo sendButtons para que lleguen juntos.
    // (sendText va por Chatwoot→Meta; sendButtons va directo a Meta API —
    //  si se envían por separado los botones llegan antes que el texto.)
    updateSession(phone, { estado: 'resuelto_bot', resuelto_bot_at: Date.now() });
    await sendButtons(
      phone,
      `🎓 Tu certificado ya está disponible:\n\n` +
      `📄 *${program.program_name}*\n` +
      `🔗 ${program.certificate_url}\n\n` +
      `¡Felicitaciones por completar tu programa! 🎉\n` +
      `¿Hay algo más en lo que pueda ayudarte?`,
      [
        { id: 'bot_resuelto_no',   title: '✅ No, es todo' },
        { id: 'bot_resuelto_menu', title: '📋 Ver menú' },
      ]
    );
    return;
  }

  // ── PENDIENTE o BLOQUEADO → crear ticket ────────────────────────────────
  const notes = certStatus === 'BLOQUEADO'
    ? 'Certificado bloqueado — requiere revisión'
    : 'Alumno consultó por certificado pendiente via bot';

  let solicitud;
  try {
    solicitud = await createSolicitud(
      session.studentId,
      session.conversationId,
      'CERTIFICADO_PENDIENTE',
      program.program_name,
      program.id,
      notes,
      phone
    );
  } catch (err) {
    console.error('[certificados] Error creando solicitud:', err.message);
    await sendText(phone, '⚠️ No pudimos registrar tu caso en este momento. Un asesor te contactará.');
    await runTransfer(phone, { ...session, ultimoTema: 'certificacion' });
    return;
  }

  const headerText = certStatus === 'BLOQUEADO'
    ? `Tu certificado tiene una observación pendiente 😔\nHemos registrado tu caso 📋`
    : `Hemos registrado tu consulta 📋`;

  const dentroHorario = isWithinBusinessHours();

  if (dentroHorario) {
    await sendText(
      phone,
      `${headerText}\n\n` +
      `🎫 *Número de ticket: ${solicitud.ticket_number}*\n` +
      `📄 Programa: ${program.program_name}\n\n` +
      `Un asesor del equipo académico revisará tu caso y se comunicará contigo a la brevedad 💙\n` +
      `⏱️ Tiempo estimado: 15 minutos`
    );
    await runTransfer(
      phone,
      { ...session, ultimoTema: 'certificacion' },
      `Ticket ${solicitud.ticket_number} — ${notes}`,
      { skipTicket: true }
    );
  } else {
    await sendText(
      phone,
      `${headerText}\n\n` +
      `🎫 *Número de ticket: ${solicitud.ticket_number}*\n` +
      `📄 Programa: ${program.program_name}\n\n` +
      `Tu ticket quedó registrado y será atendido al inicio del siguiente horario 😊\n\n` +
      `⏰ Nuestro equipo atiende:\n${getScheduleText()}`
    );
    updateSession(phone, { estado: 'menu' });
  }
}

// ── Router único para todos los pasos del flujo ──────────────────────────────

async function handleCertReply(phone, buttonId, session) {

  // ── Paginación de programas ──────────────────────────────────────────────
  if (buttonId === 'prog_ver_mas' || buttonId === 'prog_anterior') {
    const programs    = session.programOptions || [];
    const currentPage = session.programPage ?? 0;
    const newPage     = buttonId === 'prog_ver_mas' ? currentPage + 1 : currentPage - 1;
    const safePage    = Math.max(0, Math.min(newPage, Math.ceil(programs.length / PAGE_SIZE) - 1));
    updateSession(phone, { programPage: safePage });
    return _sendCertProgramPage(phone, programs, safePage);
  }

  // ── Rama B: selección de programa ───────────────────────────────────────
  const progMatch = buttonId?.match(/^cert_prog_(\d+)$/);
  if (progMatch) {
    const index = parseInt(progMatch[1], 10);
    return _handleCertProgramSelected(phone, index, session);
  }

  // ── Rama A: Paso 2A — tipo para Presencial / En vivo ────────────────────
  if (buttonId === 'cert_pres_en_vivo') {
    updateSession(phone, { estado: 'flow_cert_tipo', certTrack: 'pres' });
    await sendButtons(
      phone,
      `¿Tu certificado es de un curso o de un programa?`,
      [
        { id: 'cert_pres_curso', title: '📘 Curso' },
        { id: 'cert_pres_prog',  title: '📗 Espec./Dipl./PEE' },
      ]
    );

  // ── Rama A: Paso 2B — tipo para Online ──────────────────────────────────
  } else if (buttonId === 'cert_online') {
    updateSession(phone, { estado: 'flow_cert_tipo', certTrack: 'online' });
    await sendButtons(
      phone,
      `¿Tu certificado es de un curso o de una especialización?`,
      [
        { id: 'cert_online_curso',  title: '📘 Curso' },
        { id: 'cert_online_espec',  title: '📗 Especialización' },
      ]
    );

  // ── Rama A: Paso 3 — tiempos + preguntar si ya pasó el plazo ────────────
  } else if (CERT_INFO[buttonId]) {
    const info = CERT_INFO[buttonId];
    updateSession(phone, { estado: 'flow_cert_plazo', pendingData: buttonId });
    await sendButtons(
      phone,
      `Tu certificado estará disponible en *${info.dias}* 🎓\n\n` +
      `📌 Lo recibirás en ${info.donde}\n` +
      `🚨 ${info.nota}\n\n` +
      `¿Ya pasaron esos días hábiles y aún no tienes tu certificado?`,
      [
        { id: 'cert_en_plazo',    title: '✅ Aún en el plazo' },
        { id: 'cert_fuera_plazo', title: '⚠️ Ya pasó el plazo' },
      ]
    );

  // ── Rama A: Paso 4A — aún en plazo ──────────────────────────────────────
  } else if (buttonId === 'cert_en_plazo') {
    updateSession(phone, { estado: 'flow_cert_info' });
    await sendButtons(
      phone,
      `Perfecto 😊 Cuando llegue el momento, podrás descargarlo desde:\n` +
      `🔗 https://we-educacion.com/web/login → *Mis Certificados*`,
      [
        { id: 'cert_ok',        title: '✅ Entendido' },
        { id: 'cert_otra_duda', title: '❓ Tengo otra duda' },
        { id: 'cert_asesor',    title: '💬 Hablar con asesor' },
      ]
    );

  // ── Rama A: Paso 4B — ya pasó el plazo ──────────────────────────────────
  } else if (buttonId === 'cert_fuera_plazo') {
    await askReclamoDatos(
      phone,
      'reclamo_certificado',
      `Lamentamos el inconveniente 😔 Vamos a revisar tu caso de inmediato.\nUn asesor te atenderá en breve 💙`
    );

  // ── Confirmaciones finales ───────────────────────────────────────────────
  } else if (buttonId === 'cert_ok') {
    tagFlow(phone, ['resuelto-bot', 'certificados']);
    await showBotResuelto(phone);

  } else if (buttonId === 'cert_otra_duda') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);

  } else if (buttonId === 'cert_asesor' || buttonId === 'hablar_asesor') {
    updateSession(phone, { ultimoTema: 'certificacion' });
    await runTransfer(phone, session);
  }
}

module.exports = { showCertificados, handleCertReply };
