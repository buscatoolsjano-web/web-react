# Fase 20 · E1 — Los 358 activos, importados

Fecha: 2026-09-21. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: [`scripts/fase20-e1-procedencia.sql`](../scripts/fase20-e1-procedencia.sql) ·
importador: [`fase20-e1-importar-activos.mjs`](../scripts/fase20-e1-importar-activos.mjs) ·
reglas y tests: [`lib/fase20-mapeo.mjs`](../scripts/lib/fase20-mapeo.mjs) ·
[`fase20-e1-import-tests.mjs`](../scripts/fase20-e1-import-tests.mjs).
Auditoría previa: [`PHASE_20_MANTENIMIENTO_E0_AUDITORIA.md`](PHASE_20_MANTENIMIENTO_E0_AUDITORIA.md).

> **STEL, sólo GET.** El importador no tiene ningún método de escritura: la librería
> `stel-api.mjs` sólo sabe hacer GET. **STEL_WRITES = 0.**

---

## 1 · La procedencia

Cuatro columnas y un índice, con la convención que ya usan `products`, `sales_quotes`,
`sales_orders`, `deliveries`, `sales_invoices` y `payments`:

```sql
alter table public.maintenance_assets
  add column external_source text,        -- 'stel'
  add column external_id     text,        -- assets.id de STEL
  add column imported_at     timestamptz,
  add column last_synced_at  timestamptz;

create unique index uq_maintenance_assets_external
  on public.maintenance_assets (company_id, external_source, external_id)
  where external_id is not null;
```

Todas nulables y sin default, como sus equivalentes. **La `reference` no es la clave de
sincronización**: si STEL renumerara un activo, con la referencia se duplicaría y nadie se
enteraría. Con el id de STEL, el mismo activo sigue siendo el mismo —y hay un test que lo
verifica renumerando la referencia a propósito.

## 2 · La importación

| | |
|---|---|
| `STEL_ASSETS_FOUND` | **358** |
| `ASSETS_IMPORTED` | **358** |
| `MATCHED_CUSTOMERS` | **356** — 208 por CUIT, 148 por `legacy_ref`, **0 por nombre** |
| `ASSETS_WITHOUT_CUSTOMER` | **2**, con `owner_customer_id` nulo |
| `MISSING_SERIAL` | **4** |
| `DUPLICATE_SERIAL_ASSETS` | **10** |
| `DUPLICATE_SERIAL_GROUPS` | **5** |
| `BRANDS` | **13** textos · 336 activos enlazados a una marca que ya existía |
| `RAW_MODEL_VALUES` | **102** |
| clientes distintos | **16** |
| con ciudad | 355 · con garantía 120 · bajo contrato 42 |

**`DUPLICATE_SERIAL_GROUPS` = 5, no 7.** El informe de E0 decía 7 y estaba mal: 7 son las
**escrituras distintas** dentro de esos grupos —`2020 11 023052` y `2020-11-023052` son el mismo
serial escrito de dos formas—, y los grupos normalizados son 5. Corregido también en el E0.

### Tres cosas que el importador decidió no arreglar

1. **Dos activos traen la garantía al revés** (`2023-01-18 → 2023-01-17`) y la tabla tiene un
   CHECK que lo prohíbe. No se dio vuelta el rango ni se eligió una de las dos fechas: entran sin
   garantía y el valor original queda escrito en las notas
   (`Garantía en STEL, sin cargar por incoherente: …`). Se corrige en STEL y se vuelve a
   sincronizar.
2. **Los modelos entran tal cual**, con sus 102 escrituras para unos 60 modelos. `MODEL_NORMALIZATION_APPLIED = NO`.
3. **Las marcas no se crean.** Se enlaza `brand_id` sólo si el nombre coincide exacto con una
   marca que ya existe (336 de 358); las otras —ACRADYNE, ATLAS COPCO, PREMIER…— quedan como
   texto, que es el dato real.

### Idempotencia

`IMPORT_IDEMPOTENT = sí` · `SECOND_RUN_INSERTS = 0`. La segunda corrida con `--aplicar` reportó
`WOULD_INSERT 0 · WOULD_SKIP 358` y no escribió nada. El importador además **no escribe si los
números cambiaron**: verifica 358/356/2/0 contra lo auditado y aborta si algo no coincide.

### El efecto en la base

| tabla | antes | después |
|---|---|---|
| `maintenance_assets` | 0 | **358** |
| `maintenance_audit` | 0 | **358** |
| `maintenance_orders` · `order_parts` · `quote_lines` · `order_checks` · `measurements` | 0 | **0** |
| `maintenance_check_points` | 16 | 16 |
| `customers` · `products` · `brands` · `sales_quotes` | 1010 · 21828 · 26 · 307 | **iguales** |

`maintenance_audit` **no era parte del plan** y cambió igual: la tabla tiene un trigger
(`trg_ma_auditar`) que escribe una fila de auditoría por cada alta. Es el mecanismo de
trazabilidad del propio módulo, no algo que hiciera el importador, y 358 filas = 358 altas.

`SERVICE_DOCUMENTS_IMPORTED = 0` · `INCIDENTS_IMPORTED = 0`, como se decidió.

## 3 · La pantalla

| | |
|---|---|
| `DASHBOARD` | cuatro KPIs: **358 equipos · 102 textos de modelo · 16 clientes · 0 servicios** |
| `LIST` | Referencia + etiqueta · Nº de serie · Marca y modelo · Dueño · Alta · Tipo · Órdenes · Estado · **Servicio** |
| `QUICK_VIEW` | cajón superpuesto: la tabla mide **1247,7 px con el panel cerrado y abierto** |
| `DETAIL` | la ficha completa que ya existía, ahora con datos |

**«102 textos de modelo», no «102 modelos».** Es la etiqueta literal del KPI. Decir «102 modelos»
sería falso —el mismo aparece escrito de tres formas— y decir «60» sería inventado. Se dice qué se
está contando.

**Los chips dicen su número**: Todos 358 · Con serie 354 · Sin serie 4 · Sin cliente 2. No están
los del legacy que no aportan: «uno por modelo» serían 102, y «Mis fichas» necesita órdenes
asignadas, que hoy son cero.

**El cliente es el filtro de primer nivel**, y acá sí es un desplegable —en Clientes no, porque
son 1.010—: dieciséis clientes tienen los 358 equipos y dos de ellos tienen 141 y 134.

**«Sin servicios registrados», no «0 servicios».** Hasta que se importen los 82 documentos de
STEL, el contador en cero no es un historial vacío: es un historial que todavía no está.

### Un defecto que apareció midiendo

A 1024 px la tabla pedía 1.104 px y **la página entera se corría de costado** —no la tabla dentro
de su caja—, con el serial tomando 317 px por ser `nowrap`. Se le dejó cortar y por debajo de
1280 se guardan las dos columnas que hoy no dicen nada y que están en la ficha rápida (la cuenta
de órdenes y el estado). Medido después: 719 px de tabla en 721 de caja a 1024, y
`scrollX = 0`.

| ancho | resultado |
|---|---|
| 375 · 390 · 430 | tarjetas, serial destacado, **botón «Servicio» de 44 px**, sin desborde |
| 768 | tabla 639 en caja de 641, sin desborde |
| 1024 | tabla 719 en caja de 721, sin desborde · cajón no modal |
| 1440 | las nueve columnas, tabla 1248, sin desborde |

## 4 · Seguridad

`RLS_PASS = sí`, medido rol por rol sobre los 358 activos: **admin 358 · employee 358 ·
salesperson 0 · customer 0 · distributor 0 · anon 0** (la clave anónima devuelve `[]`). La
política es por empresa: la otra compañía del sistema ve 0. **No se creó el rol `technician`**: no
existe en los datos.

## 5 · Lo que queda para E2

Los **82 documentos de servicio** de STEL —31 presupuestos, 21 órdenes de trabajo, 30 remitos de
trabajo— con sus líneas, importes y estados. Con ellos aparecen tres cosas que hoy no se pueden
hacer con honestidad: el contador real de servicios por equipo, la última actividad, y la
decisión sobre el estado «En espera».

Y una auditoría aparte: **las equivalencias de modelo**. 102 textos, ~60 modelos. El dato
original ya está guardado; lo que falta es el modelo normalizado **al lado**, nunca encima.
