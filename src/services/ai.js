const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let knowledgeBase = '';
try {
  knowledgeBase = fs.readFileSync(
    path.join(__dirname, '../data/knowledge_base.txt'),
    'utf-8'
  );
} catch {
  console.warn('[ai] knowledge_base.txt no encontrado, RAG deshabilitado');
}

const SYSTEM_PROMPT = `Eres un asistente académico amable de W|E Educación Ejecutiva.
Responde SOLO sobre temas académicos de W|E en español.
Sé breve, claro y usa emojis con moderación.
Si no tienes suficiente información para responder con certeza, responde exactamente: TRANSFER
Base de conocimiento:
${knowledgeBase}`;

async function askAI(userMessage, historial = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...historial.map(m => ({
      role:    m.role === 'bot' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  // Agregar el mensaje actual si no viene ya en el historial
  const lastInHistory = messages[messages.length - 1];
  if (!lastInHistory || lastInHistory.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await client.chat.completions.create({
    model:      'gpt-4o-mini',
    max_tokens: 512,
    messages,
  });

  return response.choices[0].message.content.trim();
}

module.exports = { askAI };
