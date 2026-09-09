# Fase 4 · Stage 3 — plan de migración de la UI de Ventas

Auditoría del legacy y plan. **Todavía no se programó nada.**

Fuente auditada: `~/Downloads/index.html` (3,2 MB) + `~/Downloads/index_files/app.js`
(**45.345 líneas**), la copia guardada del 2026-09-08. Sólo lectura.

---

## A · Mapa de la UI legacy de Ventas

### A.1 · La estructura real

`Ventas` es **una sección con tres subsecciones**, declaradas en un solo lugar:

```js
ventas: { items: [ {key:'cotizaciones', label:'Cotizaciones'},
                   {key:'pedidos',      label:'Pedidos'},
                   {key:'notas-entrega',label:'Notas de entrega'} ] }
```

El despachador es `renderVentas()` (línea 19285) y hace algo que conviene
entender antes de diseñar nada:

> **Hay UN SOLO editor para los tres documentos.** `renderCotEditor()` se
> reutiliza para cotización, pedido y nota de entrega; lo que cambia es el campo
> `_tipoDoc` del borrador (`undefined` | `'pedido'` | `'ne'`).

Y hay **un solo borrador global** —`cotizacionBorrador`, guardado en
`localStorage` bajo `erp_cotizacion_borrador`— que decide qué pantalla se ve: si
hay un borrador con líneas, se abre el editor en lugar del listado. No hay
navegación por URL: se navega mutando `state.subsection`.

### A.2 · Listados — los tres son el mismo listado

| | `renderCotList` 19320 | `renderPedidos` 22743 | `renderNotasEntrega` 22275 |
|---|---|---|---|
| columnas | check · Referencia · Cliente · Título · Estado · Fecha · Importe | + **Origen** | + **Origen** |
| orden | click en cabecera, asc/desc | ídem | ídem |
| filtros de columna | `ref` · `cliente` · `titulo` · `estado` | ídem | ídem |
| período | 1m · 3m · 6m · 12m · todas (por defecto **6m**) | ídem | ídem |
| búsqueda | un input libre sobre todo | ídem | ídem |
| paginación | **cliente**, 10/25/50/100/200/500 | ídem | ídem |
| selección múltiple | checkbox por fila + «seleccionar todas» | ídem | ídem |

**Menú «Más» por listado**

| acción | cot | ped | NE |
|---|:-:|:-:|:-:|
| Eliminar seleccionadas | ✔ | ✔ | ✔ |
| Duplicar seleccionadas | ✔ | ✔ | ✔ |
| **Generar pedido** | ✔ | — | — |
| **Generar nota de entrega** | — | ✔ | — |
| Imprimir seleccionada | ✔ | ✔ | ✔ |
| Exportar a CSV | ✔ | ✔ | ✔ |
| Seleccionar todas | ✔ | ✔ | ✔ |

Botones fijos: **+ Nuevo** y **📄 Importar OC** (cot y ped).
En la fila de pedidos hay además un botón directo **«→ Nota entrega»**.

### A.3 · El editor unificado — `renderCotEditor` 20119 / `wireCotEditor` 20691

**Cabecera:** cliente (con buscador desplegable + «nuevo cliente»), tarjeta de
cliente plegable, chips de contactos (agregar / crear), título, fecha, forma de
pago, **IVA** (checkbox), **IIBB**, moneda, **% descuento global**.

**Cinco pestañas:**

| pestaña | qué hace |
|---|---|
| **Líneas** | tabla editable: Referencia · Nombre · Descripción · Precio base · Uds. · % Dto. · Subtotal · % Impuesto |
| **Más información** | campos extra del documento (moneda, etc.) |
| **Adjuntos** | subir/borrar archivos, con nombre, tamaño, autor y fecha |
| **Firma** | **placeholder vacío** — dice literalmente «Sin firma cargada (próximamente)» |
| **Relacionados** | tabla de documentos vinculados, navegable |

**Acciones de líneas:** `Añadir productos o servicios` (modal de búsqueda),
`Nueva línea` (línea libre sin producto), **`Nuevo capítulo`** (línea de tipo
título, sin importe).

**Barra de acciones:** Guardar · Guardar y editar · Cancelar · Volver ·
**Imprimir** (con submenú: plantilla por defecto / opciones) · **Más**
(Duplicar · Eliminar · **Generar** el documento siguiente).

**Vista previa en vivo:** un `iframe` con el documento renderizado, con zoom
(`+` / `−` / `reset`), panel redimensionable y scroll propio.

### A.4 · Conversiones entre documentos

```
Cotización ──generarPedidoDesdeCotizacion (22704)──▶ Pedido
Pedido ──generarNotaEntregaDesdePedido (22064)──▶ Nota de entrega
       └── con modal de cantidades parciales: abrirModalNEParcialVentas (22154)
Nota de entrega ──generarFacturaDesdeNotaEntrega (27043)──▶ Factura
```

La NE parcial es la única parte del circuito legacy que entiende de entregas
incompletas, y lo hace guardando `entregado[idx]` — **un array por índice de
línea**, que es justamente lo que Stage 2.5 tuvo que reconstruir.

Al crear la NE, el legacy descuenta stock y avisa **«SR descontado»**.

### A.5 · Impresión y export

- **Imprimir**: arma HTML, lo escribe en un `iframe` (`document.write`) y llama
  `print()`; con fallback a `window.open`. Hay un submenú de plantilla.
- **Exportar CSV**: sobre la selección del listado.
- **Importar OC**: sube un PDF, lo manda a un worker externo con IA y propone
  líneas. Usa una API key del lado del cliente.

### A.6 · Estados

| documento | estados legacy |
|---|---|
| cotización | `pendiente` · `cerrada` · `rechazada` |
| pedido | `pendiente` · `parcial` · `entregado` |
| nota de entrega | `pendiente` · `facturada` · `pagada` |

### A.7 · Permisos

```js
const TEAM_USERS = ['ADMIN','JANO','JUAN','FACUNDO','NORBERTO','BRIAN'];
function _chkTeam(){ ... if(!TEAM_USERS.includes(state.user)) → redirige }
function getPermsFor(user){ ... loadUserPerms() desde localStorage ... }
```

**Es control de acceso puramente visual**: una lista de nombres en el código y
un mapa de permisos en `localStorage`, sin nada del lado del servidor.

### A.8 · Mobile

17 `@media` en total; los breakpoints reales son 400, 760/768, 1100, 1200, 1280
y 1440. Sólo las notas de entrega tienen algo parecido a tarjetas (`ne-card`).
**Los listados de cotizaciones y pedidos son tablas anchas también en mobile.**

---

## A.9 · El mapa que pediste

| función legacy | componente / página React | tabla o service nuevo |
|---|---|---|
| `renderVentas` (despacho por `state.subsection`) | rutas `#/ventas/*` | — |
| `renderCotList` + `wireCotList` | `CotizacionesPage` | `sales_quotes` · `listarCotizaciones()` |
| `renderPedidos` + `wirePedidos` | `PedidosPage` | `sales_orders` · `listarPedidos()` |
| `renderNotasEntrega` + `wireNotasEntrega` | `EntregasPage` | `deliveries` · `listarEntregas()` |
| `renderCotEditor` (`_tipoDoc = cot`) | `CotizacionDetallePage` | `sales_quotes` + `sales_quote_lines` |
| `renderCotEditor` (`_tipoDoc = pedido`) / `renderPedidoEditor` | `PedidoDetallePage` | `sales_orders` + `sales_order_lines` |
| `renderCotEditor` (`_tipoDoc = ne`) / `renderNotaEntregaEditor` | `EntregaDetallePage` | `deliveries` + `delivery_lines` |
| `renderRelacionadosCot/Ped/NE` | `<PanelRelacionados>` | joins por `quote_id` / `order_id` |
| `generarPedidoDesdeCotizacion` | `convertirCotizacionEnPedido()` | `sales_orders` + `quote_id` |
| `generarNotaEntregaDesdePedido` + `abrirModalNEParcialVentas` | `<ModalEntregaParcial>` | `deliveries` + `delivery_lines.order_line_id` |
| `generarFacturaDesdeNotaEntrega` | **no se migra ahora** | `sales_invoices` (0 filas) |
| `renderAddProdResults` (+ `Ped`, `NE`) | `<SelectorProducto>` | RPC `search_products` |
| `nextRef` / `nextRefPedido` (`MAX+1` local) | — | RPC **`next_document_number`** |
| `getPermsFor` / `_chkTeam` | `usePermisos()` **solo para ocultar UI** | **RLS** |
| `loadCotizaciones` / `savePedidos` / … (localStorage) | TanStack Query | Supabase |
| `getAdjuntos` / `setAdjuntos` (localStorage) | `<PanelAdjuntos>` | `attachments` + Storage |
| pestaña **Firma** | **no existe nada que migrar** | — |
| `renderAddProdResults` sobre `PRODUCTOS` global | — | `search_products` server-side |

---

## B · Páginas React propuestas

```
#/ventas                        → redirige a #/ventas/cotizaciones
#/ventas/cotizaciones           CotizacionesPage
#/ventas/cotizaciones/nueva     CotizacionDetallePage (alta)
#/ventas/cotizaciones/:id       CotizacionDetallePage
#/ventas/pedidos                PedidosPage
#/ventas/pedidos/nuevo          PedidoDetallePage (alta)
#/ventas/pedidos/:id            PedidoDetallePage
#/ventas/entregas               EntregasPage
#/ventas/entregas/nueva         EntregaDetallePage (alta)
#/ventas/entregas/:id           EntregaDetallePage
```

HashRouter, sin tocar `router.tsx`. `#/ventas` sin subsección redirige y no
tiene pantalla propia: un tablero de Ventas sería una idea nueva, y esto es una
migración.

**El id es el `uuid`, no el número.** El número no es único a través del tiempo
si algún día se corrige un outlier, y ya tenemos 9 números raros. El número se
muestra grande en la pantalla y se busca por él; la URL usa el id.

`/nueva` como ruta propia y no un modal: el legacy pierde el borrador si
navegás, y una URL propia hace que refrescar no borre nada.

---

## C · Componentes

**Compartidos entre los tres documentos** (`src/modules/ventas/components/`)

| componente | qué resuelve |
|---|---|
| `<ListadoDocumentos>` | tabla desktop / tarjetas mobile, orden, paginación server-side |
| `<FiltrosDocumentos>` | fecha, cliente, estado, moneda, número |
| `<ChipEstado>` | un color por estado, los tres documentos |
| `<AvisosHistoricos>` | los banners de `needs_review` |
| `<TablaLineas>` | líneas en lectura y edición, con `line_type = chapter` |
| `<SelectorProducto>` | busca contra `search_products`, nunca carga el catálogo |
| `<SelectorCliente>` | busca contra `customers` |
| `<PanelRelacionados>` | cotización → pedido → entrega, con links |
| `<PanelPendientes>` | **las cuatro reglas de Stage 2.5** |
| `<ModalEntregaParcial>` | cantidades por línea, con pendiente real |
| `<PanelAdjuntos>` | `attachments` + Storage |
| `<BarraTotales>` | subtotal, impuesto, total, descuento global |

**`<PanelPendientes>` es el componente que más importa de toda la migración.**
Es el único lugar donde la UI puede mentir sobre el histórico, así que tiene un
solo trabajo: elegir entre cuatro estados y no calcular nada cuando no
corresponde.

---

## D · Services y hooks

```
services/
  cotizaciones.ts   listar · obtener · crear · actualizar · eliminar · duplicar
  pedidos.ts        idem + desdeCotizacion()
  entregas.ts       idem + desdePedido()
  numeracion.ts     proximoNumero(companyId, docType, serie?)  → RPC
  relacionados.ts   documentosRelacionados(tipo, id)
  pendientes.ts     estadoDeEntregaPorLinea(orderId)
hooks/
  useCotizaciones / usePedidos / useEntregas          (listados paginados)
  useCotizacion / usePedido / useEntrega              (detalle)
  useFiltrosVentas                                    (filtros en la URL)
  usePendientesPedido                                 (el panel de arriba)
```

`companyId` primero en cada clave de caché, `placeholderData` sólo con la misma
empresa — la misma regla que usa el Catálogo.

**`pendientes.ts` es lógica pura y testeable**, separada del componente: recibe
las líneas del pedido y las líneas de entrega, y devuelve el estado. Así los
cuatro casos de Stage 2.5 se prueban sin montar React.

---

## E · Acciones que SÍ se migran

| acción | dónde | nota |
|---|---|---|
| listar los tres documentos | listados | paginación **server-side** |
| filtrar por fecha, cliente, estado, moneda, número | listados | en la URL |
| ordenar por columna | listados | server-side |
| ver detalle | detalle | |
| crear / editar / eliminar / duplicar | los tres | |
| líneas: agregar producto, línea libre, **capítulo** | editor | `line_type` |
| descuento global, IVA, IIBB | editor | |
| **cotización → pedido** | ambos | `quote_id` |
| **pedido → entrega, total o parcial** | ambos | `order_line_id` real |
| adjuntos | editor | Storage |
| relacionados | detalle | |
| imprimir | detalle | |
| exportar CSV | listados | |
| selección múltiple + acciones en lote | listados | |

## F · Acciones legacy que NO se copian

| no se copia | por qué | qué se hace |
|---|---|---|
| `localStorage` como base de datos | ya está migrado | Supabase + TanStack Query |
| **borrador global único** (`cotizacionBorrador`) | un solo borrador para toda la app: abrir otro documento pisa el que estabas editando | estado por página, ruta `/nueva` |
| **numeración `MAX+1` local** | es la causa demostrada de los 9 `PDV11xxx` | RPC `next_document_number` |
| `entregado[idx]` — array por índice | insertar una línea corre las entregas | FK `delivery_lines.order_line_id` |
| cliente y producto **por texto** | rompe la trazabilidad | FK a `customers` y `products` |
| `TEAM_USERS` + permisos en `localStorage` | es control de acceso decorativo | RLS; la UI sólo oculta |
| `PRODUCTOS` global en memoria | son 21.775 productos | `search_products` |
| paginación y filtros en el cliente | trae los 636 documentos para mostrar 10 | server-side |
| sync masivo del store completo | escribe todo el JSON por cualquier cambio | escritura por fila |
| adjuntos en `localStorage` | los archivos no entran en el cuota del navegador | `attachments` + Storage |
| **pestaña Firma** | está vacía en el legacy: dice «próximamente» | no se migra nada |
| **Importar OC con IA** | manda el PDF a un worker con una key del lado del cliente | backlog, con la key del lado del servidor |
| `NE → Factura` | `sales_invoices` está vacía y su numeración puede venir de STEL | backlog |

---

## G · Diferencias obligatorias por el backend nuevo

Estas **no son elecciones de diseño**: el modelo nuevo obliga.

### G.1 · `delivery_lines` no tiene precio — y el remito legacy es valorizado

```
delivery_lines: id, company_id, delivery_id, order_line_id, product_id,
                sku_snapshot, name_snapshot, quantity, warehouse_id, notes
```

No hay `unit_price`, ni `discount_pct`, ni impuesto. Pero la nota de entrega
legacy **se edita con precios** —usa el mismo editor que la cotización— y las
182 entregas migradas tienen `currency_code`, `subtotal`, `tax_amount` y `total`
**en la cabecera**.

O sea: el importe del remito histórico existe, pero **el detalle por línea no**.

Hay que elegir, y es una decisión tuya:

- **(a)** agregar `unit_price`, `discount_pct`, `tax_treatment` y
  `tax_rate_snapshot` a `delivery_lines`. Es un remito valorizado 1:1, y las 600
  líneas históricas quedan con precio `NULL` — el detalle histórico no se puede
  reconstruir, sólo el total.
- **(b)** el remito no lleva precios: sólo qué y cuánto se entregó. El importe
  vive en la factura. Es más limpio conceptualmente, pero **no es 1:1**.

Sin resolver esto, «crear entrega» no se puede migrar como está.

### G.2 · `salesperson_id` está en NULL en los 166 pedidos

La columna «vendedor» que pediste en los listados va a estar **vacía en todo el
histórico**. El legacy no guardaba el vendedor por documento. Para documentos
nuevos se puede completar con el usuario que lo crea.

### G.3 · El estado de cabecera puede contradecir al detalle

Los 140 pedidos con entrega quedaron con `fulfillment_status = 'delivered'` y
los 26 sin entrega con `'pending'`. Pero Stage 2.5 demostró que **14 de esos 140
no tienen el detalle reconstruido** y **2 entregaron de más**.

Regla: **el panel por línea se deriva de `delivery_lines`, nunca del estado de
cabecera.** Si no coinciden, gana el detalle y se muestra el aviso.

### G.4 · Estados: el mapeo

| legacy | nuevo | migrados |
|---|---|---:|
| cotización `pendiente` | `sent` | 154 |
| cotización `cerrada` | `accepted` | 134 |
| cotización `rechazada` | `rejected` | 0 |
| — | `draft`, `expired` | 0 |
| pedido (los tres) | `commercial_status = confirmed` | 166 |
| NE (los tres) | `status = delivered` | 182 |

El pedido pasó de **un** estado a **cuatro** (`commercial`, `fulfillment`,
`invoicing`, `payment`). El listado muestra `commercial_status` y, al lado, el
de cumplimiento; los otros dos recién sirven cuando existan facturas y pagos.

### G.5 · Cosas que hoy están vacías

`customer_addresses` 0 · `attachments` 0 · `stock_reservations` 0 ·
`sales_invoices` 0 · `payments` 0 · `delivery_serials` 0.

El selector de dirección de envío no tiene de dónde elegir. Se muestra vacío con
opción de crear, no se inventa.

### G.6 · Stock

`app.apply_stock_movement` y `app.apply_stock_reservation` ya son triggers sobre
`stock_movements` y `stock_reservations`, y mantienen `stock_balances`. Crear
una entrega **inserta un `stock_movement`** y el balance se actualiza solo.
**No hay que construir ningún sistema de stock**, ni replicar el «SR descontado»
del legacy.

### G.7 · Series

`RT` es la única serie emisible. `RT-ML` existe en el modelo y en los 4
documentos históricos, pero **no tiene secuencia**: pedirla devuelve
`no_data_found`. **El selector de serie no la ofrece**, y como hay una sola
opción, en la práctica no hay selector: se muestra `RT` fija.

---

## H · Plan por entregas

Cada entrega termina con CI verde y es usable por sí sola.

| # | entrega | contenido | por qué en este orden |
|---|---|---|---|
| **1** | **Leer el histórico** | rutas, los 3 listados server-side con filtros y paginación, `<ChipEstado>`, `<AvisosHistoricos>`, mobile | es lo único que se puede validar contra 636 documentos reales desde el primer día |
| **2** | **Detalle en lectura** | los 3 detalles, `<TablaLineas>` en modo lectura, `<PanelRelacionados>`, **`<PanelPendientes>` con las 4 reglas** | cierra la parte histórica completa sin escribir una sola fila |
| **3** | **Crear y editar cotizaciones** | `<SelectorCliente>`, `<SelectorProducto>`, `<TablaLineas>` editable, capítulos, totales, numeración por RPC | el documento más simple: no depende de ningún otro |
| **4** | **Pedidos** | alta, edición, **cotización → pedido** | reusa todo lo de la entrega 3 |
| **5** | **Entregas** | alta, **pedido → entrega total o parcial**, movimiento de stock, serie `RT` | **bloqueada por la decisión G.1** |
| **6** | **Terminaciones** | imprimir, CSV, adjuntos, acciones en lote | nada de esto bloquea el uso diario |

Las entregas 1 y 2 **no escriben nada**: hasta ahí el riesgo sobre los datos
migrados es cero.

---

## I · Tests

**Unitarios** (Vitest, lógica pura, sin red)

| test | qué prueba |
|---|---|
| `pendientes.test.ts` | los 4 estados: real · `NO_CONSTA_ENTREGA` · `DETALLE_NO_RECONSTRUIDO` · `OVERDELIVERED` |
| `pendientes.test.ts` | **nunca devuelve un número cuando no hay evidencia** |
| `filtrosUrl.test.ts` | filtros ↔ URL, ida y vuelta |
| `estados.test.ts` | mapeo legacy → nuevo, y el chip de cada uno |
| `totales.test.ts` | subtotal, descuento global, IVA; y que un capítulo no suma |

**De integración, contra los datos reales**

| test | dato esperado |
|---|---|
| abrir el histórico de cotizaciones | 288 |
| buscar `COTI02251` | 1 resultado |
| buscar `PDV01295` | 1 resultado |
| buscar `RT0000001406` | 1 resultado |
| buscar `RT-ML2025000058` | 1 resultado, serie `RT-ML` |
| detalle con relación | PDV01295 → su cotización y su entrega |
| **pendiente real** | uno de los 126 `COMPLETO` |
| **`NO_CONSTA_ENTREGA`** | uno de los 21 |
| **`DETALLE_NO_RECONSTRUIDO`** | uno de los 14 |
| **`OVERDELIVERED`** | PDV01181 y PDV01238 |
| `NUMBER_OUTLIER` | los 9 `PDV11xxx` muestran el aviso y el número literal |
| crear cotización | número desde el RPC, no del frontend |
| convertir a pedido | `quote_id` apuntando bien |
| crear entrega | `order_line_id` en cada línea y `stock_movement` insertado |
| RLS | los 5 roles, sobre las pantallas |
| mobile | 390 · 430 · 768 · 1440 sin scroll horizontal global |
| back / forward / refresh | los filtros sobreviven; el borrador no se pierde |

**Performance, con los 636 reales**: listado de cotizaciones, de pedidos, de
entregas, detalle de pedido con líneas, filtro por cliente, búsqueda por número.
Referencia: el piso de red medido es **~190 ms**. Sin medir no se optimiza nada.

---

## J · Riesgos

| # | riesgo | por qué | mitigación |
|---|---|---|---|
| 1 | **`delivery_lines` sin precio** (G.1) | bloquea «crear entrega» 1:1 | **decisión tuya antes de la entrega 5** |
| 2 | **inventar un pendiente** | es el error que más caro sale: un número inventado se lee como un dato | `<PanelPendientes>` con lógica pura y 4 tests dedicados |
| 3 | **el editor único del legacy** | tentador de copiar, pero arrastra el borrador global | tres páginas, componentes compartidos |
| 4 | **la UI parece el control de acceso** | el legacy lo es | RLS ya probada con 110 checks; la UI sólo oculta |
| 5 | **cabecera vs detalle** (G.3) | 14 + 2 casos donde se contradicen | el detalle manda, y se avisa |
| 6 | **paginación en el cliente** | copiar el patrón legacy trae los 636 | server-side desde la entrega 1 |
| 7 | **la impresión del legacy** | `document.write` en un iframe, difícil de portar tal cual | entrega 6, y se evalúa aparte |
| 8 | **Importar OC** | manda el PDF a un worker con una key del lado del cliente | backlog, no se migra ahora |
| 9 | **capítulos** | 0 líneas históricas los usan, así que no hay con qué probar contra datos reales | tests unitarios de totales |
| 10 | **26 pedidos sin entrega, 21 dudosos** | mostrar «pendiente = todo» sería afirmar algo no demostrado | `NO_CONSTA_ENTREGA` |
| 11 | `sales_invoices` y `payments` vacías | el panel de relacionados queda a medias | se muestran las secciones vacías, no se ocultan |
| 12 | **alcance** | el legacy tiene 45.345 líneas y Ventas toca clientes, catálogo, stock y facturación | Clientes y Compras quedan fuera; selector básico de cliente |
