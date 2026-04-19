const { Pool } = require('pg');

const fallbackConnectionString =
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD}` +
  `@${process.env.DB_HOST || 'crm-postgres'}:${process.env.DB_PORT || '5432'}` +
  `/${process.env.DB_NAME || 'neondb'}`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || fallbackConnectionString,
});

pool.on('error', (err) => {
  console.error('[database] Error inesperado en pool:', err);
});

// ── Alumnos ───────────────────────────────────────────────────────────────────

async function findAlumnoByEmail(email) {
  const query = `
    SELECT id, full_name, email, phone, is_active, flag_odoo_validation, odoo_partner_id
    FROM ods_student_bot
    WHERE LOWER(email) = LOWER($1) AND is_active = true
  `;
  const { rows } = await pool.query(query, [email.trim().toLowerCase()]);
  return rows[0] || null;
}

async function findMembershipByEmail(email) {
  const query = `
    SELECT membership_tier_name, membership_active
    FROM ods_student_bot
    WHERE LOWER(email) = LOWER($1) AND is_active = true
  `;
  const { rows } = await pool.query(query, [email.trim().toLowerCase()]);
  const type   = rows[0]?.membership_tier_name?.toUpperCase() || null;
  const active = rows[0]?.membership_active || false;
  const MEMBER_TYPES = new Set(['GOLD', 'BLACK', 'PLATINUM']);
  return { type, isMember: MEMBER_TYPES.has(type) && active };
}

async function getStudentMembership(studentId) {
  const query = `
    SELECT membership_tier_name, membership_active
    FROM ods_student_bot
    WHERE id = $1
  `;
  const { rows } = await pool.query(query, [studentId]);
  return rows[0] || null;
}

// ── Programas ─────────────────────────────────────────────────────────────────

/** Programas activos del alumno (para consultas generales) */
async function getStudentPrograms(studentId) {
  const query = `
    SELECT id, program_name, program_code, modality, status, start_date, end_date,
           certificate_status, certificate_url
    FROM ods_student_programs
    WHERE student_id = $1 AND status = 'active'
    ORDER BY start_date DESC
  `;
  const { rows } = await pool.query(query, [studentId]);
  return rows;
}

/** Todos los programas del alumno, incluidos finalizados (para certificaciones).
 *  Incluye abbreviation via JOIN:
 *  EN_VIVO: program_edition_id → program_editions → program_versions
 *  ONLINE:  program_version_id → program_versions directamente
 */
async function getAllStudentPrograms(studentId) {
  const query = `
    SELECT
      sp.id, sp.program_name, sp.program_code, sp.modality, sp.status,
      sp.start_date, sp.end_date, sp.certificate_status, sp.certificate_url,
      COALESCE(pv_live.abbreviation, pv_online.abbreviation) AS abbreviation
    FROM ods_student_programs    sp
    LEFT JOIN program_editions   pe        ON pe.edition_num_id      = sp.program_edition_id
    LEFT JOIN program_versions   pv_live   ON pv_live.program_version_id  = pe.program_version_id
    LEFT JOIN program_versions   pv_online ON pv_online.program_version_id = sp.program_version_id
    WHERE sp.student_id = $1
    ORDER BY sp.start_date DESC
  `;
  const { rows } = await pool.query(query, [studentId]);
  return rows;
}

/** Programas presenciales/en vivo activos (para solicitud Alumno Flex) */
async function getStudentPresencialPrograms(studentId) {
  const query = `
    SELECT
      sp.id, sp.program_name, sp.program_code, sp.modality, sp.status,
      sp.start_date, sp.end_date, sp.certificate_status, sp.certificate_url,
      COALESCE(pv_live.abbreviation, pv_online.abbreviation) AS abbreviation
    FROM ods_student_programs    sp
    LEFT JOIN program_editions   pe
           ON pe.edition_num_id       = sp.program_edition_id
    LEFT JOIN program_versions   pv_live
           ON pv_live.program_version_id  = pe.program_version_id
    LEFT JOIN program_versions   pv_online
           ON pv_online.program_version_id = sp.program_version_id
    WHERE sp.student_id = $1
      AND sp.status     = 'active'
      AND sp.modality   IN ('PRESENCIAL', 'EN_VIVO')
    ORDER BY sp.start_date DESC
  `;
  const { rows } = await pool.query(query, [studentId]);
  return rows;
}

// ── Solicitudes / Tickets ─────────────────────────────────────────────────────

/**
 * Crea una solicitud y genera su número de ticket automáticamente.
 * Formato: TKT-{AÑO}-{00001}
 * @returns {Object} solicitud creada con ticket_number
 */
async function createSolicitud(studentId, convId, tipo, programName, programId, notes, phone) {
  const year      = new Date().getFullYear();
  const seqResult = await pool.query("SELECT nextval('solicitudes_bot_seq') AS seq");
  const seq       = String(seqResult.rows[0].seq).padStart(5, '0');
  const ticketNumber = `TKT-${year}-${seq}`;

  // conversation_id es INT en la DB; IDs del simulador son strings → guardar NULL
  const parsedConvId = parseInt(convId, 10);
  const convIdValue  = isNaN(parsedConvId) ? null : parsedConvId;

  const query = `
    INSERT INTO solicitudes_bot
      (ticket_number, student_id, conversation_id, tipo, program_name, program_id, notes, phone)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const { rows } = await pool.query(query, [
    ticketNumber, studentId || null, convIdValue, tipo,
    programName || null, programId || null, notes || null, phone || null,
  ]);
  return rows[0];
}

// ── Actualización de estado de solicitud ─────────────────────────────────────

/**
 * Actualiza el estado de un ticket en solicitudes_bot.
 * @param {string} ticketNumber — Número de ticket (ej. TKT-2026-00001)
 * @param {string} status       — Nuevo estado (ej. 'ABANDONADO', 'RESUELTO')
 */
async function updateSolicitudStatus(ticketNumber, status) {
  if (!ticketNumber) return;
  await pool.query(
    `UPDATE solicitudes_bot SET status = $1, updated_at = NOW() WHERE ticket_number = $2`,
    [status, ticketNumber]
  );
}

// ── CSAT ──────────────────────────────────────────────────────────────────────

/**
 * Guarda la calificación CSAT del alumno.
 * @param {number|string} convId       — ID de conversación Chatwoot
 * @param {number|null}   studentId    — ID del alumno (puede ser null si no verificado)
 * @param {string}        phone        — Teléfono del alumno
 * @param {string|null}   ticketNumber — Número de ticket relacionado (puede ser null)
 * @param {number}        rating       — Calificación 1-5
 */
async function createCsat(convId, studentId, phone, ticketNumber, rating, resolvedByAgent = true) {
  const parsedConvId = parseInt(convId, 10);
  const convIdValue  = isNaN(parsedConvId) ? null : parsedConvId;

  const query = `
    INSERT INTO csat_bot (conversation_id, student_id, phone, ticket_number, rating, resolved_by_agent)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await pool.query(query, [
    convIdValue, studentId || null, phone || null, ticketNumber || null, rating, resolvedByAgent,
  ]);
  return rows[0];
}

// ── Membresía VIP ─────────────────────────────────────────────────────────────

/**
 * Verifica si el alumno tiene una membresía activa en la BD interna y actualiza
 * membership_tier_name / membership_active en ods_student_bot.
 *
 * Ruta de JOINs:
 *   person_contacts (email) → persons → customers → enrollments → membership_tiers
 *
 * @param  {string} email — Correo del alumno (insensible a mayúsculas)
 * @returns {{ isMember: boolean, tier: string|null }}
 */
async function checkAndUpdateMembership(email) {
  // ── 1. Buscar membresía activa y vigente ──────────────────────────────────

  // TODO: Descomentar esto cuando se complete la migración a enrollments.
  // const { rows } = await pool.query(
  //   `SELECT mt.tier_name
  //    FROM person_contacts pc
  //    JOIN persons          pr ON pr.person_id          = pc.person_id
  //    JOIN customers        c  ON c.person_id           = pr.person_id
  //    JOIN enrollments      e  ON e.customer_id         = c.customer_id
  //                             AND e.active             = 'Y'
  //    JOIN membership_tiers mt ON mt.program_version_id = e.program_version_id
  //    WHERE pc.value ILIKE $1
  //      AND CURRENT_TIMESTAMP <= e.registration_date + (mt.duration_days || ' days')::interval
  //    ORDER BY e.registration_date DESC
  //    LIMIT 1`,
  //   [email]
  // );

  // ── TEMPORAL: tablas gold, plata, black desde Google Sheets ──────────────
  const { rows } = await pool.query(
    `SELECT tier_name
     FROM (
       SELECT 'WE GOLD' AS tier_name, "CORREO" AS email, TO_TIMESTAMP("F_REN", 'DD/MM/YYYY') AS fecha_vencimiento FROM gold
       UNION ALL
       SELECT 'WE PLAT' AS tier_name, "CORREO" AS email, TO_TIMESTAMP("F_REN", 'DD/MM/YYYY') AS fecha_vencimiento FROM plata
       UNION ALL
       SELECT 'WE BLACK' AS tier_name, "CORREO" AS email, TO_TIMESTAMP("F_REN", 'DD/MM/YYYY') AS fecha_vencimiento FROM black
     ) AS temp_members
     WHERE LOWER(email) = LOWER($1)
       AND CURRENT_TIMESTAMP <= fecha_vencimiento
     LIMIT 1`,
    [email]
  );

  const found = rows.length > 0;
  const tier  = found ? rows[0].tier_name : null;

  // ── 2. Actualizar ods_student_bot ─────────────────────────────────────────
  await pool.query(
    `UPDATE ods_student_bot
     SET membership_tier_name = $1,
         membership_active    = $2,
         updated_at           = NOW()
     WHERE LOWER(email) = LOWER($3)`,
    [tier, found, email]
  );

  console.log(`[membership] email=${email} → isMember=${found} tier=${tier || 'none'}`);
  return { isMember: found, tier };
}

// ── Match de programas ONLINE ─────────────────────────────────────────────────

/**
 * Normaliza un string para match a prueba de balas:
 * minúsculas + sin diacríticos + sin espacios.
 * Ej: 'SQL Server Básico' → 'sqlserverbasico'
 */
function _normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/\s+/g, '');            // quitar todos los espacios
}

/**
 * Busca el program_version_id en program_versions comparando
 * la columna abbreviation (normalizada) contra el nombre raw de Odoo.
 *
 * @param  {string} rawName — Nombre tal como llega de Odoo (ej. "SQL Server Básico")
 * @returns {number|null}
 */
async function findProgramVersionByAbbreviation(rawName) {
  try {
    const normalized = _normalizeForMatch(rawName);
    const { rows } = await pool.query(
      `SELECT program_version_id
       FROM program_versions
       WHERE LOWER(REPLACE(abbreviation, ' ', '')) = $1
       LIMIT 1`,
      [normalized]
    );
    return rows[0]?.program_version_id ?? null;
  } catch (err) {
    console.error('[database] Error findProgramVersionByAbbreviation:', err.message);
    return null;
  }
}

// ── Cronograma ────────────────────────────────────────────────────────────────

/**
 * Busca el edition_num_id en program_editions haciendo join con program_versions y programs.
 * Coincide por fecha de inicio y por odoo_activation (ILIKE) en cualquiera de las dos tablas.
 *
 * @param {string} baseName  — Nombre base extraído por regex (ej. "Azure Data Fundamentals")
 * @param {string} startDate — Fecha YYYY-MM-DD
 * @returns {number|null}
 */
async function findProgramEditionByOdoo(baseName, startDate) {
  try {
    const { rows } = await pool.query(
      `SELECT pe.edition_num_id
       FROM program_editions pe
       JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
       JOIN programs          p  ON p.program_id          = pv.program_id
       WHERE pe.start_date = $1::date
         AND (
           pv.odoo_activation ILIKE '%' || $2 || '%'
           OR  p.odoo_activation ILIKE '%' || $2 || '%'
         )
         AND pe.active = 'Y'
       LIMIT 1`,
      [startDate, baseName]
    );
    return rows[0]?.edition_num_id ?? null;
  } catch (err) {
    console.error('[database] Error findProgramEditionByOdoo:', err.message);
    return null;
  }
}

/**
 * Retorna los programas EN_VIVO activos del alumno para el menú de cronograma.
 * Solo devuelve registros con program_edition_id vinculado (post-sync Odoo).
 * Oculta los módulos hijos cuando el alumno también está inscrito en el diplomado
 * padre, para que el menú muestre solo el padre (entrada única tipo "Todo en Uno").
 */
async function getStudentCronograma(studentId) {
  const { rows } = await pool.query(
    `SELECT
       sp.program_edition_id,
       p.program_name,
       pv.abbreviation,
       pe.start_date,
       pe.end_date,
       pe.whatsapp_link,
       pe.teams_link,
       cat.description AS program_type
     FROM ods_student_programs  sp
     JOIN program_editions       pe  ON pe.edition_num_id     = sp.program_edition_id
     JOIN program_versions       pv  ON pv.program_version_id = pe.program_version_id
     JOIN programs               p   ON p.program_id          = pv.program_id
     LEFT JOIN catalog           cat ON cat.catalog_id        = p.cat_type_program
     WHERE sp.student_id          = $1
       AND sp.modality             IN ('EN_VIVO', 'PRESENCIAL')
       AND sp.program_edition_id  IS NOT NULL
       AND pe.active              = 'Y'
       AND (pe.start_date >= CURRENT_DATE - INTERVAL '3 months' OR pe.end_date >= CURRENT_DATE)
       -- Ocultar hijos si el alumno también está inscrito en el padre
       AND NOT EXISTS (
         SELECT 1
         FROM edition_structure    es
         JOIN ods_student_programs osp_parent
           ON es.parent_edition_id = osp_parent.program_edition_id
         WHERE es.child_edition_id  = sp.program_edition_id
           AND osp_parent.student_id = sp.student_id
       )
     ORDER BY pe.start_date ASC`,
    [studentId]
  );
  return rows;
}

/**
 * Retorna los módulos hijos de un diplomado directamente desde edition_structure.
 * Consulta estricta por parentEditionId — sin filtrar por alumno para garantizar
 * 0% de margen de error en la vinculación.
 *
 * @param {number} parentEditionId — edition_num_id del diplomado padre
 */
async function getProgramModules(parentEditionId) {
  const { rows } = await pool.query(
    `SELECT
       pe.edition_num_id,
       pv.abbreviation,
       p.program_name,
       pe.start_date,
       pe.whatsapp_link,
       pe.teams_link
     FROM edition_structure es
     JOIN program_editions  pe ON es.child_edition_id   = pe.edition_num_id
     JOIN program_versions  pv ON pe.program_version_id = pv.program_version_id
     JOIN programs          p  ON pv.program_id         = p.program_id
     WHERE es.parent_edition_id = $1
     ORDER BY pe.start_date ASC`,
    [parentEditionId]
  );
  return rows;
}

// ── Migración ─────────────────────────────────────────────────────────────────

async function runMigration() {
  const sql = `
    CREATE TABLE IF NOT EXISTS ods_student_bot (
      id                   SERIAL PRIMARY KEY,
      email                VARCHAR(255) UNIQUE NOT NULL,
      full_name            VARCHAR(255) NOT NULL,
      phone                VARCHAR(20),
      is_active            BOOLEAN DEFAULT true,
      membership_tier_name VARCHAR(50),
      membership_active    BOOLEAN DEFAULT false,
      created_at           TIMESTAMP DEFAULT NOW(),
      updated_at           TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ods_student_programs (
      id                 SERIAL PRIMARY KEY,
      student_id         INTEGER NOT NULL REFERENCES ods_student_bot(id) ON DELETE CASCADE,
      program_name       VARCHAR(255) NOT NULL,
      program_code       VARCHAR(50),
      modality           VARCHAR(20) DEFAULT 'ONLINE',
      status             VARCHAR(50) DEFAULT 'active',
      start_date         DATE,
      end_date           DATE,
      certificate_status VARCHAR(20) DEFAULT 'PENDIENTE',
      certificate_url    TEXT,
      created_at         TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE ods_student_programs ADD COLUMN IF NOT EXISTS modality           VARCHAR(20) DEFAULT 'ONLINE';
    ALTER TABLE ods_student_programs ADD COLUMN IF NOT EXISTS certificate_status VARCHAR(20) DEFAULT 'PENDIENTE';
    ALTER TABLE ods_student_programs ADD COLUMN IF NOT EXISTS certificate_url    TEXT;

    ALTER TABLE ods_student_bot ADD COLUMN IF NOT EXISTS odoo_partner_id INTEGER;

    CREATE SEQUENCE IF NOT EXISTS solicitudes_bot_seq START 1 INCREMENT 1;

    CREATE TABLE IF NOT EXISTS solicitudes_bot (
      id              SERIAL PRIMARY KEY,
      ticket_number   VARCHAR(20) UNIQUE NOT NULL,
      student_id      INT REFERENCES ods_student_bot(id),
      conversation_id INT,
      tipo            VARCHAR(30) NOT NULL,
      program_name    VARCHAR(255),
      program_id      INT,
      notes           TEXT,
      phone           VARCHAR(20),
      status          VARCHAR(20) DEFAULT 'PENDIENTE',
      resolved_at     TIMESTAMP DEFAULT NULL,
      resolved_by     INT DEFAULT NULL,
      created_at      TIMESTAMP DEFAULT NOW(),
      updated_at      TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE solicitudes_bot ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

    CREATE TABLE IF NOT EXISTS csat_bot (
      id                SERIAL PRIMARY KEY,
      conversation_id   INT,
      student_id        INT REFERENCES ods_student_bot(id),
      phone             VARCHAR(20),
      ticket_number     VARCHAR(20),
      rating            INT CHECK (rating BETWEEN 1 AND 5),
      resolved_by_agent BOOLEAN DEFAULT true,
      created_at        TIMESTAMP DEFAULT NOW()
    );
  `;
  await pool.query(sql);
  console.log('[database] Migración ejecutada correctamente');
}

async function testConnection() {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  console.log('[database] Conexión a PostgreSQL OK');
}

// ── Programas justificables (en vivo, en curso, hijos de diplomados) ─────────

/**
 * Retorna los programas EN_VIVO/PRESENCIAL que están actualmente en curso
 * para registrar justificaciones.
 * - Cursos sueltos: start_date <= hoy <= end_date
 * - Diplomados: NO aparecen — se "explotan" en sus módulos hijos activos
 */
async function getJustificablePrograms(studentId) {
  const { rows } = await pool.query(
    `-- 1. Cursos sueltos en curso (que NO sean padres de un diplomado)
     SELECT
       sp.program_edition_id,
       p.program_name,
       pv.abbreviation,
       pe.start_date,
       pe.end_date
     FROM ods_student_programs  sp
     JOIN program_editions       pe  ON pe.edition_num_id     = sp.program_edition_id
     JOIN program_versions       pv  ON pv.program_version_id = pe.program_version_id
     JOIN programs               p   ON p.program_id          = pv.program_id
     WHERE sp.student_id          = $1
       AND sp.modality             IN ('EN_VIVO', 'PRESENCIAL')
       AND sp.program_edition_id  IS NOT NULL
       AND pe.active              = 'Y'
       AND pe.start_date         <= CURRENT_DATE
       AND pe.end_date           >= CURRENT_DATE
       -- Excluir padres (diplomados que tienen hijos)
       AND NOT EXISTS (
         SELECT 1 FROM edition_structure es
         WHERE es.parent_edition_id = sp.program_edition_id
       )
       -- Excluir hijos cuando el alumno está inscrito en el padre
       -- (se traen abajo con la segunda query)
       AND NOT EXISTS (
         SELECT 1
         FROM edition_structure    es
         JOIN ods_student_programs osp_parent
           ON es.parent_edition_id = osp_parent.program_edition_id
         WHERE es.child_edition_id  = sp.program_edition_id
           AND osp_parent.student_id = sp.student_id
       )

     UNION ALL

     -- 2. Hijos de diplomados en curso
     SELECT
       pe_child.edition_num_id  AS program_edition_id,
       p_child.program_name,
       pv_child.abbreviation,
       pe_child.start_date,
       pe_child.end_date
     FROM ods_student_programs  sp
     JOIN edition_structure      es  ON es.parent_edition_id  = sp.program_edition_id
     JOIN program_editions       pe_child ON pe_child.edition_num_id = es.child_edition_id
     JOIN program_versions       pv_child ON pv_child.program_version_id = pe_child.program_version_id
     JOIN programs               p_child  ON p_child.program_id  = pv_child.program_id
     WHERE sp.student_id          = $1
       AND sp.modality             IN ('EN_VIVO', 'PRESENCIAL')
       AND pe_child.active        = 'Y'
       AND pe_child.start_date   <= CURRENT_DATE
       AND pe_child.end_date     >= CURRENT_DATE

     ORDER BY start_date ASC`,
    [studentId]
  );
  return rows;
}

// ── Verified Phones (sesión persistente 1 mes) ───────────────────────────────

/**
 * Busca un teléfono verificado que aún no haya expirado.
 * @param {string} phone — número sin '+'
 * @returns {Object|null}
 */
async function findVerifiedPhone(phone) {
  const { rows } = await pool.query(
    `SELECT phone, correo, nombre, student_id, membership_tier, is_member, verified, odoo_partner_id
     FROM verified_phones
     WHERE phone = $1 AND expires_at > NOW()`,
    [phone]
  );
  return rows[0] || null;
}

/**
 * Guarda o actualiza un teléfono verificado. Expira en 1 mes.
 */
async function saveVerifiedPhone({ phone, correo, nombre, studentId, membershipTier, isMember, verified, odooPartnerId }) {
  await pool.query(
    `INSERT INTO verified_phones (phone, correo, nombre, student_id, membership_tier, is_member, verified, odoo_partner_id, verified_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW() + INTERVAL '1 month')
     ON CONFLICT (phone) DO UPDATE SET
       correo          = EXCLUDED.correo,
       nombre          = EXCLUDED.nombre,
       student_id      = EXCLUDED.student_id,
       membership_tier = EXCLUDED.membership_tier,
       is_member       = EXCLUDED.is_member,
       verified        = EXCLUDED.verified,
       odoo_partner_id = EXCLUDED.odoo_partner_id,
       verified_at     = NOW(),
       expires_at      = NOW() + INTERVAL '1 month'`,
    [phone, correo, nombre, studentId, membershipTier || null, isMember || false, verified || false, odooPartnerId || null]
  );
}

/**
 * Elimina un teléfono verificado (para el botón "No soy [nombre]").
 */
async function deleteVerifiedPhone(phone) {
  await pool.query('DELETE FROM verified_phones WHERE phone = $1', [phone]);
}

module.exports = {
  findAlumnoByEmail,
  findMembershipByEmail,
  getStudentMembership,
  getStudentPrograms,
  getAllStudentPrograms,
  getStudentPresencialPrograms,
  createSolicitud,
  updateSolicitudStatus,
  createCsat,
  checkAndUpdateMembership,
  findProgramEditionByOdoo,
  findProgramVersionByAbbreviation,
  getStudentCronograma,
  getProgramModules,
  getJustificablePrograms,
  findVerifiedPhone,
  saveVerifiedPhone,
  deleteVerifiedPhone,
  runMigration,
  testConnection,
  pool,
};
