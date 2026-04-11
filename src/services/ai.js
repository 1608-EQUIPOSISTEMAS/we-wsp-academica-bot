const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Intent Detection ──────────────────────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `Eres un clasificador de intenciones para el bot académico de W|E Educación Ejecutiva.
Analiza el mensaje del alumno y responde ÚNICAMENTE con el JSON:
{
  "intent": "[ID]",
  "confidence": 0.0,
  "is_complaint": false
}

IDs disponibles:
- campus_virtual: problemas para ingresar al campus o plataforma
- certificacion: consultas o reclamos sobre certificados
- justificaciones: justificar inasistencia o tardanza
- alumno_flex: solicitar modalidad flex
- instaladores: problemas con SAP, Office o software
- examenes_int: exámenes internacionales MOS, PMI u otros
- cronograma: fechas, horarios o calendario del programa
- inscripcion: inscribirse a un nuevo programa o curso
- hablar_asesor: quiere hablar con una persona humana
- DESCONOCIDO: no se puede clasificar con certeza

is_complaint debe ser true si el alumno expresa frustración, queja, urgencia o menciona que lleva tiempo esperando.

Responde SOLO el JSON, sin explicaciones adicionales.`;

/**
 * Detecta la intención del mensaje del alumno.
 * @param {string} text          — Mensaje libre del alumno
 * @param {Object} [sessionState] — Estado de sesión (para contexto, opcional)
 * @returns {{ intent: string, confidence: number, is_complaint: boolean }}
 */
async function detectIntent(text, sessionState = {}) {
  const response = await client.chat.completions.create({
    model:           'gpt-4o-mini',
    max_tokens:      80,
    temperature:     0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user',   content: text },
    ],
  });

  let parsed;
  try {
    parsed = JSON.parse(response.choices[0].message.content.trim());
  } catch {
    return { intent: 'DESCONOCIDO', confidence: 0, is_complaint: false };
  }

  return {
    intent:       String(parsed.intent      || 'DESCONOCIDO'),
    confidence:   typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    is_complaint: parsed.is_complaint === true,
  };
}

module.exports = { detectIntent };
