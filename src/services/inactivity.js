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
const { sendText }                                     = require('./whatsapp');
const { setLabels, resolveConversation, addPrivateNote, checkAgentReplied } = require('./chatwoot');
const { getScheduleText }                              = require('./schedule');

// ── Modo test: tiempos reducidos para depuración ────────────────────────────
const TEST_MODE = process.env.INACTIVITY_TEST_MODE === 'true';

const INTERVAL_MS         = 1 * 60 * 1000;  // revisar cada 1 min
const BOT_IDLE_MS         = TEST_MODE ?  5 * 60 * 1000 : 30 * 60 * 1000; // CASO 1
const TRANSFER_WAIT_MS    = TEST_MODE ?  2 * 60 * 1000 :  5 * 60 * 1000; // CASO 2
const HUMAN_WARN_MS       = TEST_MODE ?  3 * 60 * 1000 : 15 * 60 * 1000; // CASO 3
const HUMAN_CLOSE_MS      = TEST_MODE ?  2 * 60 * 1000 : 20 * 60 * 1000; // CASO 4
const CSAT_TIMEOUT_MS     = TEST_MODE ?  2 * 60 * 1000 : 10 * 60 * 1000; // CASO 5
const ASESOR_WARN_MS      = TEST_MODE ?  3 * 60 * 1000 : 30 * 60 * 1000; // CASO 3B: nota privada al asesor
const ASESOR_ALUMNO_MS    = TEST_MODE ?  4 * 60 * 1000 : 60 * 60 * 1000; // CASO 3B: msg al alumno

function _mins(ms) { return ms == null ? 'N/A' : Math.floor((Date.now() - ms) / 60000) + ' min'; }

function startInactivityWatcher() {
  if (TEST_MODE) {
    console.log('[inactivity] ⚠️  TEST MODE activo — tiempos reducidos:');
    console.log(`  CASO1=${BOT_IDLE_MS/60000}m  CASO2=${TRANSFER_WAIT_MS/60000}m  CASO3=${HUMAN_WARN_MS/60000}m  CASO3B-nota=${ASESOR_WARN_MS/60000}m  CASO3B-msg=${ASESOR_ALUMNO_MS/60000}m  CASO4=${HUMAN_CLOSE_MS/60000}m  CASO5=${CSAT_TIMEOUT_MS/60000}m`);
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

      // ── CASO 1 — resuelto_bot ──────────────────────────────────────────────
      if (session.estado === 'resuelto_bot') {
        const elapsed = now - (session.resuelto_bot_at || session.ultimaInteraccion);
        if (elapsed >= BOT_IDLE_MS) {
          console.log(`[inactivity] CASO1 cierre automático: phone=${phone}`);
          try {
            await sendText(phone, `¡Que tengas un buen día! 💙 Hasta pronto.`);
            if (session.conversationId) {
              setLabels(session.conversationId, ['resuelto-bot']);
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
            await sendText(
              phone,
              `¡Gracias por contactarnos! 😊\n` +
              `Que tengas un excelente día 💙\n` +
              `*W|E Educación Ejecutiva*`
            );
          } catch (err) {
            console.error('[inactivity] Error CASO5 cierre CSAT:', err.message);
          }
          deleteSession(phone);
        }
        continue;
      }

      // ── CASOS 2, 3, 3B, 4 — en atención humana ─────────────────────────────
      if (!session.en_atencion_humana) continue;

      // Ignorar sesiones que ya se están cerrando por inactividad
      if (session.resolved_by) continue;

      // Fuera de horario: ya se avisó al alumno, no disparar mensajes de inactividad
      if (session.fuera_de_horario) continue;

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
            await sendText(
              phone,
              `Entendemos que en este momento no puedes responder 😊\n` +
              `Cuando tengas tiempo escríbenos nuevamente,\n` +
              `estaremos encantados de ayudarte 👋💙\n\n` +
              `⏰ Horario de atención:\n${getScheduleText()}`
            );
            if (session.conversationId) {
              setLabels(session.conversationId, ['resuelto-inactividad']);
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
            // excluir el msg ya conocido). Si no, buscar desde el transfer (-5s margen).
            const sinceMs = session.asesor_respondio
              ? session.asesor_respondio_at + 1
              : Math.max(0, (session.transfer_at || 0) - 5000);

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
              // Nuevo mensaje del asesor → resetear flags CASO 3B (nuevo ciclo)
              // y resetear alumno_respondio_post_asesor (ahora toca al alumno responder)
              if (isNewMsg) {
                updates.asesor_no_responde_msg_sent        = false;
                updates.asesor_no_responde_alumno_msg_sent = false;
                updates.alumno_respondio_post_asesor       = false;
                console.log(`[inactivity] Nuevo msg asesor: reseteando flags CASO 3B + alumno_respondio phone=${phone}`);
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
          await sendText(
            phone,
            `¿Sigues ahí? 😊\n` +
            `Estaré esperando tu respuesta por unos minutos más ⏳`
          );
          if (session.conversationId) {
            setLabels(session.conversationId, ['inactivo']);
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

        // 3B-2: Mensaje al alumno (60 min / 4 min test)
        if (session.asesor_no_responde_msg_sent && !session.asesor_no_responde_alumno_msg_sent && esperaAlumno >= ASESOR_ALUMNO_MS) {
          console.log(`[inactivity] CASO3B-2 aviso al alumno: phone=${phone} espera=${Math.floor(esperaAlumno/60000)}min`);
          updateSession(phone, { asesor_no_responde_alumno_msg_sent: true });
          try {
            await sendText(
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
          await sendText(
            phone,
            `Lamentamos la espera 🙏\n` +
            `Estamos atendiendo varios casos en este momento,\n` +
            `pero un asesor te atenderá muy pronto 💙`
          );
        } catch (err) {
          console.error('[inactivity] Error CASO2 aviso espera:', err.message);
        }
      }
    }
}

module.exports = { startInactivityWatcher, runInactivityCycle };
