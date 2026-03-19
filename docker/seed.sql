-- Extensión pgvector (disponible en la imagen pgvector/pgvector:pg17)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Tabla principal ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_email_enrollment (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  full_name  VARCHAR(255) NOT NULL,
  phone      VARCHAR(20),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Alumnos de prueba ──────────────────────────────────────────────────────────
INSERT INTO bot_email_enrollment (email, full_name, phone, is_active) VALUES
  ('juan.perez@gmail.com',      'Juan Pérez',          '5491123456789', true),
  ('maria.garcia@hotmail.com',  'María García',         '5491187654321', true),
  ('carlos.lopez@empresa.com',  'Carlos López',         '5491155555555', true),
  ('ana.martinez@outlook.com',  'Ana Martínez',         '5491144444444', true),
  ('lucas.fernandez@yahoo.com', 'Lucas Fernández',      '5491133333333', false)
ON CONFLICT (email) DO NOTHING;
