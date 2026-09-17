# Fase 15 · Ventas · Entrega 3 — Tarifa en los precios, salida protegida y alta atómica

Fecha: 2026-09-17. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: `docs/database/PHASE_15_VENTAS_ENTREGA_3.sql` (migración `phase15_ventas_entrega_3_crear_cotizacion`).

E3 cierra tres huecos de E2: el precio sugerido ignoraba la tarifa del documento, salir con un
borrador sucio lo perdía sin preguntar, y el alta escribía desde el navegador en cuatro pasos.

WhatsApp no se tocó: ni tablas, ni funciones, ni cron, ni secrets (ver § 10).

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CURRENT_NEW_QUOTE_FLOW | `DocumentoNuevoPage` armaba el documento en memoria, pero al guardar hacía **4 viajes** desde el navegador: `next_document_number`, insert en `sales_quotes`, insert de líneas y `registrar_evento_venta`. Sin contacto, sin vendedor y sin tarifa en el formulario. Si fallaba el paso 2, el número ya estaba consumido; si fallaba el 3, quedaba una cotización sin líneas. |
| CURRENT_PRICE_SUGGESTION | `productosParaLinea.ts` resolvía el precio **siempre** contra la lista `is_default` de la empresa, ignorando `sales_quotes.price_list_id`. El selector ni recibía la tarifa. |
| CURRENT_NAVIGATION_GUARD | Sólo `beforeunload` (cerrar pestaña/recargar). Dentro de la aplicación no había nada: otra cotización, el menú o «atrás» desmontaban el editor y se perdía el borrador. |
| SCHEMA_GAPS | Ninguno que bloquee E3. `price_list_id` ya existía (E2); `product_prices` tiene `price_list_id`, `amount` y vigencia (`valid_from`/`valid_to`), que el código ignoraba; `sales_quote_lines` ya guarda `brand_snapshot` y `list_price_snapshot`. Los tipos del repo no tenían `price_list_id` en `sales_quotes` (se leía por índice): se regeneró ese bloque. |

## 2 · Tarifa → precio sugerido

- `buscarProductos(companyId, texto, { listaPrecioId })` resuelve por **`product_id` + `price_list_id`**,
  nunca por nombre ni por SKU.
- Sin tarifa en el documento: la lista por defecto, como antes.
- **Nunca** se cae de una lista a otra en silencio.
- `precioVigente` elige la fila vigente hoy; si ninguna rige, la última que empezó. Una futura no se
  sugiere. (La vigencia estaba en la tabla y no se miraba.)
- Moneda: `PRICE_CURRENCY_RULE = same currency only`. Si la lista está en otra moneda, no se aplica,
  no se convierte y no se usa otra lista.
- Motivos visibles en el buscador: «Este producto no tiene precio en la tarifa seleccionada (X).» /
  «La tarifa X está en ARS y el documento en USD: no se aplica ni se convierte.»
- La tarifa **sugiere**: después se edita el precio a mano, y cambiar la tarifa **no recalcula** las
  líneas ya cargadas (no hay «recalcular todo» en E3).

Verificado en producción con datos reales (sin escribir nada): el mismo producto `CP.CP9911` sugiere
**USD 46,03** con la tarifa «Distribuidores» y **USD 162,46** con «Lista base» o sin tarifa. Los
balanceadores sin precio en ninguna lista entran sin precio y con el motivo.

## 3 · Salir con cambios sin guardar

`useSalidaConCambios(sucio)` (en `src/hooks/`) combina las dos barreras que existen:

- `useBlocker` del data router (React Router 7 + `createHashRouter`) para la navegación de la
  aplicación: otra cotización, menú lateral, breadcrumb, `navigate(...)` y **atrás/adelante** del
  navegador, porque el history lo maneja el router;
- `beforeunload` para cerrar la pestaña o recargar.

No se parchea `history` a mano. El diálogo es `DialogoCambiosSinGuardar` sobre el `ConfirmDialog` del
sistema («Hay cambios sin guardar» / «Seguir editando» / «Descartar y salir»), nunca `window.confirm`.

No bloquea: cambiar de pestaña interna del documento (no cambia la ruta), guardar (el borrador deja de
estar sucio y la navegación pasa sola), descartar, ni entrar en edición sin tocar nada.

## 4 · Alta de cotización

`CotizacionNuevaPage` usa el mismo modelo mental que la edición de E2: un `Borrador` en memoria con
cabecera y líneas, y **una sola escritura** al final. `DocumentoNuevoPage` queda para el pedido (E4).

Campos del alta: cliente, contacto, vendedor, tarifa, fecha, validez, título, moneda, tipo de cambio,
forma de pago, % descuento global, % percepción, observaciones y líneas (agregar, quitar, reordenar,
cantidad, precio, descuento, impuesto, descripción).

No se manda ni se acepta: `company_id`, `number`, `series_code`, `status`, `created_by`, `external_id`,
`imported_at` ni totales. El servidor los pone o los rechaza (`CAMPO_NO_PERMITIDO`).

## 5 · `crear_cotizacion` (RPC atómica)

`crear_cotizacion(p_company uuid, p_cabecera jsonb, p_lineas jsonb)`, SECURITY DEFINER,
`search_path` fijo, `revoke` a `public`/`anon` y `grant` a `authenticated`/`service_role`.

Hace, en una transacción: valida rol (admin/employee), cierra el payload, exige cliente y moneda,
valida cliente / contacto del cliente / vendedor de la empresa / tarifa de la empresa y de la misma
moneda, toma la serie por defecto, pide el número con `next_document_number` —que es quien exige la
**autoridad ERP**—, inserta la cabecera en `draft`, inserta las líneas renumeradas 1..n, deja que el
trigger de siempre calcule los totales, audita `created` con los datos de negocio, las líneas y el
total, y devuelve `{id, number, total, lineas}`.

Si algo falla, no queda nada: tampoco el número, porque el `UPDATE` de `document_sequences` vuelve
atrás con el resto de la transacción (medido en la suite).

Las reglas y los códigos de error son los mismos que `guardar_cotizacion` (E2). No se reescribió esa
función: la suite corre los mismos casos contra las dos para que no se separen.

## 6 · Numeración y autoridad

No se hardcodea nada: la autoridad sale de `document_numbering_authority` y la exige
`app.exigir_emision_erp` dentro de `next_document_number` y del trigger del INSERT.

**Hoy en Buscatools la autoridad de `quote` es STEL**, así que el alta está bloqueada con motivo real
(banner y botón deshabilitado con `aria-describedby`), tal como se ve en la pantalla. En la suite, la
empresa de fixture con autoridad ERP crea normalmente, y con STEL el alta se rechaza sin consumir
número.

El número se consume recién al crear: un borrador abandonado no se come ninguno.

## 7 · Duplicar

`duplicarDocumento('cotizacion')` pasó a usar `crear_cotizacion`. Copia cliente, contacto, vendedor,
**tarifa** (que el duplicado anterior perdía), moneda, tipo de cambio, condiciones, descuentos y las
líneas con sus snapshots. No copia número, serie, estado, `external_id`, `imported_at`, relaciones ni
auditoría. El duplicado del pedido queda como estaba (E4).

## 8 · Totales, fechas y moneda

- Totales: los calcula el servidor (triggers `trg_lineas_totales` / `trg_cotizacion_totales`). El alta
  muestra una **previsualización** de unidades y subtotal con la misma fórmula, y deja impuestos y
  total en «—» hasta guardar: no se duplica una fórmula divergente.
- `quote_date`: el día de **Argentina** (a las 22 h de acá, en UTC ya es mañana); `valid_until` opcional.
- Moneda: sin USD por defecto. El desplegable arranca en «Elegí la moneda» y sin ella no se crea
  (`DOCUMENT_CURRENCY_REQUIRED`). Las tarifas se filtran por la moneda elegida.
- Cambiar de cliente limpia el contacto y lo avisa; cambiar de moneda limpia la tarifa incompatible y
  lo avisa.

## 9 · Tests

| Suite | Resultado |
|---|---|
| lint, typecheck, build | OK |
| vitest / test:isolated | 119 archivos, 1299 tests |
| `scripts/fase15-e3-crear-cotizacion-tests.mjs` (base) | 66 checks, 0 fallos |

Frontend nuevo: tarifa aplicada al buscar, producto sin precio, moneda distinta, vigencia de precios,
borrador del alta (0 escrituras antes de crear), validaciones, error del servidor, bloqueo por STEL,
rol sin permiso, guardia de navegación (pregunta, «seguir editando», «descartar y salir», sin cambios
no pregunta, cambiar de pestaña no dispara nada) y el alta que navega al documento creado.

Base: crear con número/estado/líneas/totales/auditoría, rollback completo (incluido el número),
validaciones de cliente, contacto, vendedor, tarifa, moneda, producto, cantidad, descuento y precio,
12 campos inyectados rechazados, permisos (anon, vendedor, técnico, portal, admin de otra empresa),
autoridad STEL y dos altas seguidas con números distintos.

## 10 · Seguridad y datos

- RLS: sin cambios. No se ampliaron permisos de Ventas.
- Red team en la suite: anon, salesperson, technician, customer del portal y admin de otra empresa son
  rechazados; los campos inyectados también.
- DB_BASELINE: producción idéntica antes y después (cotizaciones, líneas, pedidos, entregas,
  auditoría, movimientos de stock, secuencias y autoridad). Sin fixtures: 0 empresas `zz`.
- No se creó ninguna cotización productiva: en Buscatools el alta está bloqueada por autoridad, y las
  pruebas usan empresas de fixture con su propia serie.
- WHATSAPP_TOUCHED = NO. Mientras corría el piloto de WhatsApp (E3.1) no se ejecutó ninguna migración,
  suite ni script que tocara `whatsapp_*`, pg_cron, pg_net, Edge Functions de WhatsApp, OpenAI ni
  secrets. Lectura de control al cierre: cron activo, cola en `done`, 4 corridas con 3 llamadas.

## 11 · Rollback

`drop function if exists public.crear_cotizacion(uuid, jsonb, jsonb);` — no hay cambios de schema.
Revertir la base exige volver a desplegar el frontend anterior, porque el alta nueva llama a esa RPC.

## 12 · Huecos para E4/E5

- Pedido y remito siguen con el alta vieja (`crearCotizacionLegacy` / `crearPedido`), que escribe desde
  el navegador en varios pasos.
- `convertirCotizacionEnPedido` sigue leyendo y reinsertando desde el cliente.
- Duplicar pedido sigue por el camino viejo.
- «Recalcular precios por tarifa» de líneas ya cargadas: fuera de alcance por decisión de E3.
- El buscador de productos de Compras y Mantenimiento sigue siendo otra implementación.
