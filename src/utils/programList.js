/**
 * Utilidad de paginación para listas de programas del alumno.
 *
 * WhatsApp permite máximo 10 filas por lista.
 * Reservamos la fila 10 para navegación (ver más / página anterior).
 */

const PAGE_SIZE = 9;

/**
 * Construye las filas de una página de programas para sendList.
 *
 * @param {Array}           programs  — Array completo de programas del alumno
 * @param {number}          page      — Página actual (0-based)
 * @param {'cert'|'flex'}   tipo      — Flujo al que pertenece (afecta IDs y descripción)
 * @returns {Array}                   — Filas listas para pasar a sendList
 */
function buildProgramRows(programs, page, tipo) {
  const start   = page * PAGE_SIZE;
  const slice   = programs.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < programs.length;
  const hasPrev = page > 0;

  const rows = slice.map((p, i) => ({
    id:          tipo === 'cert' ? `cert_prog_${start + i}` : `flex_prog_${start + i}`,
    title:       p.program_name.slice(0, 24),
    description: tipo === 'cert'
      ? (p.status === 'finished' ? 'Finalizado' : 'En curso')
      : (p.modality === 'EN_VIVO' ? 'En vivo' : 'Presencial'),
  }));

  if (hasMore) {
    rows.push({ id: 'prog_ver_mas',  title: '➕ Ver más programas', description: '' });
  } else if (hasPrev) {
    // En la última página mostramos "volver" sólo si no hay más páginas
    rows.push({ id: 'prog_anterior', title: '⬅️ Página anterior',   description: '' });
  }

  return rows;
}

module.exports = { buildProgramRows, PAGE_SIZE };
