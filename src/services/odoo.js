const axios  = require('axios');
const { pool, findProgramEditionByOdoo,
        findProgramVersionByAbbreviation } = require('./database');

const ODOO_BASE = 'https://we-educacion.com';

// ── Parser de nombres EN_VIVO de Odoo ────────────────────────────────────────
// Formato esperado: "Azure Data Fundamentals (25/10) - Octubre 2025"
// Extrae: baseName y startDate (YYYY-MM-DD).
const ODOO_PROGRAM_REGEX = /^(.+?)\s*\((\d{2})\/(\d{2})\)\s*-\s*\w+\s+(\d{4})$/;

function parseOdooProgramName(rawName) {
  if (!rawName) return null;
  const m = rawName.match(ODOO_PROGRAM_REGEX);
  if (!m) return null;
  const [, baseName, day, month, year] = m;
  return {
    baseName:  baseName.trim(),
    startDate: `${year}-${month}-${day}`, // YYYY-MM-DD
  };
}

// ── Sesión en memoria ─────────────────────────────────────────────────────────
// Guardamos el header Set-Cookie completo para reenviarlo en cada request.
let currentSessionCookie = null;

// ── Autenticación ─────────────────────────────────────────────────────────────

async function _authenticate() {
  console.log('[odoo] Autenticando sesión...');
  const res = await axios.post(
    `${ODOO_BASE}/web/session/authenticate`,
    {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        db:       'we-educacion.com',
        login:    process.env.ODOO_USER,
        password: process.env.ODOO_PASS,
      },
    },
    { timeout: 10000 }
  );

  // Odoo devuelve error lógico dentro del body, no en el status HTTP
  if (res.data?.error) {
    throw new Error(`Odoo auth error: ${res.data.error.message}`);
  }

  // Capturar la cookie de sesión del header Set-Cookie
  const setCookie = res.headers['set-cookie'];
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Odoo no devolvió cookie de sesión');
  }
  // Tomar solo el valor de cada cookie (sin flags como Path, HttpOnly, etc.)
  currentSessionCookie = setCookie.map(c => c.split(';')[0]).join('; ');
  console.log('[odoo] Sesión autenticada OK');
}

/** Garantiza que haya una cookie de sesión activa antes de cada request. */
async function _ensureSession() {
  if (!currentSessionCookie) await _authenticate();
}

// ── Búsqueda de alumno por email ──────────────────────────────────────────────

async function _searchAlumno(email) {
  const res = await axios.post(
    `${ODOO_BASE}/web/dataset/search_read`,
    {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        model:  'res.partner',
        domain: [['email', '=', email]],
        fields: ['id', 'name', 'names', 'surnames', 'email', 'phone', 'vat'],
        limit:  1,
      },
    },
    {
      timeout: 10000,
      headers: { Cookie: currentSessionCookie },
    }
  );

  if (res.data?.error) {
    throw new Error(`Odoo search error: ${res.data.error.message}`);
  }

  return res.data?.result?.records ?? [];
}

// ── Programas del alumno (2 peticiones en paralelo) ──────────────────────────

async function _fetchPrograms(partnerId) {
  const headers = { Cookie: currentSessionCookie };

  const fetchOnline = axios.post(
    `${ODOO_BASE}/web/dataset/search_read`,
    {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        model:  'report.slide.channel.progress',
        domain: [['partner_id', '=', partnerId]],
        fields: ['channel_id'],
      },
    },
    { timeout: 10000, headers }
  );

  const fetchEnVivo = axios.post(
    `${ODOO_BASE}/web/dataset/search_read`,
    {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        model:  'report.slide.group.evaluation',
        domain: [['parent_slide_group_id', '=', false], ['partner_id', '=', partnerId]],
        fields: ['slide_group_id', 'student_id_create_date'],
      },
    },
    { timeout: 10000, headers }
  );

  // Ejecutar en paralelo; errores individuales no detienen la otra petición
  const [resOnline, resEnVivo] = await Promise.all([
    fetchOnline.catch(err => { console.warn('[odoo] Error petición online:', err.message); return null; }),
    fetchEnVivo.catch(err => { console.warn('[odoo] Error petición en vivo:', err.message); return null; }),
  ]);

  const programs = [];

  // ── Mapear Online ─────────────────────────────────────────────────────────
  if (resOnline?.data?.error) {
    console.warn('[odoo] Error programas online:', resOnline.data.error.message);
  } else {
    for (const rec of (resOnline?.data?.result?.records ?? [])) {
      if (!rec.channel_id) continue;
      programs.push({
        code:     String(rec.channel_id[0]),
        name:     rec.channel_id[1],
        modality: 'ONLINE',
      });
    }
    console.log(`[odoo] Programas online: ${programs.length}`);
  }

  // ── Mapear En Vivo ────────────────────────────────────────────────────────
  if (resEnVivo?.data?.error) {
    const errMsg = resEnVivo.data.error.message || '';
    if (errMsg.toLowerCase().includes('partner_id')) {
      console.warn('[odoo] ⚠️  partner_id no existe en report.slide.group.evaluation — avisar al usuario para corregir el campo del domain');
    } else {
      console.warn('[odoo] Error programas en vivo:', errMsg);
    }
  } else {
    const countAntes = programs.length;
    for (const rec of (resEnVivo?.data?.result?.records ?? [])) {
      if (!rec.slide_group_id) continue;
      programs.push({
        code:       String(rec.slide_group_id[0]),
        name:       rec.slide_group_id[1],
        modality:   'EN_VIVO',
        start_date: rec.student_id_create_date || null,
      });
    }
    console.log(`[odoo] Programas en vivo: ${programs.length - countAntes}`);
  }

  return programs;
}

// ── Fetch con auto-reintento si la sesión expiró ──────────────────────────────

async function _fetchFromOdoo(email) {
  // Mock de desarrollo: sin credenciales configuradas o email contiene 'mock'
  if (!process.env.ODOO_USER || email.includes('mock')) {
    console.log(`[odoo] Modo mock para: ${email}`);
    return _mockResponse(email);
  }

  // Autenticar si no hay sesión activa
  if (!currentSessionCookie) {
    await _authenticate();
  }

  let records;
  try {
    records = await _searchAlumno(email);
  } catch (err) {
    // Si Odoo rechazó la sesión, re-autenticar y reintentar una vez
    if (err.message.includes('session') || err.message.includes('Access Denied')) {
      console.warn('[odoo] Sesión expirada — re-autenticando...');
      currentSessionCookie = null;
      await _authenticate();
      records = await _searchAlumno(email);
    } else {
      throw err;
    }
  }

  if (!records || records.length === 0) {
    return { success: false };
  }

  const r          = records[0];
  const partnerId  = r.id;
  const programs   = await _fetchPrograms(partnerId);

  return {
    success: true,
    data: {
      partnerId,
      name:      r.names    || r.name?.split(' ')[0] || r.name || '',
      last_name: r.surnames || r.name?.split(' ').slice(1).join(' ') || '',
      email:     r.email    || email,
      phone:     r.phone    || null,
      programs,
    },
  };
}

// ── Mock interno (desarrollo) ─────────────────────────────────────────────────

function _mockResponse(email) {
  if (email.includes('mock')) {
    return {
      success: true,
      data: {
        name:      'Juan',
        last_name: 'Perez',
        email,
        phone:     '51999000001',
        programs: [
          {
            code:       'PROG-01',
            name:       'Diplomado en Gestión Empresarial',
            modality:   'ONLINE',
            start_date: '2023-01-01',
            end_date:   '2023-03-01',
          },
          {
            code:       'PROG-02',
            name:       'Especialización en Finanzas',
            modality:   'PRESENCIAL',
            start_date: '2023-04-01',
            end_date:   '2023-08-01',
          },
        ],
      },
    };
  }
  return { success: false };
}

// ── Sincronización principal ──────────────────────────────────────────────────

/**
 * Consulta Odoo y sincroniza alumno + programas en PostgreSQL.
 * Lanza excepción si la conexión a Odoo falla (red / timeout / 5xx).
 *
 * @param  {string}  email
 * @returns {{ synced: boolean, studentId: number|null }}
 */
async function syncStudentFromOdoo(email) {
  let odooData;
  try {
    odooData = await _fetchFromOdoo(email);
  } catch (err) {
    console.error('[odoo] Error de conexión con Odoo:', err.message);
    throw err;
  }

  if (!odooData.success || !odooData.data) {
    console.log(`[odoo] Alumno no encontrado en Odoo: ${email}`);
    return { synced: false, studentId: null };
  }

  const d        = odooData.data;
  const fullName = `${d.name} ${d.last_name}`.trim();

  // ── INSERT o UPDATE del alumno ────────────────────────────────────────────
  const { rows } = await pool.query(
    `INSERT INTO ods_student_bot (full_name, email, phone, is_active, odoo_partner_id)
     VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (email) DO UPDATE SET
       full_name       = EXCLUDED.full_name,
       phone           = EXCLUDED.phone,
       odoo_partner_id = EXCLUDED.odoo_partner_id,
       updated_at      = NOW()
     RETURNING id`,
    [fullName, d.email, d.phone || null, d.partnerId]
  );
  const studentId = rows[0].id;

  // ── INSERT de programas (ignorar duplicados sin depender de constraints) ──
  for (const prog of (d.programs || [])) {
    let editionId   = null;
    let versionId   = null;
    let programName = prog.name; // fallback: nombre completo tal como viene de Odoo

    if (prog.modality === 'EN_VIVO') {
      // Parsear nombre para obtener baseName limpio + fecha de inicio
      const parsed = parseOdooProgramName(prog.name);
      if (parsed) {
        programName = parsed.baseName; // "Microsoft Excel Básico" sin "(09/04) - Abril 2026"
        editionId   = await findProgramEditionByOdoo(parsed.baseName, parsed.startDate);
        if (editionId) {
          console.log(`[odoo] EN_VIVO matched edition: "${parsed.baseName}" ${parsed.startDate} → edition_num_id=${editionId}`);
        } else {
          console.warn(`[odoo] EN_VIVO sin match en program_editions: "${parsed.baseName}" ${parsed.startDate}`);
        }
      } else {
        console.warn(`[odoo] No se pudo parsear nombre EN_VIVO: "${prog.name}"`);
      }
    } else if (prog.modality === 'ONLINE') {
      // Buscar program_version_id por abbreviation normalizada
      versionId = await findProgramVersionByAbbreviation(prog.name);
      if (versionId) {
        console.log(`[odoo] ONLINE matched version: "${prog.name}" → program_version_id=${versionId}`);
      } else {
        console.warn(`[odoo] ONLINE sin match en program_versions: "${prog.name}"`);
      }
    }

    await pool.query(
      `INSERT INTO ods_student_programs
         (student_id, program_name, program_code, modality, status, start_date, end_date,
          program_edition_id, program_version_id)
       SELECT $1::int, $2::varchar, $3::varchar, $4::varchar, 'active', $5::date, $6::date,
              $7::int, $8::int
       WHERE NOT EXISTS (
         SELECT 1 FROM ods_student_programs
         WHERE student_id = $1::int AND program_code = $3::varchar
       )`,
      [studentId, programName, prog.code, prog.modality || 'ONLINE',
       prog.start_date || null, prog.end_date || null, editionId, versionId]
    );

    // En re-syncs: actualizar IDs si el registro ya existía sin ellos
    if (editionId || versionId) {
      await pool.query(
        `UPDATE ods_student_programs
         SET program_edition_id = COALESCE(program_edition_id, $1),
             program_version_id = COALESCE(program_version_id, $2)
         WHERE student_id = $3 AND program_code = $4
           AND (program_edition_id IS NULL OR program_version_id IS NULL)`,
        [editionId, versionId, studentId, prog.code]
      );
    }
  }

  // ── Marcar como validado ──────────────────────────────────────────────────
  await pool.query(
    `UPDATE ods_student_bot SET flag_odoo_validation = true WHERE email = $1`,
    [d.email]
  );

  console.log(`[odoo] Sync OK — email=${email} studentId=${studentId} odooPartnerId=${d.partnerId} programas=${d.programs?.length ?? 0}`);
  return { synced: true, studentId, odooPartnerId: d.partnerId };
}

// ── Certificados ──────────────────────────────────────────────────────────────

/**
 * Lista todos los certificados emitidos para un alumno.
 * @param {number} partnerId — res.partner id del alumno en Odoo
 * @returns {Array<{ id, code, courseName, date, state }>} — vacío si falla o no hay
 */
async function fetchStudentCertificates(partnerId) {
  try {
    await _ensureSession();
    const res = await axios.post(
      `${ODOO_BASE}/web/dataset/search_read`,
      {
        jsonrpc: '2.0',
        method:  'call',
        params: {
          model:  'issued.certificates',
          domain: [['partner_id', 'in', [partnerId]]],
          fields: ['id', 'code', 'slide_channel_id', 'date_issue', 'state'],
          order:  'date_issue desc',
        },
      },
      { timeout: 15000, headers: { Cookie: currentSessionCookie } }
    );

    if (res.data?.error) {
      console.warn('[odoo] fetchStudentCertificates error:', res.data.error.message);
      return [];
    }

    return (res.data?.result?.records ?? []).map(r => ({
      id:         r.id,
      code:       r.code || '',
      courseName: Array.isArray(r.slide_channel_id) ? r.slide_channel_id[1] : (r.slide_channel_id || ''),
      date:       r.date_issue || null,
      state:      r.state || '',
    }));
  } catch (err) {
    console.error('[odoo] fetchStudentCertificates exception:', err.message);
    return [];
  }
}

/**
 * Obtiene el PDF en base64 de un certificado específico.
 * @param {number} certId — id del registro en issued.certificates
 * @returns {string|null} — base64 del PDF, o null si no existe o hay error
 */
async function fetchCertificatePdf(certId) {
  try {
    await _ensureSession();
    const res = await axios.post(
      `${ODOO_BASE}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method:  'call',
        params: {
          model:  'issued.certificates',
          method: 'read',
          args:   [[certId], ['pdf_certificate_file']],
          kwargs: {},
        },
      },
      { timeout: 20000, headers: { Cookie: currentSessionCookie } }
    );

    if (res.data?.error) {
      console.warn('[odoo] fetchCertificatePdf error:', res.data.error.message);
      return null;
    }

    const records = res.data?.result ?? [];
    const base64  = records[0]?.pdf_certificate_file;
    return base64 || null;
  } catch (err) {
    console.error('[odoo] fetchCertificatePdf exception:', err.message);
    return null;
  }
}

module.exports = { syncStudentFromOdoo, fetchStudentCertificates, fetchCertificatePdf };
