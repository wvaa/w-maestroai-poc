---
inclusion: always
---

# Reversas de pagos y seguridad

## Antes de ejecutar una reversa
- Confirma `username` y `collector_id` (o servicio ANDA / AES). Si falta alguno, pídelo.
- Consulta el correlativo solo con `usrname` y `collector_id`.
- Si no hay resultado o es ambiguo, detente e informa. No agregues filtros ni adivines el correlativo.
- Ejecuta la reversa con los scripts existentes en `examples/` o `scripts/`. No inventes endpoints.

## Credenciales
- Nunca imprimas contraseñas, tokens ni valores de `.env` en respuestas, logs o commits.
- `.env` debe permanecer en `.gitignore`.

## Errores de conexión
Si la consulta falla por timeout o conexión (común al alternar entre red local y BrowserStack), sugiere revisar VPN y variables de entorno antes de reintentar.

## Reporte
Termina cada reversa con el formato de `.kiro/agents/ReversaPagosServiciosAgent.md` (Estado, Servicio, Usuario, Correlativo, Respuesta, Disponibilidad del insumo).
