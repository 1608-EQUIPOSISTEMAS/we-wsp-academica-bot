const { sendText }      = require('../services/whatsapp');
const { updateSession } = require('../services/session');
const { tagFlow }       = require('../services/chatwoot');
const { runTransfer }   = require('./transfer');

async function showJustificaciones(phone) {
  updateSession(phone, { estado: 'flow_justificacion_datos', ultimoTema: 'justificaciones' });
  tagFlow(phone, ['bot-activo', 'justificaciones'], 'Justificaciones');
  await sendText(
    phone,
    `Para gestionar tu justificación necesito algunos datos 📋\n\n` +
    `¿Cuál es el nombre de tu curso o programa y la edición?`
  );
}

async function handleJustificacionDatos(phone, texto, session) {
  updateSession(phone, { pendingData: texto });
  await runTransfer(phone, { ...session, ultimoTema: 'justificaciones' }, texto);
}

module.exports = { showJustificaciones, handleJustificacionDatos };
