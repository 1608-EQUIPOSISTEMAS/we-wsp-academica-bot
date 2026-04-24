const { sendButtons, sendList } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { runTransfer }           = require('./transfer');

function _firstNameTitle(fullName) {
  if (!fullName) return '';
  const first = String(fullName).trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// ── Secciones del menú (reutilizable) ────────────────────────────────────────
// Si se pasa `nombre`, añade "No soy X" como última fila (máx 10 rows en total).
function getMenuSections(nombre) {
  const sections = [
    {
      title: '📚 Académica',
      rows: [
        { id: 'campus_materiales',  title: '💻 Campus y Materiales', description: 'Encuentra el enlace directo para acceder a tus clases y recursos.' },
        { id: 'certificacion',      title: '🎓 Certificación',        description: 'Descarga diplomas emitidos o reporta inconvenientes con tus documentos.' },
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
      ],
    },
    {
      title: '🛠️ Soporte Técnico',
      rows: [
        { id: 'instaladores',  title: '⚙️ Instaladores',  description: 'Descarga instaladores y guías: SAP HANA, SAP R/3, Office 365.' },
      ],
    },
  ];

  if (nombre) {
    const firstName = _firstNameTitle(nombre);
    const noSoyTitle = `🔄 No soy ${firstName}`.length <= 24
      ? `🔄 No soy ${firstName}`
      : '🔄 No soy yo';
    sections[sections.length - 1].rows.push({
      id:          'quick_no_soy_yo',
      title:       noSoyTitle,
      description: 'Identificarme con otro correo.',
    });
  }

  return sections;
}

// ── Menú principal unificado (lista con 3 secciones) ─────────────────────────
async function showMenu(phone, nombre) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    'W|E Educación Ejecutiva',
    '¿En qué más puedo ayudarte? 😊',
    'Selecciona una opción para continuar.',
    'Ver opciones',
    getMenuSections(nombre)
  );
}

// ── Fallback (cuando el bot no entiende un mensaje libre) ─────────────────────
async function showFallbackMenu(phone, nombre) {
  updateSession(phone, { estado: 'menu' });
  await sendList(
    phone,
    'W|E Educación Ejecutiva',
    'No entendí bien tu mensaje 😊\n¿En qué podemos ayudarte?',
    'Selecciona una opción para continuar.',
    'Ver opciones',
    getMenuSections(nombre)
  );
}

module.exports = { showMenu, showFallbackMenu, getMenuSections };
