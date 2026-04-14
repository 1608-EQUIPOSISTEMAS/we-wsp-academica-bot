const { sendText, sendButtons, sendList,
        sendBase64Pdf, delay }           = require('../services/whatsapp');
const { updateSession }                  = require('../services/session');
const { tagFlow, addPrivateNote }        = require('../services/chatwoot');
const { runTransfer }                    = require('./transfer');
const { showMenu }                       = require('./menu');
const { askReclamoDatos }                = require('./reclamo');
const { showBotResuelto }               = require('./resuelto');
const { getAllStudentPrograms, createSolicitud } = require('../services/database');
const { isWithinBusinessHours, getScheduleText } = require('../services/schedule');
const { fetchStudentCertificates,
        fetchCertificatePdf }            = require('../services/odoo');

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

/** Formatea 'YYYY-MM-DD' de Odoo a 'DD/MM/YYYY' legible. */
function _formatCertDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

/** Prefijos que indican el tipo de programa y ensanchan el nombre innecesariamente. */
const _CERT_PREFIXES = [
  { re: /^Especialización\s+en\s+/i,      tipo: 'Especialización' },
  { re: /^Especialista\s+en\s+/i,         tipo: 'Especialización' },
  { re: /^Programa\s+de\s+Especialización\s+en\s+/i, tipo: 'Especialización' },
  { re: /^Diplomado\s+en\s+/i,            tipo: 'Diplomado' },
  { re: /^Diplomado\s+/i,                 tipo: 'Diplomado' },
  { re: /^PEE\s+en\s+/i,                  tipo: 'PEE' },
  { re: /^PEE\s+/i,                       tipo: 'PEE' },
];

/**
 * Descompone el nombre de un certificado de Odoo en { shortTitle, tipo }.
 * - Quita prefijos de tipo (Especialización en, Diplomado en, PEE…)
 * - Elimina la palabra "Online" donde aparezca
 * - Aplica _cleanVersion para sufijos V1-V7
 * Si no hay prefijo detectado → tipo null (es un Curso)
 */
function _parseCertName(courseName) {
  const base = _cleanVersion(
    (courseName || 'Certificado').replace(/\bonline\b/gi, '').replace(/\s{2,}/g, ' ').trim()
  );
  for (const { re, tipo } of _CERT_PREFIXES) {
    if (re.test(base)) {
      const shortTitle = base.replace(re, '').trim();
      return { shortTitle, tipo };
    }
  }
  return { shortTitle: base, tipo: null };
}

/** Trunca a 24 chars con "…" (límite de título de fila en WhatsApp). */
function _truncate24(text) {
  return text.length > 24 ? text.slice(0, 21) + '...' : text;
}

/**
 * Construye { title, description } para una fila de certificado de Odoo.
 * - title: nombre corto (sin prefijo de tipo), truncado a 24
 * - description: tipo (si lo hay) · modalidad · fecha de emisión
 */
function _buildCertRow(cert) {
  const { shortTitle, tipo } = _parseCertName(cert.courseName);
  const title      = _truncate24(shortTitle);
  const modalidad  = cert.isEnVivo ? '🏫 En Vivo' : '💻 Online';
  const fechaStr   = cert.date ? `Emitido: ${_formatCertDate(cert.date)}` : null;
  const description = [tipo, modalidad, fechaStr].filter(Boolean).join(' · ');
  return { title, description: description || 'Sin fecha' };
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

// ── Rama B — certificados reales desde Odoo ───────────────────────────────────

async function _showCertProgramList(phone, session) {
  // Sin odooPartnerId no podemos consultar Odoo → flujo genérico
  if (!session.odooPartnerId) return _showCertRamaA(phone);

  const certs = await fetchStudentCertificates(session.odooPartnerId);

  if (certs.length === 0) {
    await sendText(
      phone,
      `Aún no tienes certificados generados en nuestra plataforma 😊\n\n` +
      `Si crees que hay un error o necesitas información sobre tu certificado, ` +
      `un asesor puede ayudarte.`
    );
    await delay(500);
    await sendButtons(
      phone,
      '¿Qué deseas hacer?',
      [
        { id: 'cert_asesor', title: '💬 Hablar con asesor' },
        { id: 'volver_menu', title: '🔙 Menú principal' },
      ]
    );
    return;
  }

  // Guardar certs en sesión para el handler de selección
  updateSession(phone, { estado: 'flow_cert_programa', certOptions: certs });
  await _sendCertOdooList(phone, certs);
}

async function _sendCertOdooList(phone, certs) {
  // Ordenar por fecha desc (más recientes primero) como seguridad extra
  const sorted = [...certs].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  // Máx 9 certs dinámicos + 1 fila estática = 10 filas (límite WhatsApp)
  const rows = sorted.slice(0, 9).map(c => {
    const { title, description } = _buildCertRow(c);
    return { id: `cert_odoo_${c.id}`, title, description };
  });

  // Fila estática siempre al final
  rows.push({
    id:          'cert_tipo_avanzado',
    title:       '🙋 No veo mi certificado',
    description: 'Faltante, corrección o Diplomado/PEE',
  });

  await sendList(
    phone,
    'Mis Certificados',
    `🎓 Aquí están tus certificados disponibles.\nSelecciona uno para descargarlo:`,
    'W|E Educación Ejecutiva',
    '🎓 Ver certificados',
    [{ title: 'Certificados emitidos', rows }]
  );
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

// ── Búsqueda libre ────────────────────────────────────────────────────────────

/**
 * Bifurca la búsqueda según el flujo activo:
 *   - certOptions presentes → flujo Odoo (busca en certificados reales)
 *   - programOptions presentes → flujo DB (busca en programas locales)
 */
async function handleCertSearch(phone, keyword, session) {
  const kw = keyword.trim().toLowerCase();

  // ── Flujo Odoo: buscar en session.certOptions ──────────────────────────
  const certOptions = session.certOptions || [];
  if (certOptions.length > 0) {
    const results = certOptions.filter(c =>
      (c.courseName || '').toLowerCase().includes(kw)
    );

    if (results.length === 0) {
      await sendButtons(
        phone,
        `No encontré ningún certificado con "*${keyword}*" 😔\n¿Qué deseas hacer?`,
        [
          { id: 'cert_buscar', title: '🔍 Buscar de nuevo' },
          { id: 'cert_asesor', title: '💬 Hablar con asesor' },
        ]
      );
      updateSession(phone, { estado: 'flow_cert_busqueda' });
      return;
    }

    updateSession(phone, { estado: 'flow_cert_programa' });
    return _sendCertOdooSearchResults(phone, keyword, results);
  }

  // ── Flujo DB: buscar en session.programOptions ─────────────────────────
  const allPrograms = session.programOptions || [];
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
    updateSession(phone, { estado: 'flow_cert_busqueda' });
    return;
  }

  updateSession(phone, { estado: 'flow_cert_programa' });
  await _sendCertSearchResults(phone, keyword, results);
}

/** Muestra resultados de búsqueda para el flujo Odoo (IDs cert_odoo_*). */
async function _sendCertOdooSearchResults(phone, keyword, results) {
  // Máx 9 resultados + fila estática = 10 filas (límite WhatsApp)
  const rows = results.slice(0, 9).map(c => {
    const { title, description } = _buildCertRow(c);
    return { id: `cert_odoo_${c.id}`, title, description };
  });

  // Siempre el salvavidas al final
  rows.push({
    id:          'cert_tipo_avanzado',
    title:       '🙋 No veo mi certificado',
    description: 'Faltante, corrección o Diplomado/PEE',
  });

  await sendList(
    phone,
    'Resultados',
    `Encontré *${results.length}* certificado(s) con "*${keyword}*" 🎓`,
    'Selecciona el que buscas',
    '🎓 Ver resultados',
    [{ title: 'Certificados encontrados', rows }]
  );
}

// ── Router único para todos los pasos del flujo ──────────────────────────────

async function handleCertReply(phone, buttonId, session) {

  // ── Paso 7: Diplomados / PEE / Especializaciones → contexto primero ────
  if (buttonId === 'cert_tipo_avanzado') {
    let programs = [];
    try {
      const all = await getAllStudentPrograms(session.studentId);
      programs  = all.filter(p => {
        const tipo = _deduceTipo(p.program_name);
        return tipo === 'Diplomado' || tipo === 'PEE' || tipo === 'Especialización';
      });
    } catch (err) {
      console.error('[certificados] Error consultando programas avanzados:', err.message);
    }

    if (programs.length === 0) {
      // Sin programas en BD → transferir directo con texto explicativo
      await sendText(
        phone,
        `🎓 Los certificados de *Diplomados, PEE y Especializaciones* requieren una revisión académica manual.\n\n` +
        `Esto se debe a que se validan convalidaciones, módulos completados y nota integradora antes de emitirlos.\n\n` +
        `Un asesor del equipo académico revisará tu caso y te lo enviará 💙`
      );
      return runTransfer(phone, { ...session, ultimoTema: 'certificacion_avanzada' });
    }

    // Enriquecer con renderedTitle exacto antes de guardar en sesión
    const programsWithTitle = programs.map(p => ({ ...p, renderedTitle: _buildRowTitle(p) }));

    updateSession(phone, {
      estado:              'flow_cert_avanzado',
      certAvanzadoOptions: programsWithTitle,
    });

    const rows = programsWithTitle.slice(0, 9).map((p, i) => ({
      id:          `cert_avanzado_${i}`,
      title:       p.renderedTitle,
      description: _buildRowDescription(p),
    }));
    rows.push({
      id:          'cert_avanzado_otro',
      title:       '🔍 Otro / No aparece',
      description: 'Consultar por un programa antiguo',
    });

    await sendList(
      phone,
      'Certificado Final',
      `¿Para cuál de tus programas necesitas el certificado final? 🎓`,
      'W|E Educación Ejecutiva',
      '🎓 Ver programas',
      [{ title: 'Certificados Especiales', rows }]
    );
    return;
  }

  // ── Nuevo handler: selección dentro de cert_avanzado_* ───────────────────
  if (buttonId?.startsWith('cert_avanzado_')) {
    const TRANSFER_MSG =
      `🎓 Los certificados de *Diplomados, PEE y Especializaciones* requieren una revisión académica manual.\n\n` +
      `Esto se debe a que se validan convalidaciones, módulos completados y nota integradora antes de emitirlos.\n\n` +
      `Un asesor del equipo académico revisará tu caso y te lo enviará 💙`;

    let notaPrograma;
    if (buttonId === 'cert_avanzado_otro') {
      notaPrograma = 'No especificado en BD (Seleccionó "Otro")';
    } else {
      const idx     = parseInt(buttonId.replace('cert_avanzado_', ''), 10);
      const program = (session.certAvanzadoOptions || [])[idx];
      notaPrograma  = program?.program_name || 'Programa no identificado';
    }

    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `📋 *Solicitud de revisión:* El alumno reporta que no visualiza su certificado (Posible Diplomado/PEE o error en emisión).\nPrograma indicado: ${notaPrograma}`
      ).catch(err => console.error('[certificados] Error nota privada cert avanzado:', err));
    }

    await sendText(phone, TRANSFER_MSG);
    return runTransfer(phone, { ...session, ultimoTema: 'certificacion_avanzada' });
  }

  // ── Paso 6: Certificado de Odoo seleccionado → descargar y enviar PDF ───
  const odooMatch = buttonId?.match(/^cert_odoo_(\d+)$/);
  if (odooMatch) {
    const certId = parseInt(odooMatch[1], 10);
    const cert   = (session.certOptions || []).find(c => c.id === certId);
    const safeName = cert
      ? _cleanVersion(cert.courseName).replace(/\s+/g, '_').slice(0, 30)
      : 'WE';
    const filename = `Certificado_${safeName}.pdf`;

    await sendText(phone, '⏳ Generando tu certificado, dame un momento...');

    let base64;
    try {
      base64 = await fetchCertificatePdf(certId);
    } catch (err) {
      console.error('[certificados] Error obteniendo PDF de Odoo:', err.message);
      base64 = null;
    }

    if (base64) {
      try {
        await sendBase64Pdf(
          phone,
          base64,
          filename,
          `🎓 ¡Aquí tienes tu certificado! Felicitaciones por completar tu programa 🎉`
        );
        updateSession(phone, { estado: 'flow_cert_post_envio', resuelto_bot_at: Date.now() });
        await delay(500);
        await sendButtons(
          phone,
          `¿Hay algo más en lo que pueda ayudarte? 😊`,
          [
            { id: 'cert_ver_mas',      title: '🎓 Otro certificado' },
            { id: 'bot_resuelto_menu', title: '📋 Ver menú' },
            { id: 'bot_resuelto_no',   title: '✅ No, es todo' },
          ]
        );
        return;
      } catch (err) {
        console.error('[certificados] Error enviando PDF por WhatsApp:', err.message);
        await sendText(
          phone,
          `Tu certificado está listo, pero ocurrió un error al enviarlo por WhatsApp 😔\n` +
          `Un asesor te lo enviará directamente 💙`
        );
        return runTransfer(phone, { ...session, ultimoTema: 'certificacion' });
      }
    }

    // PDF null → aún no generado o vacío
    await sendText(
      phone,
      `Tu certificado está registrado, pero el PDF aún no se ha generado o está en proceso 📋\n\n` +
      `Un asesor del equipo académico podrá darte más información 💙`
    );
    return runTransfer(phone, { ...session, ultimoTema: 'certificacion' });
  }

  // ── Ver más certificados (post-envío de PDF) ─────────────────────────────
  if (buttonId === 'cert_ver_mas') {
    const certs = session.certOptions || [];
    if (certs.length > 0) {
      updateSession(phone, { estado: 'flow_cert_programa' });
      return _sendCertOdooList(phone, certs);
    }
    // Sin opciones en sesión → recargar desde Odoo
    return _showCertProgramList(phone, session);
  }

  // ── Buscador ─────────────────────────────────────────────────────────────
  if (buttonId === 'cert_buscar') {
    updateSession(phone, { estado: 'flow_cert_busqueda' });
    // Mensaje contextual: Odoo (certOptions) vs DB (programOptions)
    const esFlujoOdoo = (session.certOptions || []).length > 0;
    await sendText(
      phone,
      esFlujoOdoo
        ? `Por favor, escribe el nombre del programa o curso del cual buscas el certificado 🔍\n_(ej: Excel, Finanzas, SAP...)_`
        : `¡Claro! Escribe el nombre o una palabra clave del programa que buscas 🔍\n_(ej: Finanzas, Marketing, Excel...)_`
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
