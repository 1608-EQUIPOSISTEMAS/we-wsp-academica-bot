const { sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { runTransfer }           = require('./transfer');

// ── Menú principal unificado (lista con 3 secciones) ─────────────────────────
async function showMenu(phone, nombre) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    'W|E Educación Ejecutiva',
    '¿En qué más puedo ayudarte? 😊',
    'Selecciona una opción para continuar.',
    'Ver opciones',
    [
      {
        title: '📚 Académico',
        rows: [
          { id: 'campus_materiales',  title: '💻 Campus y Materiales', description: 'Encuentra el enlace directo para acceder a tus clases y recursos.' },
          { id: 'certificacion',      title: '🎓 Certificación',        description: 'Descarga tus diplomas emitidos o reporta inconvenientes con tus documentos.' },
          { id: 'cronograma',         title: '📅 Cronograma de clases', description: 'Revisa los módulos activos y las fechas de inicio de tus programas.' },
          { id: 'justificaciones',    title: '⚠️ Justificaciones',      description: 'Reporta inasistencias o solicita prórrogas por motivos de fuerza mayor.' },
          { id: 'inscribirme',        title: '➕ Inscribirme',          description: 'Conoce nuestra oferta académica y anótate a un nuevo programa.' },
          { id: 'examenes_int',       title: '📝 Exámenes Internac.',   description: 'Inicia el trámite para rendir tu examen de certificación global.' },
          { id: 'hablar_asesor',      title: '💬 Contacto asesor',      description: 'Atención personalizada con uno de nuestros especialistas.' },
        ],
      },
      {
        title: '💳 Finanzas',
        rows: [
          { id: 'estado_cuenta',      title: '📊 Estado de Cuenta',    description: 'Consulta tus cuotas y saldo pendiente.' },
          { id: 'enviar_comprobante', title: '🧾 Enviar Comprobante',  description: 'Registra y confirma tu pago.' },
        ],
      },
      {
        title: '🛠️ Soporte Técnico',
        rows: [
          { id: 'instaladores',  title: '⚙️ Instaladores',  description: 'Descarga instaladores y guías: SAP HANA, SAP R/3, Office 365.' },
        ],
      },
    ]
  );
}

// ── Fallback (cuando el bot no entiende un mensaje libre) ─────────────────────
// Muestra 3 botones rápidos; si el alumno elige uno, se muestra el menú unificado.
async function showFallbackMenu(phone) {
  updateSession(phone, { estado: 'flow_menu_principal' });
  await sendButtons(
    phone,
    `No entendí bien tu mensaje 😊\n¿En qué podemos ayudarte?`,
    [
      { id: 'menu_academico', title: '📚 Académico' },
      { id: 'menu_pagos',     title: '💳 Pagos / Soporte' },
      { id: 'hablar_asesor',  title: '💬 Con un asesor' },
    ]
  );
}

// ── Handler del fallback (botones) ───────────────────────────────────────────
async function handleMenuPrincipalReply(phone, input, session) {
  if (input === 'hablar_asesor') return runTransfer(phone, session);
  // Cualquier otra selección (menu_academico, menu_pagos) → menú unificado
  return showMenu(phone, session.nombre);
}

module.exports = { showMenu, showFallbackMenu, handleMenuPrincipalReply };
