'use strict';
/** Acceso a PostgreSQL (pg). Todas las consultas son parametrizadas. */
const { Pool } = require('pg');
const { buildPoolConfig } = require('./config');

let pool = null;

function getPool() {
  if (pool) return pool;
  pool = new Pool(buildPoolConfig());
  pool.on('error', (err) => console.error('[db] Error en cliente inactivo del pool:', err.message));
  return pool;
}

// Solo usrname y collector_id. Mas reciente primero ("id DESC" desempata).
const SERVICE_PAYMENT_QUERY = [
  'SELECT ssn, correlativo_collector, prodtype_from, collector_id',
  'FROM sch_services_payments.service_payment',
  'WHERE usrname = $1',
  'AND ($2::text IS NULL OR collector_id = $2)',
  'ORDER BY created DESC, id DESC',
].join(' ');

const str = (v) => (v === null || v === undefined ? null : String(v));

function normalizeRow(row) {
  return {
    ssn: str(row.ssn),
    correlativo_collector: str(row.correlativo_collector),
    prodtype_from: str(row.prodtype_from),
    collector_id: str(row.collector_id),
  };
}

async function getServicePaymentsByUser(usrname, collectorId) {
  const collector = collectorId === undefined || collectorId === null || collectorId === '' ? null : String(collectorId);
  const result = await getPool().query(SERVICE_PAYMENT_QUERY, [usrname, collector]);
  return result.rows.map(normalizeRow);
}

async function getLatestServicePaymentByUser(usrname, collectorId) {
  const rows = await getServicePaymentsByUser(usrname, collectorId);
  return rows.length > 0 ? rows[0] : null;
}

async function ping() {
  await getPool().query('SELECT 1 AS ok');
  return true;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getServicePaymentsByUser, getLatestServicePaymentByUser, ping, closePool, SERVICE_PAYMENT_QUERY };
