---
inclusion: fileMatch
fileMatchPattern: "examples/**/*.yaml"
---

# Flujos Maestro

- Los flujos consumen este servicio desde un archivo `.js` ejecutado con `runScript` (ver `examples/maestro-flow.yaml` y `examples/fetch-service-payment.js`). No hay drivers de BD en Maestro.
- La lógica JS va en archivos `.js`, no en bloques `${...}` multilínea de `evalScript`, que solo admite una línea.
- Los datos del pago (`USRNAME`, `COLLECTOR_ID`, `SERVICE_IDENTIFIER`) se pasan en el `env` del `runScript`. No pongas URL base ni API key fijas en el YAML.
- Alternativa: `scripts/inject-env.js` consulta el servicio y ejecuta Maestro con `-e KEY=VALUE`.
- En BrowserStack el servicio debe ser alcanzable desde fuera de la red local. Revisa VPN, túnel o URL pública antes de culpar al flujo.
- Después de una prueba que consuma un insumo de pago, ejecuta la reversa para restaurarlo.
