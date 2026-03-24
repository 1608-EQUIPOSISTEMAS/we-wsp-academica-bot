-- Extensión pgvector (disponible en la imagen pgvector/pgvector:pg17)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── ODS: Alumnos (membresía y datos del bot) ────────────────────────────────
CREATE TABLE IF NOT EXISTS ods_student_bot (
  id                   SERIAL PRIMARY KEY,
  email                VARCHAR(255) UNIQUE NOT NULL,
  full_name            VARCHAR(255) NOT NULL,
  phone                VARCHAR(20),
  is_active            BOOLEAN DEFAULT true,
  membership_tier_name VARCHAR(50),   -- NULL | 'GOLD' | 'BLACK' | 'PLATINUM'
  membership_active    BOOLEAN DEFAULT false,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);

-- ── ODS: Programas por alumno ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ods_student_programs (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES ods_student_bot(id) ON DELETE CASCADE,
  program_name VARCHAR(255) NOT NULL,
  program_code VARCHAR(50),
  status       VARCHAR(50) DEFAULT 'active',  -- 'active' | 'finished' | 'suspended'
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ── Alumnos de prueba ────────────────────────────────────────────────────────
INSERT INTO ods_student_bot (email, full_name, phone, is_active, membership_tier_name, membership_active) VALUES
  ('juan.perez@gmail.com',      'Juan Pérez',      '51987654321', true,  'GOLD',     true),
  ('maria.garcia@hotmail.com',  'María García',     '51912345678', true,  'PLATINUM', true),
  ('carlos.lopez@empresa.com',  'Carlos López',     '51955555555', true,  NULL,       false),
  ('ana.martinez@outlook.com',  'Ana Martínez',     '51944444444', true,  'BLACK',    true),
  ('lucas.fernandez@yahoo.com', 'Lucas Fernández',  '51933333333', false, NULL,       false)
ON CONFLICT (email) DO NOTHING;

-- ── Programas de prueba ──────────────────────────────────────────────────────
INSERT INTO ods_student_programs (student_id, program_name, program_code, status, start_date, end_date)
SELECT s.id, p.program_name, p.program_code, p.status, p.start_date, p.end_date
FROM ods_student_bot s
JOIN (VALUES
  ('juan.perez@gmail.com',      'Gestión de Proyectos PMI',          'PROG-001', 'active',   '2025-01-15', '2025-07-15'),
  ('juan.perez@gmail.com',      'Excel Avanzado para Negocios',      'PROG-010', 'finished', '2024-06-01', '2024-12-01'),
  ('maria.garcia@hotmail.com',  'MBA Ejecutivo',                     'PROG-002', 'active',   '2025-02-01', '2026-02-01'),
  ('maria.garcia@hotmail.com',  'Liderazgo y Gestión de Equipos',    'PROG-007', 'active',   '2025-03-01', '2025-09-01'),
  ('carlos.lopez@empresa.com',  'SAP Módulo FI',                     'PROG-003', 'active',   '2025-01-20', '2025-07-20'),
  ('ana.martinez@outlook.com',  'Marketing Digital y E-Commerce',    'PROG-004', 'active',   '2025-02-15', '2025-08-15'),
  ('ana.martinez@outlook.com',  'Gestión de Proyectos PMI',          'PROG-001', 'active',   '2025-03-10', '2025-09-10'),
  ('lucas.fernandez@yahoo.com', 'Finanzas para No Financieros',      'PROG-005', 'suspended','2024-11-01', '2025-05-01')
) AS p(email, program_name, program_code, status, start_date, end_date)
  ON s.email = p.email;
