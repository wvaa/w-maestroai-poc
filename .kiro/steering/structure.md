---
inclusion: always
---

# Estructura del proyecto

```
src/
  config.js      Lectura y validación de variables de entorno
  db.js          Pool de PostgreSQL y consultas
  server.js      Servidor Express y endpoints (/service-payment, /health)
scripts/
  inject-env.js  Consulta el servicio e inyecta variables para Maestro
  ping-db.js     Verifica conectividad con la BD
examples/
  fetch-service-payment.js, post-reversal.js, post-reverse-anda.js
  maestro-flow.yaml
  request-response.md
.kiro/
  agents/        Agentes (ReversaPagosServiciosAgent)
  steering/      Estas guías
.env.example     Plantilla de variables de entorno
```

## Dónde poner cosas nuevas
- Lógica de acceso a datos: `src/db.js`.
- Endpoints: `src/server.js`.
- Variables de entorno nuevas: `src/config.js` y `.env.example`.
- Utilidades de línea de comandos: `scripts/`.
- Ejemplos de uso con Maestro o reversas: `examples/`.
