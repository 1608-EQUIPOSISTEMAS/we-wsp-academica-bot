const { sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { runTransfer }           = require('./transfer');

// ── Paso 1 — Botones de categoría ────────────────────────────────────────────
async function showMenu(phone, nombre) {
  updateSession(phone, { estado: 'flow_menu_principal' });
  await sendButtons(
    phone,
    `Hola ${nombre} 👋 ¿En qué podemos ayudarte hoy?`,
    [
      { id: 'menu_academico', title: '📚 Académico' },
      { id: 'menu_pagos',     title: '💳 Pagos' },
      { id: 'hablar_asesor',  title: '💬 Con un asesor' },
    ]
  );
}

// ── Paso 2A — Lista Académico y Gestión ─────────────────────────────────────
async function showMenuAcademico(phone) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    'Académico y Gestión',
    '¿Qué necesitas?',
    'Selecciona una opción',
    '📋 Ver opciones',
    [{
      title: 'Académico y Gestión',
      rows: [
        { id: 'materiales',      title: '🖥️ Campus y Materiales', description: 'Acceso al campus virtual' },
        { id: 'cronograma',      title: '📅 Cronograma',           description: 'Fechas de tu programa' },
        { id: 'examenes_int',    title: '📝 Exámenes Int.',        description: 'Certificaciones internacionales' },
        { id: 'certificacion',   title: '🏅 Certificación',        description: 'Estado y tiempos' },
        { id: 'justificaciones', title: '📄 Justificaciones',      description: 'Gestiona tu inasistencia' },
        { id: 'alumno_flex',     title: '⚡ Alumno Flex',          description: 'Modalidad flexible' },
        { id: 'inscripcion',     title: '📝 Inscribirme',          description: 'Inscripción a programas' },
        { id: 'instaladores',    title: '💻 Instaladores',         description: 'SAP, Office y más' },
        { id: 'menu_principal',  title: '🔙 Menú principal',       description: 'Volver al inicio' },
      ],
    }]
  );
}

// ── Paso 2B — Lista Pagos y Facturación ──────────────────────────────────────
async function showMenuPagos(phone) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    'Pagos y Facturación',
    '¿Qué necesitas?',
    'Selecciona una opción',
    '📋 Ver opciones',
    [{
      title: 'Pagos y Facturación',
      rows: [
        { id: 'estado_cuenta',       title: '📊 Estado de Cuenta',    description: 'Cuotas y saldo pendiente' },
        { id: 'enviar_comprobante',   title: '🧾 Enviar Comprobante',  description: 'Registra tu pago' },
        { id: 'hablar_asesor',        title: '💬 Hablar con asesor',   description: 'Atención personalizada' },
        { id: 'menu_principal',       title: '🔙 Menú principal',      description: 'Volver al inicio' },
      ],
    }]
  );
}

// ── Mapa título → id (fallback cuando Chatwoot no envía el id del botón) ──────
const MENU_TITLE_TO_ID = {
  '📚 Académico':          'menu_academico',
  '💳 Pagos':              'menu_pagos',
  '💬 Con un asesor':      'hablar_asesor',
};

// ── Handler del menú principal (botones) ─────────────────────────────────────
async function handleMenuPrincipalReply(phone, input, session) {
  // Resolver por id directo o por título (cuando Chatwoot no envía el id)
  const buttonId = MENU_TITLE_TO_ID[input] ?? input;

  if (buttonId === 'menu_academico') return showMenuAcademico(phone);
  if (buttonId === 'menu_pagos')     return showMenuPagos(phone);
  if (buttonId === 'hablar_asesor')  return runTransfer(phone, session);
}

module.exports = { showMenu, showMenuPagos, handleMenuPrincipalReply };
