const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'crm-postgres',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'neondb',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
});

pool.on('error', (err) => {
  console.error('[database] Error inesperado en pool:', err);
});

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
  const type = rows[0]?.membership_tier_name?.toUpperCase() || null;
  const active = rows[0]?.membership_active || false;
  const MEMBER_TYPES = new Set(['GOLD', 'BLACK', 'PLATINUM']);
  return { type, isMember: MEMBER_TYPES.has(type) && active };
}

async function getStudentPrograms(studentId) {
  const query = `
    SELECT id, program_name, program_code, status, start_date, end_date
    FROM ods_student_programs
    WHERE student_id = $1 AND status = 'active'
    ORDER BY start_date DESC
  `;
  const { rows } = await pool.query(query, [studentId]);
  return rows;
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
      id           SERIAL PRIMARY KEY,
      student_id   INTEGER NOT NULL REFERENCES ods_student_bot(id) ON DELETE CASCADE,
      program_name VARCHAR(255) NOT NULL,
      program_code VARCHAR(50),
      status       VARCHAR(50) DEFAULT 'active',
      start_date   DATE,
      end_date     DATE,
      created_at   TIMESTAMP DEFAULT NOW()
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
  getStudentPrograms,
  getStudentMembership,
  runMigration,
  testConnection,
  pool,
};
