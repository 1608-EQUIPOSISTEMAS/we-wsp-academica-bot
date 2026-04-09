const { getSession, getOrCreateSession, updateSession, addToHistory, deleteSession } = require('./services/session');
const { createCsat } = require('./services/database');
const { assignAgent, updateLabels, resolveConversation,
        addPrivateNote, openConversation, deactivateBot, assignTeam } = require('./services/chatwoot');
const { showBotResuelto, handleBotResuelto } = require('./flows/resuelto');
const { sendText, sendTextDirect, sendButtons, sendList } = require('./services/whatsapp');
const { buildProgramRows, PAGE_SIZE }     = require('./utils/programList');
const { detectIntent }            = require('./services/ai');
const { runTransfer }             = require('./flows/transfer');
const { showMenu, handleMenuPrincipalReply } = require('./flows/menu');
const {
  startIdentificacion,
  handleCorreo,
  handleCorreoNoEncontrado,
} = require('./flows/identificacion');
const { showCampus, handleCampusReply }                  = require('./flows/campus');
const { showCertificados, handleCertReply, handleCertSearch } = require('./flows/certificados');
const { showJustificaciones, handleJustificacionReply }  = require('./flows/justificaciones');
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
  '✅ Ya me registré':                     'insc_registrado',
  '❓ Tengo una duda':                     'insc_duda',
  '🏠 Menú principal':                     'insc_menu',
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
  // ── Paginación de programas ──────────────────────────────────────────────
  '➕ Ver más programas':                  'prog_ver_mas',
  '⬅️ Página anterior':                   'prog_anterior',
  // ── CSAT ────────────────────────────────────────────────────────────────
  '⭐ 1':                                  'csat_1',
  '⭐⭐ 2':                                'csat_2',
  '⭐⭐⭐ 3':                              'csat_3',
  '⭐⭐⭐⭐ 4':                            'csat_4',
  '⭐⭐⭐⭐⭐ 5':                          'csat_5',
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
  const normText = normalizeText(text);
  for (let i = 0; i < programOptions.length; i++) {
    const p         = programOptions[i];
    const normFull  = normalizeText(p.program_name || '');
    const normTitle = normFull.slice(0, 24); // WhatsApp trunca a 24 chars en la lista
    if (
      normFull  === normText ||
      normTitle === normText ||
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
  markProcessed(msg.id);

  const isNewSession = !getSession(phone);
  const session = updateSession(phone, { conversationId, ultimaActividad: Date.now() });

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
        `Ups, estamos experimentando intermitencias técnicas 🛠️\n` +
        `Te estoy transfiriendo inmediatamente con un asesor para que te ayude.`
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

  switch (session.estado) {

    case 'inicio':
      return startIdentificacion(phone);

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
      // Texto libre: aceptar dígito 1-5 directamente
      if (text) {
        const n = parseInt(text.trim(), 10);
        if (n >= 1 && n <= 5) return handleCsatReply(phone, n, session);
      }
      return; // ignorar cualquier otra respuesta
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
      if (id) return handleCampusReply(phone, id, session);
      return; // texto libre ignorado — el alumno debe usar los botones

    // ── Certificación — Rama B: búsqueda libre ───────────────────────────
    case 'flow_cert_busqueda':
      if (id) return handleCertReply(phone, id, session);   // cert_buscar / cert_asesor
      if (text) return handleCertSearch(phone, text, session);
      return;

    // ── Certificación — Rama B: selección de programa ─────────────────────
    case 'flow_cert_programa': {
      if (id) return handleCertReply(phone, id, session);
      if (text) {
        // Chatwoot a veces envía el título de la fila en lugar del id.
        // Detectar la opción de búsqueda por su texto antes de intentar resolveProgram.
        if (normalizeText(text).includes('buscar')) {
          return handleCertReply(phone, 'cert_buscar', session);
        }
        const match = resolveProgram(text, session.programOptions);
        if (match) return handleCertReply(phone, `cert_prog_${match.index}`, session);
        await sendText(phone,
          `No reconocí esa opción 😊\nPor favor selecciona una de las opciones de la lista.`
        );
        return _reshowProgramList(phone, session, 'cert');
      }
      return;
    }

    // ── Certificación — flujo Rama A ────────────────────────────────────────
    case 'flow_cert_modalidad':
    case 'flow_cert_plazo':
    case 'flow_cert_info':
      if (id) return handleCertReply(phone, id, session);
      return;

    case 'flow_cert_tipo': {
      // '📘 Curso' es ambiguo: presencial vs online — se resuelve con certTrack
      const certId = id || (normalizeText(text) === NORM_CURSO
        ? (session.certTrack === 'online' ? 'cert_online_curso' : 'cert_pres_curso')
        : null);
      if (certId) return handleCertReply(phone, certId, session);
      return;
    }

    // ── Justificaciones ────────────────────────────────────────────────────
    case 'flow_justificacion_info':
      if (id) return handleJustificacionReply(phone, id, session);
      return;

    // ── Exámenes Internacionales ───────────────────────────────────────────
    case 'flow_examenes':
      if (id) return handleExamenesReply(phone, id, session);
      return;

    // ── Reclamo / Grupo — esperan texto libre del alumno ──────────────────
    case 'flow_reclamo_datos':
      if (text) return handleReclamoDatos(phone, text, session);
      return;

    case 'flow_grupo_datos':
      if (text) return runTransfer(phone, { ...session, ultimoTema: 'grupo_whatsapp' }, text);
      return;

    // ── Alumno Flex — Rama B: selección de programa ───────────────────────
    case 'flow_flex_programa': {
      if (id) return handleAlumnoFlexReply(phone, id, session);
      if (text) {
        const match = resolveProgram(text, session.programOptions);
        if (match) return handleAlumnoFlexReply(phone, `flex_prog_${match.index}`, session);
        await sendText(phone,
          `No reconocí esa opción 😊\nPor favor selecciona una de las opciones de la lista.`
        );
        return _reshowProgramList(phone, session, 'flex');
      }
      return;
    }

    // ── Alumno Flex — Rama A / info ────────────────────────────────────────
    case 'flow_alumno_flex':
    case 'flow_flex_info':     // Rama B: mostrando info + formulario
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

      // Chatwoot a veces envía el título de la fila como texto plano en lugar del id.
      // Buscar en cronogramaOptions por nombre completo y por primeros 24 chars (límite visual WA).
      if (text) {
        const normInput = normalizeText(text);
        const options   = session.cronogramaOptions || [];
        const match     = options.find(p => {
          const normFull  = normalizeText(p.program_name || '');
          const normTitle = normFull.slice(0, 24);
          return normFull === normInput || normTitle === normInput
              || normFull.includes(normInput) || normInput.includes(normTitle);
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
      [{ title: 'Programas Presenciales / En vivo', rows }]
    );
  }
}

async function handleMenuOption(phone, optionId, session) {
  updateSession(phone, { ultimoTema: optionId });

  switch (optionId) {
    case 'campus_virtual':    return showCampus(phone, session);
    case 'certificacion':     return showCertificados(phone, session);
    case 'justificaciones':   return showJustificaciones(phone, session);
    case 'materiales':
    case 'video_clases':      return showMateriales(phone, optionId);
    case 'instaladores':      return showInstaladores(phone);
    case 'alumno_flex':       return showAlumnoFlex(phone, session);
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
      `Lamentamos el inconveniente 😔 Vamos a revisar tu caso de inmediato.\nUn asesor te atenderá en breve 💙`
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
    `¡Gracias por tu calificación! 🙏\n` +
    `Que tengas un excelente día 💙\n` +
    `*W|E Educación Ejecutiva*`
  );

  // Marcar como completado (conservando etiquetas del ticket) y cerrar conversación
  if (session.conversationId) {
    await updateLabels(session.conversationId, { add: ['csat-completado'], remove: ['csat-enviado'] }).catch(() => {});
    resolveConversation(session.conversationId).catch(() => {});
  }

  deleteSession(phone);
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
