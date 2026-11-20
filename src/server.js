'use strict';
/**
 * Servicio HTTP para Maestro (local y BrowserStack).
 *   GET /service-payment?usrname=<user>[&collector_id=<id>][&latest=true]
 *   GET /health
 * Codigos: 200, 400 (falta usrname), 401 (API key), 502 (BD), 500; /health 200 o 503.
 */
const express = require('express');
const { config, validate } = require('./config');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const isProd = () => process.env.NODE_ENV === 'production';

function apiKeyGuard(req, res, next) {
  if (!config.server.apiKey) return next();
  const provided = req.get('x-api-key');
  if (provided && provided === config.server.apiKey) return next();
  return res.status(401).json({ error: 'No autorizado: x-api-key invalido o ausente.' });
}

app.get('/health', async (_req, res) => {
  try {
    await db.ping();
    res.status(200).json({ status: 'ok', database: 'up' });
  } catch (err) {
    const body = { status: 'degraded', database: 'down' };
    if (!isProd()) body.error = err.message;
    res.status(503).json(body);
  }
});

app.get('/service-payment', apiKeyGuard, async (req, res) => {
  const { usrname, collector_id: collectorId } = req.query;
  const latest = req.query.latest === 'true' || req.query.latest === '1';

  if (typeof usrname !== 'string' || usrname.trim() === '') {
    return res.status(400).json({ error: 'Parametro "usrname" es obligatorio. Ej: /service-payment?usrname=jdoe' });
  }
  const collector = typeof collectorId === 'string' && collectorId.trim() !== '' ? collectorId.trim() : undefined;

  try {
    if (latest) {
      return res.status(200).json(await db.getLatestServicePaymentByUser(usrname.trim(), collector));
    }
    return res.status(200).json(await db.getServicePaymentsByUser(usrname.trim(), collector));
  } catch (err) {
    console.error('[service-payment] Error consultando BD:', err.message);
    const body = { error: 'Fallo al consultar la base de datos.' };
    if (!isProd()) body.detail = err.message;
    return res.status(502).json(body);
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[service-payment] Error no controlado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

function start() {
  try {
    validate();
  } catch (err) {
    console.error('[service-payment] Configuracion invalida:', err.message);
    process.exit(1);
  }
  const server = app.listen(config.server.port, config.server.host, () => {
    console.log(`[service-payment] Escuchando en http://${config.server.host}:${config.server.port}`);
  });
  const shutdown = (signal) => {
    console.log(`[service-payment] ${signal} recibido, cerrando...`);
    server.close(async () => {
      try { await db.closePool(); } catch (e) { console.error('[service-payment] Error cerrando pool:', e.message); }
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) start();

module.exports = { app, start };
