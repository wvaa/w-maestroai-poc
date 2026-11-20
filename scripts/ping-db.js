'use strict';
/** Verifica conectividad con PostgreSQL. No imprime credenciales. */
const { validate } = require('../src/config');
const db = require('../src/db');

(async () => {
  try {
    validate();
    await db.ping();
    console.log('[ping-db] Conexion OK');
    await db.closePool();
  } catch (err) {
    console.error('[ping-db] Fallo:', err.message);
    console.error('Revisa la VPN y las variables de entorno PG*.');
    process.exit(1);
  }
})();
