const { getOrCreateSession, updateSession, addToHistory } = require('./services/session');
const { sendText, sendButtons }   = require('./services/whatsapp');
const { askAI }                   = require('./services/ai');
const { runTransfer }             = require('./flows/transfer');
const { showMenu, handleMenuPrincipalReply } = require('./flows/menu');
const {
  startIdentificacion,
  handleCorreo,
  handleCorreoNoEncontrado,
} = require('./flows/identificacion');
const { showCampus, handleCampusReply }                  = require('./flows/campus');
const { showCertificados, handleCertReply }              = require('./flows/certificados');
const { showJustificaciones, handleJustificacionDatos }  = require('./flows/justificaciones');
const { showMateriales, handleMaterialesReply }          = require('./flows/materiales');
const { showInstaladores, handleInstaladoresReply }      = require('./flows/instaladores');
const { handleReclamoDatos }                             = require('./flows/reclamo');

// ── Anti-duplicado ─────────────────────────────────────────────────────────────
const processedIds  = new Set();
const MSG_ID_TTL_MS = 5 * 60 * 1000;

function markProcessed(msgId) {
  processedIds.add(msgId);
  setTimeout(() => processedIds.delete(msgId), MSG_ID_TTL_MS);
}

// ── Mapa texto visible → id interno ──────────────────────────────────────────
// Chatwoot envía el título del botón/fila como texto plano en lugar del id.
// Títulos AMBIGUOS no están aquí — se resuelven por estado en route().
const TEXT_TO_ID = {
  // ── Menú principal ──────────────────────────────────────────────────────
  '📚 Académico':                          'menu_academico',
  '🛠️ Soporte':                            'menu_soporte',
  '💬 Con un asesor':                      'hablar_asesor',
  // ── Submenú Académico y Gestión ─────────────────────────────────────────
  '🎬 Video Clases':                       'video_clases',
  '📁 Materiales':                         'materiales',
  '📅 Cronograma':                         'cronograma',
  '📝 Exámenes Int.':                      'examenes_int',
  '🖥️ Campus Virtual':                     'campus_virtual',
  '🏅 Certificación':                      'certificacion',
  '📄 Justificaciones':                    'justificaciones',
  '⚡ Alumno Flex':                        'alumno_flex',
  // ── Submenú Soporte Técnico ─────────────────────────────────────────────
  '💻 Instaladores':                       'instaladores',
  '💬 Grupo WhatsApp':                     'grupo_whatsapp',
  '👨‍🏫 Func. Docente':                   'funciones_docente',
  '💬 Hablar con asesor':                  'hablar_asesor',
  // ── Común (ambos submenús) ──────────────────────────────────────────────
  '🔙 Menú principal':                     'menu_principal',
  '📋 Ver menú':                           'volver_menu',
  // ── Campus Virtual ──────────────────────────────────────────────────────
  '✅ Sí, gracias':                        'campus_ok',
  '❌ No pude ingresar':                   'campus_no',
  // ── Certificación — modalidad ───────────────────────────────────────────
  '🏫 Presencial / En vivo':               'cert_pres_en_vivo',
  '💻 Online':                             'cert_online',
  // ── Certificación — tipo programa (AMBIGUO: '📘 Curso' resuelto por estado)
  '📗 Especialización / Diplomado / PEE':  'cert_pres_prog',
  '📗 Especialización':                    'cert_online_espec',
  // ── Certificación — plazo ───────────────────────────────────────────────
  '✅ No, aún estoy en el plazo':          'cert_en_plazo',
  '⚠️ Sí, ya pasó el plazo':              'cert_fuera_plazo',
  // ── Certificación — confirmación ────────────────────────────────────────
  '✅ Entendido':                          'cert_ok',
  '❓ Tengo otra duda':                    'cert_otra_duda',
  // ── Materiales ──────────────────────────────────────────────────────────
  '✅ Ya tengo acceso':                    'mat_ok',
  '❌ No encuentro mis materiales':        'mat_no_acceso',
  // ── Instaladores — selector de programa ────────────────────────────────
  'SAP HANA':                              'inst_hana',
  'SAP R/3':                               'inst_r3',
  'Office 365':                            'inst_o365',
  'Otro problema':                         'inst_otro',
  // ── Instaladores — SAP HANA (AMBIGUO: '🔑 No puedo ingresar...' resuelto por estado)
  '⏳ Se queda cargando al ejecutar':      'inst_hana_cargando',
  '📥 No pude instalarlo':                 'inst_hana_instalacion',
  // ── Instaladores — SAP R/3 ──────────────────────────────────────────────
  '❓ Otro problema':                      'inst_r3_otro',
  // ── Instaladores — resultado ────────────────────────────────────────────
  '✅ Sí, ya pude':                        'inst_ok',
  '❌ No, sigue el problema':              'inst_no',
  // ── Instaladores — tipo de laptop ───────────────────────────────────────
  '💻 Personal':                           'inst_laptop_personal',
  '🏢 Corporativa':                        'inst_laptop_corp',
  // ── Identificación ──────────────────────────────────────────────────────
  'Intentar otro correo':                  'reintentar_correo',
  'Hablar con un asesor':                  'hablar_asesor',
};

// ── Normalización flexible de texto ──────────────────────────────────────────
// Permite coincidencias aunque Chatwoot envíe texto con variaciones de
// mayúsculas, tildes o espacios extra.

function normalizeText(str) {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // quitar diacríticos (tildes, etc.)
}

// Mapa normalizado construido una vez al iniciar
const TEXT_TO_ID_NORMALIZED = Object.fromEntries(
  Object.entries(TEXT_TO_ID).map(([k, v]) => [normalizeText(k), v])
);

function resolveTextToId(text) {
  if (!text) return null;
  return TEXT_TO_ID[text] ?? TEXT_TO_ID_NORMALIZED[normalizeText(text)] ?? null;
}

// Versiones normalizadas de los títulos ambiguos para comparación flexible
const NORM_CURSO      = normalizeText('📘 Curso');
const NORM_CONTRASENA = normalizeText('🔑 No puedo ingresar / contraseña');

// ── Palabras clave globales → menú principal ──────────────────────────────────
const KEYWORDS_MENU = new Set(['menu', 'inicio', 'volver', 'start']);

/**
 * Punto de entrada principal.
 */
async function handleIncoming(conversationId, phone, msg) {
  if (processedIds.has(msg.id)) {
    console.log(`[bot] Mensaje duplicado ignorado: ${msg.id}`);
    return;
  }
  markProcessed(msg.id);

  const session = updateSession(phone, { conversationId });

  let text     = null;
  let buttonId = null;
  let listId   = null;

  const attrType = msg.contentAttributes?.type;
  const attrId   = msg.contentAttributes?.id;

  if (attrType === 'button_reply') {
    buttonId = attrId;
    text     = msg.content;
  } else if (attrType === 'list_reply') {
    listId = attrId;
    text   = msg.content;
  } else if (attrId) {
    console.log(`[bot] content_attributes sin type, usando id como fallback: ${attrId}`);
    buttonId = attrId;
    text     = msg.content;
  } else {
    text = msg.content?.trim();
    const CHATWOOT_INTERNAL_KEYS = new Set(['in_reply_to_external_id', 'in_reply_to']);
    const unknownAttrs = msg.contentAttributes
      ? Object.keys(msg.contentAttributes).filter(k => !CHATWOOT_INTERNAL_KEYS.has(k))
      : [];
    if (unknownAttrs.length > 0) {
      console.log(`[bot] content_attributes desconocido:`, JSON.stringify(msg.contentAttributes));
    }
  }

  // ── NIVEL 1: resolver texto → id (exacto o normalizado) ──────────────────
  if (!buttonId && !listId && text) {
    const resolvedId = resolveTextToId(text);
    if (resolvedId) {
      console.log(`[bot] Texto resuelto a id: "${text}" → "${resolvedId}"`);
      buttonId = resolvedId;
    }
  }

  if (!text && !buttonId && !listId) return;

  if (text) addToHistory(phone, 'user', text);

  console.log(`[bot] ${phone} | conv=${conversationId} | estado=${session.estado} | id=${buttonId || listId || '-'} | text=${text}`);

  try {
    await route(phone, session, { text, buttonId, listId });
  } catch (err) {
    console.error('[bot] Error en route:', err);
    await sendText(phone, '⚠️ Ocurrió un error inesperado. Por favor, intenta de nuevo en unos momentos.');
  }
}

async function route(phone, session, { text, buttonId, listId }) {
  const id = buttonId || listId;

  // Palabras clave globales — siempre vuelven al menú principal
  if (text && KEYWORDS_MENU.has(text.toLowerCase().trim()) && session.nombre) {
    return showMenu(phone, session.nombre);
  }

  switch (session.estado) {

    case 'inicio':
      return startIdentificacion(phone);

    case 'transferido': {
      const replies = session.transfer_replies ?? 0;
      if (replies < 2) {
        updateSession(phone, { transfer_replies: replies + 1 });
        await sendText(phone, 'Ya hemos notificado a un asesor 💙 Por favor espera, te atenderán en breve.');
      }
      return;
    }

    case 'esperando_correo':
      if (text) return handleCorreo(phone, text, session);
      return;

    case 'correo_no_encontrado':
      if (id) return handleCorreoNoEncontrado(phone, id, session);
      return;

    // ── Menú de dos niveles ────────────────────────────────────────────────
    case 'flow_menu_principal':
      if (id)   return handleMenuPrincipalReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    // ── Campus Virtual ─────────────────────────────────────────────────────
    case 'flow_campus':
      if (id)   return handleCampusReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    // ── Certificación ──────────────────────────────────────────────────────
    case 'flow_cert_modalidad':
    case 'flow_cert_plazo':
    case 'flow_cert_info':
      if (id)   return handleCertReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    case 'flow_cert_tipo': {
      // '📘 Curso' es ambiguo: presencial vs online — se resuelve con certTrack
      const certId = id || (normalizeText(text) === NORM_CURSO
        ? (session.certTrack === 'online' ? 'cert_online_curso' : 'cert_pres_curso')
        : null);
      if (certId) return handleCertReply(phone, certId, session);
      if (text)   return handleFreeText(phone, text, session);
      return;
    }

    // ── Reclamo / Justificaciones / Grupo — esperan texto libre ───────────
    case 'flow_reclamo_datos':
      if (text) return handleReclamoDatos(phone, text, session);
      return;

    case 'flow_justificacion_datos':
      if (text) return handleJustificacionDatos(phone, text, session);
      return;

    case 'flow_grupo_datos':
      if (text) return runTransfer(phone, { ...session, ultimoTema: 'grupo_whatsapp' }, text);
      return;

    // ── Materiales ─────────────────────────────────────────────────────────
    case 'flow_materiales':
      if (id)   return handleMaterialesReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    // ── Instaladores ──────────────────────────────────────────────────────
    case 'flow_inst_tipo':
    case 'flow_inst_hana_clave_ok':
    case 'flow_inst_hana_cargando_ok':
    case 'flow_inst_r3_clave_ok':
    case 'flow_inst_laptop':
      if (id)   return handleInstaladoresReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    case 'flow_inst_hana_problema':
      if (id) return handleInstaladoresReply(phone, id, session);
      if (normalizeText(text) === NORM_CONTRASENA)
        return handleInstaladoresReply(phone, 'inst_hana_clave', session);
      if (text) return handleFreeText(phone, text, session);
      return;

    case 'flow_inst_r3_problema':
      if (id) return handleInstaladoresReply(phone, id, session);
      if (normalizeText(text) === NORM_CONTRASENA)
        return handleInstaladoresReply(phone, 'inst_r3_clave', session);
      if (text) return handleFreeText(phone, text, session);
      return;

    // ── Menú principal / default ───────────────────────────────────────────
    case 'menu':
    default:
      if (id)   return handleMenuOption(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      if (session.nombre) return showMenu(phone, session.nombre);
      return startIdentificacion(phone);
  }
}

async function handleMenuOption(phone, optionId, session) {
  updateSession(phone, { ultimoTema: optionId });

  switch (optionId) {
    case 'campus_virtual':    return showCampus(phone);
    case 'certificacion':     return showCertificados(phone);
    case 'justificaciones':   return showJustificaciones(phone);
    case 'materiales':
    case 'video_clases':      return showMateriales(phone, optionId);
    case 'instaladores':      return showInstaladores(phone);

    case 'grupo_whatsapp':
      updateSession(phone, { estado: 'flow_grupo_datos' });
      await sendText(phone,
        `Para enviarte el enlace a tu grupo de WhatsApp, ¿puedes indicarnos el nombre de tu programa y edición? 💬`
      );
      return;

    case 'hablar_asesor':
    case 'alumno_flex':
    case 'funciones_docente':
    case 'examenes_int':
    case 'cronograma':
      return runTransfer(phone, session);

    case 'menu_principal':
    case 'volver_menu':
    case 'cert_ok':
    case 'cert_otra_duda':
    case 'campus_ok':
    case 'mat_ok':
      return showMenu(phone, session.nombre);

    case 'cert_asesor':
      return runTransfer(phone, session);

    default:
      return showMenu(phone, session.nombre);
  }
}

// ── Nivel 2: IA para texto libre ─────────────────────────────────────────────

async function handleFreeText(phone, text, session) {
  // Texto muy corto → mostrar menú de categorías directamente
  if (!text || text.length < 10) return showFallbackMenu(phone);

  try {
    const response = await askAI(text, session.historial);

    if (response === 'TRANSFER') {
      const attempts = (session.ai_fallback_count ?? 0) + 1;
      updateSession(phone, { ai_fallback_count: attempts, estado: 'menu' });

      if (attempts >= 2) {
        // Segundo intento fallido → ofrecer asesor (NO transferir automáticamente)
        updateSession(phone, { ai_fallback_count: 0 });
        await sendButtons(
          phone,
          `Parece que no encuentro la respuesta que necesitas 😔\n¿Querés hablar con un asesor del equipo académico?`,
          [
            { id: 'hablar_asesor', title: '💬 Hablar con asesor' },
            { id: 'volver_menu',   title: '📋 Ver menú' },
          ]
        );
        return;
      }

      return showFallbackMenu(phone);
    }

    // IA respondió con éxito
    updateSession(phone, { ai_fallback_count: 0, estado: 'menu' });
    addToHistory(phone, 'bot', response);
    await sendText(phone, response);
    await sendButtons(
      phone,
      '¿Hay algo más en lo que pueda ayudarte?',
      [
        { id: 'volver_menu',   title: '📋 Ver menú' },
        { id: 'hablar_asesor', title: '💬 Hablar con asesor' },
      ]
    );
  } catch (err) {
    console.error('[bot] Error en IA:', err);
    return showFallbackMenu(phone); // Error → fallback al menú, NO transfer automático
  }
}

// ── Nivel 3: fallback al menú de categorías ───────────────────────────────────

async function showFallbackMenu(phone) {
  updateSession(phone, { estado: 'flow_menu_principal' });
  await sendButtons(
    phone,
    `No entendí bien tu mensaje 😊\n¿En qué podemos ayudarte?`,
    [
      { id: 'menu_academico', title: '📚 Académico' },
      { id: 'menu_soporte',   title: '🛠️ Soporte' },
      { id: 'hablar_asesor',  title: '💬 Con un asesor' },
    ]
  );
}

module.exports = { handleIncoming };
