/**
 * Monitor de inactividad.
 *
 * CASO 1 — resuelto_bot (30 min sin respuesta):
 *   El bot preguntó "¿Algo más?" y el alumno no respondió.
 *   → Cierre automático + label resuelto-bot.
 *
 * CASO 2 — en_atencion_humana (60/90 min sin actividad del alumno):
 *   60 min → advertencia al alumno
 *   90 min → resolve automático + label resuelto-inactividad
 */

const { getAllSessions, updateSession, deleteSession } = require('./session');
const { sendText }                                     = require('./whatsapp');
const { setLabels, resolveConversation, postMessage }  = require('./chatwoot');

const INTERVAL_MS    = 5  * 60 * 1000;  // revisar cada 5 min
const BOT_IDLE_MS    = 30 * 60 * 1000;  // CASO 1: 30 min
const HUMAN_WARN_MS  = 60 * 60 * 1000;  // CASO 2: advertencia a los 60 min
const HUMAN_CLOSE_MS = 90 * 60 * 1000;  // CASO 2: cierre a los 90 min

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

      // ── CASO 2 — en_atencion_humana ───────────────────────────────────────
      if (session.en_atencion_humana) {
        const inactivo = now - (session.ultimaActividad || session.ultimaInteraccion);

        // 90 min → cierre automático
        if (inactivo >= HUMAN_CLOSE_MS && session.estado_inactividad !== 'resuelto') {
          console.log(`[inactivity] CASO2 cierre automático: phone=${phone}`);
          try {
            if (session.conversationId) {
              await postMessage(session.conversationId, {
                content:      `Cerramos la conversación por inactividad. Cuando necesites ayuda, escríbenos 💙`,
                message_type: 'outgoing',
                content_type: 'text',
              });
              setLabels(session.conversationId, ['resuelto-inactividad']);
              resolveConversation(session.conversationId);
            }
          } catch (err) {
            console.error('[inactivity] Error CASO2 cierre:', err.message);
          }
          deleteSession(phone);
          continue;
        }

        // 60 min → advertencia (solo una vez)
        if (inactivo >= HUMAN_WARN_MS && !session.estado_inactividad) {
          console.log(`[inactivity] CASO2 advertencia: phone=${phone}`);
          updateSession(phone, { estado_inactividad: 'advertido' });
          try {
            await sendText(
              phone,
              `¿Sigues ahí? 😊 Si necesitas más ayuda escríbenos cuando quieras 💙`
            );
            if (session.conversationId) {
              setLabels(session.conversationId, ['inactivo']);
            }
          } catch (err) {
            console.error('[inactivity] Error CASO2 advertencia:', err.message);
          }
        }
      }
    }
  }, INTERVAL_MS);

  console.log('[inactivity] Monitor de inactividad iniciado (intervalo: 5 min)');
}

module.exports = { startInactivityWatcher };
