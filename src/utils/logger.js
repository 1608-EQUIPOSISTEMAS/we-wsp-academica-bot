'use strict';

/**
 * Logger JSON minimalista para Docker.
 *
 * Salida: una línea JSON por evento → docker logs la captura directamente.
 * ERROR y WARN → stderr  (filtrable con: docker logs 2>&1 | grep '"lvl":"ERROR"')
 * INFO y DEBUG → stdout
 *
 * Uso:
 *   const log = require('../utils/logger');
 *   log.info('server',  'Bot arrancado', { port: 3006 });
 *   log.error('bot',    'Error inesperado', { phone, error: err.message });
 *   log.debug('session','Session lookup', { phone, estado });   // suprimido en prod
 */

const IS_PROD = process.env.NODE_ENV === 'production';

function write(level, mod, msg, ctx) {
  const entry = JSON.stringify({
    ts:  new Date().toISOString(),
    lvl: level,
    mod,
    msg,
    ...(ctx || {}),
  });

  if (level === 'ERROR' || level === 'WARN') {
    process.stderr.write(entry + '\n');
  } else {
    process.stdout.write(entry + '\n');
  }
}

module.exports = {
  info:  (mod, msg, ctx) => write('INFO',  mod, msg, ctx),
  warn:  (mod, msg, ctx) => write('WARN',  mod, msg, ctx),
  error: (mod, msg, ctx) => write('ERROR', mod, msg, ctx),
  /** Solo emite en NODE_ENV !== 'production' */
  debug: (mod, msg, ctx) => { if (!IS_PROD) write('DEBUG', mod, msg, ctx); },
};
