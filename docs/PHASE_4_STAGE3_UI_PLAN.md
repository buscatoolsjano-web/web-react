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

---

# Entrega 3 — crear y editar cotizaciones

Aplicado. Decisión G.1 opción A ya estaba; acá se suma lo que la edición
necesita.

## Lo que se decidió y por qué

### Los totales los calcula el servidor

Un trigger (`app.recalcular_totales_cotizacion`) recalcula `subtotal`,
`tax_amount` y `total` en cada cambio, a partir de las líneas. **El navegador
no puede imponer un total**: mandar `total: 1` desde el cliente se ignora, y hay
un test que lo comprueba.

La cuenta, en este orden:

```
neto de línea = cantidad × precio × (1 − dto_línea/100)
subtotal      = Σ neto × (1 − dto_global/100)
IVA           = Σ (neto × (1 − dto_global/100) × tasa_línea/100)
percepción    = subtotal × percepción/100
tax_amount    = IVA + percepción
total         = subtotal + tax_amount
```

Los capítulos son títulos: no suman. Y los **288 documentos históricos no se
recalculan nunca** — el trigger sale de entrada si `imported_at` no es nulo.

`lib/totales.ts` repite la misma cuenta **sólo para previsualizar** mientras se
escribe, y sus tests usan los números que devolvió la base.

### Dos columnas nuevas en `sales_quotes`

| columna | por qué |
|---|---|
| `discount_pct` | el editor legacy tiene «% Dto.» global |
| `perception_pct` | el legacy tiene «Sujeto a Percep. IIBB 2,5 %» |

La percepción se guarda como **alícuota**, no como booleano: fijar 2,5 en el
código sería la misma suposición que descartamos con el IVA del 21 %. El botón
de la interfaz propone 2,5 y el número se puede cambiar.

### Qué estado permite editar

| estado | |
|---|---|
| `draft` | se edita todo |
| `sent` | se edita, y **el cambio de precio, cantidad o descuento queda en `sales_audit`** |
| `accepted` · `rejected` · `expired` | **congelado**, con dos triggers que lo rechazan |

El bloqueo es del servidor, no de la interfaz: intentar cambiar el total o
tocar una línea de una cotización aceptada devuelve `restrict_violation`
aunque se llame a PostgREST directamente.

La lista de columnas bloqueadas es corta a propósito —`series_code`, `notes` y
los campos de revisión quedan afuera— para que un backfill o una anotación
posterior no choquen contra el candado.

### Auditoría

`sales_audit` **no tiene policy de INSERT**. La única puerta es
`public.registrar_evento_venta()`, `SECURITY DEFINER`, que valida la acción
contra una lista cerrada (`created`, `updated_sensitive_fields`, `sent`,
`approved`, `rejected`, `cancelled`) y saca la empresa **del documento**, no
del cliente.

Un evento por acción de negocio. Verificado: dos `UPDATE` técnicos seguidos
sobre `notes` no generan ninguna fila.

### Sin autosave, sin borrador global

Cada campo se guarda **al salir del control y sólo si cambió**. No hay
temporizadores: no hay writes duplicados, no hay bucles, y no se reescribe
nada más que la fila tocada.

En el alta el documento se arma en memoria y se escribe al guardar, así que
**un borrador abandonado no se come un número de la serie**. No hay
`cotizacionBorrador` global: dos cotizaciones abiertas no se pisan, y hay un
test que edita las dos y comprueba que cada una conserva lo suyo.

### Numeración

`next_document_number()`, siempre. **30 llamadas en paralelo** desde una sesión
real: 30 números, todos distintos, sin huecos y sin errores.

### El selector de productos

Contra `search_products`, con debounce de 300 ms y 20 filas como máximo. Sugiere
el precio de la lista por defecto **sólo si está en la moneda del documento**:
convertir de USD a ARS sin un tipo de cambio confirmado sería inventar el
precio.

## Bugs encontrados

1. **`permission denied for schema app`.** El trigger llamaba a
   `app.totales_cotizacion()` con el nombre calificado, y eso se resuelve con
   los permisos de quien dispara el trigger: ni `authenticated` ni
   `service_role` tienen `USAGE` sobre `app`. Se resolvió con `SECURITY
   DEFINER` en la función del trigger, **no** abriendo el schema: dar `USAGE`
   sobre `app` para que ande un cálculo de totales sería regalar el acceso a
   `current_company_ids()` y a todos los helpers de RLS.
2. **Los totales llegaban un `UPDATE` tarde.** La función leía el descuento y
   la percepción de la tabla, pero el trigger es `BEFORE UPDATE`: la fila
   todavía tenía los valores viejos. Ahora entran por parámetro desde `NEW`.
3. **Reordenar líneas fallaba contra `unique (quote_id, line_no)`.** El
   intercambio en dos pasos choca en el primero. Se pasa por un número libre y
   alto — no negativo, porque también hay `check (line_no > 0)`.
4. **El `CHECK` de `tax_treatment` de `delivery_lines` no era el de
   `sales_order_lines`.** Tenía `vat_27`, que no existe en las otras dos, y le
   faltaba `vat_0`, que sí. Corregido: las tres tablas aceptan lo mismo.
5. **Un componente arrastraba el cliente de Supabase.** `EditorLineas`
   importaba `TRATAMIENTOS` desde `services/`, y ese módulo lee las variables
   de entorno al importarse. Lo agarró `npm run test:isolated`, que existe
   justamente para eso. Los tratamientos pasaron a `lib/tratamientos.ts`.

---

# Entrega 4 — pedidos y conversión desde cotización

## Cambios de esquema

| | por qué |
|---|---|
| `sales_orders.discount_pct`, `perception_pct` | el editor legacy del pedido tiene el mismo «% Dto.» global y el mismo check de percepción que el de la cotización (`ped-iibb` en `app.js`). Sin ellas, convertir una cotización con descuento global daría un pedido por otro importe |
| `origin` gana el valor **`quote`** | el modelo suponía que la cotización siempre llegaba con la OC del cliente (`quote_po`). El flujo real convierte la cotización sola, y `direct` significa venta **sin** cotización: reusarlo sería guardar un dato falso |
| **`unique (company_id, quote_id)`** parcial | ver abajo |
| triggers de totales y de bloqueo | los mismos dos de la cotización, con `quantity_ordered` |

### Un pedido por cotización — con evidencia

No es una suposición: de los 132 pedidos históricos que tienen cotización,
hay **132 cotizaciones distintas**. Ninguna generó dos pedidos.

El botón se deshabilita cuando ya existe el pedido, pero **lo que impide el
duplicado es el índice**: dos pestañas convirtiendo la misma cotización a la
vez dejan **un** pedido, y la segunda recibe `23505`. Está probado.

Si algún día hace falta partir una cotización en dos pedidos, se levanta con
un `DROP INDEX`.

## Qué se puede editar

| estado | |
|---|---|
| `draft` | se edita todo |
| `confirmed` **sin entregas** | se edita; el cambio de precio queda en `sales_audit` |
| `confirmed` **con entregas** | **las líneas se congelan** |
| `cancelled` | congelado |

Lo de las entregas no es una preferencia: cambiar la cantidad pedida de una
línea que ya tiene entregas mueve el pendiente de un documento que el cliente
ya firmó — el mismo dato que Stage 2.5 tuvo que reconstruir para 505 líneas.
Lo impone un trigger, no la pantalla.

## Conversión

Copia los snapshots tal como están —producto, SKU, nombre, cantidad, precio,
descuento de línea, tratamiento y alícuota, incluidos los capítulos— y enlaza
por `quote_id`. **La cotización original no se toca**: no cambia de estado, no
se marca, no se modifica.

El vínculo es una clave foránea, no el texto del número: el legacy guardaba
`fromCotizacion: 'COTI02520'` como string y por eso Stage 2 tuvo que
reconstruir 132 relaciones.

## Stock

El detalle muestra, por línea con producto: **en stock · reservado · libre ·
faltante**. Es sólo lectura, y está verificado con un test:
`stock_movements` y `stock_reservations` quedan **exactamente igual** después
de crear, editar y confirmar un pedido. No se inventó ninguna automatización.

Un producto sin fila en `stock_balances` muestra «sin movimientos
registrados», no un cero: no es lo mismo no tener stock que no saber.

## Mobile

La auditoría del CSS encontró dos cosas y las dos se corrigieron: los campos
de la tabla de líneas estaban en **40 px** y los botones de subir/bajar/borrar
en **32 px**. En desktop está bien —es una tabla densa— pero con el dedo no.
Ahora suben a 44 px por debajo de 768 px.

Las cinco tablas del módulo scrollean **dentro de su propia caja**
(`overflow-x: auto`), así que la página nunca scrollea en horizontal, y todos
los inputs pasan a 16 px en mobile para que iOS no haga zoom al enfocar.

---

# Entrega 5 — remitos, parciales y stock

## Qué hacía el legacy (revisado antes de decidir)

`generarNotaEntregaDesdePedido` (app.js 22064) y `applyStockDeductions` (22009):

| | legacy | acá |
|---|---|---|
| sobreentrega | **la recortaba en silencio** con `Math.min(qty, pendiente)` | se **rechaza** y se explica |
| control de stock | **ninguno**: descontaba y dejaba el saldo negativo | **igual, pero avisando**: se muestra el faltante y se deja emitir |
| relación con el pedido | `entregado[idx]`, un array por índice | `delivery_line.order_line_id` |
| kits | expandía componentes | **no se migra**: hay 0 productos con `is_kit` y 0 líneas con componentes. Sin evidencia no se implementa |

El recorte silencioso es lo único que cambié a propósito: entregar una
cantidad distinta de la que se pidió sin decir nada es peor que rechazar.

## Confirmar es una sola operación del servidor

`public.confirmar_entrega(delivery)` hace todo dentro de una transacción, con
la fila del remito bloqueada (`for update`): movimientos de stock, liberación
de reservas, estado del remito, estado de cumplimiento del pedido y auditoría.

**Es idempotente.** Si el remito ya está despachado devuelve
`{ya_confirmada: true}` y no toca nada. Probado con las tres formas de romperlo:

| | |
|---|---|
| confirmar dos veces seguidas | **un** movimiento |
| dos pestañas confirmando a la vez | **una** actúa, **un** movimiento |
| reintento tras refrescar | **un** movimiento |

## Stock y reservas

El movimiento va con **cantidad negativa** porque el trigger existente
(`app.apply_stock_movement`) suma lo que recibe. No se creó ningún sistema
paralelo: `stock_movements` → trigger → `stock_balances`, como estaba.

Las reservas se consumen **borrando la fila** y, si sobra cantidad,
insertando el resto: el trigger de reservas sólo entiende INSERT y DELETE.

## Estado de cumplimiento

Se **deriva** de las cantidades reales: `pending` · `partially_delivered` ·
`delivered`. Nadie lo escribe a mano.

## Bugs encontrados

1. **Un remito en borrador contaba como entregado.** `derivar_cumplimiento`
   sumaba todas las entregas no canceladas, así que un pedido de 100 con 70
   despachadas y 30 en borrador quedaba `delivered`. Son dos preguntas
   distintas: *¿cuánto queda por entregar?* cuenta también los borradores —o
   el modal ofrecería dos veces las mismas unidades— y *¿el pedido está
   entregado?* cuenta sólo lo despachado. Lo agarró el test del caso
   100 → 30 → 40 → 30.
2. **`app.apply_stock_reservation` tenía una trampa en UPDATE**: restaba
   `OLD.quantity` y nunca sumaba `NEW.quantity`, así que cambiar la cantidad
   de una reserva dejaba el saldo reservado mal para siempre. Hoy nadie hace
   UPDATE, pero el trigger no podía quedar así.
3. **`setState` dentro de un `useEffect`** en el modal de parciales. Se pasó
   al patrón de ajuste durante el render.

## Mobile

El modal ocupa la pantalla completa por debajo de 640 px —una caja centrada
con márgenes desperdicia espacio justo donde no sobra—, su tabla scrollea
dentro de su propia caja y todos los controles son de 44 px con fuente de
16 px.
