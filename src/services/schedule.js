/**
 * Manejo de horario de atención — W|E Educación Ejecutiva
 * Zona horaria: America/Lima (Perú, UTC-5, sin horario de verano)
 */

const { DateTime } = require('luxon');

const TIMEZONE = process.env.TIMEZONE || 'America/Lima';

// weekday de Luxon: 1=Lunes … 6=Sábado, 7=Domingo
// Formato: [horaInicio, minInicio, horaFin, minFin]
const SCHEDULE = {
  1: [9, 0, 18, 30],  // Lunes
  2: [9, 0, 18, 30],  // Martes
  3: [9, 0, 18, 30],  // Miércoles
  4: [9, 0, 18, 30],  // Jueves
  5: [9, 0, 18, 30],  // Viernes
  6: [9, 0, 18, 30],  // Sábado
  7: [9, 0, 13,  0],  // Domingo
};

function isWithinBusinessHours() {
  const now  = DateTime.now().setZone(TIMEZONE);
  const sched = SCHEDULE[now.weekday];
  if (!sched) return false;

  const [startH, startM, endH, endM] = sched;
  const current = now.hour * 60 + now.minute;
  const start   = startH  * 60 + startM;
  const end     = endH    * 60 + endM;

  return current >= start && current < end;
}

/**
 * Devuelve el horario formateado para mostrar al alumno.
 */
function getScheduleText() {
  return (
    `🕘 *Lunes a Sábado:* 9:00 AM - 6:30 PM\n` +
    `🕘 *Domingo:* 9:00 AM - 1:00 PM`
  );
}

module.exports = { isWithinBusinessHours, getScheduleText };
