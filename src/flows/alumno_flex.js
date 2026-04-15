const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow }                      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showMenu }                     = require('./menu');

// ── Entrada principal ─────────────────────────────────────────────────────────

async function showAlumnoFlex(phone, session) {
  updateSession(phone, { estado: 'flow_flex_opciones', ultimoTema: 'alumno_flex' });
  tagFlow(phone, ['bot-activo', 'alumno-flex'], 'Alumno Flex');

  await sendText(
    phone,
    `¡Qué bueno que te interese la modalidad Flex! ⚡ Es una excelente opción para manejar tus propios tiempos. ` +
    `Además, ¡el cambio a esta modalidad no tiene ningún costo adicional! 🥳`
  );

  await delay(1200);

  await sendText(
    phone,
    `Para poder sumarte, solo te pedimos tener en cuenta estos 3 puntos clave:\n\n` +
    `👤 Todas las actividades y proyectos se realizan de manera individual.\n` +
    `📅 Debes presentar tus avances puntualmente en la Sesión 3 y en la entrega final.\n` +
    `🎓 Necesitarás una nota mínima de 12 y estar al día en tus pagos para poder certificarte.`
  );

  await delay(1200);

  await sendButtons(
    phone,
    `Si todo está claro y quieres empezar, llena tu solicitud de inscripción en este enlace: 👇\n` +
    `🔗 https://forms.gle/GuUVsvJwTcdSjaAr5\n\n` +
    `Tómate tu tiempo. Cuando termines, avísame por aquí.`,
    [
      { id: 'flex_form_lleno', title: '✅ Ya me inscribí' },
      { id: 'flex_mas_dudas',  title: '❓ Tengo más dudas' },
      { id: 'menu_principal',  title: '🔙 Menú principal' },
    ]
  );
}

// ── Handler de botones ────────────────────────────────────────────────────────

async function handleAlumnoFlexReply(phone, buttonId, session) {
  if (buttonId === 'flex_form_lleno') {
    updateSession(phone, { ultimoTema: 'alumno_flex' });
    await runTransfer(phone, session);
    return;
  }

  if (buttonId === 'flex_mas_dudas') {
    updateSession(phone, { ultimoTema: 'alumno_flex' });
    await runTransfer(phone, session);
    return;
  }

  if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

module.exports = { showAlumnoFlex, handleAlumnoFlexReply };
