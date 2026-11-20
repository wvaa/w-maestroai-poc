---

inclusion: manual

---

 

# Tarea: Auditoría, Limpieza y Refactorización de Flujos Maestro

 

Analiza los archivos YAML seleccionados (o todos los archivos dentro de `flows/`) y aplica una refactorización estricta siguiendo los estándares del proyecto:

 

1. **Eliminación de Duplicidad (DRY):**

   - Detecta secuencias de 3 o más pasos repetidos entre distintos tests y muévelos a un archivo en `flows/subflows/`.

   - Reemplaza los selectores directos en `flows/tests/` por llamadas a sus respectivos Page Objects en `flows/screens/`.

 

2. **Optimización de Esperas y Estabilidad:**

   - Reemplaza pausas fijas o redundantes por `extendedWaitUntil` con condiciones `visible` o `notVisible`.

   - Verifica que cada interacción crítica (`tapOn`, `inputText`) esté precedida por una validación o garantía de visibilidad.

 

3. **Validación de Rutas y Multiplataforma:**

   - Verifica que todas las rutas en `runFlow` y `runScript` sean relativas al archivo que las invoca (ej. `../../subflows/` desde `flows/tests/<tipo>/`) y que nunca salgan de `flows/` (compatibilidad BrowserStack).

   - Asegúrate de que no existan caracteres especiales sin escapar en expresiones regulares y que las variables sigan la convención `UPPER_SNAKE_CASE`.

 

4. **Formato y Documentación:**

   - Elimina comentarios obsoletos o código comentado.

   - Añade comentarios breves únicamente para separar bloques lógicos (ej. `# Arrange - Preparación`, `# Act - Ejecución`, `# Assert - Validación`).

   - Verifica que `flows/config.yaml` mantenga `flows: ["tests/**"]` (rutas relativas a `flows/`) para que Maestro no ejecute los Page Objects ni los subflows como tests independientes. No uses una clave `exclude:` (no existe); para excluir archivos concretos usa patrones con prefijo `!` dentro de `flows`.

 

Al finalizar, entrega un resumen conciso de los archivos creados, refactorizados y las mejoras de estabilidad aplicadas.
