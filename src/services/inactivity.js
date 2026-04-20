/**
 * Monitor de inactividad.
 *
 * CASO 1 — resuelto_bot (30 min sin respuesta):
 *   El bot preguntó "¿Algo más?" y el alumno no respondió.
 *   → Cierre automático + label resuelto-bot.
 *
 * CASO 2 — Transfer sin respuesta del asesor (5 min):
 *   Nadie tomó el caso → enviar mensaje de espera.
 *
 * CASO 2B — Asesor nunca respondió en 24h:
 *   Tras 24h desde el transfer sin ninguna respuesta del asesor.
 *   → Mensaje de disculpa al alumno, nota privada, resolve en Chatwoot.
 *
 * CASO 3 — Alumno inactivo mientras hay asesor (15 min):
 *   El asesor respondió pero el alumno dejó de contestar → "¿Sigues ahí?"
 *
 * CASO 4 — Cierre por inactividad (20 min después del CASO 3):
 *   → Mensaje de cierre, resolved_by = 'inactivity', resolve en Chatwoot.
 *
 * CASO 5 — CSAT sin respuesta (10 min):
 *   El bot envió la encuesta pero el alumno no respondió.
 *   → Mensaje de cierre, limpiar sesión.
 */

const { getAllSessions, updateSession, deleteSession } = require('./session');
const { sendText, sendTextDirect }                     = require('./whatsapp');
const { updateLabels, resolveConversation, addPrivateNote, checkAgentReplied } = require('./chatwoot');
const { getScheduleText }                              = require('./schedule');
const { updateSolicitudStatus }                        = require('./database');

// ── Modo test: tiempos reducidos para depuración ────────────────────────────
const TEST_MODE = process.env.INACTIVITY_TEST_MODE === 'true';

const INTERVAL_MS         = 1 * 60 * 1000;  // revisar cada 1 min
const BOT_IDLE_MS         = TEST_MODE ?  5 * 60 * 1000 : 30 * 60 * 1000; // CASO 1
const TRANSFER_WAIT_MS    = TEST_MODE ?  2 * 60 * 1000 :  5 * 60 * 1000; // CASO 2
const HUMAN_WARN_MS       = TEST_MODE ?  3 * 60 * 1000 : 15 * 60 * 1000; // CASO 3
const HUMAN_CLOSE_MS      = TEST_MODE ?  2 * 60 * 1000 : 20 * 60 * 1000; // CASO 4
const CSAT_TIMEOUT_MS     = TEST_MODE ?  2 * 60 * 1000 : 10 * 60 * 1000; // CASO 5
const BOT_WARN1_MS        = TEST_MODE ?  3 * 60 * 1000 : 15 * 60 * 1000; // CASO 0A: "¿Sigues ahí?"
const BOT_WARN2_MS        = TEST_MODE ?  4 * 60 * 1000 : 25 * 60 * 1000; // CASO 0B: "Voy a cerrar pronto..."
const BOT_ABANDON_MS      = TEST_MODE ?  5 * 60 * 1000 : 30 * 60 * 1000; // CASO 0C: cierre definitivo
const ASESOR_WARN_MS      = TEST_MODE ?  3 * 60 * 1000 :  30 * 60 * 1000; // CASO 3B: nota privada al asesor
const ASESOR_ALUMNO_MS    = TEST_MODE ?  4 * 60 * 1000 :  60 * 60 * 1000; // CASO 3B: msg al alumno
const ASESOR_NEVER_MS     = TEST_MODE ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000; // CASO 2B: asesor nunca respondió
const ASESOR_CLOSE_MS     = TEST_MODE ?  6 * 60 * 1000 : 24 * 60 * 60 * 1000; // CASO 3B-3: cierre tras 24h sin respuesta del asesor (post-3B-2)
const FUERA_HORARIO_MS    = TEST_MODE ? 15 * 60 * 1000 : 72 * 60 * 60 * 1000; // CASO FH: fuera de horario, 72h sin respuesta del asesor

function _mins(ms) { return ms == null ? 'N/A' : Math.floor((Date.now() - ms) / 60000) + ' min'; }

function startInactivityWatcher() {
  if (TEST_MODE) {
    console.log('[inactivity] ⚠️  TEST MODE activo — tiempos reducidos:');
    console.log(`  CASO0A=${BOT_WARN1_MS/60000}m  CASO0B=${BOT_WARN2_MS/60000}m  CASO0C=${BOT_ABANDON_MS/60000}m  CASO1=${BOT_IDLE_MS/60000}m  CASO2=${TRANSFER_WAIT_MS/60000}m  CASO2B=${ASESOR_NEVER_MS/60000}m  CASO3=${HUMAN_WARN_MS/60000}m  CASO3B-nota=${ASESOR_WARN_MS/60000}m  CASO3B-msg=${ASESOR_ALUMNO_MS/60000}m  CASO3B-cierre=${ASESOR_CLOSE_MS/60000}m  CASO4=${HUMAN_CLOSE_MS/60000}m  CASO5=${CSAT_TIMEOUT_MS/60000}m  CASO-FH=${FUERA_HORARIO_MS/60000}m`);
  }

  setInterval(() => runInactivityCycle(), INTERVAL_MS);

  console.log(`[inactivity] Monitor de inactividad iniciado (intervalo: 1 min)${TEST_MODE ? ' [TEST MODE]' : ''}`);
}

async function runInactivityCycle() {
    const now      = Date.now();
    const sessions = getAllSessions();
    const count    = sessions.size;

    if (count > 0) {
      console.log(`[inactivity] ── Ciclo revisión: ${count} sesión(es) activa(s) ──`);
    }

    for (const [phone, session] of sessions.entries()) {

      console.log(`[inactivity] Sesión: ${phone}`, {
        estado:               session.estado,
        en_atencion_humana:   session.en_atencion_humana,
        asesor_respondio:     session.asesor_respondio,
        transfer_at:          session.transfer_at ? new Date(session.transfer_at).toISOString() : null,
        transfer_wait_msg_sent: session.transfer_wait_msg_sent,
        asesor_inactivity_msg_sent: session.asesor_inactivity_msg_sent,
        asesor_no_responde_msg_sent: session.asesor_no_responde_msg_sent,
        asesor_no_responde_alumno_msg_sent: session.asesor_no_responde_alumno_msg_sent,
        resolved_by:          session.resolved_by,
        csat_sent:            session.csat_sent,
        tiempoDesdeTransfer:  _mins(session.transfer_at),
        tiempoDesdeActividad: _mins(session.ultimaActividad),
        tiempoDesdeAsesor:    _mins(session.asesor_respondio_at),
        tiempoDesdeInteraccion: _mins(session.ultimaInteraccion),
      });

      // ── CASO 0 — Sesión bot sin respuesta (3 etapas) ──────────────────────
      // El alumno dejó de responder en mitad del flujo del bot.
      // Aplica a cualquier estado que NO tenga su propio timer.
      // Estados previos a un flujo: no aplica inactividad bot
      const SKIP_BOT_INACTIVITY = new Set([
        'inicio', 'esperando_correo', 'correo_no_encontrado', 'menu',
        'resuelto_bot', 'esperando_csat',
      ]);

      if (
        !session.en_atencion_humana &&
        !SKIP_BOT_INACTIVITY.has(session.estado)
      ) {
        const inactivoBot = now - (session.ultimaActividad || session.ultimaInteraccion || 0);

        // ── CASO 0C — Cierre definitivo (30 min / 5 min test) ───────────────
        if (session.bot_inactivity_warn2_sent && inactivoBot >= BOT_ABANDON_MS) {
          console.log(`[inactivity] CASO0C cierre bot: phone=${phone} estado=${session.estado} inactivo=${_mins(session.ultimaActividad)}`);
          try {
            await sendText(
              phone,
              `Cerramos esta conversación por inactividad 😊\n` +
              `Cuando necesites ayuda, escríbenos de nuevo. ¡Hasta pronto! 💙\n\n` +
              `*W|E Educación Ejecutiva*`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO0C mensaje:', err.message);
          }
          if (session.conversationId) {
            addPrivateNote(
              session.conversationId,
              `🤖 Sesión del bot cerrada por inactividad (${Math.floor(inactivoBot / 60000)} min sin respuesta).\n` +
              `Estado al cerrar: ${session.estado}`
            ).catch(err => console.error('[inactivity] Error CASO0C nota privada:', err.message));
            updateLabels(session.conversationId, { add: ['resuelto-inactividad'] })
              .catch(err => console.error('[inactivity] Error CASO0C labels:', err.message));
            resolveConversation(session.conversationId)
              .catch(err => console.error('[inactivity] Error CASO0C resolveConversation:', err.message));
          }
          deleteSession(phone);
          continue;
        }

        // ── CASO 0B — Segundo aviso (25 min / 4 min test) ───────────────────
        if (session.bot_inactivity_warn1_sent && !session.bot_inactivity_warn2_sent && inactivoBot >= BOT_WARN2_MS) {
          console.log(`[inactivity] CASO0B segundo aviso: phone=${phone} inactivo=${_mins(session.ultimaActividad)}`);
          updateSession(phone, { bot_inactivity_warn2_sent: true });
          try {
            await sendText(
              phone,
              `Como no hemos recibido respuesta, cerraremos esta conversación en unos minutos ⏳\n` +
              `Si necesitas algo, escríbeme y con gusto te ayudo 😊`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO0B mensaje:', err.message);
          }
          continue;
        }

        // ── CASO 0A — Primer aviso (15 min / 3 min test) ────────────────────
        if (!session.bot_inactivity_warn1_sent && inactivoBot >= BOT_WARN1_MS) {
          console.log(`[inactivity] CASO0A primer aviso: phone=${phone} estado=${session.estado} inactivo=${_mins(session.ultimaActividad)}`);
          updateSession(phone, { bot_inactivity_warn1_sent: true });
          try {
            await sendText(
              phone,
              `¿Sigues ahí? 😊\n` +
              `Noto que llevas un momento sin responder. Estoy aquí para ayudarte cuando estés listo/a ⏳`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO0A mensaje:', err.message);
          }
          continue;
        }
      }

      // ── CASO 1 — resuelto_bot ──────────────────────────────────────────────
      if (session.estado === 'resuelto_bot') {
        const elapsed = now - (session.resuelto_bot_at || session.ultimaInteraccion);
        if (elapsed >= BOT_IDLE_MS) {
          console.log(`[inactivity] CASO1 cierre automático: phone=${phone}`);
          try {
            await sendText(phone, `¡Que tengas un buen día! 💙 Hasta pronto.`);
            if (session.conversationId) {
              updateLabels(session.conversationId, { add: ['resuelto-bot'] });
              resolveConversation(session.conversationId);
            }
          } catch (err) {
            console.error('[inactivity] Error CASO1 cierre:', err.message);
          }
          deleteSession(phone);
        }
        continue;
      }

      // ── CASO 5 — CSAT sin respuesta ───────────────────────────────────────
      if (session.estado === 'esperando_csat') {
        if (session.csat_sent_at && now - session.csat_sent_at >= CSAT_TIMEOUT_MS) {
          console.log(`[inactivity] CASO5 CSAT timeout: phone=${phone}`);
          try {
            await sendTextDirect(
              phone,
              `¡Gracias por contactarnos! 😊\n` +
              `Que tengas un excelente día 💙\n` +
              `*W|E Educación Ejecutiva*`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO5 cierre CSAT:', err.message);
          }
          if (session.conversationId) {
            updateLabels(session.conversationId, { add: ['resuelto-inactividad'], remove: ['csat-enviado'] })
              .catch(err => console.error('[inactivity] Error CASO5 updateLabels:', err.message));
            resolveConversation(session.conversationId)
              .catch(err => console.error('[inactivity] Error CASO5 resolveConversation:', err.message));
          }
          deleteSession(phone);
        }
        continue;
      }

      // ── CASOS 2, 3, 3B, 4 — en atención humana ─────────────────────────────
      if (!session.en_atencion_humana) continue;

      // Ignorar sesiones que ya se están cerrando por inactividad
      if (session.resolved_by) continue;

      // ── CASO FH — Fuera de horario: cierre forzoso tras 72h sin asesor ──────
      if (session.fuera_de_horario) {
        if (session.transfer_at && now - session.transfer_at >= FUERA_HORARIO_MS) {
          console.log(`[inactivity] CASO FH cierre 72h fuera de horario: phone=${phone}`);
          try {
            await sendTextDirect(
              phone,
              `¡Hola! Lamentamos la demora 🙏\n` +
              `Nuestros asesores han experimentado un alto volumen de mensajes.\n\n` +
              `Hemos cerrado esta solicitud temporalmente, pero si aún necesitas ayuda,\n` +
              `por favor vuelve a escribirnos un *"Hola"* para reiniciar el menú 💙`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO FH mensaje alumno:', err.message);
          }
          if (session.lastTicketNumber) {
            updateSolicitudStatus(session.lastTicketNumber, 'ABANDONADO')
              .catch(err => console.error('[inactivity] Error CASO FH updateSolicitudStatus:', err.message));
          }
          if (session.conversationId) {
            addPrivateNote(
              session.conversationId,
              `⏰ *Bot: cierre automático — fuera de horario sin respuesta en 72h*\n` +
              `Ningún asesor respondió desde el transfer (${new Date(session.transfer_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}).\n` +
              `La conversación fue cerrada automáticamente por el sistema.`
            ).catch(err => console.error('[inactivity] Error CASO FH nota privada:', err.message));
            updateLabels(session.conversationId, { add: ['resuelto-inactividad', 'sin-respuesta-asesor'] })
              .catch(err => console.error('[inactivity] Error CASO FH labels:', err.message));
            resolveConversation(session.conversationId)
              .catch(err => console.error('[inactivity] Error CASO FH resolveConversation:', err.message));
          }
          deleteSession(phone);
        }
        continue; // dentro del plazo: no aplicar ningún otro CASO
      }

      let inactivoAlumno = now - (session.ultimaActividad || session.ultimaInteraccion);

      // ── CASO 4 — Cierre por inactividad (20 min tras el aviso CASO 3) ─────
      // Solo aplica cuando el ALUMNO no respondió al asesor (CASO 3 path).
      // Si el alumno respondió después del asesor → CASO 3B, NO cerrar.
      if (session.asesor_inactivity_msg_sent && inactivoAlumno >= HUMAN_CLOSE_MS) {
        if (session.asesor_respondio && session.alumno_respondio_post_asesor) {
          console.log(`[inactivity] CASO4 skip: alumno respondió al asesor, no se cierra automáticamente phone=${phone}`);
          // No cerrar — cae al CASO 3B más abajo
        } else {
          console.log(`[inactivity] CASO4 cierre por inactividad: phone=${phone}`);
          updateSession(phone, { resolved_by: 'inactivity' });
          try {
            await sendTextDirect(
              phone,
              `Entendemos que en este momento no puedes responder 😊\n` +
              `Cuando tengas tiempo escríbenos nuevamente,\n` +
              `estaremos encantados de ayudarte 👋💙\n\n` +
              `⏰ Horario de atención:\n${getScheduleText()}`
            );
            if (session.conversationId) {
              updateLabels(session.conversationId, { add: ['resuelto-inactividad'] });
              resolveConversation(session.conversationId);
            }
          } catch (err) {
            console.error('[inactivity] Error CASO4 cierre:', err.message);
          }
          // No deleteSession aquí — el webhook conversation_resolved lo hará.
          // Si el webhook no llega, TTL de 24h limpia la sesión.
          continue;
        }
      }

      // ── Polling API: verificar si el asesor respondió / envió nuevo msg ───
      // message_created outgoing NO llega vía webhook en Chatwoot Cloud.
      // Caso A: asesor aún no ha respondido → detectar primer respuesta.
      // Caso B: asesor ya respondió → detectar mensajes NUEVOS (resetea CASO 3B).
      if (session.conversationId) {
        // Caso A: asesor aún no respondió → poll cerca del umbral CASO 2
        // Caso B: asesor ya respondió → poll siempre para detectar nuevos msgs
        const shouldPoll = !session.asesor_respondio
          ? (session.transfer_at ? now - session.transfer_at >= TRANSFER_WAIT_MS - 60000 : inactivoAlumno >= TRANSFER_WAIT_MS - 60000)
          : true;

        if (shouldPoll) {
          try {
            // sinceMs: si ya detectamos al asesor, buscar msgs POSTERIORES (+1ms para
            // excluir el msg ya conocido). Si no, buscar desde el transfer en adelante.
            // IMPORTANTE: NO usar transfer_at - 5000 porque los mensajes del bot enviados
            // justo antes del transfer (menús, listas) tienen sender.id del agente API y
            // serían detectados como respuesta humana (falso positivo).
            const sinceMs = session.asesor_respondio
              ? session.asesor_respondio_at + 1
              : session.transfer_at || 0;

            const { responded, respondedAt } = await checkAgentReplied(
              session.conversationId,
              sinceMs
            );
            if (responded) {
              const currentActivity = session.ultimaActividad || session.ultimaInteraccion;
              const keepActivity    = currentActivity > respondedAt;
              const isNewMsg        = session.asesor_respondio && respondedAt > session.asesor_respondio_at;

              console.log(`[inactivity] API poll: asesor respondió en conv=${session.conversationId}`, {
                asesorAt:         new Date(respondedAt).toISOString(),
                alumnoActividad:  new Date(currentActivity).toISOString(),
                alumnoYaRespondio: keepActivity,
                nuevoMsgAsesor:   isNewMsg,
              });

              const updates = {
                asesor_respondio:    true,
                asesor_respondio_at: respondedAt,
              };
              if (!keepActivity) {
                updates.ultimaActividad = respondedAt;
              }
              // Alumno escribió antes de que el polling detectara al asesor
              // → setear retroactivamente el flag
              if (keepActivity && !isNewMsg) {
                updates.alumno_respondio_post_asesor = true;
                console.log(`[inactivity] Retroactivo: alumno ya había respondido post-asesor phone=${phone}`);
              }
              // Nuevo mensaje del asesor → resetear flags CASO 3B y CASO 3 (nuevo ciclo)
              if (isNewMsg) {
                updates.asesor_no_responde_msg_sent        = false;
                updates.asesor_no_responde_alumno_msg_sent = false;
                updates.alumno_respondio_post_asesor       = false;
                updates.asesor_inactivity_msg_sent         = false;
                console.log(`[inactivity] Nuevo msg asesor: reseteando flags CASO 3 + 3B + alumno_respondio phone=${phone}`);
              }
              updateSession(phone, updates);

              session.asesor_respondio    = true;
              session.asesor_respondio_at = respondedAt;
              if (!keepActivity) session.ultimaActividad = respondedAt;
              if (keepActivity && !isNewMsg) session.alumno_respondio_post_asesor = true;
              if (isNewMsg) {
                session.asesor_no_responde_msg_sent        = false;
                session.asesor_no_responde_alumno_msg_sent = false;
                session.alumno_respondio_post_asesor       = false;
                session.asesor_inactivity_msg_sent         = false;
              }
              inactivoAlumno = now - (keepActivity ? currentActivity : respondedAt);
            }
          } catch (err) {
            console.error('[inactivity] Error polling checkAgentReplied:', err.message);
          }
        }
      }

      // ── Determinar si el alumno respondió después del asesor ────────────
      const alumnoRespondioDespues = session.asesor_respondio &&
        session.alumno_respondio_post_asesor;

      if (session.asesor_respondio) {
        console.log(`[inactivity] CASO3/3B check: phone=${phone}`, {
          asesor_respondio_at:   new Date(session.asesor_respondio_at).toISOString(),
          ultimaActividad:       new Date(session.ultimaActividad).toISOString(),
          alumno_respondio_post_asesor: session.alumno_respondio_post_asesor,
          alumnoRespondioDespues,
          inactivoAlumnoMin:     Math.floor(inactivoAlumno / 60000),
          desdeAsesorMin:        Math.floor((now - session.asesor_respondio_at) / 60000),
        });
      }

      // ── CASO 3 — Alumno NO respondió al asesor ──────────────────────────
      // El asesor escribió pero el alumno no contestó → "¿Sigues ahí?"
      // Medir tiempo desde que el asesor respondió, NO desde ultimaActividad.
      if (
        session.asesor_respondio &&
        !alumnoRespondioDespues &&
        !session.asesor_inactivity_msg_sent &&
        now - session.asesor_respondio_at >= HUMAN_WARN_MS
      ) {
        console.log(`[inactivity] CASO3 advertencia inactividad alumno: phone=${phone} (alumno no respondió al asesor)`);
        updateSession(phone, { asesor_inactivity_msg_sent: true });
        try {
          await sendTextDirect(
            phone,
            `¿Sigues ahí? 😊\n` +
            `Estaré esperando tu respuesta por unos minutos más ⏳`
          );
          if (session.conversationId) {
            updateLabels(session.conversationId, { add: ['inactivo'] });
          }
        } catch (err) {
          console.error('[inactivity] Error CASO3 advertencia:', err.message);
        }
        continue;
      }

      // ── CASO 3B — Asesor no responde al alumno ────────────────────────────
      // El asesor respondió, el alumno contestó, pero el asesor dejó de responder.
      if (alumnoRespondioDespues) {
        const esperaAlumno = now - session.ultimaActividad;

        // 3B-3: Cierre forzoso (24h / 6 min test) — asesor no respondió tras todos los avisos
        if (session.asesor_no_responde_alumno_msg_sent && esperaAlumno >= ASESOR_CLOSE_MS) {
          console.log(`[inactivity] CASO3B-3 cierre forzoso sin respuesta asesor: phone=${phone} espera=${Math.floor(esperaAlumno/60000)}min`);
          try {
            await sendTextDirect(
              phone,
              `¡Hola! Lamentamos la demora 🙏\n` +
              `Nuestros asesores han experimentado un alto volumen de mensajes.\n\n` +
              `Hemos cerrado esta solicitud temporalmente, pero si aún necesitas ayuda,\n` +
              `por favor vuelve a escribirnos un *"Hola"* para reiniciar el menú 💙`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO3B-3 mensaje alumno:', err.message);
          }
          if (session.lastTicketNumber) {
            updateSolicitudStatus(session.lastTicketNumber, 'ABANDONADO')
              .catch(err => console.error('[inactivity] Error CASO3B-3 updateSolicitudStatus:', err.message));
          }
          if (session.conversationId) {
            addPrivateNote(
              session.conversationId,
              `⏰ *Bot: cierre automático — asesor sin respuesta tras avisos (CASO 3B-3)*\n` +
              `El asesor dejó de responder al alumno. Último mensaje del alumno: ${new Date(session.ultimaActividad).toLocaleString('es-PE', { timeZone: 'America/Lima' })}.\n` +
              `La conversación fue cerrada automáticamente por el sistema.`
            ).catch(err => console.error('[inactivity] Error CASO3B-3 nota privada:', err.message));
            updateLabels(session.conversationId, { add: ['resuelto-inactividad', 'sin-respuesta-asesor'] })
              .catch(err => console.error('[inactivity] Error CASO3B-3 labels:', err.message));
            resolveConversation(session.conversationId)
              .catch(err => console.error('[inactivity] Error CASO3B-3 resolveConversation:', err.message));
          }
          deleteSession(phone);
          continue;
        }

        // 3B-2: Mensaje al alumno (60 min / 4 min test)
        if (session.asesor_no_responde_msg_sent && !session.asesor_no_responde_alumno_msg_sent && esperaAlumno >= ASESOR_ALUMNO_MS) {
          console.log(`[inactivity] CASO3B-2 aviso al alumno: phone=${phone} espera=${Math.floor(esperaAlumno/60000)}min`);
          updateSession(phone, { asesor_no_responde_alumno_msg_sent: true });
          try {
            await sendTextDirect(
              phone,
              `Lamentamos la espera 🙏\n` +
              `Tu caso sigue siendo atendido.\n` +
              `Un asesor te responderá muy pronto 💙`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO3B-2 aviso alumno:', err.message);
          }
          continue;
        }

        // 3B-1: Nota privada al asesor (30 min / 3 min test)
        if (!session.asesor_no_responde_msg_sent && esperaAlumno >= ASESOR_WARN_MS) {
          console.log(`[inactivity] CASO3B-1 nota privada asesor: phone=${phone} espera=${Math.floor(esperaAlumno/60000)}min`);
          updateSession(phone, { asesor_no_responde_msg_sent: true });
          if (session.conversationId) {
            try {
              await addPrivateNote(
                session.conversationId,
                `⚠️ El alumno lleva ${Math.floor(esperaAlumno / 60000)} minutos esperando respuesta. Por favor atiende esta conversación.`
              );
            } catch (err) {
              console.error('[inactivity] Error CASO3B-1 nota privada:', err.message);
            }
          }
          continue;
        }
      }

      // ── CASO 2 — Nadie tomó el caso en 5 min ──────────────────────────────
      if (
        !session.asesor_respondio &&
        !session.transfer_wait_msg_sent &&
        session.transfer_at &&
        now - session.transfer_at >= TRANSFER_WAIT_MS
      ) {
        console.log(`[inactivity] CASO2 aviso espera asesor: phone=${phone}`);
        updateSession(phone, { transfer_wait_msg_sent: true });
        try {
          await sendTextDirect(
            phone,
            `Lamentamos la espera 🙏\n` +
            `Estamos atendiendo varios casos en este momento,\n` +
            `pero un asesor te atenderá muy pronto 💙`
          );
        } catch (err) {
          console.error('[inactivity] Error CASO2 aviso espera:', err.message);
        }
      }

      // ── CASO 2B — Asesor nunca respondió en 24h ───────────────────────────
      if (
        !session.asesor_respondio &&
        session.transfer_at &&
        now - session.transfer_at >= ASESOR_NEVER_MS
      ) {
        console.log(`[inactivity] CASO2B cierre por asesor sin respuesta 24h: phone=${phone}`);
        try {
          await sendTextDirect(
            phone,
            `¡Hola! Lamentamos la demora 🙏\n` +
            `Nuestros asesores han experimentado un alto volumen de mensajes.\n\n` +
            `Hemos cerrado esta solicitud temporalmente, pero si aún necesitas ayuda,\n` +
            `por favor vuelve a escribirnos un *"Hola"* para reiniciar el menú 💙`
          );
        } catch (err) {
          console.error('[inactivity] Error CASO2B mensaje alumno:', err.message);
        }
        if (session.lastTicketNumber) {
          updateSolicitudStatus(session.lastTicketNumber, 'ABANDONADO')
            .catch(err => console.error('[inactivity] Error CASO2B updateSolicitudStatus:', err.message));
        }
        if (session.conversationId) {
          addPrivateNote(
            session.conversationId,
            `⏰ *Bot: cierre automático — asesor sin respuesta en 24h*\n` +
            `Ningún asesor respondió desde el transfer (${new Date(session.transfer_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}).\n` +
            `La conversación fue cerrada automáticamente por el sistema.`
          ).catch(err => console.error('[inactivity] Error CASO2B nota privada:', err.message));
          updateLabels(session.conversationId, { add: ['resuelto-inactividad', 'sin-respuesta-asesor'] })
            .catch(err => console.error('[inactivity] Error CASO2B labels:', err.message));
          resolveConversation(session.conversationId)
            .catch(err => console.error('[inactivity] Error CASO2B resolveConversation:', err.message));
        }
        deleteSession(phone);
        continue;
      }
    }
}

module.exports = { startInactivityWatcher, runInactivityCycle };
