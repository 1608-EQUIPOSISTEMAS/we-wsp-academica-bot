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
    FROM bot_email_enrollment
    WHERE LOWER(email) = LOWER($1) AND is_active = true
  `;
  const { rows } = await pool.query(query, [email.trim().toLowerCase()]);
  return rows[0] || null;
}

async function runMigration() {
  const sql = `
    CREATE TABLE IF NOT EXISTS bot_email_enrollment (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      full_name  VARCHAR(255) NOT NULL,
      phone      VARCHAR(20),
      is_active  BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
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

module.exports = { findAlumnoByEmail, runMigration, testConnection, pool };
