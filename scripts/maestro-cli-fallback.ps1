# ═══════════════════════════════════════════════════════════════════════════════
# Fallback de exploración con Maestro CLI cuando el servidor MCP no responde
# (inspect_screen / run devuelven UNAVAILABLE).
#
# Uso (desde la raíz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maestro-cli-fallback.ps1 -Mode hierarchy
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maestro-cli-fallback.ps1 -Mode test -Flow <flow.yaml>
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maestro-cli-fallback.ps1 -Mode step -Flow <flow.yaml>
#   Añadir -Detach para lanzarlo en un proceso independiente y volver de inmediato.
#
# Modos:
#   hierarchy  vuelca la jerarquía actual filtrada (solo nodos con text, a11y,
#              resource-id, hint o clickable) en artifacts\cli\hierarchy.txt
#   test       ejecuta el flow; salida en artifacts\cli\test.log (+ línea EXIT=<código>)
#              las capturas de takeScreenshot quedan en artifacts\cli\
#   step       test + hierarchy (un paso de exploración completo)
#
# Al terminar SIEMPRE escribe artifacts\cli\done.txt. Con -Detach, el agente
# debe esperar ese archivo en lugar de mantener la terminal bloqueada.
#
# Variables leídas del .env: MAESTRO_CLI_PATH, APP_PACKAGE, TEST_USER, TEST_PASS,
# MAESTRO_DEVICE_SERIAL (opcional). Las credenciales se pasan con -e y nunca se
# imprimen.
# ═══════════════════════════════════════════════════════════════════════════════
param(
  [ValidateSet('hierarchy', 'test', 'step')]
  [Parameter(Mandatory = $true)][string]$Mode,
  [string]$Flow,
  [string]$DeviceId,
  [string[]]$ExtraEnv = @(),   # ej. -ExtraEnv 'NPE_CODE=123','OTRA=valor'
  [switch]$Detach
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$outDir = Join-Path $root 'artifacts\cli'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$done = Join-Path $outDir 'done.txt'

if ($Mode -ne 'hierarchy' -and -not $Flow) {
  Write-Error "El modo '$Mode' requiere -Flow <archivo.yaml>."
  exit 1
}

# ── Modo desacoplado: relanzar en un proceso oculto y volver ──────────────────
if ($Detach) {
  Remove-Item $done -ErrorAction SilentlyContinue
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Mode', $Mode)
  if ($Flow)     { $args2 += @('-Flow', $Flow) }
  if ($DeviceId) { $args2 += @('-DeviceId', $DeviceId) }
  foreach ($x in $ExtraEnv) { $args2 += @('-ExtraEnv', $x) }
  Start-Process powershell -ArgumentList $args2 -WindowStyle Hidden
  Write-Host "Lanzado en segundo plano. Esperar: $done"
  exit 0
}

Remove-Item $done -ErrorAction SilentlyContinue

# ── .env ──────────────────────────────────────────────────────────────────────
$e = @{}
Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '^\s*[A-Z_0-9]+\s*=' } | ForEach-Object {
  $p = $_ -split '=', 2
  $e[$p[0].Trim()] = $p[1].Trim().Trim('"')
}
$maestro = $e.MAESTRO_CLI_PATH -replace '\\\\', '\'
if (-not $maestro) { $maestro = 'maestro' }

# ── Dispositivo: parámetro > MAESTRO_DEVICE_SERIAL > primer dispositivo adb ───
if (-not $DeviceId) { $DeviceId = $e.MAESTRO_DEVICE_SERIAL }
if (-not $DeviceId) {
  $DeviceId = (& adb devices 2>$null | Select-String '^\S+\s+device$' | Select-Object -First 1) -replace '\s+device$', ''
}
if (-not $DeviceId) {
  "ERROR: no hay dispositivo conectado" | Out-File -Encoding utf8 $done
  exit 1
}

function Invoke-Test {
  $log = Join-Path $outDir 'test.log'
  $envArgs = @('-e', "APP_PACKAGE=$($e.APP_PACKAGE)", '-e', "TEST_USER=$($e.TEST_USER)", '-e', "TEST_PASS=$($e.TEST_PASS)")
  foreach ($x in $ExtraEnv) { $envArgs += @('-e', $x) }
  # takeScreenshot guarda los .png en el directorio de trabajo: ejecutar dentro
  # de artifacts\cli para no ensuciar la raíz del repo (ruta del flow absoluta).
  $flowAbs = (Resolve-Path $Flow).Path
  Push-Location $outDir
  try { & $maestro --device $DeviceId test @envArgs --no-ansi $flowAbs *> $log; $code = $LASTEXITCODE }
  finally { Pop-Location }
  "EXIT=$code" | Out-File -Append -Encoding utf8 $log
  return $code
}

function Invoke-Hierarchy {
  $raw = Join-Path $outDir 'hierarchy_raw.json'
  $txt = Join-Path $outDir 'hierarchy.txt'
  & $maestro --device $DeviceId hierarchy 2>$null | Out-File -Encoding utf8 $raw
  $content = Get-Content $raw -Raw
  $start = $content.IndexOf('{')
  if ($start -lt 0) { "ERROR: hierarchy vacía" | Out-File -Encoding utf8 $txt; return }
  $json = $content.Substring($start) | ConvertFrom-Json
  $out = New-Object System.Collections.Generic.List[string]
  # Contenedores estructurales sin valor para selectores
  $noise = 'android:id/content$|:id/action_bar_root$|:id/navHostFragment$'
  function Walk($n) {
    $a = $n.attributes
    if ($a) {
      $t = $a.text; $d = $a.accessibilityText; $r = $a.'resource-id'; $h = $a.hintText
      $sys = ($r -like 'com.android.systemui*') -or ($r -like 'com.sec.*') -or ($d -like 'Notificaci*')
      $struct = $r -and ($r -match $noise) -and -not ($t -or $d -or $h)
      if (-not $sys -and -not $struct -and ($t -or $d -or $r -or $h -or $a.clickable -eq 'true')) {
        $out.Add(("{0} | txt={1} | a11y={2} | rid={3} | hint={4} | click={5} | enabled={6} | b={7}" -f `
          $a.class, $t, $d, $r, $h, $a.clickable, $a.enabled, $a.bounds))
      }
    }
    foreach ($c in $n.children) { Walk $c }
  }
  Walk $json
  $out | Out-File -Encoding utf8 $txt
}

$exit = 0
switch ($Mode) {
  'hierarchy' { Invoke-Hierarchy }
  'test'      { $exit = Invoke-Test }
  'step'      { $exit = Invoke-Test; Invoke-Hierarchy }
}
"DONE mode=$Mode exit=$exit $(Get-Date -Format s)" | Out-File -Encoding utf8 $done
exit $exit
