const { sendText, sendButtons, delay } = require('../services/whatsapp');
const { updateSession }                = require('../services/session');
const { tagFlow }                      = require('../services/chatwoot');
const { runTransfer }                  = require('./transfer');
const { showMenu }                     = require('./menu');

// ── Texto de info Flex ────────────────────────────────────────────────────────
const FLEX_INFO_TEXT =
  `📌 ¿Te interesa la modalidad Flex?\n` +
  `Recuerda que:\n\n` +
  `1️⃣ Todas las actividades deben hacerse de manera individual.\n` +
  `2️⃣ Necesitas una nota mínima de 12 y estar al día en tus pagos para obtener la certificación.\n` +
  `3️⃣ No hay costo adicional.\n` +
  `4️⃣ Debes presentar el avance y entrega final del proyecto en las fechas indicadas por el docente ` +
  `(Sesión 3 y última sesión).\n\n` +
  `🙋‍♀️ Para gestionar tu inscripción, llena este formulario:\n` +
  `👉 https://forms.gle/GuUVsvJwTcdSjaAr5`;

// ── Entrada principal ─────────────────────────────────────────────────────────

async function showAlumnoFlex(phone, session) {
  updateSession(phone, { estado: 'flow_flex_opciones', ultimoTema: 'alumno_flex' });
  tagFlow(phone, ['bot-activo', 'alumno-flex'], 'Alumno Flex');

  await sendText(phone, FLEX_INFO_TEXT);
  await delay(500);
  await sendButtons(
    phone,
    `¿Qué deseas hacer ahora?`,
    [
      { id: 'flex_form_lleno', title: '✅ Ya llené el form' },
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
