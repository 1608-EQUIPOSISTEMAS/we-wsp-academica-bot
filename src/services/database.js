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
    SELECT id, full_name, email, phone, is_active
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

/** Todos los programas del alumno, incluidos finalizados (para certificaciones) */
async function getAllStudentPrograms(studentId) {
  const query = `
    SELECT id, program_name, program_code, modality, status, start_date, end_date,
           certificate_status, certificate_url
    FROM ods_student_programs
    WHERE student_id = $1
    ORDER BY start_date DESC
  `;
  const { rows } = await pool.query(query, [studentId]);
  return rows;
}

/** Programas presenciales/en vivo activos (para solicitud Alumno Flex) */
async function getStudentPresencialPrograms(studentId) {
  const query = `
    SELECT id, program_name, program_code, modality, status, start_date, end_date,
           certificate_status, certificate_url
    FROM ods_student_programs
    WHERE student_id = $1
      AND status = 'active'
      AND modality IN ('PRESENCIAL', 'EN_VIVO')
    ORDER BY start_date DESC
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
async function createCsat(convId, studentId, phone, ticketNumber, rating) {
  const parsedConvId = parseInt(convId, 10);
  const convIdValue  = isNaN(parsedConvId) ? null : parsedConvId;

  const query = `
    INSERT INTO csat_bot (conversation_id, student_id, phone, ticket_number, rating)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const { rows } = await pool.query(query, [
    convIdValue, studentId || null, phone || null, ticketNumber || null, rating,
  ]);
  return rows[0];
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
  runMigration,
  testConnection,
  pool,
};
