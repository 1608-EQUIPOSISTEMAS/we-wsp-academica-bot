/**
 * Utilidad de paginación y renderizado para listas de programas del alumno.
 *
 * WhatsApp permite máximo 10 filas por lista.
 * Reservamos la fila 10 para navegación (ver más / página anterior).
 *
 * Patrón unificado con Certificados y Cronograma:
 *   title       → abbreviation (si nombre >20 chars) o nombre limpio; truncado a 21+'...'
 *   description → [Tipo] | [Modalidad] | [Año]
 */

const PAGE_SIZE = 9;

// ── Helpers de UI (misma lógica que certificados.js) ─────────────────────────

/** Elimina sufijos de versión interna (V1–V7) del texto. */
function _cleanVersion(text) {
  return text ? text.replace(/\s*V[1-7]\b/gi, '').trim() : '';
}

/** Deduce el tipo de programa a partir del nombre. */
function _deduceTipo(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('diplomado'))                     return 'Diplomado';
  if (n.includes('pee'))                           return 'PEE';
  if (n.includes('especiali'))                     return 'Especialización';
  if (n.includes('maestria') || n.includes('maestría')) return 'Maestría';
  return 'Curso';
}

/**
 * Título de la fila (≤24 chars, con margen de seguridad).
 * - Si nombre limpio >20 chars y existe abbreviation → usa abbreviation limpia
 * - Si no → usa nombre limpio
 * - Si el resultado >21 chars → slice(0,21)+'...'
 */
function _buildRowTitle(p) {
  const name = _cleanVersion(p.program_name || 'Programa');
  const abbr = _cleanVersion(p.abbreviation || '');
  const base = (name.length > 20 && abbr) ? abbr : name;
  return base.length > 24 ? base.slice(0, 21) + '...' : base;
}

/**
 * Descripción de la fila: [Tipo] | [Modalidad legible] | [Año inicio]
 * Ej: "Diplomado | En Vivo | 2025" / "Curso | Presencial"
 */
function _buildRowDescription(p) {
  const tipo = _deduceTipo(p.program_name);
  const year = p.start_date ? new Date(p.start_date).getUTCFullYear() : null;
  const mod  = p.modality === 'EN_VIVO' ? 'En Vivo' : 'Presencial';
  return year ? `${tipo} | ${mod} | ${year}` : `${tipo} | ${mod}`;
}

// ── Paginación ────────────────────────────────────────────────────────────────

/**
 * Construye las filas de una página de programas para sendList.
 *
 * @param {Array}           programs  — Array completo de programas (con renderedTitle inyectado)
 * @param {number}          page      — Página actual (0-based)
 * @param {'cert'|'flex'}   tipo      — Flujo al que pertenece (afecta IDs)
 * @returns {Array}                   — Filas listas para pasar a sendList
 */
function buildProgramRows(programs, page, tipo) {
  const start   = page * PAGE_SIZE;
  const slice   = programs.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < programs.length;
  const hasPrev = page > 0;

  const rows = slice.map((p, i) => ({
    id:          tipo === 'cert' ? `cert_prog_${start + i}` : `flex_prog_${start + i}`,
    title:       p.renderedTitle || _buildRowTitle(p),
    description: _buildRowDescription(p),
  }));

  if (hasMore) {
    rows.push({ id: 'prog_ver_mas',  title: '➕ Ver más programas', description: '' });
  } else if (hasPrev) {
    rows.push({ id: 'prog_anterior', title: '⬅️ Página anterior',   description: '' });
  }

  return rows;
}

module.exports = { buildProgramRows, PAGE_SIZE, _buildRowTitle, _buildRowDescription };
