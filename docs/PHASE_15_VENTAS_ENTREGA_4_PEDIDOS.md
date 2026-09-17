# Fase 15 · Ventas · Entrega 4 — El pedido de venta, al nivel de la cotización

Fecha: 2026-09-17. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: `docs/database/PHASE_15_VENTAS_ENTREGA_4.sql` (migraciones `phase15_ventas_entrega_4_pedidos_parte1`,
`…_guardar_pedido`, `…_crear_y_convertir`, `…_guardar_pedido_lineno`), con su bloque de ROLLBACK.

E4 le da al **pedido de venta** lo que la cotización ya tenía en E1–E3: el mismo shell documental con
pestañas, edición por borrador con «Guardar cambios» / «Descartar», guardado atómico con control de
concurrencia, alta atómica, aviso al salir con cambios y trazabilidad. Y agrega lo que no existía en
ningún lado: la **conversión cotización → pedido en una sola transacción**, que hereda el snapshot
comercial aprobado.

WhatsApp no se tocó (§ 12). El remito/entrega sigue como estaba: es E5.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CURRENT_ORDER_FLOW | `PedidoDetallePage` escribía **campo por campo al perder el foco** (`actualizarCabeceraPedido`, `agregarLineaPedido`, `actualizarLineaPedido`, `eliminarLineaPedido`, `intercambiarOrdenPedido`). No había borrador, ni «Descartar» honesto, ni control de concurrencia, ni aviso al salir. El alta manual usaba `DocumentoNuevoPage` + `crearCotizacionLegacy`, en cuatro viajes desde el navegador. |
| CURRENT_CONVERSION | La conversión eran 4–5 llamadas desde el navegador: leer la cotización, `next_document_number`, insertar el pedido, insertar las líneas, registrar el evento. Si fallaba a la mitad quedaba un pedido sin líneas, o un número consumido sin pedido. |
| SCHEMA_GAPS | `sales_orders` **no tenía `price_list_id`**: el pedido no registraba con qué tarifa se había vendido (la cotización sí, desde E2). `sales_order_lines` tiene `UNIQUE (order_id, line_no)` —las líneas de cotización no—, así que renumerar exige un paso intermedio. Los tipos del repo no conocían las RPC nuevas: se regeneraron esos bloques. |

## 2 · La tarifa del pedido

`alter table sales_orders add column price_list_id uuid references price_lists(id)`, nullable y **sin
backfill**: de los 172 pedidos históricos no sabemos con qué lista se vendieron, y completarlo con la
lista por defecto sería inventarlo. Índice parcial `idx_orders_tarifa` para los que sí la tienen.

Igual que en la cotización, la tarifa **sugiere** el precio de las líneas nuevas (el selector de
productos recibe `listaPrecioId`) y **no recalcula** las líneas ya cargadas, ni siquiera si se cambia
la tarifa después.

## 3 · Guardar un pedido — `guardar_pedido(p_order, p_esperado, p_cabecera, p_lineas)`

Gemela de `guardar_cotizacion`: mismo contrato, mismos códigos de error, mismo control de
concurrencia (`select … for update` + comparación de `updated_at`).

- **Whitelist de cabecera**: `customer_id`, `contact_id`, `order_date`, `title`, `salesperson_id`,
  `payment_terms`, `currency_code`, `price_list_id`, `notes`, `exchange_rate`, `discount_pct`,
  `perception_pct`. Cualquier otra clave → `CAMPO_NO_EDITABLE`. Número, serie, estado, empresa,
  `quote_id`, `source`, totales y auditoría **no se pueden mandar**.
- **Estado editable**: borrador y confirmado sin entregas. Cancelado → `ESTADO_NO_EDITABLE`; con
  entregas → `PEDIDO_CON_ENTREGAS` (y el trigger lo frena igual: la RPC sólo contesta antes y mejor).
- **Concurrencia**: si `updated_at` no coincide, `CONFLICTO_DE_EDICION` **sin** errcode `40001` —con
  ese código PostgREST reintenta solo y el usuario ve un timeout en vez del aviso. Lo escrito queda en
  pantalla: es lo único que la persona todavía tiene.
- **Líneas**: se mandan completas, con `id` las que ya existían. Las que no vienen, se borran. Como
  `sales_order_lines` tiene `UNIQUE (order_id, line_no)`, primero se desplazan los `line_no`
  existentes (+1000) y después se renumeran 1..n; la auditoría de las borradas informa el número real
  (`line_no - 1000`), no el provisorio.
- Los totales los recalculan los triggers del servidor. La pantalla muestra una previsualización del
  subtotal y deja impuesto y total en «—»: inventar el total sería peor que no mostrarlo.

## 4 · Alta manual — `crear_pedido(p_company, p_cabecera, p_lineas)`

Gemela de `crear_cotizacion`. Una transacción: valida, pide el número a `next_document_number`
(que es quien exige la autoridad), inserta cabecera y líneas y registra el evento. El pedido nace
`draft` / `manual`. Si algo falla, no queda ni número consumido ni pedido sin líneas.

`PedidoNuevoPage` es la pantalla, modelada sobre `CotizacionNuevaPage`: borrador en memoria, **cero
escrituras** hasta «Crear pedido», sin moneda por defecto, con contacto, vendedor y tarifa —que el
alta anterior ni ofrecía—, y sin «Válida hasta», que en el pedido no existe. `DocumentoNuevoPage` se
eliminó.

## 5 · Conversión — `convertir_cotizacion_en_pedido(p_quote, p_esperado)`

Una sola transacción, y la regla que la define:

> **El pedido hereda el snapshot comercial APROBADO.** Precios, descuentos, impuestos y sus snapshots
> se copian tal como quedaron en la cotización. **Nunca** se vuelve a consultar la lista de precios.
> La tarifa se copia como dato (`price_list_id`), no como fuente de precios.

- La cotización **no cambia de estado** al convertir (verificado: sigue `draft`).
- `p_esperado` es opcional: si se manda y no coincide, `CONFLICTO_DE_EDICION`. El frontend manda el
  `updated_at` que tenía a la vista.
- Duplicado imposible: el índice único `uq_sales_orders_quote (company_id, quote_id)`. Dos pestañas
  apretando a la vez crean **un** pedido; la segunda recibe `PEDIDO_YA_EXISTE`. El botón además se
  apaga (`Ya tiene pedido`) y muestra «Generando…» mientras corre.

## 6 · Duplicar

Duplicar un pedido pasa por `crear_pedido`, el **mismo** camino que el alta. Copia lo comercial
—cliente, contacto, vendedor, tarifa, moneda, tipo de cambio, condiciones, observaciones y líneas con
sus snapshots— y nada de identidad: número, serie, estado, `external_id`, `imported_at`, entregas,
facturas, auditoría ni el vínculo con la cotización. La copia nace borrador y manual, con fecha de hoy.

## 7 · Pantalla

`PedidoDetallePage` quedó con el mismo shell que la cotización: `DocumentHeader` (número, estados,
cliente, fecha, total), avisos de histórico, banner de autoridad **una sola vez**, `ActionBar` y seis
pestañas: **Líneas · Información · Entregas · Adjuntos · Relacionados · Trazabilidad**. El `key={id}`
del wrapper remonta al cambiar de pedido: el borrador de uno nunca aparece en otro.

- **Edición por borrador**: «Editar» abre, «Guardar cambios» es el **único** camino de escritura,
  «Descartar» con cambios pide confirmación y no escribe nada. Mientras se edita no se ofrecen
  acciones incompatibles (duplicar, cancelar, imprimir, confirmar).
- **Salir con cambios**: `useSalidaConCambios` (E3) — `useBlocker` del data router para la navegación
  de la aplicación (otro pedido, menú, atrás del navegador) y `beforeunload` para cerrar la pestaña.
  Cambiar de pestaña interna no navega y no pregunta.
- **Entregas** muestra pendientes y stock, con el cartel de siempre: *es sólo informativo; crear o
  editar un pedido no reserva ni descuenta stock*. El stock se mueve al confirmar una entrega.
- **Trazabilidad**: `PanelTrazabilidad` sobre `sales_document_events`, en castellano, sin ids ni JSON.

## 8 · Permisos y seguridad

- Las tres RPC son `security definer` con `search_path` fijo, `revoke … from public, anon` y
  `grant … to authenticated, service_role`. Las auxiliares `app.validar_*` no las ejecuta ni
  `authenticated`.
- RLS sigue decidiendo quién escribe; la UI sólo oculta botones, que es otra cosa. Un rol sin
  escritura ve el pedido y el motivo («Tu rol no edita pedidos…»), no los botones.
- La autoridad de numeración la exige `next_document_number` en el servidor. En Buscatools, hoy STEL
  numera `quote`, `sales_order` y `delivery`: crear, convertir y confirmar están bloqueados **en la
  base**, y la pantalla lo dice con el motivo. Consultar, editar, guardar, imprimir y exportar siguen
  disponibles.

## 9 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase15-e4-pedidos-tests.mjs` (base real, empresas de fixture) | **79 PASS · 0 fallos** |
| `scripts/fase15-e3-crear-cotizacion-tests.mjs` (regresión E3) | 0 fallos |
| `npm test` / `npm run test:isolated` | 1351 tests, 121 archivos, todo verde |
| `npm run lint`, `npx tsc -b`, `npm run build` | limpio |

Evidencia de la base, textual del corrido:

- alta: `nace borrador y manual — draft/manual`, `totales del servidor — 245.00/51.45/296.45`;
- concurrencia: `dos guardados a la vez: gana uno solo — 1`;
- conversión: `conserva el PRECIO APROBADO, no el nuevo de la tarifa — 80.00`,
  `la cotización no cambia de estado al convertir — draft`,
  `doble conversión simultánea: un solo pedido — 1`;
- protección aguas abajo: `con entregas, guardar se rechaza — PEDIDO_CON_ENTREGAS`,
  `un pedido cancelado no se edita — ESTADO_NO_EDITABLE`;
- stock: `sin movimientos de stock de la empresa de fixture — 0`, `sin reservas — 0`;
- cierre: `producción idéntica al baseline` (306 cotizaciones, 172 pedidos, 193 entregas, secuencias y
  autoridad sin cambios).

Frontend: `PedidoDetallePage.test.tsx` (29), `PedidoNuevoPage.test.tsx` (12), conversión dentro de
`CotizacionDetallePage.test.tsx` (5) y los unitarios de `aPayloadPedido` / `aPayloadCreacionPedido` en
`borrador.test.ts`. Prueban lo que importa: que **no se escribe nada hasta guardar**, que se manda
una sola llamada con el testigo de concurrencia y las columnas del pedido, que descartar no escribe,
que salir pregunta, y que la conversión es una sola llamada que no toca la cotización.

## 10 · Verificación en el navegador

Sobre datos reales de Buscatools, **sin escribir nada** (PDV01320): shell y pestañas, modo edición
con «Sin cambios todavía…», editor de cabecera sin «Válida hasta», Entregas con pendientes y stock,
Trazabilidad, y el alta con «Crear pedido» deshabilitado por la autoridad STEL, con el motivo a la
vista. Sin errores de consola. Sin desborde horizontal a 375, 430, 768, 1024 ni 1440 px
(`scrollWidth == clientWidth` en todos).

## 11 · Limpieza

Se borró el código que E4 dejó muerto y que escribía por fuera de las RPC: los escritores campo a
campo del pedido, `crearCotizacionLegacy` (su único usuario era el alta del pedido),
`DocumentoNuevoPage` y `CabeceraCotizacion.tsx` (su módulo CSS lo sigue usando `EditorCabecera`).

## 12 · WhatsApp

`WHATSAPP_TOUCHED = NO`. No se tocaron tablas `whatsapp_*`, funciones, Edge Functions, workers,
`pg_cron`, `pg_net`, secrets, OpenAI ni Meta. El piloto automático siguió corriendo durante toda la
entrega.

## 13 · Qué NO se hizo (a propósito)

Remito/entrega E5, adjuntos nuevos, email, PDF nuevo, importar OC, FX automático, recalcular todas las
líneas por tarifa, capítulos jerárquicos reales, cambios en STEL y cualquier autoridad productiva.
