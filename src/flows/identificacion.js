const { sendText, sendButtons, sendList, delay } = require('../services/whatsapp');
const { showMenu, getMenuSections }           = require('./menu');
const { findAlumnoByEmail,
        checkAndUpdateMembership,
        findVerifiedPhone,
        saveVerifiedPhone,
        deleteVerifiedPhone }                 = require('../services/database');
const { syncStudentFromOdoo }                 = require('../services/odoo');
const { updateSession }                       = require('../services/session');
const { tagFlow, tagAlumno }                  = require('../services/chatwoot');
const { runTransfer }                         = require('./transfer');
const { isWithinBusinessHours, getScheduleText } = require('../services/schedule');

/** Quita todo lo que no sea dígito para comparar números de teléfono */
function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

/**
 * Extrae el primer nombre de un full_name en MAYÚSCULAS y lo convierte a Title Case.
 * "ELIUTH DAVID SEGUIL MACHCO" → "Eliuth"
 */
function _toFirstName(fullName) {
  if (!fullName) return '';
  const first = String(fullName).trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Intenta reconocer al alumno por su teléfono (sesión persistente de 1 mes).
 * Si lo encuentra, muestra saludo + menú en un solo mensaje de lista.
 * Retorna true si lo reconoció (el caller debe hacer return).
 */
async function tryQuickGreeting(phone) {
  let record;
  try {
    record = await findVerifiedPhone(phone);
  } catch (err) {
    console.error('[identificacion] Error buscando verified phone:', err.message);
    return false;
  }

  if (!record) return false;

  const primerNombre = _toFirstName(record.nombre);

  updateSession(phone, {
    nombre:         record.nombre,
    correo:         record.correo,
    studentId:      record.student_id,
    odooPartnerId:  record.odoo_partner_id || null,
    verified:       record.verified,
    isMember:       record.is_member,
    membershipTier: record.membership_tier,
    estado:         'menu',
  });
  tagAlumno(phone, record.nombre, record.correo);
  tagFlow(phone, ['bot-activo']);

  const tierEmoji = { 'WE BLACK': '🖤', 'WE GOLD': '✨', 'WE PLAT': '🥈' };
  const saludoTexto = (record.verified && record.is_member)
    ? `¡${primerNombre}! Qué gusto saludar a un miembro ${record.membership_tier} ${tierEmoji[record.membership_tier] ?? '⭐'} ¿En qué puedo ayudarte hoy?`
    : `¡${primerNombre}! 👋 Qué gusto verte de nuevo. ¿En qué puedo ayudarte hoy?`;

  await sendList(
    phone,
    null,
    saludoTexto,
    'Selecciona una opción para continuar.',
    'Ver opciones',
    getMenuSections(record.nombre)
  );

  return true;
}

/**
 * Handler: si el alumno elige "No soy [nombre]" del menú rápido.
 */
async function handleQuickNoSoyYo(phone) {
  try { await deleteVerifiedPhone(phone); } catch (_) {}
  updateSession(phone, {
    nombre: null, correo: null, studentId: null,
    verified: false, isMember: false, membershipTier: null,
  });
  await startIdentificacion(phone);
}

async function startIdentificacion(phone) {
  const dentroHorario = isWithinBusinessHours();

  await sendText(
    phone,
    `¡Hola! 👋 Soy *Eva*, tu asistente virtual en _W|E Educación Ejecutiva_. ¡Qué gusto saludarte!`
  );

  await delay(1200);

  if (dentroHorario) {
    await sendText(
      phone,
      `Estoy aquí para ayudarte a resolver tus consultas académicas al instante ⚡`
    );
  } else {
    await sendText(
      phone,
      `En este momento nuestro equipo humano está descansando 🌙 _(están disponibles ${getScheduleText()})_, ` +
      `¡pero no te preocupes! Yo estoy aquí 24/7 para ayudarte a resolver tus consultas académicas al instante ⚡`
    );
  }

  await delay(1200);

  await sendText(
    phone,
    `Para poder buscar tu expediente en nuestro sistema y darte información exacta, ` +
    `¿podrías escribirme el correo electrónico con el que realizaste tu inscripción? 📧`
  );

  updateSession(phone, { estado: 'esperando_correo' });
  tagFlow(phone, ['bot-activo']);
}

/** Valida que el texto tenga estructura mínima de correo: algo@algo.algo */
function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

const MAX_INTENTOS_CORREO  = 5;
const RESET_INTENTOS_MS    = 60 * 60 * 1000; // 1 hora

/**
 * Incrementa el contador de intentos fallidos y, si se alcanza el límite,
 * transfiere directamente a un asesor.
 * El contador se resetea automáticamente si pasó más de 1 hora desde el
 * primer fallo (el usuario puede haber buscado su correo y vuelto).
 * Devuelve true si se transfirió (el caller debe hacer return).
 */
async function _registrarFalloCorreo(phone, session) {
  const ahora    = Date.now();
  const resetAt  = session.correo_intentos_reset_at || 0;
  const expirado = ahora - resetAt > RESET_INTENTOS_MS;

  const intentos = expirado ? 1 : (session.correo_intentos || 0) + 1;
  updateSession(phone, {
    correo_intentos:          intentos,
    correo_intentos_reset_at: expirado ? ahora : resetAt,
  });

  if (intentos >= MAX_INTENTOS_CORREO) {
    await sendText(
      phone,
      `Parece que estás teniendo dificultades para ingresar tu correo 😊\n` +
      `Un especialista de nuestro equipo te escribirá por aquí para ayudarte directamente.`
    );
    updateSession(phone, { ultimoTema: 'correo_no_encontrado' });
    await runTransfer(phone, { ...session, ultimoTema: 'correo_no_encontrado' });
    return true;
  }

  return false;
}

async function handleCorreo(phone, email, session) {
  const emailClean = email.trim().toLowerCase();

  // ── Validación de formato antes de consultar la DB o Odoo ────────────────
  if (!isValidEmail(emailClean)) {
    const transferido = await _registrarFalloCorreo(phone, session);
    if (transferido) return;

    const intentos  = session.correo_intentos || 0;
    const restantes = MAX_INTENTOS_CORREO - intentos;
    await sendText(
      phone,
      `Hmm, eso no parece un correo electrónico válido 🤔\n` +
      `Recuerda que suele tener el formato *nombre@ejemplo.com*. ¿Podrías escribirlo de nuevo?` +
      (restantes === 1 ? `\n\n_Este es tu último intento disponible._` : '')
    );
    return;
  }

  let alumno;
  try {
    alumno = await findAlumnoByEmail(emailClean);
  } catch (err) {
    console.error('[identificacion] Error DB:', err);
    await sendText(phone, '⚠️ Hubo un error al verificar tu correo. Por favor intenta de nuevo.');
    return;
  }

  // ── Sync desde Odoo si el alumno no existe o aún no fue validado ──────────
  const needsSync = !alumno || alumno.flag_odoo_validation === false;
  if (needsSync) {
    await sendText(phone, `⏳ Validando información...`);
    try {
      await syncStudentFromOdoo(emailClean);
    } catch (err) {
      console.error('[identificacion] Error sync Odoo:', err.message);
      await sendText(
        phone,
        `Uy, parece que nuestro sistema está tomando una pequeña siesta 😴 Estamos teniendo un contratiempo técnico, pero en unos minutos debería resolverse.\n` +
        `Por favor, intenta de nuevo en un momento.`
      );
      return;
    }
    // Re-consultar después del sync
    try {
      alumno = await findAlumnoByEmail(emailClean);
    } catch (err) {
      console.error('[identificacion] Error DB post-sync:', err);
      await sendText(phone, '⚠️ Hubo un error al verificar tu correo. Por favor intenta de nuevo.');
      return;
    }
  }

  if (alumno) {
    // ── Verificación: con correo válido basta ──────────────────────────────
    const verified = true;

    // ── Verificar membresía VIP ───────────────────────────────────────────────
    let isMember       = false;
    let membershipTier = null;
    try {
      const mem  = await checkAndUpdateMembership(emailClean);
      isMember   = mem.isMember;
      membershipTier = mem.tier;
    } catch (err) {
      console.error('[identificacion] Error verificando membresía:', err.message);
    }

    const primerNombre = _toFirstName(alumno.full_name);

    updateSession(phone, {
      nombre:        alumno.full_name,
      correo:        alumno.email,
      studentId:     alumno.id,
      odooPartnerId: alumno.odoo_partner_id || null,
      verified,
      isMember,
      membershipTier,
      estado:        'menu',
    });
    tagAlumno(phone, alumno.full_name, alumno.email);

    // ── Persistir sesión verificada (1 mes) ─────────────────────────────────
    saveVerifiedPhone({
      phone, correo: alumno.email, nombre: alumno.full_name,
      studentId: alumno.id, membershipTier, isMember, verified,
      odooPartnerId: alumno.odoo_partner_id || null,
    }).catch(err => console.error('[identificacion] Error guardando verified phone:', err.message));

    const tierEmoji = { 'WE BLACK': '🖤', 'WE GOLD': '✨', 'WE PLAT': '🥈' };
    const saludoTexto = (verified && isMember)
      ? `¡${primerNombre}! Qué gusto saludar a un miembro ${membershipTier} ${tierEmoji[membershipTier] ?? '⭐'} ¿En qué puedo ayudarte hoy?`
      : `¡${primerNombre}! 👋 Te encontré en el sistema. ¿En qué te puedo ayudar hoy?`;

    await sendList(
      phone,
      null,
      saludoTexto,
      'Selecciona una opción para continuar.',
      'Ver opciones',
      getMenuSections()
    );
  } else {
    const transferido = await _registrarFalloCorreo(phone, session);
    if (transferido) return;

    updateSession(phone, { estado: 'correo_no_encontrado' });
    await sendButtons(
      phone,
      `Uy, busqué por todas partes pero no logré encontrar ese correo en nuestros registros 🕵️‍♀️\n¿Es posible que te hayas inscrito con otro?`,
      [
        { id: 'reintentar_correo', title: 'Intentar otro correo' },
        { id: 'hablar_asesor',     title: 'Hablar con un asesor' },
      ]
    );
  }
}

async function handleCorreoNoEncontrado(phone, buttonId, session) {
  if (buttonId === 'reintentar_correo') {
    updateSession(phone, { estado: 'esperando_correo' });
    await sendText(phone, 'Por favor, escribe nuevamente tu correo de inscripción:');
  } else if (buttonId === 'hablar_asesor') {
    updateSession(phone, { ultimoTema: 'correo_no_encontrado' });
    await runTransfer(phone, session);
  }
}

module.exports = { startIdentificacion, handleCorreo, handleCorreoNoEncontrado, tryQuickGreeting, handleQuickNoSoyYo };
