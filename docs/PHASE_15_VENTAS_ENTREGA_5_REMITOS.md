# Fase 15 · Ventas · Entrega 5 — Remitos: alta atómica, parciales y stock

Fecha: 2026-09-17. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: `docs/database/PHASE_15_VENTAS_ENTREGA_5.sql` (migraciones `phase15_ventas_entrega_5_lineas_remito`,
`…_crear_remito`, `…_crear_remito_serie`, `…_guardar_remito`, `…_guardar_remito_lineno`), con ROLLBACK.

E5 lleva el remito al mismo estándar que la cotización (E2/E3) y el pedido (E4), **sin cambiarle una
coma a la semántica de stock**, que se auditó antes de tocar nada.

WhatsApp no se tocó. Facturación y compras tampoco.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CURRENT_DELIVERY_FLOW | Sin edición: la pantalla mostraba el remito y lo despachaba. Sin pestañas, sin trazabilidad, sin aviso al salir. Las líneas se ordenaban **por `id`** (un uuid), o sea que no se ordenaban. |
| CURRENT_ORDER_TO_DELIVERY_FLOW | **Cinco viajes** del navegador: leer el pedido, leer el depósito, `next_document_number`, insert en `deliveries`, insert de `delivery_lines`; si un trigger rechazaba una línea, el navegador **borraba el remito a mano**. El pendiente se calculaba en el navegador (3 consultas). |
| CURRENT_STOCK_FLOW | `draft` = **0 movimientos**. `confirmar_entrega` (draft → shipped) inserta un `stock_movements` `sale_delivery` negativo por línea (`source_type = 'delivery'`), y el trigger `app.apply_stock_movement` actualiza `stock_balances`. |
| CURRENT_RESERVATION_FLOW | `confirmar_entrega` consume/libera las reservas del pedido (`source_type = 'sales_order'`), partiéndolas si sobran. Hoy hay **0 reservas**: el pedido no reserva, y E4 no lo cambió. |
| PARTIAL_DELIVERY_SUPPORT | Sí, con el trigger `app.validar_cantidad_entregada` por línea. **Pero** el pendiente lo calculaba el cliente y el trigger no ve filas no confirmadas de otra transacción: dos personas remitando a la vez podían **sobreentregar**. |
| RTML_CURRENT_BEHAVIOR | 5 remitos importados en la serie `RT-ML`, todos `delivered` y con `imported_at`. La serie tiene fila propia en `document_numbering_authority_series` con `authority = 'STEL'` y **no tiene secuencia ERP sembrada**. |
| SCHEMA_GAPS | `delivery_lines` sin `line_no` ni `description_snapshot`; sin índice único de orden. `stock_movements` no tiene clave única para `source_type = 'delivery'` (la idempotencia la da el lock + el estado). `deliveries.shipping_address_id` apunta a la dirección **viva** del cliente: no hay snapshot de domicilio (gap documentado, § 11). |

Además, la auditoría encontró un **bug real, anterior a E5**: desde la Entrega 2 el detalle pedía
`salesperson_id` para los tres tipos y `deliveries` no tiene esa columna, así que **abrir un remito
fallaba** con `column deliveries.salesperson_id does not exist`. Se arregló acá (la columna se pide
sólo para los documentos que tienen vendedor).

## 2 · La primera regla: no inventar stock

| Clave | Efecto (auditado y preservado) |
|---|---|
| CREATE_DELIVERY_EFFECT | **0 movimientos, 0 reservas.** El remito nace `draft`. |
| CONFIRM_DELIVERY_EFFECT | `confirmar_entrega`: un movimiento negativo por línea con producto, libera las reservas del pedido, pasa a `shipped` y deriva el cumplimiento del pedido. Idempotente. |
| DISPATCH_EFFECT | Es el mismo: en este modelo *confirmar* y *despachar* son un solo paso, y el botón se llama así. No se inventó un estado intermedio. |

`confirmar_entrega` **no se tocó**. E5 no mueve stock desde ningún lugar nuevo.

## 3 · Lo que le faltaba a la línea

- `delivery_lines.line_no`, con backfill determinista (el `line_no` de la línea del pedido cuando
  existe; si no, el orden de creación) e índice único `(delivery_id, line_no)`. Un trigger se lo
  asigna a quien inserte sin número, así el importador y la reconciliación siguen funcionando.
- `delivery_lines.description_snapshot`: el texto comercial del remito, independiente del catálogo.
  **Sin backfill**: de los remitos históricos no sabemos qué decía el papel.

## 4 · Pedido → remito, en una transacción

`crear_remito_desde_pedido(p_order, p_lineas, p_fecha, p_esperado)`:

1. bloquea el **pedido** (`select … for update`) — esto es lo que hace imposible la sobreentrega
   concurrente;
2. valida empresa (`app.current_writer_company_ids()`), testigo opcional, estado (`PEDIDO_CANCELADO`,
   `PEDIDO_NO_CONFIRMADO`) y autoridad **por tipo y por serie**;
3. recalcula el pendiente en la base (`app.pendiente_de_pedido`) y corta con
   `PEDIDO_TOTALMENTE_ENTREGADO` si no queda nada;
4. valida cantidad por cantidad (`CANTIDAD_INVALIDA`, `LINEA_DE_OTRO_PEDIDO`, `LINEA_SIN_PEDIDO`,
   `SOBREENTREGA`);
5. pide el número, inserta cabecera y líneas con `line_no` 1..n y los snapshots **de la línea del
   pedido**, y lo audita;
6. devuelve `id`, `number` y cantidad de líneas.

La serie **no se elige desde afuera**: se resuelve la serie por defecto de la empresa
(`document_sequences.is_default`, en Buscatools `RT`). Un intento fallido no quema número: todo pasa
en una transacción y la secuencia vuelve atrás (verificado: el remito siguiente salió `ZRA00002`).

## 5 · Editar el borrador

`guardar_remito(p_delivery, p_esperado, p_cabecera, p_lineas)`, gemela de `guardar_pedido`:

- **whitelist**: `delivery_date`, `title`, `notes`, `contact_id`, `carrier`, `tracking`. Cualquier
  otra clave → `CAMPO_NO_EDITABLE` (número, serie, estado, empresa, cliente, `order_id`, campos de
  importación y totales incluidos).
- sólo en `draft`: despachado → `REMITO_DESPACHADO`, cancelado → `REMITO_CANCELADO`, migrado →
  `REMITO_HISTORICO`.
- concurrencia por `updated_at` → `CONFLICTO_DE_EDICION` (sin errcode `40001`, que PostgREST
  reintenta solo).
- líneas: cambia cantidades y el texto, borra las que no vienen y suma líneas pendientes **del mismo
  pedido**. El orden de las escrituras es a propósito —borrar, bajar, subir— para no chocar con el
  trigger de sobreentrega en un estado intermedio que nunca llega a existir. Renumera 1..n con el
  desplazamiento +1000 que exige el índice único.
- no deja borrar una línea con números de serie (`LINEA_CON_SERIES`) ni facturada (`LINEA_FACTURADA`).

## 6 · Pantalla

`EntregaDetallePage` pasa al shell documental: `DocumentHeader` + `ActionBar` + pestañas
**Líneas · Información · Adjuntos · Relacionados · Trazabilidad**, con `key={id}` para que el
borrador de un remito no aparezca en otro.

- En borrador: «Editar» abre el borrador local, «Guardar cambios» es el **único** camino de escritura
  y «Descartar» pide confirmación. Salir con cambios pregunta (`useSalidaConCambios`, E3).
- Cada línea muestra **lo pedido** y **lo que quedaría pendiente después**, y su tope es el pendiente
  más lo que este mismo remito ya tenía tomado: no compite consigo mismo.
- El precio, el descuento y el impuesto **no se editan**: vienen del pedido. Se dice en pantalla —*un
  remito dice qué se entrega, no a qué precio se vendió*.
- Información muestra el **pedido de origen** enlazado, o «Sin pedido relacionado» cuando no lo hay
  (37 remitos históricos están en ese caso); transporte y seguimiento aparecen sólo si existen.
- Despachar explica lo que hace y que se aprieta una sola vez.

## 7 · Autoridad y RT-ML

- `AUTHORITY` = `app.autoridad_efectiva(company, doc_type, series)`: primero la fila de la **serie**,
  después la del tipo, y `ERP` por defecto. Lo exige `next_document_number` y, además, el trigger
  `app.guardar_autoridad_numeracion` **en el insert** de `deliveries`.
- `RTML_POLICY` = **solo importación**. RT-ML tiene autoridad de serie `STEL` y no tiene secuencia
  ERP. Verificado en el fixture: numerar en RT-ML da `external_numbering_authority`, insertar un
  remito con esa serie también, la secuencia no se consume y el remito del ERP siempre sale en la
  serie por defecto. No se agregó ninguna forma de emitir RT-ML desde la UI.

## 8 · Cancelar, borrar

Sin cambios: lo decide la base. Un borrador se cancela y se borra (y al cancelarlo **vuelve el
pendiente**: se puede volver a remitar). Un remito que movió stock no se borra —borrar el movimiento
no devuelve las unidades— ni se cancela; el histórico tampoco. Todo verificado.

## 9 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase15-e5-remitos-tests.mjs` (base real, empresas de fixture) | **87 PASS · 0 fallos** |
| `scripts/fase15-e4-pedidos-tests.mjs` (regresión E4) | 0 fallos |
| `npm test` / `npm run test:isolated` | 1401 tests, 123 archivos, todo verde |
| `npm run lint`, `npx tsc -b`, `npm run build` | limpio |

Evidencia textual del corrido: `nace en borrador — draft`; `crear un remito NO mueve stock — 20/0`;
`sobre 10 pedidas y 4 entregadas, quedan 6`; `el segundo remito entrega el resto, sin saltear números
— ZRA00002`; `un tercer remito sobre un pedido entregado — PEDIDO_TOTALMENTE_ENTREGADO`; `gana uno
solo — 1` y `nunca se entregó más que lo pedido — 5` (dos remitos simultáneos); `dos guardados a la
vez: gana uno solo — 1`; `un movimiento por línea — false/shipped/1`; `confirmar dos veces NO repite
el movimiento — true/1`; `dos confirmaciones a la vez: UN movimiento — 1`; `al despachar se libera la
reserva — 1/1`; `insertar un remito con serie RT-ML — external_numbering_authority`; `un remito
despachado NO se borra`; `cancelar un borrador devuelve el pendiente — 3`; `producción idéntica al
baseline`.

Frontend: `EntregaDetallePage.test.tsx` (27), pedido → remito dentro de `PedidoDetallePage.test.tsx`
(6) y los unitarios de `borradorRemito` (17).

## 10 · Verificación en el navegador

Sobre datos reales de Buscatools, **sin escribir nada**: se abrió RT0000001433 y RT0000001431 (7
líneas), que antes ni siquiera cargaban. Shell, pestañas, líneas numeradas 1..7 en orden estable,
«Sin pedido relacionado» donde corresponde, los motivos de bloqueo a la vista y la trazabilidad.
Sin fallos de red con `fetch` instrumentado. Sin desborde horizontal a 375, 430, 768, 1024 ni 1440 px.

Crear remitos no se probó en producción a propósito: Buscatools tiene la numeración de `delivery` en
STEL, así que emitir está bloqueado en la base. Todo el circuito de alta se probó contra la base real
con empresas de fixture `zz-e5`, con su propio depósito, serie y stock.

## 11 · Gaps para E6

- **Domicilio de entrega sin snapshot**: `deliveries.shipping_address_id` apunta a la dirección viva
  del cliente. Si el cliente cambia de domicilio, el remito ya emitido «cambia» de dirección. Hace
  falta un snapshot, como el de producto y precio.
- **Sin alta manual de remito**: no se agregó, porque no hay evidencia de que el negocio la use —los
  37 remitos sin pedido son todos importados de STEL. Si hiciera falta, es una RPC gemela.
- **Idempotencia de stock estructural**: hoy la garantiza el lock + el estado (probado, incluso con
  dos confirmaciones simultáneas). Un índice único sobre `(source_type, source_id, product_id,
  warehouse_id)` la haría imposible por construcción, pero rompería un remito con el mismo producto
  en dos líneas, que el modelo permite. Queda como decisión, no como olvido.
- **Cancelar un remito despachado** no existe: haría falta un movimiento de reversa explícito y
  auditado. Hoy la base lo impide, que es la respuesta correcta mientras no se diseñe.

## 12 · Qué NO se hizo (a propósito)

Facturación, cobranzas, compras, cutover de STEL, autoridad productiva, emisión de RT-ML desde el
ERP, precios/tarifas en el remito, recálculo de catálogo y WhatsApp.
