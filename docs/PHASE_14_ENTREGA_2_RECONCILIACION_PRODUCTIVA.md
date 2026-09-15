# FASE 14 · ENTREGA 2 — RECONCILIACIÓN PRODUCTIVA CONTROLADA STEL → REACT

> Esta entrega **implementa** el camino seguro para dejar correctos los datos históricos de Ventas de
> Buscatools con STEL Order como fuente de verdad, y deja el **dry run final** listo para autorizar.
> **No se ejecutó la reconciliación productiva.** STEL sigue siendo la autoridad de numeración; no se
> tocaron `document_numbering_authority`, secuencias, stock, avisos, botones, Gmail ni STEL. Los datos
> productivos quedaron idénticos (hash por tabla antes y después, § 9). Fecha: 2026-09-15.

## 0. Resultado

| | |
|---|---|
| API_REFRESH | STEL leído **2026-09-15 ~20:20 UTC**, 59 llamadas, 0 errores. Cotizaciones 303 (última **COTI02555**), pedidos 170 (último **PDV01318**), remitos **192** (último **RT0000001432**, nuevo desde E1) |
| Cambios desde E1 | +1 remito (RT0000001432) · modificados PDV01318 y RT0000001431 · +3 productos en uso (PRO12615–12617) |
| PLAN_HASH | `e62de165c350699ccd14cce6bab6d4c9f4b0643573f81d8d5a30eeeb8e8ac4e8` |
| CUTOVER_READY | **NO** (§ 12) |

### Gate 1 — dry run final

| | |
|---|---|
| PRODUCTS_TO_CREATE | **53** (46 productos + 7 servicios; 27 inactivos en STEL → `discontinued`; 26 con precio STEL en «Lista base») |
| PRODUCTS_TO_LINK | **711** (SKU único exacto + nombre compatible → se guarda el id STEL) |
| PRODUCTS_BLOCKED | **2** (NAME_MISMATCH: `SP.2007VPM/80`, `SP.2008VP/100`) |
| CATEGORY_TO_CREATE | 1 — «Pendiente de clasificación STEL» (`needs_review = true`) |
| DOCUMENTS_TO_INSERT | **30** (16 cotizaciones, 4 pedidos, 10 remitos) |
| DOCUMENTS_TO_UPDATE | **635** (1.563 cambios de campo; 1.270 son el id STEL `external_source`/`external_id`) |
| LINES_TO_INSERT | **81** (78 en documentos nuevos + 3 en COTI02516/COTI02523) |
| LINES_TO_UPDATE | **728** líneas · 1.400 cambios de campo (595 precio + 595 descuento de remitos históricos, 187 vínculos a producto, 23 contenido de cotizaciones editadas en STEL) |
| LINES_TO_DELETE_PENDING_APPROVAL | **8** (§ 6) |
| CURRENCY_FIXES | **32** (6 cotizaciones, 11 pedidos, 15 remitos: 19 USD, 13 ARS) |
| TOTAL_FIELD_FIXES | 205 (subtotal, IVA, total y descuento global = valores oficiales STEL) |
| STATUS_FIXES | 24 (cotizaciones `sent → accepted`, Cerrada en STEL) |
| RELATION_FIXES | **32** (14 pedido→cotización, 7 remito→pedido, 11 remito→cotización directa) |
| BLOCKED | **3** (2 NAME_MISMATCH + COTI02530 estado regresivo) |

Archivos del dry run (ignorados por git, con datos de clientes): `scripts/output/e2/plan-e62de165c350.json`,
`gate1-…`, `huella-antes-…`, `respaldo-…` (filas actuales de todo lo que el plan tocaría).

## 1. Schema (aplicado: sólo estructura, 0 filas cambiadas)

Migraciones `fase14_e2_reconciliacion_stel`, `fase14_e2_app_usage_service_role` y
`fase14_e2_vinculo_producto_atomico`. SQL completo y rollback: `docs/database/PHASE_14_ENTREGA_2_RECONCILIACION_STEL.sql`.

| Cambio | Por qué |
|---|---|
| `products.external_source/external_id` + único (empresa, fuente, id) + CHECK de par | Identidad externa estable del ítem STEL. **No** se reutiliza `legacy_ref` ni el SKU |
| Únicos (empresa, fuente, id) en `sales_quotes`, `sales_orders`, `deliveries` | Las columnas ya existían; ahora un id STEL no puede estar en dos documentos |
| `deliveries.source_quote_id` (FK, excluye `order_id`) | 11 remitos reales salen de una cotización sin pedido: no se inventan pedidos |
| `stel_reconciliation_runs` / `stel_reconciliation_log` | Bitácora propia `source = STEL_RECONCILIATION`, run id, entidad, id STEL, acción, valor viejo/nuevo. RLS sin políticas y sin grants para anon/authenticated |
| `app.stel_reconciliation_ctx` + `app.en_reconciliacion_stel()` | Contexto de transacción (xid) que sólo escriben las RPC. No se puede falsificar desde la app |
| Puerta en 7 funciones de trigger | `bloquear_cotizacion_cerrada`, `bloquear_lineas_cotizacion_cerrada`, `bloquear_pedido_cerrado`, `bloquear_lineas_pedido_cerrado` y `proteger_borrado_{cotizacion,pedido,entrega}` se abren **sólo** dentro de ese contexto. Pedidos derivados y stock movido siguen bloqueando siempre |
| `app.proteger_campos_importacion` (trigger en cotizaciones, pedidos, remitos y productos) | Un usuario de la app no puede poner ni cambiar `imported_at`, `legacy_source`, `external_source`, `external_id` ni `source_quote_id` |
| RPC `public.stel_*` | EXECUTE sólo `service_role` + chequeo `auth.role() = 'service_role'`, SECURITY DEFINER con `search_path` fijo |
| `grant usage on schema app to service_role` | Corrección: tres de los triggers con puerta no son SECURITY DEFINER y las escrituras del rol de servicio fallaban con «permission denied for schema app». Lo detectó la suite antes de cualquier uso productivo; el esquema `app` no está expuesto por REST |
| Vínculo de producto como un solo registro `external` | Corrección: revertirlo en dos pasos violaba el CHECK de par. Lo detectó la prueba de rollback |

`src/types/database.types.ts`: columnas nuevas de `products` y `deliveries`.

## 2. Seguridad

- **Camino de escritura:** `stel_reconciliacion_iniciar` → `stel_asegurar_categoria_revision` →
  `stel_reconciliar_producto` → `stel_reconciliar_documento` → `stel_reconciliacion_cerrar`; rollback con
  `stel_revertir_reconciliacion`. **Un documento = una llamada = una transacción.**
- **Lo que exige la RPC de documento:**
  - un run `running` de esa empresa;
  - un id STEL numérico y un número con patrón válido;
  - columnas en lista blanca por tabla y operación;
  - referencias (cliente, cotización, pedido, producto, depósito) de la misma empresa;
  - en updates, que el valor actual sea el `old` del plan (si no, `conflicto` y rollback del documento entero);
  - que el estado coincida con el estado STEL (`app.stel_estado_react`) y nunca sea regresivo;
  - id externo nulo o igual;
  - que el documento sea histórico (`imported_at`).
- **Lo que no hace:**
  - no llama a `next_document_number`;
  - no escribe `stock_movements` ni `sales_audit`;
  - no cambia la autoridad;
  - `iniciar` exige que la autoridad de las tres series siga siendo STEL.
- **Borrados:** sólo con `aprobado: true` por línea; la fila completa queda en la bitácora.
- **Ejecutor (`ejecutarPlan`):**
  - en una empresa no `zz-` se niega salvo `autorizacion = { confirmado: true, planHash }` idéntico al hash del plan;
  - `aplicar` vuelve a leer STEL, rearma el plan y **se detiene sin escribir si el hash cambió**.
- **Red team (suite E2):** anon, admin, employee, salesperson, technician, customer y distributor → las 6 RPC
  devuelven **permiso denegado**; ninguno lee la bitácora ni los runs.
  - Admin por REST tampoco puede marcar, desmarcar o cambiar la importación, poner un id STEL, poner
    `source_quote_id`, crear un documento importado ni vincular un producto a STEL.
  - Fuera de la RPC, el trigger sigue congelando una cotización aceptada (**no hay bypass general**).
- **Advisor de seguridad:** ninguna función `stel_*` ejecutable por usuarios; las dos tablas de bitácora
  aparecen como «RLS sin políticas» (buscado: sólo `service_role`).
- **Clave STEL:** se lee de `.env.stel.local` (ignorado), sólo como header, errores limpiados. Cache temporal
  por corrida en `.stel-cache/e2-*`, borrada al terminar. Escaneo final en § 10.

## 3. Productos — decisión operativa

**STEL es hoy el maestro de productos y la fuente de precios** (14.659 productos, 41 creados en 30 días,
12 tarifas; E1 § 13). React **no** habilita edición de productos ni precios a partir de esto; la
reconciliación sólo:

1. **Vincula** (711): producto React con SKU único exacto y nombre compatible → guarda el id STEL. No pisa
   nombre, descripción, categoría ni precio del catálogo React.
2. **Bloquea** (2): SKU coincide pero el nombre describe otra cosa → revisión humana; sus líneas conservan
   el producto actual.
3. **Crea** (53) con datos de STEL:
   - SKU, nombre, descripción, `product_type = 'Servicio'` para `/services/`;
   - estado (`inactive` → `discontinued`);
   - `needs_review = true`;
   - categoría técnica **«Pendiente de clasificación STEL»**. No había categoría de revisión: las 8
     existentes son de catálogo, «Otros» incluida. No se modifica ninguna.
   Marca: STEL no la trae → vacía. Unidad: la API no la expone.
4. **Precio de catálogo:** `sales-price` > 0 de STEL en la lista por defecto «Lista base» (USD) para los 26
   que lo tienen. Las 12 tarifas de STEL no tienen equivalente en las listas React: **no se mapean**.
5. **Precio de documento ≠ precio de catálogo:** las líneas usan `item-base-price` y `discount-percentage` de
   la línea STEL, nunca el precio maestro actual.

## 4. Clientes

Para insertar sólo se acepta:
- CUIT exacto;
- nombre normalizado **confirmado** porque ese mismo cliente STEL ya está vinculado a ese mismo cliente React
  en documentos emparejados.

Nunca por parecido. En el plan actual los 30 documentos nuevos resuelven cliente con esa regla; el cliente
ambiguo de E1 (COTI02452) no genera acción. No se agregó id STEL en `customers` (no lo requiere esta
entrega).

## 5. Moneda, totales y estado

| Tema | Regla |
|---|---|
| Moneda | Sólo `currency-code` de STEL. 32 documentos sin moneda → 19 USD, 13 ARS. Si React tiene **otra** moneda, se bloquea para revisión |
| Cambios reales entre documentos | COTI02339 ARS → PDV01223 USD y PDV01274 USD → RT0000001382 ARS **se preservan** (no se fuerza la misma moneda) |
| Tipo de cambio | **No se copia** (122 documentos no USD). STEL = USD por unidad; React no tiene semántica fijada |
| Totales | Se guardan los oficiales STEL. Mapeo: Σ neto de líneas = subtotal bruto → `discount-percentage` = `discount_pct` → `subtotal-amount` (gravado, después del descuento) = `subtotal` → `tax-total-amount` = `tax_amount` → `total-amount` = `total`. Es la misma semántica que el cálculo React (subtotal después del descuento global) |
| Auditoría de totales | Cada documento reconciliado deja una nota con subtotal bruto, descuento, subtotal/IVA/total STEL y total calculado. En 6 (COTI02254, COTI02485, PDV01151, PDV01279, RT0000001242, RT0000001398) las líneas de STEL no cierran: se guarda el total oficial y el motivo |
| Subtotal/IVA en 0 del sync viejo | STEL devuelve los valores reales → se corrigen (56 documentos) |
| Descuento global | 18 cotizaciones con subtotal pre-descuento → subtotal, total y `discount_pct` de STEL |
| Estado | Cotización: Pendiente/En curso → `sent`, Cerrada/Cerrado/Aceptada → `accepted`, Rechazada → `rejected`. Pedido: Rechazado → `cancelled`, resto `confirmed`. Remito: `delivered`. Nunca regresivo (COTI02530 `accepted` en React / Pendiente en STEL → bloqueado) |
| Default USD en el flujo nuevo | **No se toca** (sigue como blocker del cutover) |

## 6. Líneas y borrados

- **Emparejado por contenido:** SKU, cantidad y precio; después sólo SKU; después posición. El orden distinto
  no es un cambio (9 cotizaciones con otro orden: no se tocan `line_no` ni ids).
- **Actualización:** campo por campo con el valor viejo como guarda; se preservan id, `line_no` y
  relaciones.
- **Borrados pendientes (8)**, detenidos para aprobación sin frenar el resto:

| Documento | Líneas React sobrantes | Clasificación | Aguas abajo |
|---|---|---|---|
| COTI02489 (aceptada) | PRO11778, UN.PTE15N | Edición real posterior en STEL (modificada 2026-09-01; STEL 1 línea, React 3) | Tiene PDV01296, pero **ninguna** línea de pedido referencia esas líneas |
| COTI02516 | PRO00238 (2.ª de dos) | Línea duplicada en React; STEL la reemplazó por GE.TSN125A (modificada 2026-09-07) | Sin pedidos |
| RT0000001405 | PRO12591, PRO12587, PRO12590, PRO12589, PRO12588 | Error de migración: son las líneas de COTI02499, que STEL ya no tiene | Sin pedido, **0 movimientos de stock** |

- **Aprobar borrados:** pasar a `aplicar` un archivo con los ids de línea aprobados (`--aprobar-borrados`).
  Cambia el plan y su hash, así que requiere un nuevo dry run.
- **Ningún documento se borra.** COTI02499 queda como `SOURCE_MISSING / PROBABLE_DELETED_IN_STEL` y se
  conserva.

## 7. Relaciones

- **Sólo por `parent-document-id` + `parent-document-path` de STEL:**
  - 14 `sales_orders.quote_id`;
  - 7 `deliveries.order_id`;
  - 11 `deliveries.source_quote_id` (remitos desde cotización);
  - en los 30 documentos nuevos, su padre cuando existe. Si el padre se inserta en el mismo run, se
    resuelve al id recién creado.
- **RT-ML:** se importa con su número y serie originales (`series_code = 'RT-ML'`). No se crea secuencia:
  sólo hará falta si React emite RT-ML.

## 8. Ejecución, fallos, idempotencia y rollback

**Orden:**
1. snapshot (huella + respaldo);
2. STEL leído ahora;
3. plan (hash debe ser el autorizado);
4. categoría de revisión y productos;
5. cotizaciones;
6. pedidos;
7. remitos (con relaciones);
8. verificación de invariantes;
9. segundo plan = 0.

- **Fallos:** documento atómico. Si falla, se registra y **sus dependientes no corren**:
  - pedido cuyo vínculo es a esa cotización;
  - remito de ese pedido;
  - documento cuyas líneas usan un producto que no se pudo crear.
- **Idempotencia:** el id STEL + la comparación con los valores actuales hacen que la segunda corrida dé 0
  acciones (probado).
- **Rollback, sin depender de PITR:**
  1. `stel_revertir_reconciliacion` recorre la bitácora del run al revés (lotes atómicos). Deshace updates
     con guarda de conflicto, borra lo insertado (documentos, líneas, productos, precios, categoría) y
     reinserta líneas borradas con su id.
  2. Material adicional: `respaldo-*.json` con las filas actuales de todo lo que el plan toca.
  3. Probado: después de 3 runs (incluido un borrado aprobado), la huella de negocio de la empresa vuelve a
     ser **idéntica** en cabeceras, líneas, relaciones, productos, precios y categorías. `updated_at` no
     vuelve: lo mueve el trigger `touch`.

## 9. Invariantes verificados

| Qué | Resultado |
|---|---|
| Datos productivos después de las 3 migraciones y todas las suites | Hash por tabla (secuencias, autoridad, cotizaciones, pedidos, remitos y sus líneas, productos, precios, categorías, clientes, movimientos y saldos de stock) **idéntico** al baseline de las 19:53 UTC; 0 reservas, 0 eventos; 0 runs y 0 filas de bitácora en productivo; 0 filas zz |
| Stock en fixture | 0 movimientos, 0 reservas, 0 saldos creados por la reconciliación |
| Secuencias y autoridad en fixture | Sin cambios |

## 10. Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase14-stel-e2-tests.mjs` (nueva) | **ALL PASS** (69 comprobaciones) |
| `scripts/fase14-stel-api-reconcile-fixture-tests.mjs` (E1) | ALL PASS |
| `scripts/fase14-ventas-cutover-fixture-tests.mjs` (E0) | TODO PASA |
| `scripts/fase12-configuracion-entrega25-stel-guard-tests.mjs` | TODO PASA (una expectativa actualizada: el admin que finge una importación ahora lo frena antes el guard de campos: PERMISO en vez de STEL) |

La suite E2 cubre:
- import de productos y sync idempotente;
- alta y actualización de documentos, incluida la cotización cerrada;
- monedas, relaciones y remito directo de cotización;
- remito histórico sin movimiento de stock;
- idempotencia, fallo parcial (conflicto concurrente → documento intacto y dependiente salteado), reintento
  y segunda corrida en cero;
- borrado sin aprobación (rechazado) y aprobado (con fila en la bitácora);
- rollback;
- ejecución productiva sin autorización o con hash ajeno (negada antes de tocar la base);
- red team de 7 roles y campos de importación desde la app.

Escaneo de la clave STEL (§ 2): 0 apariciones en repo, historial git, `dist`, `scripts/output` y temporales.

## 11. Cómo se ejecuta cuando se autorice

```
set -a; . ./.env; . ./.env.migration; set +a
node scripts/fase14-stel-e2-reconciliacion.mjs dryrun                 # plan + hash + Gate 1
node scripts/fase14-stel-e2-reconciliacion.mjs aplicar --plan-hash <hash autorizado> --autorizo-reconciliacion-productiva
node scripts/fase14-stel-e2-reconciliacion.mjs revertir --run <uuid> --autorizo-reversion
```

Después de aplicar: nueva auditoría STEL vs React. Objetivo:
- faltantes = 0 (salvo los bloqueados);
- vínculos de producto incorrectos = 0;
- monedas resolubles pendientes = 0;
- diferencias de líneas = 0 (salvo los 8 borrados pendientes);
- relaciones correctas;
- stock y secuencias sin cambios.

## 12. Blockers que siguen (CUTOVER_READY = NO)

1. STEL sigue emitiendo (RT0000001432 apareció durante la entrega).
2. Reconciliación productiva **pendiente de autorización** (plan `e62de165…`).
3. 8 borrados de línea pendientes de aprobación; 2 productos NAME_MISMATCH y COTI02530 para revisión humana.
4. Remito despachado cancelable sin devolver stock.
5. Cotización sin moneda → pedido USD automático en el flujo nuevo.
6. Freeze de STEL y últimos números reales al momento del corte.
7. Alineación de secuencias: React emitiría PDV01316–1318 y RT0000001424–1432, ya usados en STEL.
8. Decisión RT-ML (secuencia sólo si React la emite).
9. Emisión concurrente STEL/ERP durante la transición.
10. Semántica del tipo de cambio.
11. Sincronización continua de productos y precios con STEL (maestro), incluidas las 12 tarifas.

## Anexo — definiciones previas de las funciones de trigger (rollback)

Idénticas a las de la migración **sin** las líneas que mencionan `app.en_reconciliacion_stel()` / `v_reconciliacion`:

- `app.bloquear_cotizacion_cerrada`: quitar el primer `if app.en_reconciliacion_stel() then return new; end if;`.
- `app.bloquear_lineas_cotizacion_cerrada` y `app.bloquear_lineas_pedido_cerrado`: quitar el primer
  `if app.en_reconciliacion_stel() then return coalesce(new, old); end if;`.
- `app.bloquear_pedido_cerrado`: quitar el primer `if app.en_reconciliacion_stel() then return new; end if;`.
- `app.proteger_borrado_{cotizacion,pedido,entrega}`: quitar la variable `v_reconciliacion` y los
  `and not v_reconciliacion` de los dos `if` (histórico y ya emitido).

## 13. Ejecución productiva (autorizada, 2026-09-15)

Autorización del usuario: plan `e62de165c350699ccd14cce6bab6d4c9f4b0643573f81d8d5a30eeeb8e8ac4e8`, **sin** los 8
borrados y **sin** tocar los 3 bloqueados. COTI02530 (bloqueado por estado regresivo) figuraba en el plan con
id STEL + vínculo de 1 línea; por decisión explícita del usuario se **excluyó** del run.

| Paso | Resultado |
|---|---|
| Gate | STEL leído 20:50 UTC (59 llamadas): plan = hash autorizado, exacto |
| Snapshot / backup / rollback | Huella de 16 tablas; respaldo local de 2.182 filas afectadas (`scripts/output/e2/respaldo-aplicar-e62de165c350.json`); reversión por bitácora disponible |
| RECONCILIATION_RUN_ID | `c5253205-5655-452e-ba53-61bbe775831e` (20:51:21 → 20:56:42 UTC, `finished`) |
| EXECUTED_PLAN_HASH | `f4db57fe96f845b798aa287527635c86a2a9b355a0a9aa080c412ea4673fc127` (= autorizado − COTI02530) |
| Productos | 53 creados (en «Pendiente de clasificación STEL», 26 con precio en Lista base), 711 vinculados, 1 categoría técnica |
| Documentos | 30 insertados (16/4/10), 634 actualizados |
| Líneas | 81 insertadas, 727 actualizadas (1.399 campos), 0 borradas |
| Monedas / relaciones | 32 / 32 (14 quote→order, 7 order→delivery, 11 source_quote_id) |
| Fallidos / salteados | 0 / 0 |

**Validación post-ejecución** (documentos STEL releídos 20:58 UTC; STEL sin documentos nuevos desde el corte):

| | STEL | React | Faltan | Cabecera | Líneas | Moneda | Total |
|---|---|---|---|---|---|---|---|
| Cotizaciones | 303 | 304 | 0 | 0 | 2 (COTI02489, COTI02516: borrados no autorizados) | 0 | 0 |
| Pedidos | 170 | 170 | 0 | 0 | 0 | 0 | 0 |
| Remitos | 192 | 192 | 0 | 0 | 1 (RT0000001405: borrados no autorizados) | 0 | 0 |

- **React sólo:** COTI02499, que se conserva.
- **Estado distinto:** 1 (COTI02530, bloqueado).
- **Cliente ambiguo sin acción:** 1 (COTI02452).
- **Productos:**
  - 766 usados: 764 vinculados por id STEL y 2 bloqueados por nombre;
  - 0 faltantes, 0 ambiguos, 0 vínculos incorrectos;
  - 1 línea sin producto: la de COTI02530, excluido.

Comprobaciones puntuales:
- 32/32 monedas corregidas (0 documentos sin moneda en React);
- 30/30 documentos nuevos completos (id STEL, moneda, total y cantidad de líneas);
- 595/595 renglones de remitos con precio STEL;
- 11/11 `source_quote_id` correctos;
- COTI02499 intacta;
- 8/8 renglones no autorizados intactos (fila idéntica al respaldo);
- los 2 productos bloqueados y COTI02530 (cabecera y líneas) idénticos a la foto previa.

**Invariantes:**
- Idénticos al baseline: `document_sequences` (quote 2629, sales_order 1316, delivery 1424), `document_numbering_authority` (STEL ×3), `stock_movements`, `stock_balances`, clientes y categorías existentes.
- 0 reservas, 0 eventos, 0 runs en curso.

**Segundo dry run:** 0 acciones aplicables salvo las exceptuadas:
- COTI02530 (excluido: id STEL + 1 línea);
- los 8 borrados no autorizados;
- los 3 bloqueados.

CUTOVER_READY sigue **NO**.
