---

inclusion: manual

---

 

# Compatibilidad Local (USB) vs BrowserStack Cloud

 

1. **Autocontención de la carpeta `flows/`:**

   - Todos los archivos YAML, scripts JS auxiliares y recursos necesarios para ejecutar la suite **DEBEN** residir estrictamente dentro de `flows/`.

   - **NUNCA** hagas referencias a rutas que salgan de `flows/` (ej. desde `flows/tests/smoke/` está prohibido `../../../config/`; tampoco uses rutas absolutas). BrowserStack comprime únicamente el directorio `flows/` al subir los tests.

   - Las rutas de `runFlow` y `runScript` son **relativas al archivo que las invoca**, no a `flows/` ni a la raíz del proyecto:

     | Desde | Hacia subflows | Hacia screens | Hacia data |
     |---|---|---|---|
     | `flows/tests/<tipo>/` | `../../subflows/x.yaml` | `../../screens/common/x.yaml` | `../../data/x.js` |
     | `flows/subflows/` | `x.yaml` | `../screens/common/x.yaml` | `../data/x.js` |
     | `flows/screens/<plataforma>/` | `../../subflows/x.yaml` | `x.yaml` (misma carpeta) | `../../data/x.js` |

     ✗ `file: flows/subflows/login_flow.yaml` · ✗ `file: ../subflows/login_flow.yaml` (desde un test)
     ✓ `file: ../../subflows/login_flow.yaml` (desde `flows/tests/<tipo>/`)

 

2. **Gestión del `appId`:**

   - No quemes un `appId` fijo en los flujos de prueba si difiere entre Android (`com.empresa.app`) e iOS (`com.empresa.app.ios`). Utiliza `${APP_PACKAGE}` en la cabecera de cada archivo YAML; su valor se define en `.env` (no confundir con `BROWSERSTACK_APP_ID`, que es el `bs://...` de la app subida).

   - `flows/config.yaml` solo define qué archivos son tests (`flows: ["tests/**"]`) y, si se necesitan, filtros globales `includeTags` / `excludeTags`. El `appId` no va ahí: sale de `APP_PACKAGE`.

 

3. **Tags de Ejecución:**

   - Todo archivo dentro de `flows/tests/` debe incluir etiquetas (`tags`) en su cabecera para permitir ejecuciones filtradas tanto en CLI local como en la API de BrowserStack:

     ```yaml

     appId: ${APP_PACKAGE}

     tags:

       - smoke

       - auth

     ---

     ```
