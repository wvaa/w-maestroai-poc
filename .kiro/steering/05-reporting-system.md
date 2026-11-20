---
inclusion: manual
---

# Sistema de Reportes HTML

El proyecto genera reportes HTML con evidencias visuales a partir de los artefactos de cada ejecución.

## Cómo Funciona

```
npm test   →  artifacts/<test>_<hash>/result.json + screenshots
              artifacts/last-run.json  (índice de la ejecución)

npm run report  →  reports/report_YYYYMMDD_HHMMSS.html
                   reports/report_YYYYMMDD_HHMMSS.zip  (compartible)
                   reports/index.html  (histórico de todas las ejecuciones)
```

El script `scripts/generate-report.js` lee `artifacts/last-run.json`, carga el `result.json` de cada test y construye una tabla HTML con una fila por test.

## Contenido del Reporte

Cada fila del reporte muestra:
- **Nombre del test** (`name` del header YAML)
- **Dispositivo** y versión de OS
- **Duración** de la ejecución
- **Estado**: ✓ EXITOSO / ✗ FALLIDO / ? SIN RESULTADO
- **Capturas de pantalla** con lightbox interactivo (zoom con scroll, arrastrar, doble clic)
- **Mensaje de error** del subflujo específico (no del flujo principal genérico)

El reporte incluye:
- Buscador por nombre de test
- Filtro por estado (Exitoso / Fallido / Sin resultado)
- Resumen con contadores totales
- Índice histórico (`index.html`) con filtro por tipo de ejecución (cloud / local)

## Configuración del Reporte

El reporte tiene los siguientes valores fijos (igual al proyecto original):

- **Título:** `Reporte de evidencias APP 3.0 Banca Digital El Salvador`
- **Color header:** `#1B5A7D`
- **Logo:** `config/logo_cusca.png` (colocar el archivo en esa ruta)
- **Footer:** `Banco CUSCATLAN de El Salvador, S.A. | Todos los Derechos Reservados`
- **Nombre de archivo:** `reporte_APPSV_YYYYMMDD_HHMMSS.html`
- **Tests excluidos:** los que empiecen por `APPSV001` (tests de login/setup)
- **Ordenamiento:** por correlativo numérico `APPSVXXX`

## Estructura de `result.json`

Cada `artifacts/<dir>/result.json` tiene esta estructura — el agente puede leerla para diagnosticar fallos:

```json
{
  "name": "APPSV002 - Descripción del test",
  "flow": "flows/tests/smoke/APPSV002_login_happy_path.yaml",
  "status": "failed",
  "device": "Google Pixel 7",
  "duration_seconds": 45,
  "error_message": "Assert that \"Bienvenido\" is visible FAILED",
  "screenshots": ["screenshot_01.png", "screenshot_error_02.png"],
  "browserstack_url": "https://app-automate.browserstack.com/builds/..."
}
```

## Ciclo de Self-Healing con el Reporte

Cuando un test falla, el agente debe:

1. Leer `artifacts/last-run.json` para identificar los `artifact_dirs` fallidos.
2. Leer el `result.json` correspondiente para obtener `error_message`.
3. Llamar a `inspect_screen` / `take_screenshot` con el MCP de Maestro para ver el estado actual de la app.
4. Corregir el selector o agregar `extendedWaitUntil` en el flow correspondiente.
5. Re-ejecutar **solo ese test** con `maestro test flows/tests/.../APPSVxxx_<descripcion>.yaml` usando la herramienta `run` del MCP.
6. Una vez verde, ejecutar `npm run report` para actualizar el reporte.

## Artefactos Ignorados por Git

Las carpetas `artifacts/` y `reports/` están en `.gitignore`. Solo se versiona el código fuente, nunca los resultados de ejecución.
