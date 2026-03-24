const { sendText, sendButtons } = require('../services/whatsapp');
const { updateSession }         = require('../services/session');
const { tagFlow }               = require('../services/chatwoot');
const { runTransfer }           = require('./transfer');

async function showAlumnoFlex(phone) {
  updateSession(phone, { estado: 'flow_alumno_flex', ultimoTema: 'alumno_flex' });
  tagFlow(phone, ['bot-activo', 'alumno-flex'], 'Alumno Flex');

  await sendText(
    phone,
    `📌 ¿Te interesa la modalidad Flex?\n` +
    `Recuerda que:\n\n` +
    `1️⃣ Todas las actividades deben hacerse de manera individual.\n` +
    `2️⃣ Necesitas una nota mínima de 12 y estar al día en tus pagos para obtener la certificación.\n` +
    `3️⃣ No hay costo adicional.\n` +
    `4️⃣ Debes presentar el avance y entrega final del proyecto en las fechas indicadas por el docente (Sesión 3 y última sesión).\n\n` +
    `🙋‍♀️ Para gestionar tu inscripción, llena este formulario:\n` +
    `👉 https://forms.gle/GuUVsvJwTcdSjaAr5`
  );

  await sendButtons(
    phone,
    `¿Qué deseas hacer ahora?`,
    [
      { id: 'flex_formulario_ok', title: '✅ Ya llené el form' },
      { id: 'flex_mas_dudas',     title: '❓ Tengo más dudas' },
    ]
  );
}

async function handleAlumnoFlexReply(phone, buttonId, session) {
  // Ambas opciones transfieren al asesor con etiqueta alumno-flex
  updateSession(phone, { ultimoTema: 'alumno_flex' });
  tagFlow(phone, ['alumno-flex']);
  await runTransfer(phone, session);
}

module.exports = { showAlumnoFlex, handleAlumnoFlexReply };
