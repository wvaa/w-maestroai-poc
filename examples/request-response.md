# Ejemplos de request / response

## GET /service-payment

Parametros de query:

| Parametro      | Requerido | Descripcion                                                        |
| -------------- | --------- | ------------------------------------------------------------------ |
| `usrname`      | Si        | Usuario a filtrar.                                                 |
| `collector_id` | No        | Filtra por colector. Si se omite, no filtra por colector.          |
| `latest`       | No        | `true`/`1` devuelve solo el ultimo registro como objeto (no array).|

El resultado se ordena por `created` descendente (el ultimo registrado primero),
con `id` DESC como desempate.

### Request

```bash
curl -s "http://localhost:3000/service-payment?usrname=jdoe"
```

Filtrando por colector y pidiendo solo el ultimo registro:

```bash
curl -s "http://localhost:3000/service-payment?usrname=jdoe&collector_id=2010&latest=true"
```

Si el servicio tiene `API_KEY` configurada:

```bash
curl -s "http://localhost:3000/service-payment?usrname=jdoe" \
  -H "x-api-key: MI_TOKEN_SECRETO"
```

### Response 200 (con datos, array)

Array ordenado por `created` descendente (el ultimo registrado primero):

```json
[
  { "ssn": "123456789", "correlativo_collector": "COL-000987" },
  { "ssn": "123456789", "correlativo_collector": "COL-000980" }
]
```

### Response 200 (latest=true, un unico objeto)

```json
{ "ssn": "123456789", "correlativo_collector": "COL-000987" }
```

### Response 200 (sin resultados)

```json
[]
```

Con `latest=true` y sin resultados:

```json
null
```

### Response 400 (falta usrname)

```json
{
  "error": "Parametro \"usrname\" es obligatorio. Ej: /service-payment?usrname=jdoe"
}
```

### Response 401 (API key invalida, solo si API_KEY esta configurada)

```json
{
  "error": "No autorizado: x-api-key invalido o ausente."
}
```

### Response 502 (fallo de base de datos)

```json
{
  "error": "Fallo al consultar la base de datos.",
  "detail": "..."
}
```

> En `NODE_ENV=production` el campo `detail` se omite para no filtrar
> informacion interna.

---

## GET /health

```bash
curl -s "http://localhost:3000/health"
```

Response 200:

```json
{ "status": "ok", "database": "up" }
```

Response 503 (BD no responde):

```json
{ "status": "degraded", "database": "down", "error": "..." }
```
