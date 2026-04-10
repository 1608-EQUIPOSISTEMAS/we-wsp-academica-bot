const { sendText, sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }                  = require('../services/session');
const { tagFlow }                        = require('../services/chatwoot');
const { runTransfer }                    = require('./transfer');
const { showMenu }                       = require('./menu');
const { askReclamoDatos }                = require('./reclamo');
const { showBotResuelto }               = require('./resuelto');
const { getAllStudentPrograms, createSolicitud } = require('../services/database');
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

// ── Helpers de UI para el List Message ───────────────────────────────────────

/** Elimina sufijos de versión interna (V1–V7) del texto. */
const _cleanVersion = (text) => text ? text.replace(/\s*V[1-7]\b/gi, '').trim() : '';

/** Deduce el tipo de programa a partir del nombre. */
function _deduceTipo(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('diplomado'))     return 'Diplomado';
  if (n.includes('especializaci')) return 'Especialización';
  if (n.includes('pee'))           return 'PEE';
  return 'Curso';
}

/**
 * Título de la fila: si el nombre limpio supera 20 chars y hay abreviatura,
 * usa la abreviatura limpia; de lo contrario usa el nombre limpio.
 * Truncado de seguridad final a 24 chars (límite WhatsApp).
 */
function _buildRowTitle(p) {
  const name = _cleanVersion(p.program_name || 'Programa');
  const abbr = _cleanVersion(p.abbreviation || '');
  const base = (name.length > 20 && abbr) ? abbr : name;
  return base.length > 24 ? base.slice(0, 21) + '...' : base;
}

/**
 * Genera la descripción de la fila según tipo y modalidad.
 * EN_VIVO → "Diplomado | En Vivo | Año: 2025"
 * ONLINE  → "Curso | Online"
 * otros   → solo tipo
 */
function _buildRowDescription(p) {
  const tipo = _deduceTipo(p.program_name);
  const year = p.start_date ? new Date(p.start_date).getUTCFullYear() : null;
  if (p.modality === 'EN_VIVO') {
    return year ? `${tipo} | En Vivo | Año: ${year}` : `${tipo} | En Vivo`;
  }
  if (p.modality === 'ONLINE') {
    return `${tipo} | Online`;
  }
  return tipo;
}

// ── Entrada principal ─────────────────────────────────────────────────────────

async function showCertificados(phone, session) {
  updateSession(phone, { estado: 'flow_cert_modalidad', ultimoTema: 'certificacion' });
  tagFlow(phone, ['bot-activo', 'certificados'], 'Certificación');

  const verifiedFlowEnabled = process.env.ENABLE_VERIFIED_FLOW !== 'false';
  if (verifiedFlowEnabled && session.verified && session.studentId) {
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

  if (programs.length === 0) return _showCertRamaA(phone);

  // Ordenar por fecha de inicio descendente (más recientes primero)
  programs.sort((a, b) => {
    if (!a.start_date) return 1;
    if (!b.start_date) return -1;
    return new Date(b.start_date) - new Date(a.start_date);
  });

  // Enriquecer cada programa con el título renderizado (para matching en bot.js)
  const programsWithTitle = programs.map(p => ({ ...p, renderedTitle: _buildRowTitle(p) }));

  // Guardar lista completa en sesión (necesaria para búsqueda y selección por índice)
  updateSession(phone, { estado: 'flow_cert_programa', programOptions: programsWithTitle });

  if (programsWithTitle.length === 1) {
    return _handleCertProgramSelected(phone, 0, { ...session, programOptions: programsWithTitle });
  }

  await _sendCertTop5(phone, programsWithTitle);
}

async function _sendCertTop5(phone, allPrograms) {
  const rows = allPrograms.slice(0, 5).map((p, i) => ({
    id:          `cert_prog_${i}`,
    title:       p.renderedTitle || _buildRowTitle(p),
    description: _buildRowDescription(p),
  }));

  if (allPrograms.length > 5) {
    rows.push({ id: 'cert_buscar', title: '🔍 Buscar otro programa...', description: '' });
  }

  await sendList(
    phone,
    'Mis Programas',
    '¿Sobre cuál de tus programas tienes consulta de certificación? 📋',
    'Selecciona un programa',
    '📋 Ver programas',
    [{ title: 'Tus programas', rows }]
  );
}

async function _sendCertSearchResults(phone, keyword, results) {
  const rows = results.slice(0, 9).map(p => ({
    id:          `cert_prog_${p._index}`,
    title:       p.renderedTitle || _buildRowTitle(p),
    description: _buildRowDescription(p),
  }));

  if (results.length > 9) {
    rows.push({ id: 'cert_buscar', title: '🔍 Refinar búsqueda...', description: '' });
  }

  await sendList(
    phone,
    'Resultados',
    `Encontré *${results.length}* programa(s) con "*${keyword}*" 📋`,
    'Selecciona el que buscas',
    '📋 Ver resultados',
    [{ title: 'Resultados', rows }]
  );
}

async function _handleCertProgramSelected(phone, index, session) {
  const programs = session.programOptions || [];
  const program  = programs[index];

  if (!program) {
    await sendText(phone, '⚠️ No pudimos identificar el programa. Por favor intenta de nuevo.');
    return _showCertProgramList(phone, session);
  }

  // ── Con URL: certificado disponible ─────────────────────────────────────
  if (program.certificate_url) {
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

  // ── Sin URL: certificado aún no generado → crear ticket ─────────────────
  let solicitud;
  try {
    solicitud = await createSolicitud(
      session.studentId,
      session.conversationId,
      'CERTIFICADO_PENDIENTE',
      program.program_name,
      program.id,
      'Alumno consultó por certificado — aún no generado en el sistema',
      phone
    );
  } catch (err) {
    console.error('[certificados] Error creando solicitud:', err.message);
    await sendText(phone, '⚠️ No pudimos registrar tu caso en este momento. Un asesor te contactará.');
    await runTransfer(phone, { ...session, ultimoTema: 'certificacion' });
    return;
  }

  const dentroHorario = isWithinBusinessHours();

  if (dentroHorario) {
    await sendText(
      phone,
      `Aún no has generado tu certificado para este programa o está en proceso 📋\n\n` +
      `🎫 *Número de ticket: ${solicitud.ticket_number}*\n` +
      `📄 Programa: *${program.program_name}*\n\n` +
      `Un asesor del equipo académico revisará tu caso y se comunicará contigo a la brevedad 💙\n` +
      `⏱️ Tiempo estimado: 15 minutos`
    );
    await runTransfer(
      phone,
      { ...session, ultimoTema: 'certificacion' },
      `Ticket ${solicitud.ticket_number} — certificado pendiente de generación`,
      { skipTicket: true }
    );
  } else {
    await sendText(
      phone,
      `Aún no has generado tu certificado para este programa o está en proceso 📋\n\n` +
      `🎫 *Número de ticket: ${solicitud.ticket_number}*\n` +
      `📄 Programa: *${program.program_name}*\n\n` +
      `Tu ticket quedó registrado y será atendido al inicio del siguiente horario 😊\n\n` +
      `⏰ Nuestro equipo atiende:\n${getScheduleText()}`
    );
    updateSession(phone, { estado: 'menu' });
  }
}

// ── Búsqueda libre de programa ────────────────────────────────────────────────

async function handleCertSearch(phone, keyword, session) {
  const allPrograms = session.programOptions || [];
  const kw          = keyword.trim().toLowerCase();

  const results = allPrograms
    .map((p, i) => ({ ...p, _index: i }))
    .filter(p =>
      p.program_name.toLowerCase().includes(kw) ||
      (p.abbreviation || '').toLowerCase().includes(kw) ||
      (p.renderedTitle || '').toLowerCase().includes(kw)
    );

  if (results.length === 0) {
    await sendButtons(
      phone,
      `No encontré ningún programa con "*${keyword}*" 😔\n¿Qué deseas hacer?`,
      [
        { id: 'cert_buscar', title: '🔍 Buscar de nuevo' },
        { id: 'cert_asesor', title: '💬 Hablar con asesor' },
      ]
    );
    // Mantener estado flow_cert_busqueda para que el alumno pueda reintentar
    updateSession(phone, { estado: 'flow_cert_busqueda' });
    return;
  }

  updateSession(phone, { estado: 'flow_cert_programa' });
  await _sendCertSearchResults(phone, keyword, results);
}

// ── Router único para todos los pasos del flujo ──────────────────────────────

async function handleCertReply(phone, buttonId, session) {

  // ── Buscador de programas ────────────────────────────────────────────────
  if (buttonId === 'cert_buscar') {
    updateSession(phone, { estado: 'flow_cert_busqueda' });
    await sendText(
      phone,
      `¡Claro! Escribe el nombre o una palabra clave del programa que buscas 🔍\n` +
      `_(ej: Finanzas, Marketing, Excel...)_`
    );
    return;
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

module.exports = { showCertificados, handleCertReply, handleCertSearch };
