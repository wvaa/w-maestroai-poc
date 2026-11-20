/**
 * run-maestro-browserstack.js
 * Ejecuta flows de Maestro en BrowserStack App Automate via API REST v2.
 * Flujo:
 *   1. Empaqueta flows/ en un ZIP
 *   2. Sube el ZIP como test suite
 *   3. Lanza el build con app y dispositivos configurados
 *   4. Espera a que el build termine (polling)
 *   5. Obtiene detalles de cada sesión y testcase
 *   6. Descarga screenshots (ZIP) y los extrae en artifacts/
 *   7. Guarda result.json en artifacts/ para el reporte HTML
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const FormData = require('form-data');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const env = process.env;

// ── Run target: 'cloud' (BrowserStack API) or 'local' (ADB/emulator) ───────────
const runTarget = (env.RUN_TARGET || 'cloud').toLowerCase();

function ensureEnv(keys) {
  for (const k of keys) {
    if (!env[k]) {
      console.error(`Falta la variable de entorno ${k}. Rellena .env`);
      process.exit(1);
    }
  }
}

/**
 * Carga la configuración de shards desde .env para ejecución paralela en BrowserStack.
 * Retorna null si no hay shards configurados (ejecución en un solo dispositivo).
 *
 * Variables .env requeridas para shards:
 *   BROWSERSTACK_SHARDS_COUNT=3
 *   BROWSERSTACK_SHARDS_DEVICE_SELECTION=any
 *   BROWSERSTACK_SHARD_1_NAME=Thread 1
 *   BROWSERSTACK_SHARD_1_INCLUDE_TAGS=tag1
 *   BROWSERSTACK_SHARD_1_EXCLUDE_TAGS=smoke-test
 *   BROWSERSTACK_SHARD_1_EXECUTE=flows/test1.yaml,flows/test2.yaml
 *   BROWSERSTACK_SHARD_2_NAME=Thread 2
 *   ...
 */
function loadShardsConfig() {
  const shardCount = parseInt(env.BROWSERSTACK_SHARDS_COUNT || '0', 10);
  if (!shardCount || shardCount < 1) return null;

  const deviceSelection = env.BROWSERSTACK_SHARDS_DEVICE_SELECTION || 'any';
  const mapping = [];

  for (let i = 1; i <= shardCount; i++) {
    const name = env[`BROWSERSTACK_SHARD_${i}_NAME`] || `Thread ${i}`;
    const includeTags = (env[`BROWSERSTACK_SHARD_${i}_INCLUDE_TAGS`] || '').split(',').map(t => t.trim()).filter(Boolean);
    const excludeTags = (env[`BROWSERSTACK_SHARD_${i}_EXCLUDE_TAGS`] || '').split(',').map(t => t.trim()).filter(Boolean);
    const execute = (env[`BROWSERSTACK_SHARD_${i}_EXECUTE`] || '').split(',').map(t => t.trim()).filter(Boolean);

    const shard = { name, values: {} };

    if (includeTags.length > 0 || excludeTags.length > 0) {
      shard.values.tags = {};
      if (includeTags.length > 0) shard.values.tags.includeTags = includeTags;
      if (excludeTags.length > 0) shard.values.tags.excludeTags = excludeTags;
    }

    if (execute.length > 0) {
      shard.values.execute = execute;
    }

    mapping.push(shard);
  }

  return {
    numberOfShards: shardCount,
    deviceSelection: deviceSelection,
    mapping: mapping
  };
}

function listLocalScreenshots() {
  const root = process.cwd();
  const results = [];

  function walk(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        const skip = ['artifacts', 'reports', 'node_modules', '.git'].includes(item.name);
        if (!skip) walk(fullPath);
        continue;
      }
      if (/\.(png|jpe?g)$/i.test(item.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(root);
  return results;
}

// Variables y endpoints para BrowserStack Cloud
const BS_USER  = env.BROWSERSTACK_USERNAME;
const BS_KEY   = env.BROWSERSTACK_ACCESS_KEY;
const APP_ID   = env.BROWSERSTACK_APP_ID;
const DEVICE   = env.BROWSERSTACK_DEVICE   || 'Google Pixel 6';
const OS_VER   = env.BROWSERSTACK_OS_VERSION || '13.0';
const PROJECT  = env.BROWSERSTACK_PROJECT  || 'Maestro_Test';
const BASE_V2  = 'https://api-cloud.browserstack.com/app-automate/maestro/v2';
const BASE_API = 'https://api.browserstack.com/app-automate/maestro';
const AUTH     = BS_USER && BS_KEY ? ('Basic ' + Buffer.from(`${BS_USER}:${BS_KEY}`).toString('base64')) : null;

const artifactsBase = path.resolve(process.cwd(), 'artifacts');
if (!fs.existsSync(artifactsBase)) fs.mkdirSync(artifactsBase, { recursive: true });

const localArtifactsBase = env.LOCAL_ARTIFACTS_PATH
  ? path.resolve(process.cwd(), env.LOCAL_ARTIFACTS_PATH)
  : artifactsBase;
if (!fs.existsSync(localArtifactsBase)) fs.mkdirSync(localArtifactsBase, { recursive: true });

// Generar suite de tests dinámicamente escaneando los archivos YAML en flows/
let testSuite = [];
const testSuitePath = path.resolve(process.cwd(), 'tests', 'test-suite.json');

function buildTestSuiteFromFlows() {
  const flowsDir = path.resolve(process.cwd(), 'flows');
  if (!fs.existsSync(flowsDir)) {
    console.error('No se encontró la carpeta flows/');
    process.exit(1);
  }

  // Solo flows/tests/** contiene casos de prueba (igual que flows/config.yaml).
  // screens/, subflows/ y data/ son componentes reutilizables, no tests.
  const testsRoot = path.join(flowsDir, 'tests');
  if (!fs.existsSync(testsRoot)) {
    console.warn('⚠ No se encontró flows/tests/ — la suite queda vacía.');
    return [];
  }

  // Recorre flows/tests/ de forma recursiva (smoke/, regression/, e2e/, ...)
  function collectYamlFiles(dir) {
    const found = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        found.push(...collectYamlFiles(fullPath));
      } else if (item.isFile() && /\.ya?ml$/i.test(item.name)) {
        found.push(fullPath);
      }
    }
    return found;
  }

  const suite = [];
  // Rutas relativas a la raíz del proyecto con '/' para que sean estables en Windows
  const files = collectYamlFiles(testsRoot)
    .map(f => path.relative(process.cwd(), f).split(path.sep).join('/'))
    .sort();

  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file);
    const content = fs.readFileSync(filePath, 'utf8');
    const header = content.split(/^---$/m)[0];

    const nameMatch = header.match(/^name:\s*["']?(.+?)["']?\s*$/m);
    const appIdMatch = header.match(/^appId:\s*["']?(.+?)["']?\s*$/m);

    const name = nameMatch ? nameMatch[1].trim() : path.basename(file).replace(/\.ya?ml$/i, '');
    const appId = appIdMatch ? appIdMatch[1].trim() : (env.APP_PACKAGE || '');

    suite.push({
      name: name,
      flow: file,
      appId: appId
    });
  }

  return suite;
}

testSuite = buildTestSuiteFromFlows();

const testsDir = path.dirname(testSuitePath);
if (!fs.existsSync(testsDir)) fs.mkdirSync(testsDir, { recursive: true });
fs.writeFileSync(testSuitePath, JSON.stringify(testSuite, null, 2));
console.log(`✓ Test suite generada: ${testSuite.length} tests encontrados en flows/`);

// ── Variables de entorno para los flows ───────────────────────────────────────
// Maestro no lee el .env: las variables ${VAR} de los YAML deben pasarse
// explícitamente (-e en local, setEnvVariables en BrowserStack).
// Solo se envían las variables que los flows referencian y que tienen valor en .env,
// para no exponer el resto del entorno (p. ej. credenciales de BrowserStack).
const NEVER_FORWARD_VARS = new Set(['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY']);

function collectFlowEnvVars() {
  const flowsDir = path.resolve(process.cwd(), 'flows');
  const referenced = new Set();

  (function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) { walk(fullPath); continue; }
      if (!/\.ya?ml$/i.test(item.name)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      // Solo identificadores simples ${NOMBRE}; ignora expresiones JS como ${ACTION == 'X'}
      for (const m of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) referenced.add(m[1]);
    }
  })(flowsDir);

  const vars = {};
  const missing = [];
  for (const name of [...referenced].sort()) {
    if (NEVER_FORWARD_VARS.has(name)) continue;
    const value = env[name];
    if (value !== undefined && value !== '') vars[name] = value;
    else missing.push(name);
  }

  const passed = Object.keys(vars);
  if (passed.length > 0) console.log(`✓ Variables para los flows: ${passed.join(', ')}`);
  // Pueden ser variables que se definen vía runFlow env: dentro de los propios flows
  if (missing.length > 0) console.log(`ℹ Variables referenciadas sin valor en .env: ${missing.join(', ')}`);
  return vars;
}

const flowEnvVars = collectFlowEnvVars();

// Argumentos -e KEY=VALUE para `maestro test`
function buildMaestroEnvArgs() {
  const args = [];
  for (const [k, v] of Object.entries(flowEnvVars)) args.push('-e', `${k}=${v}`);
  return args;
}

/**
 * Prepara el comando para spawn/spawnSync.
 * En Windows, maestro.bat se ejecuta vía cmd.exe; cada argumento se entrecomilla
 * para que caracteres como & | < > ^ en los valores (p. ej. contraseñas) no sean
 * interpretados por cmd. maestro.bat reenvía los argumentos con %* a Java.
 */
function buildMaestroSpawn(MAESTRO_CMD, args) {
  if (!/\.(bat|cmd)$/i.test(MAESTRO_CMD)) {
    return { cmd: MAESTRO_CMD, cmdArgs: args, extraOpts: {} };
  }
  for (const [k, v] of Object.entries(flowEnvVars)) {
    if (/["%]/.test(v)) {
      console.warn(`⚠ El valor de ${k} contiene " o %; en Windows puede no llegar intacto a Maestro.`);
    }
  }
  const quote = a => `"${String(a).replace(/"/g, '""')}"`;
  const line = [MAESTRO_CMD, ...args].map(quote).join(' ');
  return {
    cmd: 'cmd.exe',
    cmdArgs: ['/d', '/s', '/c', `"${line}"`],
    extraOpts: { windowsVerbatimArguments: true }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function findLatestMaestroSessionDir(runStartTime) {
  const root = path.join(os.homedir(), '.maestro', 'tests');
  if (!fs.existsSync(root)) return null;

  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => {
      const dirPath = path.join(root, item.name);
      const stats = fs.statSync(dirPath);
      const files = fs.readdirSync(dirPath);
      const hasScreenshot = files.some(name => /\.(png|jpe?g)$/i.test(name));
      return {
        path: dirPath,
        mtime: stats.mtime.getTime(),
        hasScreenshot
      };
    })
    .filter(c => c.hasScreenshot)
    .sort((a, b) => b.mtime - a.mtime);

  if (candidates.length === 0) return null;

  const fromCurrentRun = candidates.find(dir => dir.mtime >= runStartTime);
  return fromCurrentRun ? fromCurrentRun.path : null;
}

function extractAssertionDetail(message) {
  if (!message) return null;
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  const assertThat = lines.find(line => /Assert that\s+"[^"]*".*?is visible\s+FAILED/i.test(line));
  if (assertThat) {
    const m = assertThat.match(/Assert that\s+"[^"]*".*?is visible\s+FAILED/i);
    return m ? m[0] : assertThat;
  }

  const exactAssertion = lines.find(line => /^Assertion is false:.*$/i.test(line));
  if (exactAssertion) return exactAssertion;

  const exactFailed = lines.find(line => /^Assertion .* failed\.?$/i.test(line) || /Assertion ["'].*["'] failed\.?/i.test(line));
  if (exactFailed) return exactFailed;

  const containsAssertion = lines.find(line => /Assertion is false/i.test(line));
  if (containsAssertion) return containsAssertion;

  const failedLines = lines.filter(line => /FAILED/i.test(line) || /✗/.test(line));
  if (failedLines.length > 0) {
    const realErrors = failedLines.filter(line => !/Run\s+\S+\.ya?ml/i.test(line));
    if (realErrors.length > 0) return realErrors[realErrors.length - 1];
    return failedLines[failedLines.length - 1];
  }

  const elementError = lines.find(line => /Element not found|Timeout|timed out/i.test(line));
  if (elementError) return elementError;

  const assertLines = lines.filter(line => /assert|expect|assertion/i.test(line));
  if (assertLines.length > 0) return assertLines.slice(0, 2).join('\n');

  return lines.slice(0, 2).join('\n');
}

async function apiGet(url) {
  const res = await fetch(url, { headers: { Authorization: AUTH, 'Content-Type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}: ${text.substring(0, 300)}`);
  return JSON.parse(text);
}

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { Authorization: AUTH } });
  if (!res.ok) return null;
  return res.buffer();
}

// ── Paso 1: Empaquetar flows en ZIP ───────────────────────────────────────────
function buildFlowsZip() {
  const flowsDir = path.resolve(process.cwd(), 'flows');

  if (!fs.existsSync(flowsDir)) throw new Error(`No se encontró la carpeta flows/`);

  function fixLineEndings(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        fixLineEndings(fullPath);
      } else if (/\.ya?ml$/i.test(item.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const fixed = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (content !== fixed) fs.writeFileSync(fullPath, fixed, 'utf8');
      }
    }
  }
  fixLineEndings(flowsDir);

  const zip = new AdmZip();
  // Excluye .gitkeep: BrowserStack rechaza la suite si contiene archivos que no son YAML
  zip.addLocalFolder(flowsDir, 'flows', (filename) => path.basename(filename) !== '.gitkeep');

  const yamlEntries = zip.getEntries().filter(e => !e.isDirectory && /\.ya?ml$/i.test(e.entryName));
  if (yamlEntries.length === 0) throw new Error('No hay archivos YAML en flows/');

  const zipPath = path.join(artifactsBase, 'flows.zip');
  zip.writeZip(zipPath);
  console.log(`✓ ZIP creado: ${zipPath} (${yamlEntries.length} archivos YAML)`);

  zip.getEntries().forEach(e => {
    if (!e.isDirectory) console.log(`   → ${e.entryName}`);
  });

  return zipPath;
}

// ── Paso 2: Subir test suite ──────────────────────────────────────────────────
async function uploadTestSuite(zipPath) {
  console.log('\n📤 Subiendo test suite a BrowserStack...');
  const form = new FormData();
  form.append('file', fs.createReadStream(zipPath), { filename: 'flows.zip', contentType: 'application/zip' });

  const res = await fetch(`${BASE_V2}/test-suite`, {
    method: 'POST',
    headers: { Authorization: AUTH, ...form.getHeaders() },
    body: form
  });

  const rawText = await res.text();
  let body;
  try { body = JSON.parse(rawText); } catch (e) {
    throw new Error(`Upload test suite → HTTP ${res.status}\n${rawText.substring(0, 500)}`);
  }
  if (!res.ok) throw new Error(`Upload test suite falló (HTTP ${res.status}): ${JSON.stringify(body)}`);

  const suiteId = body.test_suite_url || body.test_suite_id || body.id;
  if (!suiteId) throw new Error(`Respuesta inesperada al subir suite: ${JSON.stringify(body)}`);

  console.log(`✓ Test suite subida: ${suiteId}`);
  return suiteId;
}

// ── Paso 3: Lanzar build ──────────────────────────────────────────────────────
async function launchBuild(testSuiteId) {
  console.log('\n🚀 Lanzando build en BrowserStack App Automate...');

  const shardsConfig = loadShardsConfig();
  let devices;
  if (shardsConfig) {
    const devicesEnv = (env.BROWSERSTACK_DEVICES || '').trim();
    if (devicesEnv) {
      devices = devicesEnv.split('|').map(d => d.trim()).filter(Boolean);
    } else {
      devices = [`${DEVICE}-${OS_VER}`];
    }
  } else {
    devices = [`${DEVICE}-${OS_VER}`];
  }

  const payload = {
    app: APP_ID,
    testSuite: testSuiteId,
    project: PROJECT,
    devices: devices
  };

  const bsLocal = (env.BROWSERSTACK_LOCAL || '').toLowerCase();
  if (bsLocal === 'true') {
    payload.local = true;
    console.log(`   Local tunnel: habilitado`);
  }

  if (env.BROWSERSTACK_BUILD_NAME) payload.customBuildName = env.BROWSERSTACK_BUILD_NAME;
  if (env.BROWSERSTACK_NETWORK_LOGS) payload.networkLogs = env.BROWSERSTACK_NETWORK_LOGS.toLowerCase() === 'true';
  if (env.BROWSERSTACK_DEVICE_LOGS) payload.deviceLogs = env.BROWSERSTACK_DEVICE_LOGS.toLowerCase() === 'true';
  if (env.BROWSERSTACK_DEBUG) payload.debug = env.BROWSERSTACK_DEBUG.toLowerCase() === 'true';
  if (env.BROWSERSTACK_LANGUAGE) payload.language = env.BROWSERSTACK_LANGUAGE;
  if (env.BROWSERSTACK_LOCALE) payload.locale = env.BROWSERSTACK_LOCALE;

  // Variables ${VAR} de los flows. Nota: BrowserStack las muestra sin enmascarar en su dashboard.
  if (Object.keys(flowEnvVars).length > 0) {
    payload.setEnvVariables = { ...flowEnvVars };
    console.log(`   Variables de entorno: ${Object.keys(flowEnvVars).join(', ')}`);
  }

  if (shardsConfig) {
    payload.shards = shardsConfig;
    console.log(`   Shards: ${shardsConfig.numberOfShards} threads en paralelo`);
  } else {
    if (env.BROWSERSTACK_TAGS) {
      const tagsList = env.BROWSERSTACK_TAGS.split(',').map(t => t.trim()).filter(Boolean);
      if (tagsList.length > 0) payload.tags = { includeTags: tagsList };
    }
  }

  console.log(`   Dispositivo(s): ${devices.join(', ')}`);
  console.log(`   App: ${APP_ID}`);

  const res = await fetch(`${BASE_V2}/android/build`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const rawText = await res.text();
  let body;
  try { body = JSON.parse(rawText); } catch (e) {
    throw new Error(`Launch build → HTTP ${res.status}\n${rawText.substring(0, 500)}`);
  }
  if (!res.ok) throw new Error(`Launch build falló (HTTP ${res.status}): ${JSON.stringify(body)}`);

  const buildId = body.build_id || body.id;
  if (!buildId) throw new Error(`Respuesta inesperada al lanzar build: ${JSON.stringify(body)}`);

  console.log(`✓ Build lanzado: ${buildId}`);
  return buildId;
}

// ── Paso 4: Esperar resultado (polling) ───────────────────────────────────────
async function waitForBuild(buildId) {
  console.log('\n⏳ Esperando resultados del build...');
  const maxWait = 60 * 60 * 1000;
  const interval = 15 * 1000;
  const start = Date.now();
  const terminal = ['passed', 'failed', 'error', 'timeout', 'done', 'completed', 'canceled'];

  while (Date.now() - start < maxWait) {
    const data = await apiGet(`${BASE_V2}/builds/${buildId}`);
    const status = (data.status || '').toLowerCase();
    process.stdout.write(`   Estado: ${status} (${Math.round((Date.now() - start) / 1000)}s)\r`);

    if (terminal.includes(status)) {
      console.log(`\n✓ Build finalizado: ${status}`);
      return data;
    }
    await sleep(interval);
  }
  throw new Error('Timeout esperando el build (60 min)');
}

// ── Paso 5 & 6: Obtener detalles de sesión y descargar evidencias ─────────────
async function downloadEvidences(buildId, buildData) {
  console.log('\n📥 Descargando evidencias...');

  const devices = buildData.devices || [];
  const results = [];

  for (const deviceEntry of devices) {
    const deviceName = deviceEntry.device || DEVICE;
    const sessions = deviceEntry.sessions || [];

    for (const session of sessions) {
      const sessionId = session.id;
      const sessionStatus = (session.status || 'unknown').toLowerCase();
      const dirName = `${deviceName}_${sessionId.substring(0, 8)}`.replace(/[^a-zA-Z0-9-_]/g, '_');
      const sessionDir = path.join(artifactsBase, dirName);
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

      let sessionDetail = null;
      try {
        sessionDetail = await apiGet(`${BASE_V2}/builds/${buildId}/sessions/${sessionId}`);
      } catch (e) {
        console.warn(`   ⚠ No se pudieron obtener detalles de sesión ${sessionId}: ${e.message}`);
      }

      const testcases = [];
      if (sessionDetail && sessionDetail.testcases && sessionDetail.testcases.data) {
        for (const group of sessionDetail.testcases.data) {
          for (const tc of (group.testcases || [])) {
            testcases.push(tc);
          }
        }
      }

      const tcScreenshots = {};
      for (let i = 0; i < testcases.length; i++) {
        tcScreenshots[i] = [];
        const tc = testcases[i];
        const screenshotsUrl = tc.screenshots;

        if (screenshotsUrl) {
          let buf = null;
          for (let attempt = 0; attempt < 3 && !buf; attempt++) {
            try {
              if (attempt > 0) await sleep(3000);
              buf = await downloadBuffer(screenshotsUrl);
            } catch (e) {
              console.warn(`   ⚠ Intento ${attempt + 1}/3 falló para screenshots tc${i + 1}: ${e.message}`);
            }
          }

          if (buf) {
            try {
              const ssZip = new AdmZip(buf);
              const entries = ssZip.getEntries();
              for (const entry of entries) {
                if (!entry.isDirectory && /\.(png|jpg|jpeg)$/i.test(entry.entryName)) {
                  const ext = path.extname(entry.entryName);
                  let baseName = entry.entryName.replace(/[^a-zA-Z0-9._-]/g, '_');
                  baseName = baseName.replace(ext, '');
                  if (baseName.length > 80) baseName = baseName.substring(0, 80);
                  const ssName = `tc${i + 1}_${baseName}${ext}`;
                  const ssPath = path.join(sessionDir, ssName);
                  fs.writeFileSync(ssPath, entry.getData());
                  tcScreenshots[i].push(ssName);
                }
              }
              console.log(`   ✓ Screenshots descargadas para testcase ${i + 1}`);
            } catch (e) {
              console.warn(`   ⚠ Error procesando ZIP de screenshots tc${i + 1}: ${e.message}`);
            }
          }
        }
      }

      const videoUrl = testcases.length > 0 ? testcases[0].video : null;

      let assertionMessage = null;
      for (const tc of testcases) {
        if (!tc) continue;
        const candidates = [tc.error, tc.message, tc.logs, tc.stack].filter(Boolean);
        for (const c of candidates) {
          if (typeof c !== 'string') continue;
          const patterns = [
            /Assert that\s+"[^"]*"\s+is visible[^\n]*/i,
            /Assertion is false:[^\n]*/i,
            /Element not found[^\n]*/i,
          ];
          for (const pat of patterns) {
            const m = c.match(pat);
            if (m) { assertionMessage = m[0].trim(); break; }
          }
          if (assertionMessage) break;
        }
        if (assertionMessage) break;
      }

      for (let i = 0; i < testcases.length; i++) {
        const tc = testcases[i];
        const tcStatus = (tc.status || sessionStatus).toLowerCase();

        const bsTcName = (tc.name || tc.test_name || '').trim();
        const matchedSuiteTest = testSuite.find(t => {
          if (!t.flow) return false;
          const flowFile = path.basename(t.flow);
          const flowName = flowFile.replace(/\.ya?ml$/i, '');
          return bsTcName === flowFile
            || bsTcName === flowName
            || bsTcName.toLowerCase().includes(flowName.toLowerCase())
            || flowName.toLowerCase().includes(bsTcName.toLowerCase());
        }) || testSuite[i] || null;

        const suiteName = matchedSuiteTest ? matchedSuiteTest.name : null;
        const suiteFlow = matchedSuiteTest ? matchedSuiteTest.flow : null;
        const tcName = suiteName || bsTcName || `Test ${i + 1}`;
        let tcDirBase = tcName.replace(/[^a-zA-Z0-9-_]/g, '_');
        if (tcDirBase.length > 80) tcDirBase = tcDirBase.substring(0, 80);
        const tcDirName = `${tcDirBase}_${sessionId.substring(0, 8)}_tc${i + 1}`;
        const tcDir = path.join(artifactsBase, tcDirName);
        if (!fs.existsSync(tcDir)) fs.mkdirSync(tcDir, { recursive: true });

        let tcSS = tcScreenshots[i] || [];

        if (tcSS.length === 0) {
          const sessionFiles = fs.existsSync(sessionDir)
            ? fs.readdirSync(sessionDir).filter(f => /\.(png|jpe?g)$/i.test(f))
            : [];

          if (testcases.length === 1) {
            tcSS = sessionFiles;
          } else {
            const prefix = `tc${i + 1}_`;
            const matching = sessionFiles.filter(f => f.startsWith(prefix));
            if (matching.length > 0) tcSS = matching;
          }

          if (tcSS.length === 0 && tc.screenshot_urls && Array.isArray(tc.screenshot_urls)) {
            for (let si = 0; si < tc.screenshot_urls.length; si++) {
              try {
                const ssBuf = await downloadBuffer(tc.screenshot_urls[si]);
                if (ssBuf) {
                  const ssName = `tc${i + 1}_screenshot_${si + 1}.png`;
                  const ssPath = path.join(sessionDir, ssName);
                  fs.writeFileSync(ssPath, ssBuf);
                  tcSS.push(ssName);
                }
              } catch (e) { /* ignore */ }
            }
          }
        }

        for (const ssFile of tcSS) {
          const src = path.join(sessionDir, ssFile);
          const dest = path.join(tcDir, ssFile);
          if (fs.existsSync(src)) fs.copyFileSync(src, dest);
        }

        let tcError = null;
        if (tcStatus === 'failed') {
          if (tc.maestro_log) {
            try {
              const logRes = await fetch(tc.maestro_log, { headers: { Authorization: AUTH } });
              if (logRes.ok) {
                const logBuf = await logRes.buffer();
                const logText = logBuf.toString('utf8');
                const logLines = logText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

                let lastSubflowError = null;
                let lastAnyFailed = null;
                for (const line of logLines) {
                  if (/\bFAILED\b\s*$/.test(line)) {
                    const match = line.match(/invoke:\s+(.+?)\s+FAILED\s*$/i);
                    const failedStep = match ? match[1].trim() : null;

                    if (failedStep) {
                      lastAnyFailed = failedStep + ' FAILED';
                      if (!/^Run\s+\S+\.ya?ml/i.test(failedStep)) lastSubflowError = failedStep + ' FAILED';
                    } else {
                      const parts = line.split(': ');
                      const rawFailed = parts[parts.length - 1].replace(/\s*FAILED\s*$/, '').trim();
                      lastAnyFailed = rawFailed + ' FAILED';
                      if (!/^Run\s+\S+\.ya?ml/i.test(rawFailed)) lastSubflowError = rawFailed + ' FAILED';
                    }
                  }
                }

                for (const line of logLines) {
                  const m = line.match(/Assertion is false:\s*"[^"]*"\s+is visible/i);
                  if (m) { lastSubflowError = m[0].trim(); break; }
                }

                for (const line of logLines) {
                  const m = line.match(/Assert that\s+"[^"]*".*?is visible\s+FAILED/i);
                  if (m) { lastSubflowError = m[0].trim(); break; }
                }

                tcError = lastSubflowError || lastAnyFailed;
              }
            } catch (e) { /* ignore */ }
          }

          if (!tcError) {
            const candidates = [tc.error, tc.message, tc.logs, tc.stack].filter(Boolean);
            for (const c of candidates) {
              if (typeof c !== 'string') continue;
              const patterns = [
                /Assert that\s+"[^"]*"\s+is visible[^\n]*/i,
                /Assertion is false:[^\n]*/i,
                /Element not found[^\n]*/i,
              ];
              for (const pat of patterns) {
                const m = c.match(pat);
                if (m) { tcError = m[0].trim(); break; }
              }
              if (tcError) break;
            }
          }

          if (!tcError && assertionMessage) tcError = assertionMessage;
        }

        const tcVideoUrl = tc.video || videoUrl || null;

        const tcResultData = {
          name: tcName,
          display_name: tcName,
          flow: suiteFlow || tc.flow || tc.file || null,
          session_id: sessionId,
          build_id: buildId,
          status: tcStatus,
          device: deviceName,
          os_version: deviceEntry.os_version || OS_VER,
          app: APP_ID,
          project: PROJECT,
          timestamp: new Date().toISOString(),
          testcases_passed: tcStatus === 'passed' ? 1 : 0,
          testcases_failed: tcStatus === 'failed' ? 1 : 0,
          testcases_total: 1,
          duration_seconds: tc.duration || Math.round((session.duration || 0) / testcases.length),
          video_url: tcVideoUrl,
          screenshots: tcSS,
          browserstack_url: `https://app-automate.browserstack.com/builds/${buildId}/sessions/${sessionId}`,
          error_message: tcError || null
        };

        fs.writeFileSync(path.join(tcDir, 'result.json'), JSON.stringify(tcResultData, null, 2));
        results.push({ ...tcResultData, _dirName: tcDirName });
        console.log(`   ✓ Test guardado: ${tcName} → ${tcStatus}`);
      }

      if (testcases.length === 0) {
        const allScreenshots = Object.values(tcScreenshots).flat();
        const resultData = {
          name: dirName,
          display_name: `${deviceName} — ${sessionId.substring(0, 8)}`,
          session_id: sessionId,
          build_id: buildId,
          status: sessionStatus,
          device: deviceName,
          os_version: deviceEntry.os_version || OS_VER,
          app: APP_ID,
          project: PROJECT,
          timestamp: new Date().toISOString(),
          testcases_passed: session.testcases ? session.testcases.status.passed : 0,
          testcases_failed: session.testcases ? session.testcases.status.failed : 0,
          testcases_total: session.testcases ? session.testcases.count : 0,
          duration_seconds: session.duration || 0,
          video_url: videoUrl || null,
          screenshots: allScreenshots,
          browserstack_url: `https://app-automate.browserstack.com/builds/${buildId}/sessions/${sessionId}`,
          error_message: assertionMessage || null
        };
        fs.writeFileSync(path.join(sessionDir, 'result.json'), JSON.stringify(resultData, null, 2));
        results.push({ ...resultData, _dirName: dirName });
      }

      console.log(`   ✓ Sesión procesada: ${deviceName} (${testcases.length} testcases)`);
    }
  }

  return results;
}

// ── Helpers de tags y dispositivos locales ────────────────────────────────────
function readFlowTags(flowPath) {
  try {
    const content = fs.readFileSync(flowPath, 'utf8');
    const header = content.split(/^---$/m)[0];
    const tagsMatch = header.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (!tagsMatch) return [];
    return tagsMatch[1].match(/^\s+-\s+(.+)$/gm)
      .map(line => line.replace(/^\s+-\s+/, '').trim())
      .filter(Boolean);
  } catch (e) { return []; }
}

function filterTestsByTags(suite) {
  const tagsEnv = (env.BROWSERSTACK_TAGS || '').trim();
  if (!tagsEnv) return suite;

  const includeTags = tagsEnv.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  if (includeTags.length === 0) return suite;

  const filtered = suite.filter(test => {
    const flowPath = path.resolve(process.cwd(), test.flow);
    if (!fs.existsSync(flowPath)) return false;
    const flowTags = readFlowTags(flowPath).map(t => t.toLowerCase());
    return flowTags.some(tag => includeTags.includes(tag));
  });

  if (filtered.length === 0) {
    console.warn(`⚠ Ningún test coincide con los tags: ${includeTags.join(', ')}. Ejecutando todos.`);
    return suite;
  }

  console.log(`🏷 Filtrado por tags [${includeTags.join(', ')}]: ${filtered.length}/${suite.length} tests seleccionados.`);
  return filtered;
}

function detectAdbDevices() {
  const adbCmd = env.ADB_PATH || 'adb';
  let cmd = adbCmd;
  let cmdArgs = ['devices'];
  if (adbCmd.endsWith('.bat') || adbCmd.endsWith('.cmd')) {
    cmd = 'cmd.exe';
    cmdArgs = ['/c', adbCmd, 'devices'];
  }
  const result = spawnSync(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.warn('⚠ No se pudo ejecutar "adb devices". Verifica que ADB esté en PATH o configura ADB_PATH.');
    return [];
  }
  const lines = (result.stdout || '').split(/\r?\n/).filter(Boolean);
  const devices = [];
  for (const line of lines) {
    const match = line.match(/^([^\t]+)\tdevice$/);
    if (match) devices.push(match[1]);
  }
  return devices;
}

function getLocalDevices() {
  const localDevicesEnv = (env.LOCAL_DEVICES || '').trim();
  if (localDevicesEnv) {
    const devices = localDevicesEnv.split('|').map(d => d.trim()).filter(Boolean);
    if (devices.length > 0) return devices;
  }
  if (env.MAESTRO_DEVICE_SERIAL) return [env.MAESTRO_DEVICE_SERIAL.trim()];
  const detected = detectAdbDevices();
  if (detected.length > 0) return detected;
  return [''];
}

/**
 * Registra las capturas generadas con `takeScreenshot` dentro del flow.
 * Maestro las guarda en el directorio de trabajo del proceso (testArtifactDir),
 * no en ~/.maestro/tests, por eso el bucle anterior no las encuentra.
 */
function addFlowScreenshots(testArtifactDir, screenshotFiles) {
  if (!fs.existsSync(testArtifactDir)) return;
  const files = fs.readdirSync(testArtifactDir)
    .filter(f => /\.(png|jpe?g)$/i.test(f) && !screenshotFiles.includes(f))
    .sort();
  screenshotFiles.push(...files);
}

function runSingleTest(test, deviceSerial, MAESTRO_CMD, runTimestamp, deviceName) {
  const flowPath = path.resolve(process.cwd(), test.flow);
  if (!fs.existsSync(flowPath)) {
    console.error(`No se encontró el flujo ${flowPath}`);
    return null;
  }

  const deviceLabel = deviceName || deviceSerial || 'local';
  const deviceHash = crypto.createHash('md5').update(`${deviceSerial}_${runTimestamp}`).digest('hex').substring(0, 8);
  const sessionName = `${test.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_${deviceHash}`;
  const testArtifactDir = path.join(localArtifactsBase, sessionName);
  if (!fs.existsSync(testArtifactDir)) fs.mkdirSync(testArtifactDir, { recursive: true });

  const args = ['test', ...buildMaestroEnvArgs(), flowPath];
  const spawnEnv = Object.assign({}, process.env);
  if (deviceSerial) spawnEnv.ANDROID_SERIAL = deviceSerial;

  const { cmd, cmdArgs, extraOpts } = buildMaestroSpawn(MAESTRO_CMD, args);

  console.log(`\n▶ [${deviceLabel}] Ejecutando: ${test.name}`);

  const startTime = Date.now();
  const result = spawnSync(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: spawnEnv, cwd: testArtifactDir, ...extraOpts });
  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  const stdout = result.stdout ? result.stdout.toString('utf8').trim() : '';
  const stderr = result.stderr ? result.stderr.toString('utf8').trim() : '';

  const exitOk = !result.error && result.status === 0;
  const maestroPassedPattern = /\bPASSED\b|Flow Completed|✅|completed successfully/i;
  const maestroFailedPattern = /\bFAILED\b|AssertionError|Assertion is false|Element not found/i;
  const stdoutIndicatesPass = maestroPassedPattern.test(stdout) && !maestroFailedPattern.test(stdout);
  const ok = exitOk || stdoutIndicatesPass;

  const errorMessage = result.error
    ? result.error.message
    : (!ok && result.status !== 0) ? (stderr || stdout || `Exit code ${result.status}`) : null;

  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);

  const screenshotFiles = [];
  const maestroSessionDir = findLatestMaestroSessionDir(startTime);
  if (maestroSessionDir && fs.existsSync(maestroSessionDir)) {
    const flowBaseName = path.basename(test.flow, path.extname(test.flow));
    const items = fs.readdirSync(maestroSessionDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isFile() || !/\.(png|jpe?g)$/i.test(item.name)) continue;
      if (/screenshot-⚠/i.test(item.name) || /screenshot-%E2%9A%A0/i.test(item.name)) continue;

      const hasFlowRef = item.name.match(/[-(]([A-Z]+\d+[^.)]*)/i);
      if (hasFlowRef) {
        const refName = hasFlowRef[1].replace(/[_\s]/g, '');
        const thisFlowClean = flowBaseName.replace(/[_\s]/g, '');
        if (!thisFlowClean.toLowerCase().includes(refName.toLowerCase()) &&
            !refName.toLowerCase().includes(thisFlowClean.toLowerCase())) continue;
      }

      const sourcePath = path.join(maestroSessionDir, item.name);
      const sanitizedName = item.name
        .replace(/❌/g, '_').replace(/⚠️?/g, '_').replace(/✅/g, '_')
        .replace(/[()]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_').replace(/^_/, '').replace(/_\./g, '.');
      const destPath = path.join(testArtifactDir, sanitizedName);
      try {
        fs.copyFileSync(sourcePath, destPath);
        screenshotFiles.push(sanitizedName);
      } catch (err) {
        console.warn(`   ⚠ No se pudo copiar captura: ${err.message}`);
      }
    }
  }
  addFlowScreenshots(testArtifactDir, screenshotFiles);

  const assertionMsg = ok ? null : extractAssertionDetail(errorMessage || stderr || stdout);

  const resultData = {
    name: test.name,
    display_name: `${test.name} (${deviceLabel})`,
    flow: test.flow,
    status: ok ? 'passed' : 'failed',
    timestamp: new Date().toISOString(),
    session_id: sessionName,
    device: deviceLabel,
    app: env.APP_PACKAGE || null,
    project: env.LOCAL_PROJECT || env.BROWSERSTACK_PROJECT || 'Maestro_Local',
    testcases_passed: ok ? 1 : 0,
    testcases_failed: ok ? 0 : 1,
    testcases_total: 1,
    duration_seconds: elapsedSeconds,
    error_message: assertionMsg,
    video_url: null,
    screenshots: screenshotFiles,
    browserstack_url: null
  };
  fs.writeFileSync(path.join(testArtifactDir, 'result.json'), JSON.stringify(resultData, null, 2));

  return { sessionName, ok, resultData };
}

// ── Ejecución paralela local ──────────────────────────────────────────────────
const { spawn } = require('child_process');

function loadLocalDeviceConfig(deviceCount) {
  const configs = [];
  for (let i = 1; i <= deviceCount; i++) {
    const name = env[`LOCAL_DEVICE_${i}_NAME`] || null;
    const includeTags = (env[`LOCAL_DEVICE_${i}_INCLUDE_TAGS`] || '').split(',').map(t => t.trim()).filter(Boolean);
    const excludeTags = (env[`LOCAL_DEVICE_${i}_EXCLUDE_TAGS`] || '').split(',').map(t => t.trim()).filter(Boolean);
    const execute = (env[`LOCAL_DEVICE_${i}_EXECUTE`] || '').split(',').map(t => t.trim()).filter(Boolean);
    const hasConfig = name || includeTags.length > 0 || excludeTags.length > 0 || execute.length > 0;
    configs.push(hasConfig ? { name, includeTags, excludeTags, execute } : null);
  }
  return configs;
}

function filterTestsForDevice(allTests, deviceConfig) {
  if (!deviceConfig) return null;
  let filtered = [...allTests];

  if (deviceConfig.execute.length > 0) {
    filtered = allTests.filter(test => {
      const flowFile = path.basename(test.flow);
      const flowName = flowFile.replace(/\.ya?ml$/i, '');
      return deviceConfig.execute.some(exeRaw => {
        // Acepta tanto la ruta completa (flows/tests/smoke/APPSV002_login.yaml) como solo el nombre
        const exeNorm = exeRaw.replace(/\\/g, '/');
        if (exeNorm.toLowerCase() === test.flow.toLowerCase()) return true;
        const exe = path.posix.basename(exeNorm);
        const exeClean = exe.replace(/\.ya?ml$/i, '');
        return flowFile === exe || flowName === exeClean
          || flowFile.toLowerCase() === exe.toLowerCase()
          || flowName.toLowerCase() === exeClean.toLowerCase();
      });
    });
    return filtered;
  }

  if (deviceConfig.includeTags.length > 0) {
    filtered = filtered.filter(test => {
      const flowPath = path.resolve(process.cwd(), test.flow);
      if (!fs.existsSync(flowPath)) return false;
      const flowTags = readFlowTags(flowPath).map(t => t.toLowerCase());
      return flowTags.some(tag => deviceConfig.includeTags.map(t => t.toLowerCase()).includes(tag));
    });
  }

  if (deviceConfig.excludeTags.length > 0) {
    filtered = filtered.filter(test => {
      const flowPath = path.resolve(process.cwd(), test.flow);
      if (!fs.existsSync(flowPath)) return true;
      const flowTags = readFlowTags(flowPath).map(t => t.toLowerCase());
      return !flowTags.some(tag => deviceConfig.excludeTags.map(t => t.toLowerCase()).includes(tag));
    });
  }

  return filtered;
}

function distributeTestsToDevices(devices, testsToRun, deviceConfigs) {
  const queues = devices.map(() => []);
  const assignedTests = new Set();

  devices.forEach((device, i) => {
    const config = deviceConfigs[i];
    if (!config) return;
    const filtered = filterTestsForDevice(testsToRun, config);
    if (filtered && filtered.length > 0) {
      queues[i] = filtered;
      filtered.forEach(t => assignedTests.add(t.flow));
    }
  });

  const unassignedDeviceIndices = devices.map((_, i) => i).filter(i => !deviceConfigs[i]);
  if (unassignedDeviceIndices.length > 0) {
    const remainingTests = testsToRun.filter(t => !assignedTests.has(t.flow));
    remainingTests.forEach((test, idx) => {
      const deviceIdx = unassignedDeviceIndices[idx % unassignedDeviceIndices.length];
      queues[deviceIdx].push(test);
    });
  }

  return queues;
}

function runSingleTestAsync(test, deviceSerial, MAESTRO_CMD, runTimestamp, portOffset, deviceName) {
  return new Promise((resolve) => {
    const flowPath = path.resolve(process.cwd(), test.flow);
    if (!fs.existsSync(flowPath)) { resolve(null); return; }

    const deviceLabel = deviceName || deviceSerial || 'local';
    const deviceHash = crypto.createHash('md5').update(`${deviceSerial}_${runTimestamp}`).digest('hex').substring(0, 8);
    const sessionName = `${test.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_${deviceHash}`;
    const testArtifactDir = path.join(localArtifactsBase, sessionName);
    if (!fs.existsSync(testArtifactDir)) fs.mkdirSync(testArtifactDir, { recursive: true });

    const driverPort = 7884 + portOffset;
    const args = ['--device', deviceSerial, '--driver-host-port', String(driverPort), 'test', ...buildMaestroEnvArgs(), flowPath];
    const spawnEnv = Object.assign({}, process.env);
    if (deviceSerial) spawnEnv.ANDROID_SERIAL = deviceSerial;

    const { cmd, cmdArgs, extraOpts } = buildMaestroSpawn(MAESTRO_CMD, args);

    console.log(`\n▶ [${deviceLabel}] Ejecutando: ${test.name}`);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const child = spawn(cmd, cmdArgs, { env: spawnEnv, cwd: testArtifactDir, ...extraOpts });
    child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });

    child.on('close', (code) => {
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      stdout = stdout.trim();
      stderr = stderr.trim();

      const exitOk = code === 0;
      const maestroPassedPattern = /\bPASSED\b|Flow Completed|✅|completed successfully/i;
      const maestroFailedPattern = /\bFAILED\b|AssertionError|Assertion is false|Element not found/i;
      const stdoutIndicatesPass = maestroPassedPattern.test(stdout) && !maestroFailedPattern.test(stdout);
      const ok = exitOk || stdoutIndicatesPass;

      const errorMessage = (!ok && code !== 0) ? (stderr || stdout || `Exit code ${code}`) : null;

      if (stdout) console.log(`[${deviceLabel}] ${stdout.split('\n').slice(-3).join('\n')}`);
      if (stderr && !ok) console.error(`[${deviceLabel}] ${stderr.split('\n').slice(-3).join('\n')}`);
      console.log(`   [${deviceLabel}] ${test.name}: ${ok ? '✓ PASSED' : '✗ FAILED'} (${elapsedSeconds}s)`);

      const screenshotFiles = [];
      const maestroSessionDir = findLatestMaestroSessionDir(startTime);
      if (maestroSessionDir && fs.existsSync(maestroSessionDir)) {
        const flowBaseName = path.basename(test.flow, path.extname(test.flow));
        const items = fs.readdirSync(maestroSessionDir, { withFileTypes: true });
        for (const item of items) {
          if (!item.isFile() || !/\.(png|jpe?g)$/i.test(item.name)) continue;
          if (/screenshot-⚠/i.test(item.name) || /screenshot-%E2%9A%A0/i.test(item.name)) continue;

          const hasFlowRef = item.name.match(/[-(]([A-Z]+\d+[^.)]*)/i);
          if (hasFlowRef) {
            const refName = hasFlowRef[1].replace(/[_\s]/g, '');
            const thisFlowClean = flowBaseName.replace(/[_\s]/g, '');
            if (!thisFlowClean.toLowerCase().includes(refName.toLowerCase()) &&
                !refName.toLowerCase().includes(thisFlowClean.toLowerCase())) continue;
          }

          const sourcePath = path.join(maestroSessionDir, item.name);
          const sanitizedName = item.name
            .replace(/❌/g, '_').replace(/⚠️?/g, '_').replace(/✅/g, '_')
            .replace(/[()]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_+/g, '_').replace(/^_/, '').replace(/_\./g, '.');
          const destPath = path.join(testArtifactDir, sanitizedName);
          try { fs.copyFileSync(sourcePath, destPath); screenshotFiles.push(sanitizedName); } catch (err) { /* ignore */ }
        }
      }
      addFlowScreenshots(testArtifactDir, screenshotFiles);

      const assertionMsg = ok ? null : extractAssertionDetail(errorMessage || stderr || stdout);

      const resultData = {
        name: test.name,
        display_name: `${test.name} (${deviceLabel})`,
        flow: test.flow,
        status: ok ? 'passed' : 'failed',
        timestamp: new Date().toISOString(),
        session_id: sessionName,
        device: deviceLabel,
        app: env.APP_PACKAGE || null,
        project: env.LOCAL_PROJECT || env.BROWSERSTACK_PROJECT || 'Maestro_Local',
        testcases_passed: ok ? 1 : 0,
        testcases_failed: ok ? 0 : 1,
        testcases_total: 1,
        duration_seconds: elapsedSeconds,
        error_message: assertionMsg,
        video_url: null,
        screenshots: screenshotFiles,
        browserstack_url: null
      };
      fs.writeFileSync(path.join(testArtifactDir, 'result.json'), JSON.stringify(resultData, null, 2));
      resolve({ sessionName, ok, resultData });
    });

    child.on('error', (err) => {
      console.error(`[${deviceLabel}] Error ejecutando: ${err.message}`);
      resolve(null);
    });
  });
}

function runLocalParallel(devices, testsToRun, MAESTRO_CMD, runTimestamp) {
  console.log(`\n🔀 Ejecución paralela local: ${devices.length} dispositivos, ${testsToRun.length} tests`);
  console.log(`   Dispositivos: ${devices.join(', ')}`);

  const deviceConfigs = loadLocalDeviceConfig(devices.length);
  const hasAnyConfig = deviceConfigs.some(c => c !== null);

  let queues;
  if (hasAnyConfig) {
    queues = distributeTestsToDevices(devices, testsToRun, deviceConfigs);
    console.log('\n   📋 Distribución por configuración:');
  } else {
    queues = devices.map(() => []);
    testsToRun.forEach((test, i) => { queues[i % devices.length].push(test); });
    console.log('\n   📋 Distribución round-robin:');
  }

  devices.forEach((device, i) => {
    const config = deviceConfigs[i];
    const label = (config && config.name) ? `${config.name} (${device})` : device || 'default';
    const tags = config
      ? [
          config.includeTags.length ? `+tags: ${config.includeTags.join(',')}` : '',
          config.excludeTags.length ? `-tags: ${config.excludeTags.join(',')}` : '',
          config.execute.length ? `files: ${config.execute.join(',')}` : ''
        ].filter(Boolean).join(' | ')
      : 'round-robin';
    console.log(`   [${label}]: ${queues[i].length} tests (${tags})`);
  });

  const workerPromises = devices.map((deviceSerial, deviceIndex) => {
    return new Promise(async (resolve) => {
      const deviceTests = queues[deviceIndex];
      const results = [];
      const config = deviceConfigs[deviceIndex];
      const friendlyName = (config && config.name) ? config.name : null;

      for (const test of deviceTests) {
        const result = await runSingleTestAsync(test, deviceSerial, MAESTRO_CMD, runTimestamp, deviceIndex, friendlyName);
        if (result) results.push(result);
      }

      resolve(results);
    });
  });

  return Promise.all(workerPromises).then(allResults => allResults.flat());
}

function runLocal() {
  ensureEnv(['MAESTRO_CLI_PATH']);

  const MAESTRO_CMD = env.MAESTRO_CLI_PATH;
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testsToRun = filterTestsByTags(testSuite);
  const devices = getLocalDevices();
  const parallelEnabled = devices.length > 1;

  if (parallelEnabled) {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Maestro Local - Ejecución Paralela             ║');
    console.log('╚══════════════════════════════════════════════════╝');

    runLocalParallel(devices, testsToRun, MAESTRO_CMD, runTimestamp).then(results => {
      const successCount = results.filter(r => r.ok).length;
      const localArtifacts = results.map(r => r.sessionName);

      const lastRun = {
        run_type: 'local',
        target: 'local-parallel',
        timestamp: new Date().toISOString(),
        artifact_dirs: localArtifacts,
        devices: devices,
        status: successCount === testsToRun.length ? 'passed' : 'failed',
        passed_count: successCount,
        total_count: testsToRun.length
      };
      fs.writeFileSync(path.join(artifactsBase, 'last-run.json'), JSON.stringify(lastRun, null, 2));

      console.log(`\n✅ Ejecución paralela local completada: ${successCount}/${testsToRun.length} passed`);
      process.exit(successCount === testsToRun.length ? 0 : 1);
    });
  } else {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Maestro Local - Ejecución Secuencial           ║');
    console.log('╚══════════════════════════════════════════════════╝');

    const deviceSerial = devices[0] || '';
    const deviceConfigs = loadLocalDeviceConfig(devices.length);
    const friendlyName = (deviceConfigs[0] && deviceConfigs[0].name) ? deviceConfigs[0].name : null;
    if (deviceSerial) console.log(`   Dispositivo: ${friendlyName || deviceSerial}`);

    let successCount = 0;
    const localArtifacts = [];

    for (const test of testsToRun) {
      const result = runSingleTest(test, deviceSerial, MAESTRO_CMD, runTimestamp, friendlyName);
      if (result) {
        localArtifacts.push(result.sessionName);
        if (result.ok) successCount++;
      }
    }

    const lastRun = {
      run_type: 'local',
      target: 'local',
      timestamp: new Date().toISOString(),
      artifact_dirs: localArtifacts,
      device: deviceSerial || null,
      status: successCount === testsToRun.length ? 'passed' : 'failed',
      passed_count: successCount,
      total_count: testsToRun.length
    };
    fs.writeFileSync(path.join(artifactsBase, 'last-run.json'), JSON.stringify(lastRun, null, 2));

    console.log('\nLocal run completed:', `${successCount}/${testsToRun.length} passed`);
    process.exit(successCount === testsToRun.length ? 0 : 1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async function main() {
  try {
    if (runTarget === 'local' || runTarget === 'adb') {
      runLocal();
      return;
    }

    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  Maestro + BrowserStack App Automate (API)  ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    ensureEnv(['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_APP_ID']);

    const zipPath   = buildFlowsZip();
    const suiteId   = await uploadTestSuite(zipPath);
    const buildId   = await launchBuild(suiteId);
    const buildData = await waitForBuild(buildId);
    const results   = await downloadEvidences(buildId, buildData);

    let buildNumber = buildData.build_number || buildData.buildNumber || null;
    if (!buildNumber) {
      try {
        const buildInfo = await apiGet(`${BASE_V2}/builds/${buildId}`);
        buildNumber = buildInfo.build_number || buildInfo.buildNumber || null;
      } catch (e) {
        console.warn(`   ⚠ No se pudo recuperar build_number: ${e.message}`);
      }
    }

    const passed = results.filter(r => r.status === 'passed').length;
    const total  = results.length;

    const buildName = buildData.build_name || buildData.customBuildName || env.BROWSERSTACK_BUILD_NAME || null;
    const lastRun = {
      run_type: 'cloud',
      target: 'browserstack',
      timestamp: new Date().toISOString(),
      artifact_dirs: results.map(r => r._dirName),
      device: DEVICE,
      os_version: OS_VER,
      project: PROJECT,
      build_id: buildId,
      build_name: buildName,
      build_number: buildNumber,
      status: passed === total ? 'passed' : 'failed',
      passed_count: passed,
      total_count: total
    };
    fs.writeFileSync(path.join(artifactsBase, 'last-run.json'), JSON.stringify(lastRun, null, 2));

    console.log(`\n✅ Ejecución completa: ${passed}/${total} sesiones exitosas.`);
    console.log(`   Evidencias en: artifacts/`);
    console.log(`   Ejecuta "npm run report" para el reporte HTML.\n`);

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Error:', err.message || err);
    process.exit(1);
  }
})();
