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
const { setLabels, resolveConversation, postMessage }  = require('./chatwoot');
const { getScheduleText }                              = require('./schedule');

const INTERVAL_MS         = 1 * 60 * 1000;  // revisar cada 1 min
const BOT_IDLE_MS         = 30 * 60 * 1000; // CASO 1: 30 min
const TRANSFER_WAIT_MS    =  5 * 60 * 1000; // CASO 2: 5 min sin que asesor tome el caso
const HUMAN_WARN_MS       = 15 * 60 * 1000; // CASO 3: 15 min sin actividad del alumno
const HUMAN_CLOSE_MS      = 20 * 60 * 1000; // CASO 4: 20 min tras CASO 3
const CSAT_TIMEOUT_MS     = 10 * 60 * 1000; // CASO 5: 10 min sin respuesta CSAT

function startInactivityWatcher() {
  setInterval(async () => {
    const now      = Date.now();
    const sessions = getAllSessions();

    for (const [phone, session] of sessions.entries()) {

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

      // ── CASOS 2, 3, 4 — en atención humana ───────────────────────────────
      if (!session.en_atencion_humana) continue;

      // Ignorar sesiones que ya se están cerrando por inactividad
      if (session.resolved_by) continue;

      const inactivoAlumno = now - (session.ultimaActividad || session.ultimaInteraccion);

      // ── CASO 4 — Cierre por inactividad (20 min tras el aviso) ────────────
      if (session.asesor_inactivity_msg_sent && inactivoAlumno >= HUMAN_CLOSE_MS) {
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

      // ── CASO 3 — Advertencia de inactividad del alumno (15 min) ───────────
      if (session.asesor_respondio && !session.asesor_inactivity_msg_sent && inactivoAlumno >= HUMAN_WARN_MS) {
        console.log(`[inactivity] CASO3 advertencia inactividad alumno: phone=${phone}`);
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
  }, INTERVAL_MS);

  console.log('[inactivity] Monitor de inactividad iniciado (intervalo: 1 min)');
}

module.exports = { startInactivityWatcher };
