---
inclusion: always
---

# Producto: service-payment-http

Servicio HTTP intermedio entre flujos de **Maestro Framework** (local y BrowserStack) y la base **PostgreSQL** del Core bancario.

## Problema
El motor JavaScript de Maestro no tiene drivers de base de datos ni sockets TCP. Este servicio consulta PostgreSQL y devuelve JSON por HTTP, para que Maestro lo consuma con `http.get(...)` + `json(...)`, o para que un orquestador Node inyecte los datos como variables de entorno.

## Caso de uso principal
Los insumos de pago de servicios (ANDA, AES) son de un solo uso. Tras una prueba de Maestro se consulta el correlativo del último pago de un usuario y se ejecuta la reversa para dejar el insumo reutilizable.

## Consulta soportada
La consulta del correlativo usa únicamente `usrname` y `collector_id`. No agregues otros filtros.

## Agente asociado
`.kiro/agents/ReversaPagosServiciosAgent.md` ejecuta el flujo de reversa de punta a punta.
