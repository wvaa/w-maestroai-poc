---
inclusion: always
---

# Stack y convenciones técnicas

## Stack
- Node.js >= 18, CommonJS (`require`, no ESM).
- Express para el servidor HTTP.
- `pg` (node-postgres) con pool y consultas parametrizadas (`$1`, `$2`). Sin ODBC ni librerías nativas.
- Pruebas móviles con Maestro (YAML) en local y BrowserStack.

## Comandos
- `npm install`
- `cp .env.example .env` y completar valores reales
- `npm start` (producción), `npm run dev` (recarga con `node --watch`)

## Reglas
- Toda consulta SQL es parametrizada. Nunca concatenes valores del usuario al SQL.
- Configuración solo por variables de entorno, leída desde `src/config.js`. No hardcodees host, usuario, contraseña, tokens ni URLs de entorno.
- Si agregas una variable de entorno, añádela a `.env.example` sin valor real.
- Con `NODE_ENV=production` no devuelvas el detalle interno de errores de BD al cliente.
- Si `API_KEY` está definida, el endpoint exige el header `x-api-key`.
- Códigos HTTP: 200 (con o sin resultados), 400 (falta `usrname`), 401 (API key inválida), 502 (fallo de BD), 500 (error interno), `/health` 200 o 503.
- Respuestas de error en JSON: `{ "error": "..." }`.
- No modifiques lógica existente de conexión o reversa sin que se pida explícitamente.
