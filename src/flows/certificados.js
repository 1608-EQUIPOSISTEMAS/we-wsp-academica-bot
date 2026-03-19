const { sendText, sendButtons } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { tagFlow }               = require('../services/chatwoot');
const { runTransfer }           = require('./transfer');
const { showMenu }              = require('./menu');
const { askReclamoDatos }       = require('./reclamo');

// ── Tabla de tiempos ─────────────────────────────────────────────────────────
// Presencial/En vivo + Curso          → 7 días  → campus virtual
// Presencial/En vivo + Espec/Dipl/PEE → 30 días → correo inscripción
// Online + Curso                      → 3 días  → campus virtual
// Online + Especialización            → 7 días  → correo inscripción
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Paso 1 — Preguntar modalidad ─────────────────────────────────────────────
async function showCertificados(phone) {
  updateSession(phone, { estado: 'flow_cert_modalidad', ultimoTema: 'certificacion' });
  tagFlow(phone, ['bot-activo', 'certificados'], 'Certificación');
  await sendButtons(
    phone,
    `¿Tu programa es presencial/en vivo u online?`,
    [
      { id: 'cert_pres_en_vivo', title: '🏫 Presencial / En vivo' },
      { id: 'cert_online',       title: '💻 Online' },
    ]
  );
}

// ── Router único para todos los pasos del flujo ──────────────────────────────
async function handleCertReply(phone, buttonId, session) {

  // ── Paso 2A — Tipo para Presencial / En vivo ────────────────────────────
  if (buttonId === 'cert_pres_en_vivo') {
    updateSession(phone, { estado: 'flow_cert_tipo', certTrack: 'pres' });
    await sendButtons(
      phone,
      `¿Tu certificado es de un curso o de un programa?`,
      [
        { id: 'cert_pres_curso', title: '📘 Curso' },
        { id: 'cert_pres_prog',  title: '📗 Especialización / Diplomado / PEE' },
      ]
    );

  // ── Paso 2B — Tipo para Online ──────────────────────────────────────────
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

  // ── Paso 3 — Mostrar tiempos + preguntar si ya pasó el plazo ───────────
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
        { id: 'cert_en_plazo',    title: '✅ No, aún estoy en el plazo' },
        { id: 'cert_fuera_plazo', title: '⚠️ Sí, ya pasó el plazo' },
      ]
    );

  // ── Paso 4A — Aún en plazo: confirmación final ──────────────────────────
  } else if (buttonId === 'cert_en_plazo') {
    updateSession(phone, { estado: 'flow_cert_info' });
    await sendButtons(
      phone,
      `Perfecto 😊 Cuando llegue el momento, podrás descargarlo desde:\n` +
      `🔗 https://intranet.we-educacion.com/ → *Mis Certificados*`,
      [
        { id: 'cert_ok',        title: '✅ Entendido' },
        { id: 'cert_otra_duda', title: '❓ Tengo otra duda' },
        { id: 'cert_asesor',    title: '💬 Hablar con asesor' },
      ]
    );

  // ── Paso 4B — Ya pasó el plazo: reclamo ────────────────────────────────
  } else if (buttonId === 'cert_fuera_plazo') {
    await askReclamoDatos(
      phone,
      'reclamo_certificado',
      `Lamentamos el inconveniente 😔 Vamos a revisar tu caso de inmediato.\nUn asesor te atenderá en breve 💙`
    );

  // ── Confirmaciones finales ──────────────────────────────────────────────
  } else if (buttonId === 'cert_ok' || buttonId === 'cert_otra_duda') {
    tagFlow(phone, ['resuelto-bot', 'certificados']);
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);

  } else if (buttonId === 'cert_asesor' || buttonId === 'hablar_asesor') {
    updateSession(phone, { ultimoTema: 'certificacion' });
    await runTransfer(phone, session);
  }
}

module.exports = { showCertificados, handleCertReply };
