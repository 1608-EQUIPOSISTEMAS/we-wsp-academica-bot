const { sendText }      = require('../services/whatsapp');
const { updateSession } = require('../services/session');
const { tagFlow }       = require('../services/chatwoot');
const { runTransfer }   = require('./transfer');

// Mapeo label interno → etiqueta de tema Chatwoot
const RECLAMO_TOPIC_LABEL = {
  reclamo_certificado: 'certificados',
  reclamo_activacion:  'campus-virtual',
  reclamo_materiales:  'materiales',
};

/**
 * Inicia la captación de datos antes de un transfer por reclamo.
 *
 * @param {string}      phone          - Número del alumno
 * @param {string}      label          - Etiqueta Chatwoot (ej: 'reclamo_certificado')
 * @param {string|null} preMessage     - Mensaje empático opcional antes de pedir datos
 */
async function askReclamoDatos(phone, label, preMessage = null) {
  if (preMessage) {
    await sendText(phone, preMessage);
  }

  updateSession(phone, {
    estado:     'flow_reclamo_datos',
    ultimoTema: label,
  });

  const topicLabel = RECLAMO_TOPIC_LABEL[label] || label;
  tagFlow(phone, ['bot-activo', topicLabel, 'reclamo'], label);

  await sendText(
    phone,
    `Para ayudarte más rápido, ¿podrías indicarnos tu *nombre completo* y el *nombre de tu curso*?`
  );
}

/**
 * Recibe los datos del alumno y ejecuta el transfer.
 * El texto ingresado queda como nota interna en Chatwoot.
 */
async function handleReclamoDatos(phone, texto, session) {
  await runTransfer(phone, session, texto);
}

module.exports = { askReclamoDatos, handleReclamoDatos };
