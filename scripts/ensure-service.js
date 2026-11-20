'use strict';
/**
 * Arranca el servicio HTTP solo si no esta corriendo.
 *   node scripts/ensure-service.js          -> asegura que este arriba
 *   node scripts/ensure-service.js --stop   -> lo detiene (si lo levanto este script)
 *   node scripts/ensure-service.js --once -- <comando> [args]
 *       -> levanta el servicio, ejecuta el comando y lo apaga al terminar
 *          (solo si lo levanto este script; si ya estaba corriendo, lo deja).
 *          Devuelve el codigo de salida del comando.
 * Deja el proceso desacoplado; pid y log en artifacts/service/.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { config, validate } = require('../src/config');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'artifacts', 'service');
const pidFile = path.join(dir, 'service.pid');
const logFile = path.join(dir, 'service.log');
const host = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host;
const baseUrl = `http://${host}:${config.server.port}`;

/** Cualquier respuesta HTTP (incluso 503 por BD caida) significa que el servidor esta arriba. */
async function isUp() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function stop() {
  if (!fs.existsSync(pidFile)) return console.log('[service] No hay PID registrado; nada que detener.');
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  try {
    process.kill(pid);
    console.log(`[service] Detenido (PID ${pid}).`);
  } catch {
    console.log('[service] El proceso ya no existia.');
  }
  fs.rmSync(pidFile, { force: true });
}

async function ensure() {
  if (await isUp()) {
    console.log(`[service] Ya esta corriendo en ${baseUrl}`);
    return false;
  }
  validate();
  fs.mkdirSync(dir, { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  for (let i = 0; i < 30; i++) {
    if (await isUp()) {
      console.log(`[service] Iniciado en ${baseUrl} (PID ${child.pid})`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`No respondio en 15 s. Revisa ${path.relative(root, logFile)}`);
}

/** Levanta el servicio, corre el comando y apaga el servicio si lo levanto este script. */
async function once(cmd) {
  if (cmd.length === 0) throw new Error('Uso: --once -- <comando> [args]');
  const started = await ensure();
  let code = 1;
  try {
    code = await new Promise((resolve) => {
      // En Windows se pasa la linea completa al shell (permite .cmd como npm.cmd).
      const win = process.platform === 'win32';
      const child = spawn(win ? cmd.join(' ') : cmd[0], win ? [] : cmd.slice(1), {
        cwd: root,
        stdio: 'inherit',
        shell: win,
        env: { ...process.env, SERVICE_URL: baseUrl },
      });
      child.on('error', (e) => {
        console.error('[service] No se pudo ejecutar el comando:', e.message);
        resolve(1);
      });
      child.on('exit', (c, sig) => resolve(c === null ? (sig ? 1 : 0) : c));
    });
  } finally {
    if (started) await stop();
  }
  process.exit(code);
}

const args = process.argv.slice(2);
const sep = args.indexOf('--');
const task = args.includes('--once')
  ? once(sep >= 0 ? args.slice(sep + 1) : [])
  : args.includes('--stop')
    ? stop()
    : ensure();

task.catch((err) => {
  console.error('[service] Fallo:', err.message);
  process.exit(1);
});
