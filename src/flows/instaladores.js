const { sendText, sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }                   = require('../services/session');
const { tagFlow }                         = require('../services/chatwoot');
const { runTransfer }                     = require('./transfer');
const { showMenu }                        = require('./menu');
const { showBotResuelto }                 = require('./resuelto');

// ── Textos reutilizables ──────────────────────────────────────────────────────
const MSG_CLAVE_HANA =
  `Para ingresar a *SAP HANA*:\n\n` +
  `1. Ingresa con contraseña: *Clave12345* (la C debe ser mayúscula)\n` +
  `2. Cuando te pida nueva contraseña, escribe nuevamente: *Clave12345*\n\n` +
  `⚠️ Nunca copies y pegues la contraseña, escríbela manualmente`;

const MSG_CLAVE_R3 =
  `Para ingresar a *SAP R/3*:\n\n` +
  `1. Ingresa con contraseña: *Clave12345* (la C debe ser mayúscula)\n` +
  `2. Cuando te pida nueva contraseña, escribe nuevamente: *Clave12345*\n\n` +
  `⚠️ Nunca copies y pegues la contraseña, escríbela manualmente`;

const MSG_CORPORATIVA =
  `SAP HANA no es compatible con laptops o computadoras empresariales.\n\n` +
  `Por favor intenta desde tu *laptop personal* siguiendo el manual de instalación en tus materiales del curso.`;

const BTNS_RESULTADO = [
  { id: 'inst_ok', title: '✅ Sí, ya pude' },
  { id: 'inst_no', title: '❌ Sigue el problema' },
];

// ── Helper: pedir tipo de laptop antes del transfer ───────────────────────────
async function askLaptopType(phone, label) {
  updateSession(phone, {
    estado:     'flow_inst_laptop',
    ultimoTema: label,
  });
  await sendButtons(
    phone,
    `Para agilizar tu atención, ¿usas laptop personal o corporativa?`,
    [
      { id: 'inst_laptop_personal', title: '💻 Personal' },
      { id: 'inst_laptop_corp',     title: '🏢 Corporativa' },
    ]
  );
}

// ── PASO 1 — Selección de programa ────────────────────────────────────────────
async function showInstaladores(phone) {
  updateSession(phone, { estado: 'flow_inst_tipo', ultimoTema: 'instaladores' });
  tagFlow(phone, ['bot-activo', 'instaladores'], 'Instaladores');
  await sendList(
    phone,
    'Instaladores',
    '¿Qué programa necesitas? 💻',
    'Selecciona una opción',
    '📋 Ver opciones',
    [{
      title: 'Programas disponibles',
      rows: [
        { id: 'inst_hana', title: 'SAP HANA',     description: 'Acceso, ejecución o instalación' },
        { id: 'inst_r3',   title: 'SAP R/3',       description: 'Acceso o instalación' },
        { id: 'inst_o365', title: 'Office 365',    description: 'Cuenta de Office' },
        { id: 'inst_otro', title: 'Otro problema', description: 'Otro software o instalador' },
      ],
    }]
  );
}

// ── Handler único para todos los estados del flujo ────────────────────────────
async function handleInstaladoresReply(phone, buttonId, session) {

  // ── PASO 1 → selección de programa ─────────────────────────────────────
  if (buttonId === 'inst_hana') {
    updateSession(phone, { estado: 'flow_inst_hana_problema' });
    await sendButtons(
      phone,
      `¿Cuál es tu problema con SAP HANA?`,
      [
        { id: 'inst_hana_clave',      title: '🔑 Clave / Acceso' },
        { id: 'inst_hana_cargando',   title: '⏳ Se queda cargando' },
        { id: 'inst_hana_instalacion',title: '📥 No pude instalar' },
      ]
    );

  } else if (buttonId === 'inst_r3') {
    updateSession(phone, { estado: 'flow_inst_r3_problema' });
    await sendButtons(
      phone,
      `¿Cuál es tu problema con SAP R/3?`,
      [
        { id: 'inst_r3_clave', title: '🔑 Clave / Acceso' },
        { id: 'inst_r3_otro',  title: '❓ Otro problema' },
      ]
    );

  } else if (buttonId === 'inst_o365') {
    await sendText(phone, `Entendido, un asesor te ayudará con tu cuenta de Office 365 en breve 💙`);
    await askLaptopType(phone, 'soporte_office');

  } else if (buttonId === 'inst_otro') {
    await askLaptopType(phone, 'soporte_instaladores');

  // ── SAP HANA: problemas específicos ────────────────────────────────────
  } else if (buttonId === 'inst_hana_clave') {
    updateSession(phone, { estado: 'flow_inst_hana_clave_ok' });
    await sendText(phone, MSG_CLAVE_HANA);
    await sendButtons(phone, `¿Pudiste ingresar?`, BTNS_RESULTADO);

  } else if (buttonId === 'inst_hana_cargando') {
    updateSession(phone, { estado: 'flow_inst_hana_cargando_ok' });
    await sendText(phone, MSG_CORPORATIVA);
    await sendButtons(phone, `¿Pudiste ejecutarlo?`, BTNS_RESULTADO);

  } else if (buttonId === 'inst_hana_instalacion') {
    await askLaptopType(phone, 'soporte_sap');

  // ── SAP R/3: problemas específicos ─────────────────────────────────────
  } else if (buttonId === 'inst_r3_clave') {
    updateSession(phone, { estado: 'flow_inst_r3_clave_ok' });
    await sendText(phone, MSG_CLAVE_R3);
    await sendButtons(phone, `¿Pudiste ingresar?`, BTNS_RESULTADO);

  } else if (buttonId === 'inst_r3_otro') {
    await askLaptopType(phone, 'soporte_sap');

  // ── Resultado: solucionado ─────────────────────────────────────────────
  } else if (buttonId === 'inst_ok') {
    tagFlow(phone, ['resuelto-bot', 'instaladores']);
    await sendText(
      phone,
      `¡Excelente! 🎉 Me alegra que hayas podido solucionarlo.`
    );
    await showBotResuelto(phone);

  // ── Resultado: sigue el problema → pedir laptop ────────────────────────
  } else if (buttonId === 'inst_no') {
    await askLaptopType(phone, 'soporte_sap');

  // ── Tipo de laptop → transfer con esa info como nota ───────────────────
  } else if (buttonId === 'inst_laptop_personal') {
    await runTransfer(phone, session, 'Laptop: Personal');

  } else if (buttonId === 'inst_laptop_corp') {
    await runTransfer(phone, session, 'Laptop: Corporativa');
  }
}

module.exports = { showInstaladores, handleInstaladoresReply };
