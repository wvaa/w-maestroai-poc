/**
 * generate-report.js
 * Genera un reporte HTML con un registro por cada test ejecutado.
 * Lee los artifacts/ generados por run-maestro-browserstack.js.
 * Usa last-run.json para identificar los tests de la última ejecución.
 */

const fs = require('fs');
const path = require('path');
const fsExtra = require('fs-extra');
const AdmZip = require('adm-zip');

const artifactsDir = path.resolve(process.cwd(), 'artifacts');
const reportDir    = path.resolve(process.cwd(), 'reports');
const lastRunPath  = path.join(artifactsDir, 'last-run.json');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const reportFileName = `reporte_APPSV_${timestamp}.html`;
const reportFile     = path.join(reportDir, reportFileName);
const indexFile      = path.join(reportDir, 'index.html');

if (!fs.existsSync(artifactsDir)) {
  console.error(`No se encontró la carpeta ${artifactsDir}. Ejecuta primero npm test.`);
  process.exit(1);
}

fsExtra.ensureDirSync(reportDir);

// ── Cargar tests de la última ejecución ───────────────────────────────────────
function loadLastRunTests() {
  if (!fs.existsSync(lastRunPath)) {
    console.error('No se encontró last-run.json. Ejecuta npm test primero.');
    process.exit(1);
  }

  const lastRun = JSON.parse(fs.readFileSync(lastRunPath, 'utf8'));
  const dirs = lastRun.artifact_dirs || [];

  if (dirs.length === 0) {
    console.error('last-run.json no contiene artifact_dirs.');
    process.exit(1);
  }

  const tests = [];

  for (const dirName of dirs) {
    const testPath = path.join(artifactsDir, dirName);
    if (!fs.existsSync(testPath)) continue;

    // Leer result.json
    const resultPath = path.join(testPath, 'result.json');
    if (!fs.existsSync(resultPath)) continue;

    let result;
    try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (e) { continue; }

    // Recopilar screenshots del directorio
    const allFiles = fs.readdirSync(testPath, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => f.name);

    const screenshots = allFiles
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      // Excluir screenshots de warning — ya no se copian desde el orquestador, pero filtrar por si acaso
      .filter(f => !/screenshot-warning/i.test(f) && !/screenshot-⚠/i.test(f) && !/screenshot-%E2%9A%A0/i.test(f))
      .map(f => ({
        name: f,
        relPath: `${dirName}/${f}`,
        // Para HTML: la ruta ya está sanitizada (sin emojis/caracteres especiales)
        // desde el orquestador. Solo codificar caracteres que rompen URLs en HTML.
        htmlPath: `${dirName}/${f}`
          .split('/').map(seg => seg.replace(/ /g, '%20').replace(/#/g, '%23').replace(/\?/g, '%3F')).join('/'),
        // Identificar screenshots de error (captura automática al fallar):
        // - BrowserStack cloud: "tc{N}_screenshot-_-{timestamp}-_..."
        // - Maestro local sanitizado: "screenshot-_-{timestamp}-_..."
        // Patrón común: contiene "screenshot-_-" seguido de un timestamp numérico
        isError: /screenshot-_-\d+/i.test(f)
      }));

    const videos = allFiles
      .filter(f => /\.(mp4|mov|webm)$/i.test(f))
      .map(f => ({ name: f, relPath: `${dirName}/${f}` }));

    const videoUrl = result.video_url || (videos.length > 0 ? `../artifacts/${videos[0].relPath}` : null);

    tests.push({
      name: result.name || result.display_name || dirName,
      result,
      screenshots,
      videos,
      videoUrl
    });
  }

  return { tests, lastRun };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    passed:  { bg: '#dcfce7', color: '#166534', label: '✓ EXITOSO' },
    failed:  { bg: '#fee2e2', color: '#991b1b', label: '✗ FALLIDO' },
    error:   { bg: '#fee2e2', color: '#991b1b', label: '✗ FALLIDO' },
    unknown: { bg: '#f3f4f6', color: '#374151', label: '? SIN RESULTADO' }
  };
  const s = map[status] || map.unknown;
  return `<span style="background:${s.bg};color:${s.color};padding:4px 10px;border-radius:12px;font-weight:bold;font-size:13px;">${s.label}</span>`;
}

function extractCleanError(raw) {
  if (!raw) return null;
  // Corregir caracteres tildados que vienen como '?' por encoding incorrecto (Latin-1/ASCII)
  let cleaned = raw
    .replace(/N\?mero/g, 'Número')
    .replace(/n\?mero/g, 'número');

  // Si el error es un "Run subflow.yaml ... FAILED" genérico, indicar que el error está en el subflujo
  if (/^Run\s+\S+\.ya?ml.*FAILED\s*$/i.test(cleaned.trim())) {
    const subflowMatch = cleaned.match(/Run\s+(\S+\.ya?ml)/i);
    const subflowName = subflowMatch ? subflowMatch[1].split('/').pop() : 'subflujo';
    return `Error en subflujo: ${subflowName} (detalle no disponible en log)`;
  }

  if (cleaned.length < 300 && !/^\s*[\[{]/.test(cleaned)) return cleaned.trim();
  const patterns = [
    /Assert that\s+"[^"]*".*?is visible\s+FAILED/i,
    /Assert that\s+"[^"]*"\s+is visible[^\n]*/i,
    /Assertion is false:\s*"[^"]*"\s+is visible/i,
    /Assertion is false:[^\n]*/i,
    /Element not found[^\n]*/i,
    /Expected[^\n]*but[^\n]*/i,
  ];
  for (const pat of patterns) {
    const m = cleaned.match(pat);
    if (m) return m[0].trim();
  }
  return cleaned.substring(0, 200).trim();
}

// ── Construir HTML ────────────────────────────────────────────────────────────
function buildHtml(tests, lastRun) {
  const totalPassed  = tests.filter(t => t.result.status === 'passed').length;
  const totalFailed  = tests.filter(t => ['failed','error'].includes(t.result.status)).length;
  const totalUnknown = tests.length - totalPassed - totalFailed;
  const runType = lastRun.run_type || 'unknown';
  const isCloud = runType === 'cloud';

  // Obtener lista de dispositivos únicos usados en esta ejecución
  const usedDevices = [...new Set(tests.map(t => t.result.device).filter(Boolean))];
  const deviceDisplay = usedDevices.length > 1
    ? `${usedDevices.length} dispositivos`
    : (usedDevices[0] || lastRun.device || 'local');
  const osVersion = isCloud && usedDevices.length === 1
    ? (lastRun.os_version || tests[0]?.result?.os_version || '')
    : '';

  const rows = tests.map((test, idx) => {
    const r = test.result;

    // Screenshots
    const ssHtml = test.screenshots.length > 0
      ? test.screenshots.map((ss, ssIdx) => {
          const borderStyle = ss.isError
            ? 'border:3px solid #dc2626;'
            : 'border:1px solid #d1d5db;';
          return `<img src="../artifacts/${ss.htmlPath}" style="max-width:180px;max-height:140px;border-radius:6px;${borderStyle}margin:4px;cursor:pointer;" alt="${ss.name}" title="${ss.name}" data-testidx="${idx}" data-ssidx="${ssIdx}" onclick="openLightbox(${idx}, ${ssIdx})" />`;
        }).join('')
      : `<span style="color:#9ca3af;font-size:13px;">Sin capturas</span>`;

    // Video
    const videoHtml = '';

    // Info
    const duration = r.duration_seconds
      ? (r.duration_seconds >= 60
        ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s`
        : `${r.duration_seconds}s`)
      : '—';
    const ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : '—';
    // Link a BrowserStack (oculto)
    const bsLink = '';

    // Error
    const cleanError = extractCleanError(r.error_message);
    const errorHtml = cleanError
      ? `<div style="margin-top:8px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;padding:6px 10px;">
           <code style="color:#b91c1c;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${cleanError.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
         </div>`
      : '';

    return `
    <tr style="background:${idx % 2 === 0 ? '#fff' : '#f9fafb'};" data-status="${r.status || 'unknown'}">
      <td style="padding:12px;border:1px solid #e5e7eb;vertical-align:top;min-width:200px;">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${r.name || r.display_name || test.name}</div>
        <!-- Flow oculto -->
        <div style="color:#6b7280;font-size:11px;">📱 ${r.device || 'local'}${r.os_version ? ' (Android ' + r.os_version + ')' : ''}</div>
        <div style="color:#6b7280;font-size:11px;">Duración: ${duration}</div>
        <!-- Fecha oculta -->
        ${bsLink ? `<div style="margin-top:4px;">${bsLink}</div>` : ''}
      </td>
      <td style="padding:12px;border:1px solid #e5e7eb;vertical-align:middle;text-align:center;min-width:100px;">
        ${statusBadge(r.status)}
      </td>
      <td style="padding:12px;border:1px solid #e5e7eb;vertical-align:top;">
        <div>${ssHtml}</div>
        ${videoHtml}
        ${errorHtml}
      </td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte de evidencias APP 3.0 Banca Digital El Salvador</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f3f4f6; color: #111827; margin: 0; padding: 24px; }
    .header { background: #1B5A7D; color: #fff; padding: 24px 32px; border-radius: 12px; margin-bottom: 24px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; }
    .header p  { margin: 0; color: #9ca3af; font-size: 14px; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .summary-card { background: #fff; border-radius: 10px; padding: 16px 24px; flex: 1; min-width: 130px; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
    .summary-card .num { font-size: 32px; font-weight: 700; }
    .summary-card .lbl { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .green { color: #16a34a; }
    .red   { color: #dc2626; }
    .gray  { color: #6b7280; }
    .info-bar { background: #fff; border-radius: 10px; padding: 12px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); font-size: 13px; color: #374151; display: flex; gap: 24px; flex-wrap: wrap; }
    .info-bar span { display: inline-flex; align-items: center; gap: 6px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th { background: #1B5A7D; color: #fff; padding: 12px; text-align: left; font-size: 13px; font-weight: 600; }
    td { vertical-align: top; }
    .footer { margin-top: 24px; text-align: center; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header" style="display:flex;align-items:center;justify-content:space-between;">
    <div>
      <h1>Reporte de evidencias APP 3.0 Banca Digital El Salvador</h1>
      <p>Generado el ${new Date().toLocaleString()}</p>
    </div>
    <img src="../config/logo_cusca.png" alt="Logo Cuscatlán" style="max-height:60px;object-fit:contain;" />
  </div>

  <div class="info-bar">
    <span>📱 Dispositivo(s): <strong>${deviceDisplay}${osVersion ? ' (Android ' + osVersion + ')' : ''}</strong></span>
    <span>▶️ Ejecución: <strong>${runType}</strong></span>
    ${lastRun.project ? `<span>📂 Proyecto: <strong>${lastRun.project}</strong></span>` : ''}
    <span>📅 Ejecución: <strong>${lastRun.timestamp ? new Date(lastRun.timestamp).toLocaleString() : '—'}</strong></span>
  </div>

  <div class="summary">
    <div class="summary-card"><div class="num">${tests.length}</div><div class="lbl">Total</div></div>
    <div class="summary-card"><div class="num green">${totalPassed}</div><div class="lbl">Exitoso</div></div>
    <div class="summary-card"><div class="num red">${totalFailed}</div><div class="lbl">Fallido</div></div>
    <div class="summary-card"><div class="num gray">${totalUnknown}</div><div class="lbl">Sin resultado</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:25%"><input type="text" id="searchTest" placeholder="🔍 Buscar test..." style="width:100%;padding:6px 10px;border:none;border-radius:6px;font-size:12px;background:#ffffff;color:#111827;outline:none;" /></th>
        <th style="width:10%">
          <select id="filterStatus" style="width:100%;padding:6px 8px;border:none;border-radius:6px;font-size:12px;background:#ffffff;color:#111827;outline:none;cursor:pointer;">
            <option value="all">Todos</option>
            <option value="passed">✓ Exitoso</option>
            <option value="failed">✗ Fallido</option>
            <option value="unknown">? Sin resultado</option>
          </select>
        </th>
        <th>Evidencias</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="3" style="padding:24px;text-align:center;color:#9ca3af;">No hay resultados.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">Banco CUSCATLAN de El Salvador, S.A. | Todos los Derechos Reservados</div>

  <!-- Lightbox Modal -->
  <div id="lightbox" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);align-items:center;justify-content:center;" onclick="closeLightboxBackdrop(event)">
    <button id="lb-close" onclick="closeLightbox()" style="position:absolute;top:16px;right:24px;background:none;border:none;color:#fff;font-size:36px;cursor:pointer;z-index:10001;line-height:1;" title="Cerrar (Esc)">&times;</button>
    <button id="lb-prev" onclick="navigateLightbox(-1)" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;font-size:40px;cursor:pointer;border-radius:50%;width:56px;height:56px;display:flex;align-items:center;justify-content:center;z-index:10001;" title="Anterior (←)">&#8249;</button>
    <button id="lb-next" onclick="navigateLightbox(1)" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;font-size:40px;cursor:pointer;border-radius:50%;width:56px;height:56px;display:flex;align-items:center;justify-content:center;z-index:10001;" title="Siguiente (→)">&#8250;</button>
    <div id="lb-img-container" style="position:relative;max-width:92vw;max-height:92vh;overflow:auto;border-radius:8px;box-shadow:0 4px 30px rgba(0,0,0,.5);cursor:grab;">
      <img id="lb-img" src="" style="display:block;margin:auto;transition:width 0.15s ease, height 0.15s ease;" draggable="false" />
    </div>
    <div id="lb-caption" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:#e5e7eb;font-size:13px;text-align:center;max-width:80vw;max-height:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
    <div id="lb-zoom-hint" style="position:absolute;top:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.7);font-size:12px;pointer-events:none;transition:opacity .3s;">Scroll para zoom · Doble clic para reiniciar · Arrastrar para desplazar</div>
  </div>

  <script>
    // ── Test screenshots data for lightbox navigation ──
    const testScreenshots = ${JSON.stringify(tests.map(t => {
      const err = extractCleanError(t.result.error_message) || '';
      return t.screenshots.map(ss => ({ src: '../artifacts/' + ss.htmlPath, name: ss.name, isError: ss.isError, errorMsg: ss.isError ? err : '' }));
    }))};

    let currentTestIdx = -1;
    let currentSsIdx = -1;

    // ── Zoom state ──
    let zoomLevel = 1;
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 5;
    const ZOOM_STEP = 0.3;
    let baseWidth = 0;
    let baseHeight = 0;

    // ── Drag-to-scroll state ──
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let scrollStartX = 0, scrollStartY = 0;

    function resetZoom() {
      zoomLevel = 1;
      applyZoom();
    }

    function applyZoom() {
      const img = document.getElementById('lb-img');
      const container = document.getElementById('lb-img-container');
      const newW = baseWidth * zoomLevel;
      const newH = baseHeight * zoomLevel;
      img.style.width = newW + 'px';
      img.style.height = newH + 'px';
      img.style.minWidth = newW + 'px';
      img.style.minHeight = newH + 'px';
      container.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
    }

    function openLightbox(testIdx, ssIdx) {
      currentTestIdx = testIdx;
      currentSsIdx = ssIdx;
      const ss = testScreenshots[testIdx][ssIdx];
      const lb = document.getElementById('lightbox');
      const img = document.getElementById('lb-img');
      const container = document.getElementById('lb-img-container');

      img.onload = function() {
        // Calcular tamaño base: encajar en 90vw x 90vh manteniendo aspect ratio
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.9;
        const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        baseWidth = img.naturalWidth * ratio;
        baseHeight = img.naturalHeight * ratio;
        zoomLevel = 1;
        applyZoom();
        // Centrar scroll
        container.scrollLeft = 0;
        container.scrollTop = 0;
      };

      img.src = ss.src;
      // Caption: mostrar error si es screenshot de error, sino el nombre del archivo
      const caption = document.getElementById('lb-caption');
      if (ss.isError && ss.errorMsg) {
        caption.textContent = '❌ ' + ss.errorMsg;
        caption.style.color = '#fca5a5';
        caption.style.whiteSpace = 'normal';
        caption.style.maxHeight = '80px';
        caption.style.overflow = 'auto';
      } else {
        caption.textContent = ss.name + ' (' + (ssIdx + 1) + '/' + testScreenshots[testIdx].length + ')';
        caption.style.color = '#e5e7eb';
        caption.style.whiteSpace = 'nowrap';
        caption.style.maxHeight = '60px';
        caption.style.overflow = 'hidden';
      }      lb.style.display = 'flex';
      updateNavButtons();
      document.body.style.overflow = 'hidden';
      // Mostrar hint de zoom brevemente
      const hint = document.getElementById('lb-zoom-hint');
      hint.style.opacity = '1';
      setTimeout(function() { hint.style.opacity = '0'; }, 3000);
    }

    function closeLightbox() {
      document.getElementById('lightbox').style.display = 'none';
      const img = document.getElementById('lb-img');
      img.src = '';
      img.style.width = '';
      img.style.height = '';
      img.style.minWidth = '';
      img.style.minHeight = '';
      document.body.style.overflow = '';
      currentTestIdx = -1;
      currentSsIdx = -1;
      zoomLevel = 1;
    }

    function closeLightboxBackdrop(e) {
      if (e.target === document.getElementById('lightbox')) closeLightbox();
    }

    function navigateLightbox(dir) {
      if (currentTestIdx < 0) return;
      const total = testScreenshots[currentTestIdx].length;
      const next = currentSsIdx + dir;
      if (next < 0 || next >= total) return;
      openLightbox(currentTestIdx, next);
    }

    function updateNavButtons() {
      const total = testScreenshots[currentTestIdx].length;
      document.getElementById('lb-prev').style.visibility = currentSsIdx > 0 ? 'visible' : 'hidden';
      document.getElementById('lb-next').style.visibility = currentSsIdx < total - 1 ? 'visible' : 'hidden';
    }

    // ── Zoom con scroll del mouse ──
    (function() {
      const container = document.getElementById('lb-img-container');

      container.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const prevZoom = zoomLevel;
        zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel + delta));
        if (zoomLevel === prevZoom) return;

        // Mantener el punto bajo el cursor centrado
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + container.scrollLeft;
        const mouseY = e.clientY - rect.top + container.scrollTop;
        const ratio = zoomLevel / prevZoom;

        applyZoom();

        // Ajustar scroll para que el punto bajo el cursor quede en su lugar
        container.scrollLeft = mouseX * ratio - (e.clientX - rect.left);
        container.scrollTop = mouseY * ratio - (e.clientY - rect.top);
      }, { passive: false });

      // ── Drag para desplazar (scroll) ──
      container.addEventListener('mousedown', function(e) {
        if (zoomLevel <= 1) return;
        if (e.button !== 0) return;
        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        scrollStartX = container.scrollLeft;
        scrollStartY = container.scrollTop;
        container.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        container.scrollLeft = scrollStartX - dx;
        container.scrollTop = scrollStartY - dy;
      });

      document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        isDragging = false;
        container.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
      });

      // ── Doble clic para toggle zoom ──
      container.addEventListener('dblclick', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (zoomLevel > 1) {
          resetZoom();
          container.scrollLeft = 0;
          container.scrollTop = 0;
        } else {
          // Zoom 2.5x centrado en el punto del doble clic
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left + container.scrollLeft;
          const mouseY = e.clientY - rect.top + container.scrollTop;
          zoomLevel = 2.5;
          applyZoom();
          // Centrar el punto del clic en el viewport del contenedor
          container.scrollLeft = mouseX * 2.5 - rect.width / 2;
          container.scrollTop = mouseY * 2.5 - rect.height / 2;
        }
      });
    })();

    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
      if (document.getElementById('lightbox').style.display !== 'flex') return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft' && zoomLevel <= 1) navigateLightbox(-1);
      else if (e.key === 'ArrowRight' && zoomLevel <= 1) navigateLightbox(1);
      else if (e.key === '+' || e.key === '=') {
        zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP);
        applyZoom();
      } else if (e.key === '-') {
        zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
        applyZoom();
      } else if (e.key === '0') {
        resetZoom();
        document.getElementById('lb-img-container').scrollLeft = 0;
        document.getElementById('lb-img-container').scrollTop = 0;
      }
    });

    // ── Table filters ──
    const searchInput = document.getElementById('searchTest');
    const filterSelect = document.getElementById('filterStatus');
    const rows = document.querySelectorAll('tbody tr');

    function applyFilters() {
      const search = searchInput.value.toLowerCase();
      const status = filterSelect.value;

      rows.forEach(row => {
        const testName = (row.querySelector('td:first-child') || {}).textContent.toLowerCase();
        const rowStatus = row.getAttribute('data-status') || '';
        const matchSearch = !search || testName.includes(search);
        const matchStatus = status === 'all' || rowStatus === status;
        row.style.display = (matchSearch && matchStatus) ? '' : 'none';
      });
    }

    searchInput.addEventListener('input', applyFilters);
    filterSelect.addEventListener('change', applyFilters);
  </script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const { tests, lastRun } = loadLastRunTests();

if (tests.length === 0) {
  console.error('No se encontraron resultados para la última ejecución.');
  process.exit(1);
}

// Excluir tests APPSV001 del reporte (son solo para inicio de sesión, no parte de la suite)
const filteredTests = tests.filter(t => {
  const name = (t.result.name || t.name || '').toUpperCase();
  return !name.startsWith('APPSV001');
});

if (filteredTests.length === 0) {
  console.warn('⚠ Solo se encontraron tests APPSV001 (excluidos del reporte). No hay tests de suite para reportar.');
  process.exit(0);
}

console.log(`   Tests en reporte: ${filteredTests.length} (excluidos ${tests.length - filteredTests.length} APPSV001)`);

// Ordenar tests por correlativo (APPSVXXX)
filteredTests.sort((a, b) => {
  const nameA = (a.result.name || a.name || '').toUpperCase();
  const nameB = (b.result.name || b.name || '').toUpperCase();
  const numA = nameA.match(/APPSV(\d+)/);
  const numB = nameB.match(/APPSV(\d+)/);
  if (numA && numB) return parseInt(numA[1], 10) - parseInt(numB[1], 10);
  if (numA) return -1;
  if (numB) return 1;
  return nameA.localeCompare(nameB);
});

const htmlContent = buildHtml(filteredTests, lastRun);
fs.writeFileSync(reportFile, htmlContent, 'utf8');

// Guardar metadata del reporte para el índice histórico
const metaFileName = `reporte_APPSV_${timestamp}.meta.json`;
const metaFilePath = path.join(reportDir, metaFileName);
const reportMeta = {
  file: reportFileName,
  timestamp: now.toISOString(),
  runType: lastRun.run_type || 'unknown',
  testsCount: filteredTests.length,
  passed: filteredTests.filter(t => t.result.status === 'passed').length,
  failed: filteredTests.filter(t => ['failed','error'].includes(t.result.status)).length
};
fs.writeFileSync(metaFilePath, JSON.stringify(reportMeta, null, 2), 'utf8');

// Índice de reportes
const allReports = fs.readdirSync(reportDir)
  .filter(f => (f.startsWith('report_') || f.startsWith('reporte_')) && f.endsWith('.html') && f !== 'index.html')
  .sort()
  .reverse();

// Cargar metadata de cada reporte
const reportsMeta = allReports.map(f => {
  const metaFile = f.replace('.html', '.meta.json');
  const metaPath = path.join(reportDir, metaFile);
  if (fs.existsSync(metaPath)) {
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) { /* ignore */ }
  }
  return { file: f, runType: 'unknown' };
});

const indexHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Histórico de reportes</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f3f4f6; color: #111827; margin: 0; padding: 24px; }
    .header { background: #1B5A7D; color: #fff; padding: 24px 32px; border-radius: 12px; margin-bottom: 24px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; }
    .header p  { margin: 0; color: #9ca3af; font-size: 14px; }
    .filter-bar { background: #fff; border-radius: 10px; padding: 12px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .filter-bar label { font-size: 13px; font-weight: 600; color: #374151; }
    .filter-bar select { padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; cursor: pointer; background: #fff; }
    .badge-cloud { background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge-local { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge-unknown { background: #f3f4f6; color: #6b7280; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { background: #fff; border-radius: 10px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    li a { display: flex; align-items: center; gap: 12px; padding: 16px 20px; text-decoration: none; color: #1d4ed8; font-size: 15px; font-weight: 500; border-radius: 10px; transition: background .15s; }
    li a:hover { background: #eff6ff; }
    li a .date { color: #6b7280; font-size: 13px; font-weight: 400; }
    li a .stats { color: #6b7280; font-size: 12px; font-weight: 400; margin-left: auto; }
    li:first-child a { border: 2px solid #2563eb; }
    .footer { margin-top: 24px; text-align: center; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header" style="display:flex;align-items:center;justify-content:space-between;">
    <div>
      <h1>📋 Histórico de reportes</h1>
      <p>${allReports.length} reporte(s)</p>
    </div>
    <img src="../config/logo_cusca.png" alt="Logo Cuscatlán" style="max-height:60px;object-fit:contain;" />
  </div>

  <div class="filter-bar">
    <label>🎯 Filtrar por tipo:</label>
    <select id="filterRunType">
      <option value="all">Todos</option>
      <option value="cloud">☁️ Cloud</option>
      <option value="local">💻 Local</option>
    </select>
  </div>

  <ul id="reportList">
    ${reportsMeta.map((meta, idx) => {
      const f = allReports[idx];
      const m = f.match(/reporte?_(?:APPSV_)?(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.html/);
      const label = m ? (m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] + ':' + m[6]) : f;
      const runType = meta.runType || 'unknown';
      const badgeClass = runType === 'cloud' ? 'badge-cloud' : (runType === 'local' ? 'badge-local' : 'badge-unknown');
      const badgeLabel = runType === 'cloud' ? '☁️ Cloud' : (runType === 'local' ? '💻 Local' : '? Desconocido');
      const statsText = meta.testsCount ? ((meta.passed || 0) + '✓ / ' + (meta.failed || 0) + '✗ / ' + meta.testsCount + ' total') : '';
      const statsHtml = statsText ? ' <span class="stats">' + statsText + '</span>' : '';
      return '<li data-runtype="' + runType + '"><a href="' + f + '">📄 ' + f + ' <span class="date">' + label + '</span> <span class="' + badgeClass + '">' + badgeLabel + '</span>' + statsHtml + '</a></li>';
    }).join('\n    ')}
  </ul>
  <div class="footer">Actualizado el ${new Date().toLocaleString()}</div>

  <script>
    const filterSelect = document.getElementById('filterRunType');
    const items = document.querySelectorAll('#reportList li');

    function applyFilter() {
      const value = filterSelect.value;
      items.forEach(li => {
        const type = li.getAttribute('data-runtype');
        li.style.display = (value === 'all' || type === value) ? '' : 'none';
      });
    }

    filterSelect.addEventListener('change', applyFilter);

    // Resetear filtro al volver con el botón "atrás" del navegador
    window.addEventListener('pageshow', () => {
      filterSelect.value = 'all';
      applyFilter();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(indexFile, indexHtml, 'utf8');

// ── Crear ZIP del reporte con evidencias ──────────────────────────────────────
const zipFileName = `reporte_APPSV_${timestamp}.zip`;
const zipFilePath = path.join(reportDir, zipFileName);

try {
  // Crear directorio temporal para organizar los archivos del ZIP
  const tmpZipDir = path.join(reportDir, `_tmp_zip_${timestamp}`);
  fsExtra.ensureDirSync(tmpZipDir);

  // Generar HTML adaptado para el ZIP (rutas relativas desde la raíz del ZIP)
  let zipHtmlContent = htmlContent
    .replace(/\.\.\/config\//g, 'config/')
    .replace(/\.\.\/artifacts\//g, 'artifacts/');
  const zipHtmlName = `reporte_APPSV_${timestamp}.html`;
  fs.writeFileSync(path.join(tmpZipDir, zipHtmlName), zipHtmlContent, 'utf8');

  // Copiar screenshots al directorio temporal manteniendo la estructura artifacts/dirName/file
  const addedFiles = new Set();
  for (const test of filteredTests) {
    for (const ss of test.screenshots) {
      const ssFullPath = path.join(artifactsDir, ss.relPath);
      if (fs.existsSync(ssFullPath) && !addedFiles.has(ss.relPath)) {
        const destDir = path.join(tmpZipDir, 'artifacts', path.dirname(ss.relPath));
        fsExtra.ensureDirSync(destDir);
        const destFile = path.join(tmpZipDir, 'artifacts', ss.relPath);
        try {
          fs.copyFileSync(ssFullPath, destFile);
          addedFiles.add(ss.relPath);
        } catch (e) {
          console.warn(`   ⚠ No se pudo copiar al temporal: ${ss.relPath} (${e.message})`);
        }
      }
    }
  }

  // Copiar el logo
  const logoPath = path.resolve(process.cwd(), 'config', 'logo_cusca.png');
  if (fs.existsSync(logoPath)) {
    fsExtra.ensureDirSync(path.join(tmpZipDir, 'config'));
    fs.copyFileSync(logoPath, path.join(tmpZipDir, 'config', 'logo_cusca.png'));
  }

  // Crear ZIP desde el directorio temporal
  const zip = new AdmZip();
  zip.addLocalFolder(tmpZipDir);
  zip.writeZip(zipFilePath);

  // Limpiar directorio temporal (con reintentos para Windows EPERM/ENOTEMPTY)
  try {
    fs.rmSync(tmpZipDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (cleanErr) {
    console.warn(`   ⚠ No se pudo eliminar el directorio temporal (se limpiará manualmente): ${cleanErr.message}`);
  }

  console.log(`✓ ZIP compartible: ${zipFilePath}`);
} catch (zipErr) {
  console.error(`⚠ Error generando ZIP: ${zipErr.message}`);
  // Limpiar temporal si quedó
  const tmpZipDir = path.join(reportDir, `_tmp_zip_${timestamp}`);
  if (fs.existsSync(tmpZipDir)) {
    try {
      fs.rmSync(tmpZipDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (_) { /* ignorar — se limpiará manualmente */ }
  }
}

console.log(`✓ Reporte generado: ${reportFile} (${filteredTests.length} tests)`);
console.log(`✓ Índice actualizado: ${indexFile}`);
console.log(`  Abre en tu navegador: file:///${reportFile.replace(/\\/g, '/')}`);
