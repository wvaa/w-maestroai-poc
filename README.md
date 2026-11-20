# Suite de Automatización Móvil con Agente IA

Proyecto de automatización E2E para aplicaciones móviles nativas (Android e iOS) usando **Maestro Framework**, con un agente IA autónomo integrado en **Kiro IDE**, orquestador de ejecución local y cloud (BrowserStack App Automate), y generador de reportes HTML con evidencias visuales.

---

## Índice

1. [Arquitectura del proyecto](#arquitectura-del-proyecto)
2. [Requisitos](#requisitos)
3. [Instalación](#instalación)
4. [Configuración](#configuración)
5. [Estructura de carpetas](#estructura-de-carpetas)
6. [Agente IA — Kiro IDE](#agente-ia--kiro-ide)
7. [Modos de ejecución](#modos-de-ejecución)
8. [Estructura de los flows](#estructura-de-los-flows)
9. [Sistema de reportes](#sistema-de-reportes)
10. [CI/CD — BrowserStack](#cicd--browserstack)
11. [Comandos de referencia](#comandos-de-referencia)

---

## Arquitectura del proyecto

El proyecto combina tres capas independientes que trabajan juntas:

```
┌─────────────────────────────────────────────────────────┐
│  Kiro IDE — Agente IA Autónomo                          │
│  (exploración, generación y validación de flows YAML)   │
│                                                         │
│  MCP: maestro ──► controla el dispositivo en tiempo real│
│  MCP: maestro-docs ──► consulta documentación oficial   │
└──────────────────────────┬──────────────────────────────┘
                           │ genera
                           ▼
┌─────────────────────────────────────────────────────────┐
│  flows/  (suite de pruebas YAML)                        │
│  ├── screens/   Page Objects por plataforma             │
│  ├── subflows/  Acciones reutilizables                  │
│  ├── tests/     Casos de prueba E2E                     │
│  └── data/      Variables y scripts auxiliares          │
└──────────────────────────┬──────────────────────────────┘
                           │ ejecuta
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Orquestador Node.js (scripts/)                         │
│  ├── run-maestro-browserstack.js  ──► npm test          │
│  └── generate-report.js          ──► npm run report     │
│                                                         │
│  Modos: local · local paralelo · cloud · cloud shards   │
└─────────────────────────────────────────────────────────┘
```

---

## Requisitos

| Requisito | Versión mínima | Verificación |
|---|---|---|
| Node.js | 18 | `node --version` |
| Maestro CLI | 1.38+ | `maestro --version` |
| Java (JDK) | 17+ | `java -version` |
| ADB (paralelo local) | cualquiera | `adb devices` |
| Kiro IDE | cualquiera | — |
| Cuenta BrowserStack | App Automate | solo para modo cloud |

**Instalar Maestro CLI:**
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-del-repositorio>
cd poc01_maestro

# 2. Instalar dependencias Node.js
npm install

# 3. Configurar variables de entorno
cp config/browserstack.env.example .env
# Editar .env con los valores reales

# 4. Verificar que Maestro está disponible
maestro --version
```

---

## Configuración

Toda la configuración se gestiona a través del archivo `.env` en la raíz del proyecto. La referencia completa de todas las variables disponibles está en `config/browserstack.env.example`.

### Variables mínimas — ejecución local

```env
RUN_TARGET=local
APP_PACKAGE=com.example.app
MAESTRO_CLI_PATH=/Users/<user>/.maestro/bin/maestro
MAESTRO_DEVICE_SERIAL=emulator-5554
```

### Variables mínimas — ejecución cloud

```env
RUN_TARGET=cloud
APP_PACKAGE=com.example.app
BROWSERSTACK_USERNAME=tu_usuario
BROWSERSTACK_ACCESS_KEY=tu_access_key
BROWSERSTACK_APP_ID=bs://<app-id>
BROWSERSTACK_DEVICE=Google Pixel 7
BROWSERSTACK_OS_VERSION=13.0
BROWSERSTACK_PROJECT=Maestro_POC
```

> El archivo `.env` está en `.gitignore` y nunca debe commitearse. Para CI/CD, inyectar las variables como secrets del pipeline.

---

## Estructura de carpetas

```
poc01_maestro/
│
├── .kiro/                              # Configuración del agente IA (Kiro IDE)
│   ├── steering/                       # Instrucciones permanentes del agente
│   │   ├── 01-maestro-explorer-agent.md    # Rol, ciclo de trabajo y herramientas MCP
│   │   ├── 02-maestro-coding-standards.md  # POM, selectores nativos Swift/Kotlin
│   │   ├── 03-browserstack-compliance.md   # Reglas de empaquetado para BrowserStack
│   │   ├── 04-runner-and-execution.md      # Modos de ejecución y uso del orquestador
│   │   ├── 05-reporting-system.md          # Sistema de reportes y ciclo de self-healing
│   │   ├── 06-environment-variables.md     # Variables de entorno y convenciones
│   │   └── clean-and-refactor.md           # Prompt manual de auditoría y refactorización
│   ├── prompts/
│   │   └── clean-and-refactor.md           # Mismo prompt accesible como /prompt
│   └── settings/
│       └── mcp.json                        # Configuración de servidores MCP (local)
│
├── flows/                              # Suite de pruebas (carpeta raíz para BrowserStack)
│   ├── config.yaml                     # Configuración del workspace de Maestro (descubrimiento de tests)
│   ├── screens/                        # Page Objects — componentes de pantalla
│   │   ├── android/                    # Selectores exclusivos de Android
│   │   ├── ios/                        # Selectores exclusivos de iOS
│   │   └── common/                     # Pantallas unificadas (Android + iOS)
│   ├── subflows/                       # Acciones reutilizables (login, logout, permisos)
│   ├── tests/                          # Casos de prueba E2E
│   │   ├── smoke/                      # Flujos críticos — validación rápida post-build
│   │   ├── sanity/                     # Flujos del área modificada en el sprint
│   │   ├── regression/                 # Suite completa de negocio
│   │   ├── e2e/                        # Flujos cruzados multi-módulo
│   │   └── negative/                   # Errores, validaciones y edge cases
│   └── data/                           # Archivos JS auxiliares o variables de entorno
│
├── scripts/                            # Orquestador y utilidades Node.js
│   ├── run-maestro-browserstack.js     # Runner principal (local y cloud)
│   ├── generate-report.js              # Generador de reporte HTML
│   └── fix-line-endings.js             # Convierte CRLF→LF en YAMLs (Windows)
│
├── config/
│   ├── browserstack.env.example        # Referencia completa de variables de entorno
│   └── logo_cusca.png                  # Logo para el reporte HTML
│
├── tests/                              # (generado automáticamente)
│   └── test-suite.json                 # Índice de tests generado por el runner
│
├── artifacts/                          # (generado, en .gitignore)
│   ├── <test>_<hash>/
│   │   ├── result.json                 # Resultado individual del test
│   │   └── *.png                       # Screenshots del test
│   └── last-run.json                   # Índice de la última ejecución
│
├── reports/                            # (generado, en .gitignore)
│   ├── reporte_APPSV_<timestamp>.html  # Reporte HTML de evidencias
│   ├── reporte_APPSV_<timestamp>.zip   # ZIP compartible (HTML + screenshots)
│   └── index.html                      # Histórico de todas las ejecuciones
│
├── .env                                # Variables de entorno locales (en .gitignore)
├── .gitignore
├── package.json
└── README.md
```

---

## Agente IA — Kiro IDE

El agente está configurado mediante **steering files** en `.kiro/steering/`. Estos archivos se cargan automáticamente en cada sesión de Kiro y definen el comportamiento, estándares y ciclo de trabajo del agente.

### Servidores MCP configurados

| Servidor | Función |
|---|---|
| `maestro` | Controla el dispositivo en tiempo real (inspección, ejecución, screenshots) |
| `maestro-docs` | Consulta la documentación oficial de Maestro |

Ambos se usan **implícitamente** — el agente los invoca automáticamente sin que el usuario lo solicite.

### Herramientas MCP disponibles

**`maestro` (CLI):**

| Herramienta | Uso |
|---|---|
| `list_devices` | Detectar dispositivos conectados al inicio |
| `inspect_screen` | Extraer árbol de UI antes de escribir selectores |
| `take_screenshot` | Validar visualmente estados de la pantalla |
| `run` | Ejecutar comandos YAML o archivos de flow |
| `cheat_sheet` | Consultar sintaxis avanzada de Maestro |

**`maestro-docs`:**

| Herramienta | Uso |
|---|---|
| `searchDocumentation` | Buscar en la documentación oficial |
| `getPage` | Leer una página completa de los docs |
| `askQuestion` | Resolver dudas sobre comandos y comportamiento |

### Ciclo de trabajo autónomo del agente

```
1. list_devices          → identificar dispositivo y plataforma
2. inspect_screen        → leer jerarquía de UI real
3. run (tapOn/inputText) → navegar por la pantalla
4. inspect_screen        → verificar nuevo estado tras cada interacción
5. Generar Page Objects  → flows/screens/common/ o android/ o ios/
6. Generar subflows      → flows/subflows/
7. Generar test final    → flows/tests/smoke/ o regression/
8. run (archivo YAML)    → ejecutar el test completo
9. Auto-healing          → si falla: inspect + corregir + re-ejecutar
```

### Steering files

| Archivo | Inclusión | Contenido |
|---|---|---|
| `01-maestro-explorer-agent.md` | Siempre | Rol del agente, herramientas MCP, ciclo de trabajo |
| `02-maestro-coding-standards.md` | Siempre | POM, selectores nativos Android/iOS, esperas |
| `03-browserstack-compliance.md` | Siempre | Autocontención en `flows/`, tags, `appId` variable |
| `04-runner-and-execution.md` | Siempre | Modos de ejecución, formato de headers YAML |
| `05-reporting-system.md` | Siempre | Reporte HTML, ciclo de self-healing con artefactos |
| `06-environment-variables.md` | Siempre | Variables, convenciones, seguridad |
| `clean-and-refactor.md` | Manual (`#`) | Auditoría y refactorización de flows existentes |

### Cómo iniciar una sesión con el agente

Abre el proyecto en Kiro IDE y escribe en el chat algo como:

```
Tengo la app com.example.app abierta en el emulador.
Explora el flujo de login y genera los tests.
```

```
Explora la pantalla de transferencia y crea el Page Object
y el caso de prueba para el flujo happy path.
```

```
#clean-and-refactor
Audita todos los flows en flows/tests/ y aplica las mejoras.
```

---

## Modos de ejecución

### Local — un dispositivo

```env
RUN_TARGET=local
MAESTRO_CLI_PATH=/Users/<user>/.maestro/bin/maestro
MAESTRO_DEVICE_SERIAL=emulator-5554
```

```bash
npm test
```

Ejecuta cada test secuencialmente con `maestro test <flow>`.

### Local — paralelo (múltiples dispositivos)

```env
RUN_TARGET=local
LOCAL_DEVICES=emulator-5554|R5CT20XXXXX|9A241XXXXX
LOCAL_DEVICE_1_NAME=Emulador Thread 1
LOCAL_DEVICE_1_INCLUDE_TAGS=smoke
LOCAL_DEVICE_2_NAME=Samsung Thread 2
LOCAL_DEVICE_2_INCLUDE_TAGS=regression
LOCAL_DEVICE_3_NAME=Pixel Thread 3
LOCAL_DEVICE_3_INCLUDE_TAGS=e2e
```

```bash
npm test
```

Distribuye los tests por tags y los ejecuta en paralelo real. Cada instancia de Maestro usa un puerto driver distinto (`--driver-host-port 7884+N`) para evitar conflictos.

### Cloud — BrowserStack (dispositivo único)

```env
RUN_TARGET=cloud
BROWSERSTACK_SHARDS_COUNT=0
BROWSERSTACK_DEVICE=Google Pixel 7
BROWSERSTACK_OS_VERSION=13.0
```

```bash
npm test
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

```bash
npm test
```

---

## Estructura de los flows

### Convención de nombres

```
flows/tests/smoke/APPSV002_nombre_del_caso.yaml
flows/tests/regression/APPSV050_nombre_del_caso.yaml
```

- Prefijo `APPSV` + correlativo de 3 dígitos, único en toda la suite.
- El `name` del header empieza por el mismo `APPSVxxx`: el reporte ordena por ese número.
- `APPSV001` está reservado para el login/setup y se excluye automáticamente del reporte.

### Tipos de prueba y carpetas

| Tipo | Carpeta | Tag | Propósito |
|---|---|---|---|
| Smoke | `flows/tests/smoke/` | `smoke` | 5-10 flujos críticos — login, home, navegación base. Se ejecutan en cada build. |
| Sanity | `flows/tests/sanity/` | `sanity` | Flujos del área modificada en el sprint actual. Más rápido que regression completa. |
| Regression | `flows/tests/regression/` | `regression` | Suite completa de todos los flujos de negocio. Se ejecuta antes de un release. |
| E2E | `flows/tests/e2e/` | `e2e` | Flujos cruzados multi-módulo: login → transferencia → consulta de saldo → logout. |
| Negative | `flows/tests/negative/` | `negative` | Errores, validaciones y edge cases: credenciales inválidas, montos fuera de rango, campos vacíos, timeout de sesión. |

```
flows/tests/
├── smoke/       → APPSV002_login.yaml, APPSV003_home.yaml ...
├── sanity/      → flujos del sprint actual
├── regression/  → suite completa de negocio
├── e2e/         → flujos cruzados multi-módulo
└── negative/    → errores, validaciones, edge cases
```

### Header obligatorio de cada test

```yaml
appId: ${APP_PACKAGE}
name: "APPSV002 - Descripción del caso de prueba"
tags:
  - smoke          # suite a la que pertenece
  - <tag-de-shard> # tag para distribución paralela (si aplica)
---
- launchApp
- runFlow:
    file: ../../subflows/login_flow.yaml   # relativa a flows/tests/smoke/
    env:
      USER_EMAIL: ${TEST_USER}
      USER_PASS: ${TEST_PASS}
# ... resto del test
- stopApp
```

### Arquitectura POM (Page Object Model)

```
flows/
├── screens/
│   ├── common/login_screen.yaml       # Pantalla unificada Android + iOS
│   ├── android/transfer_screen.yaml   # Pantalla exclusiva Android
│   └── ios/transfer_screen.yaml       # Pantalla exclusiva iOS
├── subflows/
│   ├── login_flow.yaml                # Acción reutilizable de login
│   ├── logout_flow.yaml               # Acción reutilizable de logout
│   └── handle_permissions_flow.yaml   # Manejo de permisos del sistema
└── tests/
    ├── smoke/APPSV002_login.yaml
    └── regression/APPSV010_transfer.yaml
```

### Estrategia de selectores (prioridad)

1. **`id`** — `resource-id` (Android) o `accessibilityIdentifier` (iOS)
   - Usar regex para unificar: `id: ".*btn_login"` funciona en ambas plataformas
2. **`text`** — texto visible o `accessibilityLabel`
3. **`point`** — coordenadas relativas, solo como último recurso

### Reglas de codificación

- Nunca hardcodear credenciales — usar `${VAR_NAME}`
- Nunca usar `wait` con tiempos fijos — usar `extendedWaitUntil`
- Las rutas en `runFlow` y `runScript` son relativas **al archivo que las invoca** y nunca deben salir de `flows/`:

  | Desde | Hacia subflows | Hacia screens | Hacia data |
  |---|---|---|---|
  | `flows/tests/<tipo>/` | `../../subflows/x.yaml` | `../../screens/common/x.yaml` | `../../data/x.js` |
  | `flows/subflows/` | `x.yaml` | `../screens/common/x.yaml` | `../data/x.js` |
  | `flows/screens/<plataforma>/` | `../../subflows/x.yaml` | `x.yaml` (misma carpeta) | `../../data/x.js` |

- Variables en `UPPER_SNAKE_CASE`

---

## Sistema de reportes

```bash
npm run report
```

Genera en `reports/`:

| Archivo | Descripción |
|---|---|
| `reporte_APPSV_<timestamp>.html` | Reporte HTML con tabla de resultados |
| `reporte_APPSV_<timestamp>.zip` | ZIP compartible (HTML + screenshots) |
| `index.html` | Histórico de todas las ejecuciones |

### Contenido del reporte

- Una fila por test con nombre, dispositivo, duración y estado
- Screenshots incrustadas con lightbox interactivo (zoom, arrastrar, teclado)
- Capturas de error con borde rojo y mensaje del subflujo específico
- Filtro por estado (Exitoso / Fallido / Sin resultado) y buscador por nombre
- Tests `APPSV001` (login/setup) excluidos automáticamente

### Ciclo de self-healing

Cuando un test falla, el agente puede diagnosticar y corregir automáticamente:

```
1. Leer artifacts/last-run.json → identificar tests fallidos
2. Leer result.json → obtener error_message
3. inspect_screen / take_screenshot → ver estado actual de la app
4. Corregir selector o agregar extendedWaitUntil
5. Ejecutar solo el test fallido con run (MCP)
6. npm run report → actualizar el reporte
```

---

## CI/CD — BrowserStack

BrowserStack comprime y sube únicamente el directorio `flows/`. Por eso **todos los archivos YAML deben estar autocontenidos dentro de `flows/`** — ninguna ruta puede salir de esa carpeta.

### Subir la app a BrowserStack

```bash
curl -u "USUARIO:ACCESS_KEY" \
  -X POST "https://api-cloud.browserstack.com/app-automate/upload" \
  -F "file=@app.apk"
# Respuesta: { "app_url": "bs://..." }
# Copiar ese valor en BROWSERSTACK_APP_ID del .env
```

### Configuración de `flows/config.yaml`

```yaml
flows:
  - "tests/**"   # rutas relativas a flows/; ** incluye subcarpetas
```

Esto evita que Maestro intente ejecutar los Page Objects como tests independientes.

---

## Comandos de referencia

```bash
# Instalar dependencias
npm install

# Ejecutar la suite (modo definido en .env)
npm test

# Generar reporte HTML desde la última ejecución
npm run report

# Convertir CRLF→LF en todos los YAML (necesario en Windows antes de subir a BrowserStack)
npm run fix-endings

# Ejecutar un test individual localmente (sin el orquestador)
maestro test flows/tests/smoke/APPSV002_login.yaml

# Ejecutar con variables de entorno
maestro test --env APP_PACKAGE=com.example.app flows/tests/smoke/APPSV002_login.yaml

# Listar dispositivos conectados
maestro list-devices

# Inspeccionar la pantalla actual
maestro studio
```

---

## Contribución y versionado

- Los archivos `artifacts/`, `reports/` y `tests/test-suite.json` están en `.gitignore` — no se versionan
- El archivo `.env` nunca se versiona — cada desarrollador mantiene el suyo
- La carpeta `flows/` es el único contenido que se sube a BrowserStack
- Los steering files en `.kiro/steering/` se versionan para mantener el comportamiento del agente consistente en todo el equipo
