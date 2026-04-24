const { getSession, getOrCreateSession, updateSession, addToHistory, deleteSession } = require('./services/session');
const { createCsat } = require('./services/database');
const { assignAgent, updateLabels, resolveConversation,
        addPrivateNote, openConversation, deactivateBot, assignTeam } = require('./services/chatwoot');
const { showBotResuelto, handleBotResuelto } = require('./flows/resuelto');
const { sendText, sendTextDirect, sendButtons, sendList } = require('./services/whatsapp');
const { buildProgramRows, PAGE_SIZE }     = require('./utils/programList');
const { detectIntent }            = require('./services/ai');
const { runTransfer }             = require('./flows/transfer');
const { showMenu, showFallbackMenu } = require('./flows/menu');
const {
  startIdentificacion,
  handleCorreo,
  handleCorreoNoEncontrado,
  tryQuickGreeting,
  handleQuickNoSoyYo,
} = require('./flows/identificacion');
const { showCampus, handleCampusReply, handleCampusProgramaReply } = require('./flows/campus');
const { showCertificados, handleCertReply, handleCertSearch } = require('./flows/certificados');
const { showJustificaciones, handleJustificacionProgramaReply, handleJustificacionFlowResponse } = require('./flows/justificaciones');
const { showExamenes, handleExamenesReply }              = require('./flows/examenes');
const { showMateriales, handleMaterialesReply }          = require('./flows/materiales');
const { showInstaladores, handleInstaladoresReply }      = require('./flows/instaladores');
const { askReclamoDatos, handleReclamoDatos }             = require('./flows/reclamo');
const { showAlumnoFlex, handleAlumnoFlexReply }          = require('./flows/alumno_flex');
const { showInscripcion, handleInscripcionReply }        = require('./flows/inscripcion');
const { handleCronograma, handleCronogramaReply }        = require('./flows/cronograma');

// ── Anti-duplicado ─────────────────────────────────────────────────────────────
const processedIds  = new Set();
const MSG_ID_TTL_MS = 5 * 60 * 1000;

function markProcessed(msgId) {
  processedIds.add(msgId);
  setTimeout(() => processedIds.delete(msgId), MSG_ID_TTL_MS);
}

// Dedup adicional para taps interactivos:
// Chatwoot a veces dispara dos message_created con diferente ID para el mismo tap
// (list_reply / button_reply). Usamos phone+type+id con ventana de 15 s.
const _processedTaps = new Map();
const TAP_DEDUP_TTL_MS = 15_000;

function _isTapDuplicate(phone, iType, iId) {
  if (!iType || !iId) return false;
  const key = `${phone}:${iType}:${iId}`;
  if (_processedTaps.has(key)) return true;
  _processedTaps.set(key, true);
  setTimeout(() => _processedTaps.delete(key), TAP_DEDUP_TTL_MS);
  return false;
}

// ── Mapa texto visible → id interno ──────────────────────────────────────────
// Chatwoot envía el título del botón/fila como texto plano en lugar del id.
// Títulos AMBIGUOS no están aquí — se resuelven por estado en route().
const TEXT_TO_ID = {
  // ── Menú principal ──────────────────────────────────────────────────────
  '📚 Académico':                          'menu_academico',
  '💳 Pagos':                              'menu_pagos',
  '💬 Con un asesor':                      'hablar_asesor',
  // ── Submenú Académico y Gestión ─────────────────────────────────────────
  '🖥️ Campus y Materiales':               'campus_materiales',
  '💻 Campus y Materiales':               'campus_materiales',
  '📅 Cronograma de clases':               'cronograma',
  '📅 Cronograma':                         'cronograma',   // fallback título viejo
  '📝 Exámenes Internac.':                 'examenes_int',
  '📝 Exámenes Int.':                      'examenes_int',   // fallback título viejo
  '🎓 Certificación':                      'certificacion',
  '🏅 Certificación':                      'certificacion',  // fallback título viejo
  '⚠️ Justificaciones':                   'justificaciones',
  '📄 Justificaciones':                    'justificaciones', // fallback título viejo
  '⚡ Alumno Flex':                        'alumno_flex',
  '⚙️ Instaladores':                      'instaladores',
  '💻 Instaladores':                       'instaladores',   // fallback título viejo
  // ── Submenú Pagos y Facturación ─────────────────────────────────────────
  '📊 Estado de Cuenta':                   'estado_cuenta',
  '🧾 Enviar Comprobante':                 'enviar_comprobante',
  '💬 Hablar con asesor':                  'hablar_asesor',
  '💬 Contacto asesor':                    'hablar_asesor',
  '💬 Con un especialista':                'hablar_asesor',
  // ── Común (ambos submenús) ──────────────────────────────────────────────
  '🔙 Menú principal':                     'menu_principal',
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
  '📋 No aparece mi cert':                 'cert_no_aparece',
  '✏️ Corregir un dato':                  'cert_correccion',
  // ── Certificación — filas de lista ──────────────────────────────────────
  '🙋 No veo mi certificado':              'cert_tipo_avanzado',
  '🔍 Buscar de nuevo':                    'cert_buscar',
  '🔍 Buscar otro programa...':            'cert_buscar',
  '🔍 Refinar búsqueda...':               'cert_buscar',
  '🔍 Otro / No aparece':                 'cert_avanzado_otro',
  // ── Campus / Materiales ──────────────────────────────────────────────────
  'Ingresar al campus':                    'campus_ingreso',
  'No veo mi programa':                    'campus_programa',
  'Desbloqueo de campus':                  'campus_desbloqueo',
  '✅ Ya tengo acceso':                    'mat_ok',
  '✅ Pude ingresar':                      'mat_ok',
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
  '📝 Inscribirme':                        'inscribirme',
  '➕ Inscribirme':                        'inscribirme',
  '✅ Ya me registré':                     'insc_registrado',
  '❓ Tengo una duda':                     'insc_duda',
  '🏠 Menú principal':                     'insc_menu',
  // ── Justificaciones ──────────────────────────────────────────────────────
  '✅ Listo, ya llené':                    'just_listo',
  // ── Exámenes Internacionales ─────────────────────────────────────────────
  '✅ Llené el form':                      'exam_formulario_ok',
  '🆘 Necesito ayuda':                    'form_problemas',
  // ── Compartido: flujos con formulario Google ─────────────────────────────
  '⚠️ Tengo problemas':                   'form_problemas',
  '🆘 Tengo problemas':                   'form_problemas',
  // ── Alumno Flex ──────────────────────────────────────────────────────────
  '✅ Ya llené el form':                   'flex_form_lleno',
  '✅ Ya me inscribí':                     'flex_form_lleno',
  '❓ Tengo más dudas':                    'flex_mas_dudas',
  // ── Paginación de programas ──────────────────────────────────────────────
  '➕ Ver más programas':                  'prog_ver_mas',
  '📋 Ver más programas':                  'crono_mas_cursos',
  '⬅️ Página anterior':                   'prog_anterior',
  // ── CSAT ────────────────────────────────────────────────────────────────
  '⭐':                                    'csat_1',
  '⭐⭐':                                  'csat_2',
  '⭐⭐⭐':                                'csat_3',
  '⭐⭐⭐⭐':                              'csat_4',
  '⭐⭐⭐⭐⭐':                            'csat_5',
  // Fallback títulos viejos (por si hay sesiones en curso)
  '⭐ 1':                                  'csat_1',
  '⭐⭐ 2':                                'csat_2',
  '⭐⭐⭐ 3':                              'csat_3',
  '⭐⭐⭐⭐ 4':                            'csat_4',
  '⭐⭐⭐⭐⭐ 5':                          'csat_5',
  // ── Cierre bot (resuelto_bot) ────────────────────────────────────────────
  '✅ No, es todo':                        'bot_resuelto_no',
  '✅ No, eso es todo':                    'bot_resuelto_no',
  '📋 Ver menú':                           'volver_menu',
  '🔙 Volver al menú':                    'volver_menu',
  '🎓 Otro certificado':                   'cert_ver_mas',
  // ── Micro-CSAT del bot ───────────────────────────────────────────────────
  '🟢 Excelente':                          'bot_csat_good',
  '🟡 Regular':                            'bot_csat_ok',
  '🔴 Mejorable':                          'bot_csat_bad',
  // ── Identificación ──────────────────────────────────────────────────────
  'Intentar otro correo':                  'reintentar_correo',
  'Hablar con un asesor':                  'hablar_asesor',
  '🔄 No soy yo':                         'quick_no_soy_yo',
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

/**
 * Busca en session.programOptions el programa que coincida con el texto
 * enviado por el alumno (Chatwoot a veces envía el título visible en vez del ID).
 *
 * Compara contra program_name completo Y contra los primeros 24 chars
 * (límite que WhatsApp aplica al título de cada fila de lista).
 *
 * @returns {{ program: Object, index: number } | null}
 */
function resolveProgram(text, programOptions) {
  if (!programOptions?.length || !text) return null;

  // WhatsApp envía "Título\nDescripción" cuando el alumno selecciona de una lista.
  // Nos quedamos solo con la primera línea (el título) para comparar.
  const firstLine = text.split('\n')[0].trim();
  const normText  = normalizeText(firstLine);

  for (let i = 0; i < programOptions.length; i++) {
    const p        = programOptions[i];
    const fullName = p.program_name || '';
    const normFull = normalizeText(fullName);

    // Nivel 1: nombre completo
    // Nivel 2: primeros 24 chars normalizados (truncado simple legacy)
    const normTitle = normFull.slice(0, 24);

    // Nivel 3: simulamos _buildRowTitle (>24 → slice(0,21)+'...')
    const normTrunc = normalizeText(
      fullName.length > 24 ? fullName.slice(0, 21) + '...' : fullName
    );

    // Nivel 4: abreviatura limpia
    const normAbbr = normalizeText(p.abbreviation || '');

    // Nivel 5: renderedTitle guardado en session (ya aplicó _buildRowTitle + _cleanVersion)
    const normRendered = normalizeText(p.renderedTitle || '');
    const normRenderedTrunc = normRendered.length > 24
      ? normRendered.slice(0, 21) + '...'
      : normRendered;

    if (
      normFull     === normText ||
      normTitle    === normText ||
      normTrunc    === normText ||
      normAbbr     === normText ||
      normRendered === normText ||
      normRenderedTrunc === normText ||
      normFull.includes(normText) ||
      normText.includes(normTitle)
    ) {
      return { program: p, index: i };
    }
  }
  return null;
}

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

  // Dedup por tap interactivo: mismo phone+tipo+id en ventana de 15 s
  const iType = msg.contentAttributes?.type;
  const iId   = msg.contentAttributes?.id;
  if (_isTapDuplicate(phone, iType, iId)) {
    console.log(`[bot] Tap duplicado ignorado: ${phone}:${iType}:${iId}`);
    return;
  }

  markProcessed(msg.id);

  const isNewSession = !getSession(phone);
  const session = updateSession(phone, {
    conversationId,
    ultimaActividad: Date.now(),
    bot_inactivity_warn1_sent: false,
    bot_inactivity_warn2_sent: false,
  });

  // La conversación se queda en PENDING mientras el bot atiende.
  // Se pasa a OPEN solo al hacer transfer humano (ver transfer.js).

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
    console.error('[emergencia] Error crítico procesando mensaje:', err);

    // ── 1. Forzar transferencia en sesión ────────────────────────────────────
    updateSession(phone, {
      estado:             'en_atencion_humana',
      en_atencion_humana: true,
      transfer_at:        Date.now(),
    });

    const convId = session?.conversationId || conversationId;

    if (convId) {
      // ── 2. Nota privada para el asesor ─────────────────────────────────────
      addPrivateNote(
        convId,
        `⚠️ *ERROR CRÍTICO DEL BOT*\nEl flujo falló: ${err.message}\nTransferencia automática de emergencia ejecutada.`
      ).catch(() => {});

      // ── 3. PENDING → OPEN, equipo General, desactivar bot ──────────────────
      openConversation(convId).catch(() => {});
      updateLabels(convId, { add: ['transfer-emergencia', 'transfer-humano'] }).catch(() => {});
      assignTeam(convId, process.env.CHATWOOT_TEAM_GENERAL).catch(() => {});
      assignAgent(convId, process.env.CHATWOOT_DEFAULT_AGENT_ID).catch(() => {});
      deactivateBot(convId).catch(() => {});
    }

    // ── 4. Aviso al usuario (try/catch propio: la API de WA podría estar caída)
    try {
      await sendTextDirect(
        phone,
        `Uy, parece que nuestro sistema está tomando una pequeña siesta 😴 Estamos teniendo un contratiempo técnico.\n` +
        `Te estoy conectando con uno de mis compañeros del equipo humano para que te ayude.`
      );
    } catch (sendErr) {
      console.error('[emergencia] No se pudo enviar aviso al usuario:', sendErr.message);
    }
  }
}

async function route(phone, session, { text, buttonId, listId }) {
  const id = buttonId || listId;

  // Palabras clave globales → menú principal (excepto si está con agente humano)
  if (text && KEYWORDS_MENU.has(normalizeText(text)) && session.nombre
      && session.estado !== 'en_atencion_humana') {
    return showMenu(phone, session.nombre);
  }

  // ── IDs globales de navegación ─────────────────────────────────────────────
  // El alumno puede presionar botones de mensajes anteriores desde cualquier
  // estado. Estos IDs se manejan antes del switch para evitar que caigan a
  // handlers de flujo que no los reconocen.
  const GLOBAL_NAV_IDS = new Set([
    'volver_menu', 'menu_principal', 'bot_resuelto_menu', 'insc_menu',
  ]);
  if (id && GLOBAL_NAV_IDS.has(id) && session.estado !== 'en_atencion_humana') {
    return showMenu(phone, session.nombre);
  }
  if (id === 'hablar_asesor' && session.estado !== 'en_atencion_humana'
      && session.estado !== 'menu') {
    return handleMenuOption(phone, 'hablar_asesor', session);
  }

  // ── Nudge: estados que esperan botones y reciben texto libre ────────────
  // En vez de quedarse mudo, recordar al alumno que use los botones.
  const BUTTON_ONLY_STATES = new Set([
    'flow_campus', 'flow_cert_modalidad', 'flow_cert_plazo', 'flow_cert_info',
    'flow_cert_post_envio', 'flow_cert_no_aparece_modalidad', 'flow_cert_no_aparece_tipo',
    'flow_cert_no_aparece_plazo', 'flow_examenes', 'flow_alumno_flex',
    'flow_flex_opciones', 'flow_materiales', 'flow_inst_tipo',
    'flow_inst_hana_clave_ok', 'flow_inst_hana_cargando_ok', 'flow_inst_r3_clave_ok',
    'flow_inst_laptop', 'flow_inscripcion_confirm', 'flow_justificacion_flow',
  ]);
  if (!id && text && BUTTON_ONLY_STATES.has(session.estado)) {
    await sendText(phone, `Por favor, selecciona una de las opciones del mensaje anterior para continuar 😊`);
    return;
  }

  switch (session.estado) {

    case 'inicio': {
      // Intentar saludo rápido (sesión persistente de 1 mes)
      const recognized = await tryQuickGreeting(phone);
      if (recognized) return; // tryQuickGreeting ya puso estado='menu'
      return startIdentificacion(phone);
    }

    // ── En atención humana — bot silenciado salvo palabras reservadas ─────────
    case 'en_atencion_humana':
    case 'transferido': {  // 'transferido' como alias de compatibilidad
      // Registrar actividad del alumno (evita cierre por inactividad si está respondiendo al asesor)
      const atencionUpdates = { ultimaActividad: Date.now() };
      if (session.asesor_respondio) {
        atencionUpdates.alumno_respondio_post_asesor = true;
        atencionUpdates.asesor_inactivity_msg_sent   = false; // alumno respondió → cancelar el "¿Sigues ahí?" pendiente
      }
      updateSession(phone, atencionUpdates);

      const normalized = normalizeText(text || '');
      if (normalized === 'menu' || normalized === 'bot') {
        await sendText(phone,
          `En este momento un asesor te está atendiendo 💙\nPor favor espera su respuesta.`
        );
      }
      // Silencio total para cualquier otro mensaje
      return;
    }

    // ── Esperando respuesta CSAT ───────────────────────────────────────────
    case 'esperando_csat': {
      // Botón o id resuelto por TEXT_TO_ID
      if (id?.startsWith('csat_')) {
        const rating = parseInt(id.split('_')[1], 10);
        return handleCsatReply(phone, rating, session);
      }
      // Texto libre: aceptar dígito 1-5 directamente; resto → nudge
      if (text) {
        const n = parseInt(text.trim(), 10);
        if (n >= 1 && n <= 5) return handleCsatReply(phone, n, session);
        await sendText(
          phone,
          `Para ayudarnos a mejorar, por favor selecciona una calificación de la lista desplegable que te envié arriba 👇`
        );
        return;
      }
      return; // ignorar cualquier otra respuesta
    }

    // ── Micro-CSAT del bot ────────────────────────────────────────────────
    case 'flow_bot_csat': {
      const BOT_CSAT_MAP = { bot_csat_good: 5, bot_csat_ok: 3, bot_csat_bad: 1 };
      const rating = id && BOT_CSAT_MAP[id] !== undefined ? BOT_CSAT_MAP[id] : null;
      if (rating === null) return; // ignorar mensajes que no sean los 3 botones

      const labelMap = { bot_csat_good: 'bot-csat-bueno', bot_csat_ok: 'bot-csat-regular', bot_csat_bad: 'bot-csat-mejorable' };
      const labelVal = labelMap[id];
      const textoVal = { bot_csat_good: 'Excelente 🟢', bot_csat_ok: 'Regular 🟡', bot_csat_bad: 'Mejorable 🔴' }[id];

      try {
        await createCsat(
          session.conversationId,
          session.studentId || null,
          phone,
          null,    // bot no genera ticket
          rating,
          false    // resolved_by_agent = false → CSAT del bot
        );
      } catch (err) {
        console.error('[bot-csat] Error guardando calificación:', err.message);
      }

      if (session.conversationId) {
        addPrivateNote(
          session.conversationId,
          `📊 *CSAT Bot:* El alumno calificó la atención automática como: *${textoVal}*`
        ).catch(() => {});
        updateLabels(session.conversationId, { add: [labelVal, 'resuelto-bot'] }).catch(() => {});
        resolveConversation(session.conversationId).catch(() => {});
      }

      await sendText(
        phone,
        `¡Gracias por tu calificación! 💙 Tomamos nota para seguir mejorando. ¡Que tengas un excelente día!`
      );
      deleteSession(phone);
      return;
    }

    case 'esperando_correo':
      if (text) return handleCorreo(phone, text, session);
      return;

    case 'correo_no_encontrado':
      if (id) return handleCorreoNoEncontrado(phone, id, session);
      if (text) {
        // Si parece un correo, procesarlo directamente como reintento
        if (text.includes('@')) return handleCorreo(phone, text, session);
        // Texto sin '@' → recordarle que debe ingresar su correo o usar los botones
        await sendText(phone,
          `Para reintentar, escribe tu correo de inscripción 📧\n` +
          `O selecciona una opción del menú.`
        );
      }
      return;

    // ── ¿Algo más? — confirmación de cierre bot ────────────────────────────
    case 'resuelto_bot':
      if (id) return handleBotResuelto(phone, id, session);
      if (text) {
        await sendText(phone, `Por favor, selecciona una opción del menú de arriba para continuar 😊`);
        return showBotResuelto(phone);
      }
      return;

    // ── Campus Virtual ─────────────────────────────────────────────────────
    case 'flow_campus':
      if (id) return handleCampusReply(phone, id, session);
      return;

    case 'flow_campus_programa':
      if (id || text) return handleCampusProgramaReply(phone, id || text, session);
      return;

    // ── Certificación — Rama B: búsqueda libre ───────────────────────────
    case 'flow_cert_busqueda':
      if (id) return handleCertReply(phone, id, session);   // cert_buscar / cert_asesor
      if (text) return handleCertSearch(phone, text, session);
      return;

    // ── Certificación — Sub-flujo avanzado (Diplomados/PEE): selección de programa ──
    case 'flow_cert_avanzado': {
      // IDs directos: cert_avanzado_0, cert_avanzado_1, ..., cert_avanzado_otro
      if (id) return handleCertReply(phone, id, session);

      if (text) {
        const normInput           = normalizeText(text.split('\n')[0].trim());
        const certAvanzadoOptions = session.certAvanzadoOptions || [];

        const avMatch = certAvanzadoOptions.findIndex(p => {
          const fullName      = p.program_name || '';
          const normFull      = normalizeText(fullName);
          const normAbbr      = normalizeText(p.abbreviation || '');
          const normRend      = normalizeText(p.renderedTitle || '');
          const normTitle     = normFull.slice(0, 24);
          const normTrunc     = normalizeText(
            fullName.length > 24 ? fullName.slice(0, 21) + '...' : fullName
          );
          const normRendTrunc = normalizeText(
            (p.renderedTitle || '').length > 24
              ? (p.renderedTitle || '').slice(0, 21) + '...'
              : (p.renderedTitle || '')
          );
          return normFull  === normInput || normAbbr  === normInput ||
                 normRend  === normInput || normTitle === normInput ||
                 normTrunc === normInput || normRendTrunc === normInput ||
                 normFull.includes(normInput) || normInput.includes(normTitle);
        });
        if (avMatch >= 0) return handleCertReply(phone, `cert_avanzado_${avMatch}`, session);

        if (normInput.includes('otro') || normInput.includes('no aparece') ||
            normInput.includes('antiguo')) {
          return handleCertReply(phone, 'cert_avanzado_otro', session);
        }

        await sendText(phone, `No reconocí esa opción 😊\nPor favor selecciona una de la lista.`);
      }
      return;
    }

    // ── Certificación — Rama B: selección de programa ─────────────────────
    case 'flow_cert_programa': {
      // IDs interactivos: cert_odoo_*, cert_tipo_avanzado, cert_prog_*, cert_buscar, etc.
      if (id) return handleCertReply(phone, id, session);

      if (text) {
        // Chatwoot a veces envía el título de la fila en lugar del id.
        const normInput = normalizeText(text.split('\n')[0].trim());

        // Detectar opción de búsqueda por texto
        if (normInput.includes('buscar')) {
          return handleCertReply(phone, 'cert_buscar', session);
        }

        // ── Rama B Odoo: buscar en certOptions ────────────────────────────
        const certOptions = session.certOptions || [];
        if (certOptions.length > 0) {
          const certMatch = certOptions.find(c => {
            const normFull  = normalizeText(c.courseName || '');
            const normShort = normalizeText(
              (c.courseName || '').length > 24
                ? (c.courseName || '').slice(0, 21) + '...'
                : (c.courseName || '')
            );
            return normFull === normInput || normShort === normInput ||
                   normFull.includes(normInput) || normInput.includes(normFull.slice(0, 10));
          });
          if (certMatch) return handleCertReply(phone, `cert_odoo_${certMatch.id}`, session);

          // Texto que describe la fila estática final (Diplomados/PEE o "No veo mi certificado")
          if (normInput.includes('diplomado') || normInput.includes('avanzado') ||
              normInput.includes('pee')       || normInput.includes('especiali') ||
              normInput.includes('no veo')    || normInput.includes('faltante')  ||
              normInput.includes('🙋')) {
            return handleCertReply(phone, 'cert_tipo_avanzado', session);
          }

          await sendText(phone,
            `No reconocí esa opción 😊\nPor favor selecciona una de la lista.`
          );
          return;
        }

        // ── Rama B DB (fallback sin odooPartnerId): buscar en programOptions ──
        const match = resolveProgram(text, session.programOptions);
        if (match) return handleCertReply(phone, `cert_prog_${match.index}`, session);

        await sendText(phone,
          `No reconocí esa opción 😊\nPor favor selecciona una de las opciones de la lista.`
        );
        return _reshowProgramList(phone, session, 'cert');
      }
      return;
    }

    // ── Certificación — flujo Rama A y post-envío PDF ───────────────────────
    case 'flow_cert_modalidad':
    case 'flow_cert_plazo':
    case 'flow_cert_info':
    case 'flow_cert_post_envio':
      if (id === 'bot_resuelto_no' || id === 'bot_resuelto_menu')
        return handleBotResuelto(phone, id, session);
      if (id) return handleCertReply(phone, id, session);
      return;

    // ── Certificación — "No aparece mi cert" (usuario verificado) ──────────
    // TEXT_TO_ID puede convertir títulos compartidos a cert_* en vez de noap_*,
    // por eso mapeamos ambos IDs (noap_ directo + cert_ vía TEXT_TO_ID).
    case 'flow_cert_no_aparece_modalidad': {
      const NOAP_MOD_MAP = { cert_pres_en_vivo: 'noap_pres', cert_online: 'noap_online' };
      const noap_mod = NOAP_MOD_MAP[id] || id || { '🏫 Pres. / En vivo': 'noap_pres', '💻 Online': 'noap_online' }[text];
      if (noap_mod) return handleCertReply(phone, noap_mod, session);
      return;
    }
    case 'flow_cert_no_aparece_tipo': {
      const NOAP_TIPO_MAP = {
        cert_pres_curso:   'noap_pres_curso',
        cert_online_curso: 'noap_online_curso',
        cert_pres_prog:    'noap_pres_prog',
        cert_online_espec: 'noap_online_espec',
      };
      const resolved = NOAP_TIPO_MAP[id] || id;
      const noap_tipo = resolved || {
        '📘 Curso': session.noap_modalidad === 'online' ? 'noap_online_curso' : 'noap_pres_curso',
        '📗 Espec./Dipl./PEE': 'noap_pres_prog',
        '📗 Especialización': 'noap_online_espec',
      }[text];
      if (noap_tipo) return handleCertReply(phone, noap_tipo, session);
      return;
    }
    case 'flow_cert_no_aparece_plazo': {
      const NOAP_PLAZO_MAP = { cert_en_plazo: 'noap_en_plazo', cert_fuera_plazo: 'noap_fuera_plazo' };
      const resolvedPlazo = NOAP_PLAZO_MAP[id] || id;
      if (resolvedPlazo === 'bot_resuelto_no' || resolvedPlazo === 'bot_resuelto_menu')
        return handleBotResuelto(phone, resolvedPlazo, session);
      if (resolvedPlazo) return handleCertReply(phone, resolvedPlazo, session);
      if (text === '✅ Aún en el plazo') return handleCertReply(phone, 'noap_en_plazo', session);
      if (text === '⚠️ Ya pasó el plazo') return handleCertReply(phone, 'noap_fuera_plazo', session);
      return;
    }

    case 'flow_cert_tipo': {
      // '📘 Curso' es ambiguo: presencial vs online — se resuelve con certTrack
      const certId = id || (normalizeText(text) === NORM_CURSO
        ? (session.certTrack === 'online' ? 'cert_online_curso' : 'cert_pres_curso')
        : null);
      if (certId) return handleCertReply(phone, certId, session);
      return;
    }

    // ── Justificaciones ────────────────────────────────────────────────────
    case 'flow_justificacion_programa':
      if (id || text) return handleJustificacionProgramaReply(phone, id || text, session);
      return;
    case 'flow_justificacion_flow':
      // Esperando respuesta del Meta Flow — se procesa en metaWebhook
      return;

    // ── Exámenes Internacionales ───────────────────────────────────────────
    case 'flow_examenes':
      if (id) return handleExamenesReply(phone, id, session);
      return;

    // ── Reclamo / Grupo — esperan texto libre del alumno ──────────────────
    case 'flow_reclamo_datos':
      if (text) return handleReclamoDatos(phone, text, session);
      return;

    // ── Alumno Flex — opciones (formulario / dudas / menú) ───────────────
    case 'flow_alumno_flex':
    case 'flow_flex_opciones':
      if (id) return handleAlumnoFlexReply(phone, id, session);
      return;

    // ── Materiales ─────────────────────────────────────────────────────────
    case 'flow_materiales':
      if (id) return handleMaterialesReply(phone, id, session);
      return;

    // ── Instaladores ──────────────────────────────────────────────────────
    case 'flow_inst_tipo':
    case 'flow_inst_hana_clave_ok':
    case 'flow_inst_hana_cargando_ok':
    case 'flow_inst_r3_clave_ok':
    case 'flow_inst_laptop':
      if (id) return handleInstaladoresReply(phone, id, session);
      return;

    case 'flow_inst_hana_problema':
      if (id) return handleInstaladoresReply(phone, id, session);
      if (normalizeText(text) === NORM_CONTRASENA)
        return handleInstaladoresReply(phone, 'inst_hana_clave', session);
      return;

    case 'flow_inst_r3_problema':
      if (id) return handleInstaladoresReply(phone, id, session);
      if (normalizeText(text) === NORM_CONTRASENA)
        return handleInstaladoresReply(phone, 'inst_r3_clave', session);
      return;

    // ── Inscripción — confirmación post-formulario ──────────────────────
    case 'flow_inscripcion_confirm':
      if (id) return handleInscripcionReply(phone, id, session);
      return;

    // ── Cronograma — selección de programa En Vivo ─────────────────────
    case 'flow_cronograma': {
      if (id?.startsWith('crono_')) return handleCronogramaReply(phone, id, session);

      // Chatwoot envía el título renderizado como texto plano (a veces con "\nDescripción").
      // Comparar contra: program_name, abbreviation, y el renderedTitle exacto del menú
      // (ya limpio de versiones V1-V7 y con la lógica abbreviation/name aplicada).
      if (text) {
        const normInput = normalizeText(text.split('\n')[0].trim());
        const options   = session.cronogramaOptions || [];
        const match     = options.find(p => {
          const normName     = normalizeText(p.program_name  || '');
          const normAbbr     = normalizeText(p.abbreviation  || '');
          const normRendered = normalizeText(p.renderedTitle || '');
          // Simular el truncado de _buildRowTitle (>24 → 21+'...')
          const normTrunc    = normRendered.length > 24
            ? normRendered.slice(0, 21) + '...'
            : normRendered;
          return normName     === normInput ||
                 normAbbr     === normInput ||
                 normRendered === normInput ||
                 normTrunc    === normInput ||
                 normName.includes(normInput) ||
                 normInput.includes(normRendered.slice(0, 24));
        });

        if (match) {
          return handleCronogramaReply(phone, `crono_${match.program_edition_id}`, session);
        }

        await sendText(
          phone,
          `No reconocí esa opción 😊\nPor favor selecciona un programa de la lista.`
        );
      }
      return;
    }

    // ── Menú principal / default ───────────────────────────────────────────
    case 'menu':
    default:
      if (id)   return handleMenuOption(phone, id, session);
      // "No soy [nombre]" — título dinámico de la lista, detectar por patrón
      // normalizeText no quita emojis, así que limpiamos antes de comparar
      if (text && normalizeText(text.replace(/[^\p{L}\p{N}\s]/gu, '')).startsWith('no soy'))
        return handleMenuOption(phone, 'quick_no_soy_yo', session);
      if (text) return handleFreeText(phone, text, session);
      if (session.nombre) return showMenu(phone, session.nombre);
      return startIdentificacion(phone);
  }
}

/**
 * Re-muestra la lista de programas desde session.programOptions (sin query a DB).
 * Se usa cuando el alumno escribe texto que no coincide con ningún programa.
 * @param {'cert'|'flex'} tipo
 */
async function _reshowProgramList(phone, session, tipo) {
  const programs = session.programOptions || [];
  if (!programs.length) return;

  const page   = session.programPage ?? 0;
  const rows   = buildProgramRows(programs, page, tipo);
  const total  = programs.length;
  const pages  = Math.ceil(total / PAGE_SIZE);
  const footer = pages > 1 ? `Página ${page + 1} de ${pages}` : 'Selecciona un programa';

  if (tipo === 'cert') {
    await sendList(
      phone,
      'Mis Programas',
      '¿Sobre cuál de tus programas tienes consulta de certificación? 📋',
      footer,
      '📋 Ver programas',
      [{ title: 'Tus programas', rows }]
    );
  } else {
    await sendList(
      phone,
      'Mis Programas',
      '¿Para cuál de tus programas deseas solicitar la modalidad Flex? ⚡',
      footer,
      '📋 Ver programas',
      [{ title: 'Programas En Vivo', rows }]
    );
  }
}

async function handleMenuOption(phone, optionId, session) {
  updateSession(phone, { ultimoTema: optionId });

  switch (optionId) {
    case 'campus_virtual':    return showCampus(phone, session);
    case 'certificacion':     return showCertificados(phone, session);
    case 'justificaciones':   return showJustificaciones(phone, session);
    case 'campus_materiales':  return showCampus(phone, session);
    case 'materiales':        return showMateriales(phone, optionId);
    case 'instaladores':      return showInstaladores(phone);
    case 'alumno_flex':       return showAlumnoFlex(phone, session);
    case 'inscribirme':
    case 'inscripcion':       return showInscripcion(phone, session);
    case 'examenes_int':      return showExamenes(phone);

    case 'quick_no_soy_yo':
      return handleQuickNoSoyYo(phone);

    case 'menu_academico':
    case 'menu_pagos':
      return showMenu(phone, session.nombre);

    // ── Pagos — candado inteligente ─────────────────────────────────────────
    case 'estado_cuenta':
    case 'enviar_comprobante': {
      const tramite = optionId === 'estado_cuenta' ? 'Estado de Cuenta' : 'Envío de Comprobante';
      if (session.verified === true) {
        if (session.conversationId) {
          addPrivateNote(
            session.conversationId,
            `📋 *Solicitud financiera:* El alumno solicita *${tramite}*. (Identidad verificada por coincidencia de celular)`
          ).catch(err => console.error('[bot] Error nota privada pagos verificado:', err));
        }
        await sendText(phone,
          `Entendido 💙 En breve un asesor del equipo de finanzas te atenderá para procesar tu solicitud.`
        );
        return runTransfer(phone, { ...session, ultimoTema: 'pagos' });
      }
      // Celular no coincide → alerta + transfer con contexto
      if (session.conversationId) {
        addPrivateNote(
          session.conversationId,
          `📋 *Alerta de Seguridad:* El usuario solicita *${tramite}*, pero el número de WhatsApp no coincide con la base de datos.\n_(Requiere validación de identidad)_`
        ).catch(err => console.error('[bot] Error nota privada pagos:', err));
      }
      await sendText(phone,
        `Para proteger tu privacidad financiera y procesar tu solicitud de *${tramite}*, un asesor validará tu identidad brevemente 🔒`
      );
      return runTransfer(phone, { ...session, ultimoTema: 'pagos' });
    }

    case 'hablar_asesor':
      return runTransfer(phone, session);

    case 'cronograma':
      if (process.env.ENABLE_VERIFIED_FLOW !== 'false' && session.verified && session.studentId) {
        return handleCronograma(phone, session);
      }
      return runTransfer(phone, session);

    case 'menu_principal':
    case 'volver_menu':
    case 'cert_otra_duda':
    case 'bot_resuelto_menu':
    case 'insc_menu':
      return showMenu(phone, session.nombre);

    case 'bot_resuelto_no':
      return handleBotResuelto(phone, 'bot_resuelto_no', session);

    case 'cert_asesor':
      return runTransfer(phone, session);

    default:
      return showMenu(phone, session.nombre);
  }
}

// ── Nivel 2: detección de intención ──────────────────────────────────────────

const INTENT_CONFIDENCE_THRESHOLD = 0.75;

async function handleFreeText(phone, text, session) {
  // Texto demasiado corto → menú directo (regla: > 8 caracteres)
  if (!text || text.length <= 8) return showFallbackMenu(phone);

  let result;
  try {
    result = await detectIntent(text, { estado: session.estado });
  } catch (err) {
    console.error('[bot] Error en detección de intención:', err.message);
    return showFallbackMenu(phone);
  }

  const { intent, confidence, is_complaint } = result;
  console.log(`[ai] intent=${intent} confidence=${confidence.toFixed(2)} complaint=${is_complaint}`);

  // Confianza insuficiente o intención desconocida → menú
  if (confidence < INTENT_CONFIDENCE_THRESHOLD || intent === 'DESCONOCIDO') {
    return showFallbackMenu(phone);
  }

  // ── Caso especial: queja + certificación ──────────────────────────────────
  if (is_complaint && intent === 'certificacion') {
    if (session.verified && session.studentId) {
      // Rama B: mostrar lista de programas directamente
      return showCertificados(phone, session);
    }
    // Sin verificación: flujo de reclamo
    return askReclamoDatos(
      phone,
      'reclamo_certificado',
      `Lamentamos el inconveniente 😔 Vamos a revisar tu caso de inmediato.\nUno de mis compañeros del equipo humano te escribirá por aquí en breve 💙`
    );
  }

  // ── Enrutar como si el alumno hubiera seleccionado la opción del menú ─────
  updateSession(phone, { ultimoTema: intent });
  return handleMenuOption(phone, intent, session);
}

// ── CSAT ─────────────────────────────────────────────────────────────────────

async function handleCsatReply(phone, rating, session) {
  try {
    await createCsat(
      session.conversationId,
      session.studentId || null,
      phone,
      session.lastTicketNumber || null,
      rating
    );
    console.log(`[csat] Guardado: phone=${phone} rating=${rating} ticket=${session.lastTicketNumber || 'N/A'}`);
  } catch (err) {
    console.error('[csat] Error guardando calificación:', err.message);
  }

  await sendText(
    phone,
    `¡Gracias por tu calificación! 💙 Tomamos nota para seguir mejorando. ¡Que tengas un excelente día!`
  );

  // Marcar como completado (conservando etiquetas del ticket) y cerrar conversación
  if (session.conversationId) {
    await updateLabels(session.conversationId, { add: ['csat-completado'], remove: ['csat-enviado'] }).catch(() => {});
    resolveConversation(session.conversationId).catch(() => {});
  }

  deleteSession(phone);
}

module.exports = { handleIncoming };
