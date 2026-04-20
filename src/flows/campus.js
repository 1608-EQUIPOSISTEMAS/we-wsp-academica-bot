const { sendText, sendButtons, sendList, delay } = require('../services/whatsapp');
const { updateSession }                         = require('../services/session');
const { tagFlow, addPrivateNote }               = require('../services/chatwoot');
const { getStudentCronograma }                  = require('../services/database');
const { runTransfer }                           = require('./transfer');
const { showBotResuelto }                       = require('./resuelto');
const { showMenu }                              = require('./menu');

// ── Helpers (compartidos con cronograma) ─────────────────────────────────────
const _cleanVersion = (text) => text ? text.replace(/\s*V[1-7]\b/gi, '').trim() : '';

function _buildRowTitle(p) {
  const name = _cleanVersion(p.program_name || 'Programa');
  const abbr = _cleanVersion(p.abbreviation || '');
  const base = (name.length > 20 && abbr) ? abbr : name;
  return base.length > 24 ? base.slice(0, 21) + '...' : base;
}

function _deduceTipo(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('diplomado'))     return 'Diplomado';
  if (n.includes('especializaci')) return 'Especialización';
  if (n.includes('pee'))           return 'PEE';
  return 'Curso';
}

// ── Entrada principal ────────────────────────────────────────────────────────

async function showCampus(phone, session) {
  updateSession(phone, { estado: 'flow_campus', ultimoTema: 'campus_virtual' });
  tagFlow(phone, ['bot-activo', 'campus-virtual'], 'Campus Virtual');

  await sendButtons(
    phone,
    `¿Con qué te puedo ayudar sobre el Campus Virtual? 🎓`,
    [
      { id: 'campus_ingreso',     title: 'Ingresar al campus' },
      { id: 'campus_programa',    title: 'No veo mi programa' },
      { id: 'campus_desbloqueo',  title: 'Desbloqueo de campus' },
    ]
  );
}

async function handleCampusReply(phone, buttonId, session) {
  if (buttonId === 'campus_ingreso') {
    const usuario = session?.correo || 'tu correo de inscripción';
    await sendText(
      phone,
      `¡Claro! Puedes ingresar al Campus Virtual desde aquí 📚\n\n` +
      `🔗 https://we-educacion.com/web/login\n\n` +
      `En el login encontrarás dos campos:\n` +
      `• *Correo:* ${usuario}\n` +
      `• *Contraseña:* Si es tu primera vez o nunca la cambiaste, suele ser *1234567* o tu número de documento.\n\n` +
      `🔑 Si en algún momento cambiaste tu contraseña, usa esa. Y si no la recuerdas, en la misma página verás el enlace *"¿Olvidaste tu contraseña?"* para restablecerla fácilmente.`
    );
    await delay(1500);
    await sendButtons(
      phone,
      `Tómate tu tiempo. Si no puedes ingresar, avísame y lo resolvemos. 👇`,
      [
        { id: 'mat_ok',         title: '✅ Pude ingresar' },
        { id: 'form_problemas', title: '🆘 Tengo problemas' },
        { id: 'menu_principal', title: '🔙 Menú principal' },
      ]
    );

  } else if (buttonId === 'campus_programa') {
    // Mostrar lista de programas en vivo para que seleccione cuál no ve
    if (!session.studentId) {
      // Sin identificación → transfer directo
      await runTransfer(phone, { ...session, ultimoTema: 'campus_programa' });
      return;
    }

    let programs = [];
    try {
      programs = await getStudentCronograma(session.studentId);
    } catch (err) {
      console.error('[campus] Error consultando programas:', err.message);
    }

    if (!programs || programs.length === 0) {
      if (session.conversationId) {
        addPrivateNote(session.conversationId,
          `⚠️ *Campus Virtual:* El alumno no encuentra su programa. No tiene programas En Vivo/Presencial activos.`
        ).catch(() => {});
      }
      await sendText(phone,
        `No encontramos programas presenciales o en vivo activos en tu cuenta.\n` +
        `Un asesor revisará tu caso para ayudarte 💙`
      );
      return runTransfer(phone, { ...session, ultimoTema: 'campus_programa' });
    }

    const display = programs.slice(0, 10);
    updateSession(phone, {
      estado: 'flow_campus_programa',
      campusProgramOptions: display.map(p => ({
        ...p,
        renderedTitle: _buildRowTitle(p),
      })),
    });

    const sections = [{
      title: 'Mis Programas',
      rows: display.map(p => ({
        id:          `campus_prog_${p.program_edition_id}`,
        title:       _buildRowTitle(p),
        description: p.program_type || _deduceTipo(p.program_name),
      })),
    }];

    await sendList(
      phone,
      'Campus Virtual',
      '¿Cuál es el programa que no ves en tu Campus Virtual? 👇',
      'Selecciona el programa para reportarlo.',
      '📋 Ver mis programas',
      sections
    );
    return;

  } else if (buttonId === 'campus_desbloqueo') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Campus Virtual:* El alumno solicita desbloqueo de campus — derivar a Finanzas.`
      ).catch(err => console.error('[bot] Error nota privada campus:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'campus_desbloqueo' });

  } else if (buttonId === 'mat_ok') {
    tagFlow(phone, ['resuelto-bot', 'campus-virtual']);
    await showBotResuelto(phone);

  } else if (buttonId === 'form_problemas') {
    if (session.conversationId) {
      addPrivateNote(
        session.conversationId,
        `⚠️ *Campus Virtual:* El alumno reporta problemas de acceso al campus virtual.`
      ).catch(err => console.error('[bot] Error nota privada campus:', err));
    }
    await runTransfer(phone, { ...session, ultimoTema: 'campus_virtual' });

  } else if (buttonId === 'menu_principal') {
    updateSession(phone, { estado: 'menu' });
    await showMenu(phone, session.nombre);
  }
}

// ── Selección de programa que no ve en campus ────────────────────────────────

async function handleCampusProgramaReply(phone, idOrText, session) {
  const programs = session.campusProgramOptions || [];

  let program;
  if (idOrText && idOrText.startsWith('campus_prog_')) {
    const editionId = parseInt(idOrText.replace('campus_prog_', ''), 10);
    program = programs.find(p => Number(p.program_edition_id) === editionId);
  } else {
    // Chatwoot puede enviar el título renderizado como texto
    const input = (idOrText || '').trim().toUpperCase();
    program = programs.find(p => (p.renderedTitle || '').toUpperCase() === input);
  }

  if (!program) {
    await sendText(phone, '⚠️ No pude identificar ese programa. Por favor selecciona uno de la lista.');
    return;
  }

  const nombre = _cleanVersion(program.program_name || 'Programa');

  if (session.conversationId) {
    addPrivateNote(
      session.conversationId,
      `⚠️ *Campus Virtual:* El alumno no encuentra el programa *${nombre}* (edition_id: ${program.program_edition_id}) en su campus virtual.`
    ).catch(err => console.error('[campus] Error nota privada:', err.message));
  }

  await sendText(phone,
    `Entendido, voy a derivarte con un asesor para revisar tu acceso al programa *${nombre}* en el Campus Virtual 💙`
  );
  return runTransfer(phone, { ...session, ultimoTema: 'campus_programa' },
    `El alumno no encuentra el programa "${nombre}" (edition_id: ${program.program_edition_id}) en su campus virtual.`
  );
}

module.exports = { showCampus, handleCampusReply, handleCampusProgramaReply };
