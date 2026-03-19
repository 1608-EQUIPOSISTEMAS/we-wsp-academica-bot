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
      { id: 'menu_soporte',   title: '🛠️ Soporte' },
      { id: 'hablar_asesor',  title: '💬 Con un asesor' },
    ]
  );
}

// ── Paso 2A — Lista Académico y Gestión (8 items) ────────────────────────────
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
        { id: 'video_clases',    title: '🎬 Video Clases',     description: 'Accede a tus clases grabadas' },
        { id: 'materiales',      title: '📁 Materiales',        description: 'Descarga tus recursos' },
        { id: 'cronograma',      title: '📅 Cronograma',        description: 'Fechas de tu programa' },
        { id: 'examenes_int',    title: '📝 Exámenes Int.',     description: 'Certificaciones internacionales' },
        { id: 'campus_virtual',  title: '🖥️ Campus Virtual',   description: 'Acceso a tu plataforma' },
        { id: 'certificacion',   title: '🏅 Certificación',     description: 'Estado y tiempos' },
        { id: 'justificaciones', title: '📄 Justificaciones',   description: 'Gestiona tu inasistencia' },
        { id: 'alumno_flex',     title: '⚡ Alumno Flex',       description: 'Modalidad flexible' },
        { id: 'menu_principal',  title: '🔙 Menú principal',    description: 'Volver al inicio' },
      ],
    }]
  );
}

// ── Paso 2B — Lista Soporte Técnico (4 items) ────────────────────────────────
async function showMenuSoporte(phone) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    'Soporte Técnico',
    '¿Qué necesitas?',
    'Selecciona una opción',
    '📋 Ver opciones',
    [{
      title: 'Soporte Técnico',
      rows: [
        { id: 'instaladores',      title: '💻 Instaladores',      description: 'SAP, Office y más' },
        { id: 'grupo_whatsapp',    title: '💬 Grupo WhatsApp',    description: 'Únete a tu grupo' },
        { id: 'funciones_docente', title: '👨‍🏫 Func. Docente',   description: 'Herramientas del docente' },
        { id: 'hablar_asesor',     title: '💬 Hablar con asesor', description: 'Atención personalizada' },
        { id: 'menu_principal',    title: '🔙 Menú principal',    description: 'Volver al inicio' },
      ],
    }]
  );
}

// ── Mapa título → id (fallback cuando Chatwoot no envía el id del botón) ──────
const MENU_TITLE_TO_ID = {
  '📚 Académico':    'menu_academico',
  '🛠️ Soporte':     'menu_soporte',
  '💬 Con un asesor': 'hablar_asesor',
};

// ── Handler del menú principal (botones) ─────────────────────────────────────
async function handleMenuPrincipalReply(phone, input, session) {
  // Resolver por id directo o por título (cuando Chatwoot no envía el id)
  const buttonId = MENU_TITLE_TO_ID[input] ?? input;

  if (buttonId === 'menu_academico') return showMenuAcademico(phone);
  if (buttonId === 'menu_soporte')   return showMenuSoporte(phone);
  if (buttonId === 'hablar_asesor')  return runTransfer(phone, session);
}

module.exports = { showMenu, handleMenuPrincipalReply };
