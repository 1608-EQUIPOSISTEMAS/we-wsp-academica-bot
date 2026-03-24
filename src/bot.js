const { getSession, getOrCreateSession, updateSession, addToHistory } = require('./services/session');
const { assignAgent, openConversation } = require('./services/chatwoot');
const { showBotResuelto, handleBotResuelto } = require('./flows/resuelto');
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
const { showJustificaciones, handleJustificacionReply }  = require('./flows/justificaciones');
const { showExamenes, handleExamenesReply }              = require('./flows/examenes');
const { showMateriales, handleMaterialesReply }          = require('./flows/materiales');
const { showInstaladores, handleInstaladoresReply }      = require('./flows/instaladores');
const { handleReclamoDatos }                             = require('./flows/reclamo');
const { showAlumnoFlex, handleAlumnoFlexReply }          = require('./flows/alumno_flex');
const { showInscripcion }                               = require('./flows/inscripcion');

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
  '🏫 Pres. / En vivo':                    'cert_pres_en_vivo',
  '💻 Online':                             'cert_online',
  // ── Certificación — tipo programa (AMBIGUO: '📘 Curso' resuelto por estado)
  '📗 Espec./Dipl./PEE':                   'cert_pres_prog',
  '📗 Especialización':                    'cert_online_espec',
  // ── Certificación — plazo ───────────────────────────────────────────────
  '✅ Aún en el plazo':                    'cert_en_plazo',
  '⚠️ Ya pasó el plazo':                  'cert_fuera_plazo',
  // ── Certificación — confirmación ────────────────────────────────────────
  '✅ Entendido':                          'cert_ok',
  '❓ Tengo otra duda':                    'cert_otra_duda',
  // ── Materiales ──────────────────────────────────────────────────────────
  '✅ Ya tengo acceso':                    'mat_ok',
  '❌ No veo materiales':                  'mat_no_acceso',
  // ── Instaladores — selector de programa ────────────────────────────────
  'SAP HANA':                              'inst_hana',
  'SAP R/3':                               'inst_r3',
  'Office 365':                            'inst_o365',
  'Otro problema':                         'inst_otro',
  // ── Instaladores — SAP HANA (AMBIGUO: '🔑 Clave / Acceso' resuelto por estado)
  '⏳ Se queda cargando':                  'inst_hana_cargando',
  '📥 No pude instalar':                   'inst_hana_instalacion',
  // ── Instaladores — SAP R/3 ──────────────────────────────────────────────
  '❓ Otro problema':                      'inst_r3_otro',
  // ── Instaladores — resultado ────────────────────────────────────────────
  '✅ Sí, ya pude':                        'inst_ok',
  '❌ Sigue el problema':                  'inst_no',
  // ── Instaladores — tipo de laptop ───────────────────────────────────────
  '💻 Personal':                           'inst_laptop_personal',
  '🏢 Corporativa':                        'inst_laptop_corp',
  // ── Inscripción ─────────────────────────────────────────────────────────
  '📝 Inscribirme':                        'inscripcion',
  // ── Justificaciones ──────────────────────────────────────────────────────
  '✅ Listo, ya llené':                    'just_listo',
  '❌ El link no abre':                    'just_link_falla',
  '❓ Tengo otra duda':                    'just_otra_duda',
  // ── Exámenes Internacionales ─────────────────────────────────────────────
  '✅ Llené el form':                      'exam_formulario_ok',
  '❓ Una pregunta':                       'exam_pregunta',
  // ── Alumno Flex ──────────────────────────────────────────────────────────
  '✅ Ya llené el form':                   'flex_formulario_ok',
  '❓ Tengo más dudas':                    'flex_mas_dudas',
  // ── Cierre bot (resuelto_bot) ────────────────────────────────────────────
  '✅ No, es todo':                        'bot_resuelto_no',
  '📋 Ver menú':                           'bot_resuelto_menu',
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
const NORM_CONTRASENA = normalizeText('🔑 Clave / Acceso');

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

  const isNewSession = !getSession(phone);
  const session = updateSession(phone, { conversationId, ultimaActividad: Date.now() });

  // Al inicio de cada conversación nueva: pasar de pending → open + asignar agente
  // Delay de 2s para que Chatwoot termine de procesar la conversación nueva
  if (isNewSession && conversationId) {
    setTimeout(async () => {
      await openConversation(conversationId).catch(err =>
        console.error('[bot] Error abriendo conversación:', err)
      );
      if (process.env.CHATWOOT_DEFAULT_AGENT_ID) {
        await assignAgent(conversationId, process.env.CHATWOOT_DEFAULT_AGENT_ID).catch(err =>
          console.error('[bot] Error asignando agente inicial:', err)
        );
      }
    }, 2000);
  }

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

  // Palabras clave globales → menú principal (excepto si está con agente humano)
  if (text && KEYWORDS_MENU.has(normalizeText(text)) && session.nombre
      && session.estado !== 'en_atencion_humana') {
    return showMenu(phone, session.nombre);
  }

  switch (session.estado) {

    case 'inicio':
      return startIdentificacion(phone);

    // ── En atención humana — bot silenciado salvo palabras reservadas ─────────
    case 'en_atencion_humana':
    case 'transferido': {  // 'transferido' como alias de compatibilidad
      const normalized = normalizeText(text || '');
      if (normalized === 'menu' || normalized === 'bot') {
        await sendText(phone,
          `En este momento un asesor te está atendiendo 💙\nPor favor espera su respuesta.`
        );
      }
      // Silencio total para cualquier otro mensaje
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

    // ── ¿Algo más? — confirmación de cierre bot ────────────────────────────
    case 'resuelto_bot':
      if (id)   return handleBotResuelto(phone, id, session);
      if (text) return handleBotResuelto(phone, 'bot_resuelto_menu', session);
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

    // ── Justificaciones ────────────────────────────────────────────────────
    case 'flow_justificacion_info':
      if (id)   return handleJustificacionReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    // ── Exámenes Internacionales ───────────────────────────────────────────
    case 'flow_examenes':
      if (id)   return handleExamenesReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
      return;

    // ── Reclamo / Grupo — esperan texto libre ──────────────────────────────
    case 'flow_reclamo_datos':
      if (text) return handleReclamoDatos(phone, text, session);
      return;

    case 'flow_grupo_datos':
      if (text) return runTransfer(phone, { ...session, ultimoTema: 'grupo_whatsapp' }, text);
      return;

    // ── Alumno Flex ────────────────────────────────────────────────────────
    case 'flow_alumno_flex':
      if (id)   return handleAlumnoFlexReply(phone, id, session);
      if (text) return handleFreeText(phone, text, session);
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
    case 'campus_virtual':    return showCampus(phone, session);
    case 'certificacion':     return showCertificados(phone);
    case 'justificaciones':   return showJustificaciones(phone, session);
    case 'materiales':
    case 'video_clases':      return showMateriales(phone, optionId);
    case 'instaladores':      return showInstaladores(phone);
    case 'alumno_flex':       return showAlumnoFlex(phone);
    case 'inscripcion':       return showInscripcion(phone, session);
    case 'examenes_int':      return showExamenes(phone);

    case 'grupo_whatsapp':
      updateSession(phone, { estado: 'flow_grupo_datos' });
      await sendText(phone,
        `Para enviarte el enlace a tu grupo de WhatsApp, ¿puedes indicarnos el nombre de tu programa y edición? 💬`
      );
      return;

    case 'hablar_asesor':
    case 'funciones_docente':
    case 'cronograma':
      return runTransfer(phone, session);

    case 'menu_principal':
    case 'volver_menu':
    case 'cert_otra_duda':
    case 'bot_resuelto_menu':
      return showMenu(phone, session.nombre);

    case 'bot_resuelto_no':
      return handleBotResuelto(phone, 'bot_resuelto_no', session);

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
