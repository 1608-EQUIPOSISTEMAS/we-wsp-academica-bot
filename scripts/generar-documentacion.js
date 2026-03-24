/**
 * Generador de documentación Excel — W|E Bot Académico
 * Ejecutar: node scripts/generar-documentacion.js
 * Salida:   docs/WE-Bot-Documentacion.xlsx
 */

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const OUTPUT_DIR  = path.join(__dirname, '..', 'docs');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'WE-Bot-Documentacion.xlsx');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Paleta de colores ──────────────────────────────────────────────────────────
const C = {
  azul_oscuro:   '1A3B5D',
  azul_medio:    '2E6DA4',
  azul_claro:    'D6E4F0',
  verde_oscuro:  '1E6B2E',
  verde_claro:   'D4EDDA',
  naranja:       'F5A623',
  naranja_claro: 'FFF3CD',
  gris_cabecera: '4A4A4A',
  gris_fila:     'F5F5F5',
  blanco:        'FFFFFF',
  rojo_claro:    'FADBD8',
  morado_claro:  'E8DAEF',
  celeste:       'D6EAF8',
};

const wb = new ExcelJS.Workbook();
wb.creator  = 'W|E Bot Generator';
wb.created  = new Date();
wb.modified = new Date();

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function addSheet(name, tabColor) {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: tabColor } },
    pageSetup:  { paperSize: 9, orientation: 'landscape', fitToPage: true },
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }];
  return ws;
}

function setColWidths(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function titleRow(ws, title, cols) {
  const row = ws.addRow([title]);
  ws.mergeCells(1, 1, 1, cols);
  const cell = ws.getCell('A1');
  cell.font      = { name: 'Calibri', bold: true, size: 16, color: { argb: C.blanco } };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.azul_oscuro } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  ws.getRow(1).height = 36;
}

function headerRow(ws, headers, bgColor = C.azul_medio) {
  const row = ws.addRow(headers);
  row.eachCell(cell => {
    cell.font      = { name: 'Calibri', bold: true, size: 11, color: { argb: C.blanco } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = border();
  });
  row.height = 30;
  return row;
}

function border(color = 'BFBFBF') {
  const s = { style: 'thin', color: { argb: color } };
  return { top: s, left: s, bottom: s, right: s };
}

function dataRow(ws, values, bgColor = C.blanco, textColor = '000000', bold = false) {
  const row = ws.addRow(values);
  row.eachCell({ includeEmpty: true }, cell => {
    cell.font      = { name: 'Calibri', size: 11, color: { argb: textColor }, bold };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border    = border();
  });
  row.height = 18;
  return row;
}

function sectionHeader(ws, label, cols, color = C.azul_oscuro) {
  const row = ws.addRow([label]);
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, cols);
  const cell = ws.getCell(`A${ws.rowCount}`);
  cell.font      = { name: 'Calibri', bold: true, size: 12, color: { argb: C.blanco } };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(ws.rowCount).height = 22;
}

function emptyRow(ws) {
  ws.addRow([]);
  ws.getRow(ws.rowCount).height = 8;
}

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 1 — ÍNDICE
// ═════════════════════════════════════════════════════════════════════════════

const wsIdx = addSheet('🗂 Índice', C.azul_oscuro);
setColWidths(wsIdx, [5, 30, 55, 20]);

titleRow(wsIdx, '🤖  W|E EDUCACIÓN EJECUTIVA — DOCUMENTACIÓN DEL BOT ACADÉMICO', 4);

wsIdx.addRow(['', 'Generado el:', new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }), '']);
wsIdx.getRow(2).getCell(2).font = { italic: true, color: { argb: '888888' } };

emptyRow(wsIdx);
headerRow(wsIdx, ['#', 'Hoja / Flujo', 'Descripción', 'Temas cubre']);

const flujos = [
  ['1', '📋 Menú Principal',          'Saludo y clasificación inicial. El alumno elige entre Académico, Soporte o Asesor.', 'Bienvenida, identificación'],
  ['2', '🏅 Certificaciones',          'Consulta de estado y tiempos de certificado. 4 combinaciones según modalidad y tipo.', 'Certificado, plazos, reclamo'],
  ['3', '🖥️ Campus Virtual',          'Instrucciones de acceso al campus. Deriva a reclamo si no puede ingresar.', 'Login, credenciales'],
  ['4', '📚 Materiales y Video Clases','Acceso a materiales en campus virtual. Deriva a reclamo si no los ve.', 'Materiales, clases grabadas'],
  ['5', '💻 Instaladores SAP',         'Soporte para SAP HANA, SAP R/3 y Office 365. Instrucciones + transfer si no resuelve.', 'SAP HANA, SAP R/3, Office 365'],
  ['6', '📝 Reclamo / Gestión',        'Captura de datos (nombre + curso) antes de transferir al equipo humano.', 'Reclamos, escalaciones'],
  ['7', '🔄 Transfer a Asesor',        'Mensaje de cierre del bot + asignación de equipo + desactivación del bot.', 'Handoff, espera asesor'],
  ['8', '✅ Cierre de Conversación',   'Pregunta "¿Algo más?" al resolver. Cierre manual o automático por inactividad.', 'Cierre, inactividad 30 min'],
  ['9', '⚙️ Reglas Generales',        'Flujo de identificación, palabras clave especiales, manejo de texto libre.', 'Correo, IA, fallback, bot activo'],
];

flujos.forEach(([n, nombre, desc, temas], i) => {
  const bg = i % 2 === 0 ? C.blanco : C.gris_fila;
  dataRow(wsIdx, [n, nombre, desc, temas], bg);
});

emptyRow(wsIdx);
sectionHeader(wsIdx, '📌  Instrucciones para proponer modificaciones', 4, C.azul_oscuro);
const instrucciones = [
  ['', '1.', 'Ubica el flujo que quieres modificar en la hoja correspondiente.', ''],
  ['', '2.', 'En la columna "TEXTO ACTUAL (BOT)" encontrarás el mensaje exacto que envía el bot hoy.', ''],
  ['', '3.', 'Escribe tu propuesta de cambio en la columna "PROPUESTA DE CAMBIO" (columna amarilla).', ''],
  ['', '4.', 'Avisa al equipo técnico indicando la hoja y el número de paso.', ''],
  ['', '5.', 'NO modificar los textos en azul (son textos dinámicos que cambian según el alumno).', ''],
];
instrucciones.forEach(r => dataRow(wsIdx, r, C.naranja_claro));

// ═════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN GENÉRICA PARA HOJAS DE FLUJO
// ═════════════════════════════════════════════════════════════════════════════
// Cols: Paso | Quién | Mensaje / Texto visible | Tipo | Opciones para el alumno | Resultado | PROPUESTA

function flowSheet(name, tabColor) {
  const ws = addSheet(name, tabColor);
  setColWidths(ws, [6, 14, 52, 18, 36, 28, 32]);
  titleRow(ws, `🤖  W|E Bot — ${name}`, 7);
  headerRow(ws, ['#\nPASO', 'QUIÉN\nHABLA', 'MENSAJE / TEXTO VISIBLE AL ALUMNO', 'TIPO DE\nMENSAJE', 'OPCIONES / BOTONES\n(texto exacto)', 'RESULTADO /\nSIGUIENTE PASO', '✏️ PROPUESTA\nDE CAMBIO']);

  // Colorear columna de propuesta (col 7) en amarillo en todos los rows futuros
  ws.getColumn(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0' } };

  return ws;
}

function paso(ws, n, quien, mensaje, tipo, opciones, resultado, bgColor = C.blanco) {
  const row = ws.addRow([n, quien, mensaje, tipo, opciones, resultado, '']);
  row.height = Math.max(18, Math.ceil(mensaje.length / 40) * 15);

  const colColors = [bgColor, bgColor, bgColor, bgColor, bgColor, bgColor, 'FFFACD'];
  row.eachCell({ includeEmpty: true }, (cell, colNum) => {
    cell.font      = { name: 'Calibri', size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colColors[colNum - 1] } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border    = border();
    if (colNum === 2) cell.alignment.horizontal = 'center';
    if (colNum === 1) { cell.alignment.horizontal = 'center'; cell.font.bold = true; }
  });
  return row;
}

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 2 — MENÚ PRINCIPAL + IDENTIFICACIÓN
// ═════════════════════════════════════════════════════════════════════════════

const wsMenu = flowSheet('📋 Menú Principal', 'FFD700');

sectionHeader(wsMenu, '🔵  PASO 0 — Identificación del alumno', 7, '1A5276');
paso(wsMenu, 0, '🤖 Bot',
  '👋 ¡Hola! Bienvenido/a a W|E Educación Ejecutiva 💙\n\nPara brindarte una mejor atención, por favor indícanos el correo con el que te inscribiste:',
  'Texto libre', '(el alumno escribe su correo)', 'Bot busca el correo en la base de datos', C.celeste);
paso(wsMenu, '0b', '🤖 Bot',
  '✅ ¡Hola, [NOMBRE]! Te encontramos en el sistema 😊\n\n→ Muestra Menú Principal',
  'Texto', '—', 'Continúa al Menú Principal', C.verde_claro);
paso(wsMenu, '0c', '🤖 Bot',
  '🔍 No encontramos ese correo en nuestro sistema.\n¿Qué deseas hacer?',
  'Botones', '• Intentar otro correo\n• Hablar con un asesor', 'Reintenta correo O transfiere a asesor', C.rojo_claro);
paso(wsMenu, '0d', '🤖 Bot',
  'Por favor, escribe nuevamente tu correo de inscripción:',
  'Texto libre', '(alumno escribe correo otra vez)', 'Vuelve al paso 0', C.naranja_claro);

emptyRow(wsMenu);
sectionHeader(wsMenu, '🟢  PASO 1 — Menú Principal', 7, '1E8449');
paso(wsMenu, 1, '🤖 Bot',
  'Hola [NOMBRE] 👋 ¿En qué podemos ayudarte hoy?',
  'Botones', '• 📚 Académico\n• 🛠️ Soporte\n• 💬 Con un asesor', 'Despliega submenú según selección');

emptyRow(wsMenu);
sectionHeader(wsMenu, '🟢  PASO 2A — Submenú Académico y Gestión', 7, '1E8449');
paso(wsMenu, '2A', '🤖 Bot',
  '¿Qué necesitas? (Académico y Gestión)',
  'Lista desplegable',
  '• 🎬 Video Clases — Accede a tus clases grabadas\n• 📁 Materiales — Descarga tus recursos\n• 📅 Cronograma — Fechas de tu programa\n• 📝 Exámenes Int. — Certificaciones internacionales\n• 🖥️ Campus Virtual — Acceso a tu plataforma\n• 🏅 Certificación — Estado y tiempos\n• 📄 Justificaciones — Gestiona tu inasistencia\n• ⚡ Alumno Flex — Modalidad flexible\n• 🔙 Menú principal — Volver al inicio',
  'Inicia el flujo correspondiente', C.azul_claro);

emptyRow(wsMenu);
sectionHeader(wsMenu, '🟢  PASO 2B — Submenú Soporte Técnico', 7, '1E8449');
paso(wsMenu, '2B', '🤖 Bot',
  '¿Qué necesitas? (Soporte Técnico)',
  'Lista desplegable',
  '• 💻 Instaladores — SAP, Office y más\n• 💬 Grupo WhatsApp — Únete a tu grupo\n• 👨‍🏫 Func. Docente — Herramientas del docente\n• 💬 Hablar con asesor — Atención personalizada\n• 🔙 Menú principal — Volver al inicio',
  'Inicia el flujo correspondiente', C.morado_claro);

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 3 — CERTIFICACIONES
// ═════════════════════════════════════════════════════════════════════════════

const wsCert = flowSheet('🏅 Certificaciones', '27AE60');

sectionHeader(wsCert, '🏅  FLUJO CERTIFICACIONES — 4 pasos', 7, '1E6B2E');

paso(wsCert, 1, '🤖 Bot',
  '¿Tu programa es presencial/en vivo u online?',
  'Botones',
  '• 🏫 Pres. / En vivo\n• 💻 Online',
  'Guarda modalidad → Paso 2');

paso(wsCert, '2A', '🤖 Bot',
  '¿Tu certificado es de un curso o de un programa?\n\n[Si eligió Presencial / En vivo]',
  'Botones',
  '• 📘 Curso\n• 📗 Espec./Dipl./PEE',
  'Guarda tipo → Paso 3', C.gris_fila);

paso(wsCert, '2B', '🤖 Bot',
  '¿Tu certificado es de un curso o de una especialización?\n\n[Si eligió Online]',
  'Botones',
  '• 📘 Curso\n• 📗 Especialización',
  'Guarda tipo → Paso 3', C.gris_fila);

sectionHeader(wsCert, '📊  Tabla de tiempos y entrega (según combinación elegida)', 7, C.azul_medio);
const combos = [
  ['Presencial/En vivo', 'Curso',                '7 días hábiles',  'campus virtual'],
  ['Presencial/En vivo', 'Espec./Dipl./PEE',     '30 días hábiles', 'correo de inscripción'],
  ['Online',             'Curso',                 '3 días hábiles',  'campus virtual'],
  ['Online',             'Especialización',       '7 días hábiles',  'correo de inscripción'],
];
headerRow(wsCert, ['', 'Modalidad', 'Tipo de programa', 'Tiempo de entrega', 'Dónde llega', '', ''], C.verde_oscuro);
combos.forEach(([mod, tipo, dias, donde], i) => {
  const bg = i % 2 === 0 ? C.verde_claro : C.blanco;
  paso(wsCert, '', '', `${mod} + ${tipo}`, '', `${dias} → ${donde}`, '', bg);
  // override cells manually
  const r = wsCert.getRow(wsCert.rowCount);
  r.getCell(2).value = mod;
  r.getCell(3).value = tipo;
  r.getCell(4).value = dias;
  r.getCell(5).value = donde;
});

emptyRow(wsCert);
paso(wsCert, 3, '🤖 Bot',
  'Tu certificado estará disponible en [X DÍAS] 🎓\n\n📌 Lo recibirás en [campus virtual / correo]\n🚨 Los días hábiles no cuentan fines de semana ni feriados.\n\n¿Ya pasaron esos días hábiles y aún no tienes tu certificado?',
  'Botones',
  '• ✅ Aún en el plazo\n• ⚠️ Ya pasó el plazo',
  'En plazo → Paso 4A\nFuera de plazo → Reclamo', C.celeste);

paso(wsCert, '4A', '🤖 Bot',
  'Perfecto 😊 Cuando llegue el momento, podrás descargarlo desde:\n🔗 https://we-educacion.com/web/login → Mis Certificados',
  'Botones',
  '• ✅ Entendido → ¿Algo más?\n• ❓ Tengo otra duda → Menú\n• 💬 Hablar con asesor → Transfer',
  'Cierre bot / Menú / Transfer', C.verde_claro);

paso(wsCert, '4B', '🤖 Bot',
  'Lamentamos el inconveniente 😔 Vamos a revisar tu caso de inmediato.\nUn asesor te atenderá en breve 💙\n\n¿Podrías indicarnos tu nombre completo y el nombre de tu curso?',
  'Texto libre',
  '(alumno escribe sus datos)',
  '→ Transfer a asesor con nota interna', C.rojo_claro);

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 4 — CAMPUS VIRTUAL
// ═════════════════════════════════════════════════════════════════════════════

const wsCampus = flowSheet('🖥️ Campus Virtual', '2980B9');

sectionHeader(wsCampus, '🖥️  FLUJO CAMPUS VIRTUAL', 7, '1A5276');

paso(wsCampus, 1, '🤖 Bot',
  'Que tal 😊 Puedes ingresar a tu campus virtual aquí:\n🔗 https://we-educacion.com/web/login\n\nTus credenciales las encuentras en el correo de confirmación enviado desde pagos@we-educacion.com\n• Usuario: tu correo de inscripción\n• Contraseña inicial: 1234567\n\n¿Pudiste ingresar sin problema?',
  'Botones',
  '• ✅ Sí, gracias\n• ❌ No pude ingresar',
  'OK → ¿Algo más?\nNo → Reclamo de activación');

paso(wsCampus, '2A', '🤖 Bot',
  '¿Hay algo más en lo que pueda ayudarte? 😊',
  'Botones',
  '• ✅ No, es todo → Cierre\n• 📋 Ver menú → Menú principal',
  'Fin del flujo', C.verde_claro);

paso(wsCampus, '2B', '🤖 Bot',
  'Para agilizar tu atención, ¿podrías indicarnos tu nombre completo y el nombre de tu curso?',
  'Texto libre',
  '(alumno escribe sus datos)',
  '→ Transfer a asesor con nota interna', C.rojo_claro);

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 5 — MATERIALES Y VIDEO CLASES
// ═════════════════════════════════════════════════════════════════════════════

const wsMat = flowSheet('📚 Materiales y Videos', '8E44AD');

sectionHeader(wsMat, '📚  FLUJO MATERIALES Y VIDEO CLASES', 7, '6C3483');

paso(wsMat, 1, '🤖 Bot',
  'Todos tus materiales y video clases están disponibles en tu campus virtual 📚\n🔗 https://we-educacion.com/web/login\n\n¿Necesitas ayuda para acceder?',
  'Botones',
  '• ✅ Ya tengo acceso\n• ❌ No veo materiales',
  'OK → ¿Algo más?\nNo → Reclamo de materiales');

paso(wsMat, '2A', '🤖 Bot',
  '¿Hay algo más en lo que pueda ayudarte? 😊',
  'Botones',
  '• ✅ No, es todo → Cierre\n• 📋 Ver menú → Menú principal',
  'Fin del flujo', C.verde_claro);

paso(wsMat, '2B', '🤖 Bot',
  'Para agilizar tu atención, ¿podrías indicarnos tu nombre completo y el nombre de tu curso?',
  'Texto libre',
  '(alumno escribe sus datos)',
  '→ Transfer a asesor con nota interna', C.rojo_claro);

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 6 — INSTALADORES SAP
// ═════════════════════════════════════════════════════════════════════════════

const wsInst = flowSheet('💻 Instaladores SAP', 'E74C3C');

sectionHeader(wsInst, '💻  FLUJO INSTALADORES — PASO 1: Selección de programa', 7, 'C0392B');
paso(wsInst, 1, '🤖 Bot',
  '¿Qué programa necesitas? 💻',
  'Lista desplegable',
  '• SAP HANA — Acceso, ejecución o instalación\n• SAP R/3 — Acceso o instalación\n• Office 365 — Cuenta de Office\n• Otro problema — Otro software o instalador',
  'Continúa según programa seleccionado');

emptyRow(wsInst);
sectionHeader(wsInst, '🔵  SAP HANA — Problemas', 7, '1A5276');
paso(wsInst, '2H', '🤖 Bot',
  '¿Cuál es tu problema con SAP HANA?',
  'Botones',
  '• 🔑 Clave / Acceso\n• ⏳ Se queda cargando\n• 📥 No pude instalar',
  'Responde según problema');

paso(wsInst, '3H-A', '🤖 Bot',
  'Para ingresar a SAP HANA:\n\n1. Ingresa con contraseña: Clave12345 (la C debe ser mayúscula)\n2. Cuando te pida nueva contraseña, escribe nuevamente: Clave12345\n\n⚠️ Nunca copies y pegues la contraseña, escríbela manualmente\n\n¿Pudiste ingresar?',
  'Botones',
  '• ✅ Sí, ya pude → ¡Excelente! + ¿Algo más?\n• ❌ Sigue el problema → Tipo de laptop → Transfer',
  '→ OK: cierre  /  → No: transfer', C.celeste);

paso(wsInst, '3H-B', '🤖 Bot',
  'SAP HANA no es compatible con laptops o computadoras empresariales.\n\nPor favor intenta desde tu laptop personal siguiendo el manual de instalación en tus materiales del curso.\n\n¿Pudiste ejecutarlo?',
  'Botones',
  '• ✅ Sí, ya pude → ¡Excelente! + ¿Algo más?\n• ❌ Sigue el problema → Tipo de laptop → Transfer',
  '→ OK: cierre  /  → No: transfer', C.celeste);

paso(wsInst, '3H-C', '🤖 Bot',
  'Para agilizar tu atención, ¿usas laptop personal o corporativa?',
  'Botones',
  '• 💻 Personal → Transfer\n• 🏢 Corporativa → Transfer',
  '→ Transfer con nota: tipo de laptop', C.naranja_claro);

emptyRow(wsInst);
sectionHeader(wsInst, '🔵  SAP R/3 — Problemas', 7, '1A5276');
paso(wsInst, '2R', '🤖 Bot',
  '¿Cuál es tu problema con SAP R/3?',
  'Botones',
  '• 🔑 Clave / Acceso\n• ❓ Otro problema',
  'Responde según problema');

paso(wsInst, '3R-A', '🤖 Bot',
  'Para ingresar a SAP R/3:\n\n1. Ingresa con contraseña: Clave12345 (la C debe ser mayúscula)\n2. Cuando te pida nueva contraseña, escribe nuevamente: Clave12345\n\n⚠️ Nunca copies y pegues la contraseña, escríbela manualmente\n\n¿Pudiste ingresar?',
  'Botones',
  '• ✅ Sí, ya pude → ¡Excelente! + ¿Algo más?\n• ❌ Sigue el problema → Tipo de laptop → Transfer',
  '→ OK: cierre  /  → No: transfer', C.celeste);

emptyRow(wsInst);
sectionHeader(wsInst, '🔵  Office 365 y Otros', 7, '1A5276');
paso(wsInst, 'O365', '🤖 Bot',
  'Entendido, un asesor te ayudará con tu cuenta de Office 365 en breve 💙\n\n¿Usas laptop personal o corporativa?',
  'Botones',
  '• 💻 Personal → Transfer\n• 🏢 Corporativa → Transfer',
  '→ Transfer con nota: tipo de laptop', C.gris_fila);

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 7 — TRANSFER A ASESOR
// ═════════════════════════════════════════════════════════════════════════════

const wsTrans = flowSheet('🔄 Transfer a Asesor', 'E67E22');

sectionHeader(wsTrans, '🔄  FLUJO TRANSFER — Lo que ocurre al pasar a un asesor humano', 7, 'A04000');

paso(wsTrans, 1, '🤖 Bot',
  'Entendido 💙 En breve un asesor del equipo académico te atenderá.\n\n⏱️ Tiempo de espera estimado: 15 minutos\nPor favor, mantente atento a este chat.',
  'Texto', '—', 'Bot envía mensaje de espera');

paso(wsTrans, 2, '⚙️ Sistema',
  '[ACCIÓN INTERNA — el alumno no la ve]\n\n• Se crea nota privada en Chatwoot con:\n  - Nombre y correo del alumno\n  - Último tema consultado\n  - Dato adicional (tipo laptop u otros)\n  - Historial del chat con el bot',
  'Nota interna', '—', 'Contexto visible solo para el equipo', C.naranja_claro);

paso(wsTrans, 3, '⚙️ Sistema',
  '[ACCIÓN INTERNA — el alumno no la ve]\n\n• Se asigna etiqueta: transfer-humano\n• Se asigna al equipo según tema:\n  - Académico: Campus, Cert., Materiales, etc.\n  - Soporte: SAP, Office\n• Se asigna agente por defecto',
  'Asignación', '—', 'Conversación lista para asesor humano', C.naranja_claro);

paso(wsTrans, 4, '⚙️ Sistema',
  '[ACCIÓN INTERNA]\nEl bot queda desactivado en esta conversación.\nEl asesor humano toma el control completo.\n\nSi el alumno escribe "menu" o "bot", el bot vuelve a activarse.',
  'Control', '—', 'Estado: en atención humana', C.rojo_claro);

emptyRow(wsTrans);
sectionHeader(wsTrans, '📋  Mapeo de Temas → Equipos Chatwoot', 7, C.azul_medio);
headerRow(wsTrans, ['', 'Tema / Origen', 'Equipo Chatwoot asignado', '', '', '', ''], C.azul_medio);
const equipos = [
  ['Campus Virtual', 'TEAM_ACADEMICO'],
  ['Certificación', 'TEAM_ACADEMICO'],
  ['Justificaciones', 'TEAM_ACADEMICO'],
  ['Alumno Flex', 'TEAM_ACADEMICO'],
  ['Cronograma', 'TEAM_ACADEMICO'],
  ['Exámenes Int.', 'TEAM_ACADEMICO'],
  ['Video Clases', 'TEAM_ACADEMICO'],
  ['Materiales', 'TEAM_ACADEMICO'],
  ['Reclamo Certificado', 'TEAM_ACADEMICO'],
  ['Reclamo Activación', 'TEAM_ACADEMICO'],
  ['Reclamo Materiales', 'TEAM_ACADEMICO'],
  ['Instaladores / SAP', 'TEAM_SOPORTE'],
  ['Office 365', 'TEAM_SOPORTE'],
];
equipos.forEach(([tema, equipo], i) => {
  const bg = equipo === 'TEAM_ACADEMICO' ? C.celeste : C.morado_claro;
  const row = paso(wsTrans, '', '', tema, equipo, '', '', bg);
  row.getCell(2).value = tema;
  row.getCell(3).value = equipo;
  row.getCell(4).value = '';
});

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 8 — CIERRE DE CONVERSACIÓN
// ═════════════════════════════════════════════════════════════════════════════

const wsCierre = flowSheet('✅ Cierre', '27AE60');

sectionHeader(wsCierre, '✅  CIERRE — Cuando el bot resuelve la consulta', 7, C.verde_oscuro);

paso(wsCierre, 1, '🤖 Bot',
  '¿Hay algo más en lo que pueda ayudarte? 😊',
  'Botones',
  '• ✅ No, es todo\n• 📋 Ver menú',
  'Responde según elección del alumno');

paso(wsCierre, '2A', '🤖 Bot',
  '¡Perfecto! Que tengas un buen día 💙',
  'Texto', '—',
  '→ Conversación se cierra automáticamente\n→ Etiqueta: resuelto-bot', C.verde_claro);

paso(wsCierre, '2B', '🤖 Bot',
  'Muestra Menú Principal nuevamente',
  'Botones (menú)', '→ Ver Menú Principal', 'Alumno puede consultar otro tema', C.celeste);

emptyRow(wsCierre);
sectionHeader(wsCierre, '⏰  CIERRE AUTOMÁTICO POR INACTIVIDAD', 7, C.naranja);

paso(wsCierre, 'INACT-1', '⚙️ Sistema',
  'Si el alumno NO responde en 30 minutos después de la pregunta "¿Hay algo más?"',
  'Auto', '—',
  'Bot envía: "¡Que tengas un buen día! 💙 Hasta pronto."\n→ Conversación se cierra\n→ Etiqueta: resuelto-bot', C.naranja_claro);

paso(wsCierre, 'INACT-2', '⚙️ Sistema',
  'Si el alumno NO responde en 60 minutos después de transferirse a un asesor humano',
  'Auto', '—',
  'Bot envía: "¿Sigues ahí? 😊 Si necesitas más ayuda escríbenos cuando quieras 💙"\n→ Etiqueta: inactivo', C.naranja_claro);

paso(wsCierre, 'INACT-3', '⚙️ Sistema',
  'Si el alumno NO responde en 90 minutos después de transferirse a un asesor humano',
  'Auto', '—',
  'Chatwoot envía: "Cerramos la conversación por inactividad. Cuando necesites ayuda, escríbenos 💙"\n→ Conversación se cierra\n→ Etiqueta: resuelto-inactividad', C.rojo_claro);

emptyRow(wsCierre);
sectionHeader(wsCierre, '📨  CIERRE POR EL ASESOR (resolución en Chatwoot)', 7, C.gris_cabecera);

paso(wsCierre, 'ASESOR', '⚙️ Sistema',
  'Cuando el asesor marca la conversación como "Resuelta" en Chatwoot',
  'Automático', '—',
  'Bot intenta enviar:\n"¡Gracias por contactarnos! 😊\nSi necesitas algo más, escríbenos cuando quieras.\n💙 W|E Educación Ejecutiva"\n\n(Si la ventana de 24h de WhatsApp expiró, el mensaje NO se envía pero la sesión sí se limpia)', C.gris_fila);

// ═════════════════════════════════════════════════════════════════════════════
//  HOJA 9 — REGLAS GENERALES
// ═════════════════════════════════════════════════════════════════════════════

const wsReglas = flowSheet('⚙️ Reglas Generales', '7F8C8D');

sectionHeader(wsReglas, '📌  PALABRAS CLAVE ESPECIALES (funcionan en cualquier momento)', 7, C.azul_oscuro);
headerRow(wsReglas, ['', 'Palabra clave', 'Qué hace el bot', '', '', '', ''], C.azul_oscuro);
const keywords = [
  ['menu', 'Muestra el Menú Principal (solo si hay sesión activa)'],
  ['bot',  'Reactiva el bot si estaba en espera de asesor humano → Menú Principal'],
];
keywords.forEach(([kw, efecto], i) => {
  const r = paso(wsReglas, '', kw, efecto, '', '', '', i % 2 === 0 ? C.blanco : C.gris_fila);
  r.getCell(2).value = kw;
  r.getCell(3).value = efecto;
});

emptyRow(wsReglas);
sectionHeader(wsReglas, '🤖  MANEJO DE TEXTO LIBRE (cuando el alumno escribe algo inesperado)', 7, C.azul_medio);
paso(wsReglas, 'L1', '⚙️ Sistema',
  'NIVEL 1 — El bot busca si el texto coincide con algún botón conocido.\nEjemplo: si escribe "Academico" lo reconoce como "📚 Académico".',
  'Auto', '—', 'Ejecuta la acción del botón correspondiente', C.verde_claro);
paso(wsReglas, 'L2', '🤖 Bot (IA)',
  'NIVEL 2 — Si el texto tiene más de 10 caracteres y no coincide con ningún botón, el bot consulta a IA (GPT-4o mini) con información del campus W|E para intentar responder la pregunta.',
  'IA', '—', 'Si la IA responde → muestra respuesta\nSi la IA dice TRANSFER → cuenta un intento\nTras 2 intentos fallidos → ofrece botón "Hablar con asesor"', C.celeste);
paso(wsReglas, 'L3', '🤖 Bot',
  'NIVEL 3 — Fallback: si el texto es muy corto o la IA no pudo resolver, muestra el menú principal.',
  'Texto + Botones', '—', 'Muestra el menú para que el alumno elija', C.naranja_claro);

emptyRow(wsReglas);
sectionHeader(wsReglas, '🏷️  ETIQUETAS CHATWOOT (visibles internamente para el equipo)', 7, C.gris_cabecera);
headerRow(wsReglas, ['', 'Etiqueta', 'Cuándo se aplica', '', '', '', ''], C.gris_cabecera);
const etiquetas = [
  ['bot-activo',          'Cuando el alumno inicia un flujo con el bot'],
  ['resuelto-bot',        'Cuando el alumno confirma que su consulta fue resuelta por el bot'],
  ['transfer-humano',     'Cuando el bot transfiere al asesor humano'],
  ['inactivo',            'Cuando el alumno lleva 60 min sin responder (en atención humana)'],
  ['resuelto-inactividad','Cuando la conversación se cierra automáticamente por 90 min de inactividad'],
  ['reclamo',             'Cuando el alumno reporta un problema que requiere gestión'],
  ['certificados',        'Flujo de certificaciones activo'],
  ['campus-virtual',      'Flujo de campus virtual activo'],
  ['materiales',          'Flujo de materiales activo'],
  ['instaladores',        'Flujo de instaladores activo'],
];
etiquetas.forEach(([etiqueta, cuando], i) => {
  const r = paso(wsReglas, '', etiqueta, cuando, '', '', '', i % 2 === 0 ? C.blanco : C.gris_fila);
  r.getCell(2).value = etiqueta;
  r.getCell(3).value = cuando;
});

// ═════════════════════════════════════════════════════════════════════════════
//  GUARDAR
// ═════════════════════════════════════════════════════════════════════════════

wb.xlsx.writeFile(OUTPUT_FILE).then(() => {
  console.log(`\n✅  Documentación generada exitosamente:`);
  console.log(`    ${OUTPUT_FILE}\n`);
}).catch(err => {
  console.error('❌  Error al generar el archivo:', err);
});
