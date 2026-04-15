const { sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { runTransfer }           = require('./transfer');

// ── Paso 1 — Botones de categoría ────────────────────────────────────────────
async function showMenu(phone, nombre) {
  updateSession(phone, { estado: 'flow_menu_principal' });
  await sendButtons(
    phone,
    `¿En qué más puedo ayudarte? 😊`,
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
    '📚 Área Académica',
    'Aquí tienes las opciones para gestionar tu cursada. Selecciona la que mejor describa tu consulta. 👇',
    'Siempre puedes elegir \'Menú principal\' para volver atrás.',
    'Ver opciones',
    [{
      title: 'Académico y Gestión',
      rows: [
        { id: 'campus_materiales', title: '💻 Campus y Materiales', description: 'Encuentra el enlace directo para acceder a tus clases y recursos.' },
        { id: 'cronograma',        title: '📅 Cronograma',           description: 'Revisa los módulos activos y las fechas de inicio de tus programas.' },
        { id: 'examenes_int',      title: '📝 Exámenes Internac.',   description: 'Inicia el trámite para rendir tu examen de certificación global.' },
        { id: 'certificacion',     title: '🎓 Certificación',        description: 'Descarga tus diplomas emitidos o reporta inconvenientes con tus documentos.' },
        { id: 'justificaciones',   title: '⚠️ Justificaciones',      description: 'Reporta inasistencias o solicita prórrogas por motivos de fuerza mayor.' },
        { id: 'alumno_flex',       title: '⚡ Alumno Flex',          description: 'Consulta las condiciones y beneficios de la modalidad de estudio flexible.' },
        { id: 'inscribirme',       title: '➕ Inscribirme',          description: 'Conoce nuestra oferta académica y anótate a un nuevo programa.' },
        { id: 'instaladores',      title: '⚙️ Instaladores',         description: 'Links y guías paso a paso para instalar SAP, Office u otro software.' },
        { id: 'menu_principal',    title: '🔙 Menú principal',       description: 'Vuelve al inicio para consultas de Pagos o hablar con un asesor.' },
      ],
    }]
  );
}

// ── Paso 2B — Lista Pagos y Facturación ──────────────────────────────────────
async function showMenuPagos(phone) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    '💳 Área de Pagos',
    'Aquí puedes gestionar todo lo relacionado con tus cuotas y facturación. ¿En qué te puedo ayudar hoy? 👇',
    'W|E Educación Ejecutiva',
    'Ver opciones',
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

module.exports = { showMenu, showMenuAcademico, showMenuPagos, handleMenuPrincipalReply };
