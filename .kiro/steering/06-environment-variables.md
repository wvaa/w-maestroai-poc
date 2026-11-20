---
inclusion: manual
---

# Variables de Entorno del Proyecto

Todas las variables se definen en el archivo `.env` en la raíz del proyecto. Nunca deben hardcodearse en los archivos YAML ni en los scripts.

## Configuración Inicial

```bash
cp .env.example .env
# Editar .env con los valores reales
npm install
```

La referencia completa de todas las variables disponibles está en `config/browserstack.env.example`.

## Variables Críticas (el agente siempre debe verificarlas)

| Variable | Requerida para | Descripción |
|---|---|---|
| `RUN_TARGET` | Siempre | `local` o `cloud` |
| `APP_PACKAGE` | Siempre | Package ID de la app (usado en `appId: ${APP_PACKAGE}` de los flows) |
| `MAESTRO_CLI_PATH` | Local | Ruta al binario de Maestro |
| `BROWSERSTACK_USERNAME` | Cloud | Usuario de BrowserStack |
| `BROWSERSTACK_ACCESS_KEY` | Cloud | API key de BrowserStack |
| `BROWSERSTACK_APP_ID` | Cloud | ID de la app subida (`bs://...`) |

## Convención de Nombres

Todas las variables siguen `UPPER_SNAKE_CASE`. En los flows YAML se referencian como `${VARIABLE_NAME}`:

```yaml
appId: ${APP_PACKAGE}
---
- tapOn:
    id: ".*input_email"
- inputText: ${USER_EMAIL}
```

Las variables de entorno que se pasan a un flow individual se definen en la sección `env:` del `runFlow`:

```yaml
- runFlow:
    file: ../../subflows/login_flow.yaml   # desde flows/tests/<tipo>/
    env:
      USER_EMAIL: ${TEST_USER}
      USER_PASS: ${TEST_PASS}
```

## Variables para los Flows de Prueba

El agente debe usar variables de entorno para datos de prueba sensibles. Nunca hardcodear:

```yaml
# ✗ Prohibido
- inputText: "usuario@ejemplo.com"
- inputText: "MiPassword123"

# ✓ Correcto
- inputText: ${TEST_USER}
- inputText: ${TEST_PASS}
```

Estas variables se definen en `.env` y se pasan a Maestro a través del orquestador o directamente via CLI:

```bash
# CLI directo para pruebas rápidas
maestro test --env TEST_USER=user@test.com --env TEST_PASS=pass123 flows/tests/smoke/APPSV002_login_happy_path.yaml
```

## Variables de Tags y Distribución de Shards

El sistema de tags conecta los flows con la distribución de ejecución paralela:

```yaml
# En el flow YAML:
tags:
  - smoke         # ejecutar en shard/dispositivo de smoke tests
  - regression    # ejecutar en shard/dispositivo de regression
```

```env
# En .env para BrowserStack shards:
BROWSERSTACK_SHARD_1_INCLUDE_TAGS=smoke
BROWSERSTACK_SHARD_2_INCLUDE_TAGS=regression

# En .env para local paralelo:
LOCAL_DEVICE_1_INCLUDE_TAGS=smoke
LOCAL_DEVICE_2_INCLUDE_TAGS=regression
```

**Regla:** Si un test debe ejecutarse en un shard o dispositivo específico, el tag del flow debe coincidir exactamente con el tag definido en la variable de entorno correspondiente.

## Reporte (sin variables de entorno)

El reporte HTML es propio de Banco CUSCATLAN y **no se configura desde `.env`**: `scripts/generate-report.js` no lee ninguna variable. Título, colores, logo (`config/logo_cusca.png`), footer, nombre de archivo (`reporte_APPSV_<timestamp>`) y exclusión de tests `APPSV001` están fijos en el script. El detalle está en `05-reporting-system.md`.

No agregues variables `REPORT_*` al `.env`: no tienen efecto. Si se necesita cambiar algo del reporte, hay que modificar `scripts/generate-report.js`.

## Seguridad

- El archivo `.env` está en `.gitignore` y nunca debe commitearse.
- Para CI/CD, las variables se inyectan como secrets del pipeline (GitHub Actions, Bitrise, etc.).
- El agente nunca debe leer ni imprimir los valores de `BROWSERSTACK_ACCESS_KEY` ni credenciales de usuario de prueba.
