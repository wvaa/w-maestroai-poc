---
inclusion: manual
---

# Sistema de Ejecución y Orquestador

Este proyecto incluye un orquestador Node.js en `scripts/run-maestro-browserstack.js` que gestiona la ejecución de la suite completa. El agente debe conocer este sistema para operar correctamente.

## Comandos Disponibles

```bash
npm install          # Instalar dependencias (solo la primera vez)
npm test             # Ejecutar la suite completa según RUN_TARGET en .env
npm run report       # Generar reporte HTML desde los artifacts de la última ejecución
npm run fix-endings  # Convertir CRLF→LF en todos los YAML de flows/ (necesario antes de subir a BrowserStack)
```

## Modos de Ejecución (`RUN_TARGET`)

### Local — un dispositivo
```env
RUN_TARGET=local
MAESTRO_CLI_PATH=maestro
MAESTRO_DEVICE_SERIAL=emulator-5554
```
Ejecuta cada test secuencialmente con `maestro test <flow>`. Los artefactos se guardan en `artifacts/`.

### Local — paralelo (múltiples dispositivos)
```env
RUN_TARGET=local
LOCAL_DEVICES=emulator-5554|R5CT20XXXXX
LOCAL_DEVICE_1_NAME=Emulador Thread 1
LOCAL_DEVICE_1_INCLUDE_TAGS=smoke
LOCAL_DEVICE_2_NAME=Físico Thread 2
LOCAL_DEVICE_2_INCLUDE_TAGS=regression
```
Detecta los dispositivos, distribuye los tests por tags o round-robin, y los ejecuta en paralelo real usando `spawn`. Cada instancia de Maestro usa un puerto driver distinto (`--driver-host-port 7884+N`) para evitar conflictos.

### Cloud — BrowserStack (dispositivo único)
```env
RUN_TARGET=cloud
BROWSERSTACK_USERNAME=...
BROWSERSTACK_ACCESS_KEY=...
BROWSERSTACK_APP_ID=bs://<app-id>
BROWSERSTACK_SHARDS_COUNT=0
```

### Cloud — BrowserStack (shards paralelos)
```env
RUN_TARGET=cloud
BROWSERSTACK_SHARDS_COUNT=3
BROWSERSTACK_DEVICES=Samsung Galaxy S25 Ultra-15.0|Google Pixel 7-13.0
BROWSERSTACK_SHARD_1_NAME=Thread 1
BROWSERSTACK_SHARD_1_INCLUDE_TAGS=smoke
BROWSERSTACK_SHARD_2_NAME=Thread 2
BROWSERSTACK_SHARD_2_INCLUDE_TAGS=regression
BROWSERSTACK_SHARD_3_NAME=Thread 3
BROWSERSTACK_SHARD_3_INCLUDE_TAGS=e2e
```

## Comportamiento Automático del Runner

1. **Genera `tests/test-suite.json`** escaneando todos los `.yaml` en `flows/` (nivel raíz) y extrayendo `name`, `appId` y `tags` del header YAML.
2. **Filtra por tags** si `BROWSERSTACK_TAGS` está definido antes de ejecutar.
3. **Convierte CRLF→LF** automáticamente en todos los YAML antes de empaquetar el ZIP para BrowserStack.
4. **Guarda `artifacts/last-run.json`** al finalizar con el listado de `artifact_dirs` para que `npm run report` pueda leerlos.
5. **Por cada test** genera una carpeta en `artifacts/<nombre_test>_<hash>/` con `result.json` y las screenshots copiadas.

## Estructura de Carpetas de Tests

```
flows/tests/
├── smoke/       → 5-10 flujos críticos — login, home, navegación base
├── sanity/      → flujos del área modificada en el sprint actual
├── regression/  → suite completa de negocio (todos los flujos)
├── e2e/         → flujos cruzados multi-módulo (login→transferencia→saldo)
└── negative/    → errores, validaciones, edge cases (credenciales inválidas,
                   montos fuera de rango, campos vacíos, timeout de sesión)
```

## Clasificación de Tests — Regla para el Agente

**Antes de guardar un nuevo test, el agente DEBE preguntar al usuario el tipo de prueba** si no fue indicado explícitamente en la solicitud. La pregunta es:

> "¿Este caso de prueba es smoke, sanity, regression, e2e o negative?"

Si el usuario lo indica desde el inicio (ej. "genera un smoke test para login"), el agente lo clasifica directamente sin preguntar.

| Tipo | Carpeta | Tag | Cuándo usarlo |
|---|---|---|---|
| Smoke | `flows/tests/smoke/` | `smoke` | Flujo crítico que debe pasar en cada build |
| Sanity | `flows/tests/sanity/` | `sanity` | Área modificada en el sprint actual |
| Regression | `flows/tests/regression/` | `regression` | Flujo completo de negocio |
| E2E | `flows/tests/e2e/` | `e2e` | Flujo que cruza múltiples módulos |
| Negative | `flows/tests/negative/` | `negative` | Error, validación o caso borde |

## Reglas para los Flows Generados por el Agente

Para que el runner procese correctamente cada test, **todo archivo en `flows/tests/`** debe tener este header:

```yaml
appId: ${APP_PACKAGE}
name: "APPSVxxx - Descripción del caso de prueba"
tags:
  - smoke         # tipo de prueba (smoke/sanity/regression/e2e/negative)
  - <tag-de-shard-si-aplica>
---
```

- `name` es el texto que aparece en el reporte — debe ser descriptivo, único y **empezar por `APPSVxxx`** (mismo correlativo que el archivo). El reporte ordena por ese número y excluye los que empiezan por `APPSV001`.
- `appId: ${APP_PACKAGE}` permite cambiar el paquete sin modificar los flows.
- El primer tag debe coincidir con el tipo de prueba y la carpeta donde se guarda.
- Los tags de shard controlan en qué thread/dispositivo se ejecuta el test en ejecución paralela.

## Convención de nombres de archivo

Formato: `APPSV<correlativo de 3 dígitos>_<descripcion_en_snake_case>.yaml` (prefijo del proyecto APP 3.0 Banca Digital El Salvador).

```
APPSV001_inicio_sesion.yaml                → reservado: login/setup (excluido del reporte)
APPSV002_login_happy_path.yaml             → smoke
APPSV010_transferencia_propia.yaml         → regression
APPSV050_login_credenciales_invalidas.yaml → negative
APPSV100_flujo_pago_completo.yaml          → e2e
```

Reglas:
- El correlativo es **único en toda la suite** (no por carpeta). Antes de crear un test, revisa los existentes en `flows/tests/**` y usa el siguiente número libre.
- `APPSV001` está reservado para el flujo de inicio de sesión/setup: el reporte lo excluye automáticamente. No lo uses para un caso de prueba real.
- El `name` del header debe empezar por el mismo `APPSVxxx` que el nombre del archivo.

## Después de Crear un Nuevo Test

Cuando el agente crea un archivo en `flows/tests/`, debe:
1. Confirmar con el usuario el tipo de prueba si no fue especificado.
2. Guardar el archivo en la subcarpeta correcta según la tabla de clasificación.
3. Verificar que el archivo tiene `name` y `tags` en el header con el tag del tipo correcto.
4. Informar al usuario que ejecute `npm test` para validar el flujo.
5. Recordar que `tests/test-suite.json` se regenera automáticamente en cada `npm test` — no editarlo manualmente.
