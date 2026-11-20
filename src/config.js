'use strict';
/** Configuracion del servicio solo desde variables de entorno (sin secretos en codigo). */
require('dotenv').config();

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : String(v);
}

function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isNaN(n) ? fallback : n;
}

const config = {
  server: {
    port: envInt('PORT', 3000),
    host: env('HOST', '0.0.0.0'),
    apiKey: env('API_KEY', ''),
  },
  postgres: {
    host: env('PGHOST'),
    port: envInt('PGPORT', 5432),
    database: env('PGDATABASE'),
    user: env('PGUSER'),
    password: env('PGPASSWORD'),
    connectionTimeout: envInt('PG_CONNECTION_TIMEOUT', 15),
    queryTimeout: envInt('PG_QUERY_TIMEOUT', 30),
    poolMax: envInt('PG_POOL_MAX', 10),
    ssl: env('PGSSLMODE'),
    sslRootCert: env('PGSSLROOTCERT'),
    connectionString: env('DATABASE_URL'),
  },
};

function resolveSsl() {
  const mode = config.postgres.ssl.toLowerCase();
  if (mode === '' || mode === 'disable' || mode === 'false') return undefined;
  if (config.postgres.sslRootCert) {
    return {
      rejectUnauthorized: true,
      ca: require('node:fs').readFileSync(config.postgres.sslRootCert, 'utf8'),
    };
  }
  if (mode === 'no-verify' || mode === 'require-no-verify') {
    return { rejectUnauthorized: false };
  }
  return true;
}

function buildPoolConfig() {
  const p = config.postgres;
  const base = {
    max: p.poolMax,
    connectionTimeoutMillis: p.connectionTimeout * 1000,
    query_timeout: p.queryTimeout * 1000,
    ssl: resolveSsl(),
  };
  if (p.connectionString) return { ...base, connectionString: p.connectionString };
  return { ...base, host: p.host, port: p.port, database: p.database, user: p.user, password: p.password };
}

function validate() {
  const p = config.postgres;
  if (p.connectionString) return;
  const missing = [];
  if (!p.host) missing.push('PGHOST');
  if (!p.database) missing.push('PGDATABASE');
  if (!p.user) missing.push('PGUSER');
  if (!p.password) missing.push('PGPASSWORD');
  if (missing.length > 0) {
    throw new Error(`Configuracion de PostgreSQL incompleta. Faltan: ${missing.join(', ')} (o define DATABASE_URL).`);
  }
}

module.exports = { config, buildPoolConfig, validate };
