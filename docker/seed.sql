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
  id                 SERIAL PRIMARY KEY,
  student_id         INTEGER NOT NULL REFERENCES ods_student_bot(id) ON DELETE CASCADE,
  program_name       VARCHAR(255) NOT NULL,
  program_code       VARCHAR(50),
  modality           VARCHAR(20) DEFAULT 'ONLINE',  -- 'ONLINE' | 'PRESENCIAL' | 'EN_VIVO'
  status             VARCHAR(50) DEFAULT 'active',  -- 'active' | 'finished' | 'suspended'
  start_date         DATE,
  end_date           DATE,
  certificate_status VARCHAR(20) DEFAULT 'PENDIENTE', -- 'EMITIDO' | 'PENDIENTE' | 'BLOQUEADO'
  certificate_url    TEXT,
  created_at         TIMESTAMP DEFAULT NOW()
);

-- ── Tickets / Solicitudes del bot ────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS solicitudes_bot_seq START 1 INCREMENT 1;

CREATE TABLE IF NOT EXISTS solicitudes_bot (
  id              SERIAL PRIMARY KEY,
  ticket_number   VARCHAR(20) UNIQUE NOT NULL,
  student_id      INT REFERENCES ods_student_bot(id),
  conversation_id INT,
  tipo            VARCHAR(30) NOT NULL,  -- 'CERTIFICADO_PENDIENTE' | 'SOLICITUD_FLEX'
  program_name    VARCHAR(255),
  program_id      INT,
  notes           TEXT,
  phone           VARCHAR(20),
  status          VARCHAR(20) DEFAULT 'PENDIENTE',  -- 'PENDIENTE' | 'EN_PROCESO' | 'SOLUCIONADO'
  resolved_at     TIMESTAMP DEFAULT NULL,
  resolved_by     INT DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ── CSAT del bot ─────────────────────────────────────────────────────────────
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

-- Idempotencia para DBs existentes
ALTER TABLE ods_student_programs ADD COLUMN IF NOT EXISTS modality           VARCHAR(20) DEFAULT 'ONLINE';
ALTER TABLE ods_student_programs ADD COLUMN IF NOT EXISTS certificate_status VARCHAR(20) DEFAULT 'PENDIENTE';
ALTER TABLE ods_student_programs ADD COLUMN IF NOT EXISTS certificate_url    TEXT;
ALTER TABLE solicitudes_bot      ADD COLUMN IF NOT EXISTS phone              VARCHAR(20);

-- ── Alumnos de prueba ────────────────────────────────────────────────────────
-- Nota: juan.perez usa phone 51922495159 para prueba de verificación en simulator
INSERT INTO ods_student_bot (email, full_name, phone, is_active, membership_tier_name, membership_active) VALUES
  ('juan.perez@gmail.com',      'Juan Pérez',      '51922495159', true,  'GOLD',     true),
  ('maria.garcia@hotmail.com',  'María García',     '51912345678', true,  'PLATINUM', true),
  ('carlos.lopez@hotmail.com',  'Carlos López',     '51955555555', true,  NULL,       false),
  ('ana.martinez@outlook.com',  'Ana Martínez',     '51944444444', true,  'BLACK',    true),
  ('lucas.fernandez@yahoo.com', 'Lucas Fernández',  '51933333333', false, NULL,       false)
ON CONFLICT (email) DO NOTHING;

-- ── Programas de prueba ──────────────────────────────────────────────────────
INSERT INTO ods_student_programs
  (student_id, program_name, program_code, modality, status, start_date, end_date, certificate_status, certificate_url)
SELECT s.id, p.program_name, p.program_code, p.modality, p.status,
       p.start_date::DATE, p.end_date::DATE, p.certificate_status, p.certificate_url
FROM ods_student_bot s
JOIN (VALUES
  -- Juan Pérez: 1 programa presencial activo (flex OK), 1 finalizado con cert emitido
  ('juan.perez@gmail.com', 'Gestión de Proyectos PMI', 'PROG-001', 'PRESENCIAL', 'active',
   '2025-01-15', '2025-07-15', 'PENDIENTE', NULL),
  ('juan.perez@gmail.com', 'Excel Expert', 'PROG-010', 'ONLINE', 'finished',
   '2024-06-01', '2024-12-01', 'EMITIDO',
   'https://we-educacion.com/certificados/demo/juan-perez-excel-expert.pdf'),

  -- María García: 1 en vivo activo (flex OK), 1 online activo
  ('maria.garcia@hotmail.com', 'MBA Ejecutivo', 'PROG-002', 'ONLINE', 'active',
   '2025-02-01', '2026-02-01', 'PENDIENTE', NULL),
  ('maria.garcia@hotmail.com', 'Liderazgo y Gestión de Equipos', 'PROG-007', 'EN_VIVO', 'active',
   '2025-03-01', '2025-09-01', 'PENDIENTE', NULL),

  -- Carlos López: 2 finalizados con cert emitido
  ('carlos.lopez@hotmail.com', 'SAP FICO', 'PROG-003', 'PRESENCIAL', 'finished',
   '2024-08-01', '2025-02-01', 'EMITIDO',
   'https://we-educacion.com/certificados/demo/carlos-lopez-sap-fico.pdf'),
  ('carlos.lopez@hotmail.com', 'Power BI', 'PROG-008', 'ONLINE', 'finished',
   '2024-10-01', '2025-04-01', 'EMITIDO',
   'https://we-educacion.com/certificados/demo/carlos-lopez-power-bi.pdf'),

  -- Ana Martínez: 2 activos (1 online, 1 presencial — flex OK)
  ('ana.martinez@outlook.com', 'Marketing Digital y E-Commerce', 'PROG-004', 'ONLINE', 'active',
   '2025-02-15', '2025-08-15', 'PENDIENTE', NULL),
  ('ana.martinez@outlook.com', 'Gestión de Proyectos PMI', 'PROG-001', 'PRESENCIAL', 'active',
   '2025-03-10', '2025-09-10', 'PENDIENTE', NULL),

  -- Lucas Fernández: suspendido → cert bloqueado
  ('lucas.fernandez@yahoo.com', 'Finanzas para No Financieros', 'PROG-005', 'PRESENCIAL', 'suspended',
   '2024-11-01', '2025-05-01', 'BLOQUEADO', NULL)
) AS p(email, program_name, program_code, modality, status, start_date, end_date, certificate_status, certificate_url)
  ON s.email = p.email;
