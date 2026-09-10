# Fase 6 · Compras — auditoría y plan de migración

Auditoría del módulo de Compras del legacy contra el backend nuevo. **No se
programó nada.**

Fuentes leídas: `app.js` (5,1 MB, el legacy completo), el dataset embebido de
proveedores en `BuscatoolsERP.html`, el backup de `localStorage` del
2026-09-09, la auditoría de Chrome del origen legacy y el schema real de
Supabase.

---

## Lo primero, porque cambia el plan

### 1 · En el backend nuevo **no hay nada de Compras**

Ventas y Clientes arrancaron con tablas que Stage 1 ya había creado. Compras
no. Las únicas tablas con «purchase» en el nombre son del **lado del cliente**
—la orden de compra que el cliente nos manda a nosotros—:

| tabla | de quién es |
|---|---|
| `customer_purchase_orders` | del cliente hacia nosotros |
| `customer_purchase_order_lines` | ídem |
| `purchase_order_discrepancies` | ídem |
| `customer_po_candidates` | ídem |

No existe `suppliers`, ni `purchase_orders`, ni `goods_receipts`, ni
`supplier_invoices`, ni `supplier_payments`. **El schema de Compras se diseña
desde cero.**

Lo único que ya está preparado es el enganche con stock:
`stock_movements.movement_type` **ya acepta `purchase_receipt`**, y tiene
`source_type` / `source_id` para apuntar al documento que lo generó.

### 2 · No tengo los datos reales de Compras

El backup del 2026-09-09 fue el export de **Ventas**: 30 claves de las 55 que
la auditoría de Chrome contó en el origen. **Ninguna de las cinco claves de
Compras está adentro**:

```
erp_proveedores        no está en el backup
erp_pedidos_compra     no está
erp_notas_proveedor    no está
erp_facturas_prov      no está
erp_facturas           no está
```

Sé exactamente **qué forma** tienen —lo dice el código— pero no **cuántos hay
ni qué dicen**. Los 142 proveedores sí los tengo, porque están embebidos en el
HTML.

**Antes de planificar volúmenes hace falta un export de sólo lectura de esas
cinco claves**, con el mismo método que se usó para Ventas: leer
`localStorage` sin escribir nada.

---

## A · Pantallas legacy

El menú declara **siete** subsecciones (`SECTIONS.compras`, línea 235):

| # | subsección | estado real |
|---|---|---|
| 1 | Proveedores | **implementada** |
| 2 | Pedidos a proveedores | **implementada** |
| 3 | Notas de entrega de proveedor | **implementada** |
| 4 | Facturas de proveedor | **implementada** |
| 5 | Recibos de proveedor | **placeholder** |
| 6 | Tickets y otros gastos | **placeholder** |
| 7 | Libro de facturas recibidas | **placeholder** |

`renderCompras` sólo enruta las cuatro primeras; las otras tres caen en
`empty()`, que pinta «🚧 Próximamente · Esta sección se está desarrollando».
Es el mismo caso que «Clientes potenciales».

Cada una de las cuatro reales tiene **listado** (filtros por columna, orden,
paginado de 25 en memoria) y **editor** con líneas, capítulos, descuento por
línea, descuento global e IVA.

## B · Funciones

| función | línea | qué hace |
|---|---|---|
| `renderCompras` | 31805 | enruta las siete subsecciones |
| `loadProveedores` / `saveProveedores` | 31830 | leer y guardar proveedores |
| `nextProvRef` | 31843 | `PROV00001` por **`MAX+1` local** |
| `renderProveedoresList` | — | listado con filtros |
| `loadPedidosCompra` / `savePedidosCompra` | 32070 | pedidos a proveedor |
| `clearPCBorrador` / `getPCActual` | 32077 | borrador único global |
| `nextPcRef` | 32084 | `PC00001` por **`MAX+1` local** |
| `renderPedidosCompraList` / `Editor` | 32093 | listado y editor |
| `wirePedidoCompraEditor` / `updatePedidoCompra` | — | edición de líneas |
| `generarNotaProvDesdePedidoCompra` | — | PC → NEP, total o parcial |
| `abrirModalNEPParcial` | — | modal de cantidades parciales |
| `loadNotasProveedor` / `saveNotasProveedor` | 32955 | notas de entrega de proveedor |
| `generarFacturaProvDesdeNEP` | 33156 | NEP → factura |
| `loadFacturasProveedor` / `saveFacturasProveedor` | 33145 | facturas de proveedor |
| `nextFpRef` | 33147 | `FP00001` por **`MAX+1` local** |
| `renderFacturasProvList` / `Editor` | 33190 | listado y editor |
| `eliminarPedidoCompraByRefSilent` | — | borrado |
| `renderInformeCompras` | — | informe |
| `applyStockRestoration` | — | **suma stock al recibir** |
| `logAct('pc'|'nep'|'fp', …)` | — | trazabilidad |

## C · Datos reales

| dato | cuánto | de dónde |
|---|---|---|
| **proveedores** | **142** | embebidos en `<script id="proveedores-data">` |
| pedidos a proveedor | **desconocido** | `erp_pedidos_compra`, no exportado |
| notas de entrega de proveedor | **desconocido** | `erp_notas_proveedor`, no exportado |
| facturas de proveedor | **desconocido** | `erp_facturas_prov`, no exportado |
| recibos / tickets / libro | **cero** | las pantallas no existen |
| movimientos de stock | 381 migrados | ya en `stock_movements` |
| kardex legacy | 22 filas | `erp_kardex`, con `kind: sr` (stock real) y `sv` (virtual) |

La auditoría de Chrome ya había dicho que `erp_facturas` (ventas) existe pero
está **vacía**, y que `erp_recibos`, `erp_notas_credito`, `erp_facturas_prov` y
`erp_notas_proveedor` estaban **AUSENTES** en ese perfil. Si eso se confirma en
el export nuevo, **el circuito de Compras podría no tener casi datos que
migrar** — pero eso hay que medirlo, no suponerlo.

## D · Tablas y claves usadas

**Legacy — `localStorage`, todo con prefijo de empresa (`_ekey`)**

| clave | contenido |
|---|---|
| `erp_proveedores` | array de proveedores; si está vacío, cae al dataset de 142 |
| `erp_pedidos_compra` | array de PC |
| `erp_pc_borrador` | borrador **único y global** del PC en edición |
| `erp_notas_proveedor` | array de NEP |
| `erp_facturas_prov` | array de FP |
| `erp_trazabilidad_log`, `erp_traz_<USUARIO>` | log de acciones |
| `erp_kardex` | movimientos de stock |

**Backend nuevo:** nada. Ver el punto 1.

## E · Proveedores

142 registros, con estos campos:

```json
{"ref":"PROV00008","nj":"Pinturerias REX S.A.","nc":"","cif":"","tel":"47247600",
 "email":"","direccion":"Direccion: Av.Saenz Peña 2227 · San Martin · BUENOS AIRES · CP 1651 · AR",
 "actividad":"","agente":"BUSCATOOLS","formaPago":"FOB 180 DIAS","notas":""}
```

- `ref` `PROV00008` — numeración por `MAX+1` local
- `nj` / `nc` — razón social y nombre comercial
- `cif` — CUIT
- `direccion` — **texto libre**, con el prefijo «Direccion:» adentro. No está
  estructurada, igual que pasaba con los clientes
- `formaPago` — condición de pago **por proveedor** (ej. «FOB 180 DIAS»)
- `agente` — a qué empresa del grupo pertenece la relación
- `actividad`, `notas` — texto libre

Es prácticamente el mismo modelo que `customers`, lo que es una buena noticia
para el diseño.

## F · Pedido a proveedor (PC)

```js
{ ref:'PC00001', proveedor:'<texto>', titulo, fecha:'YYYY-MM-DD',
  items:[{sku, nombre, desc, price, qty, dto, type?:'chapter', titulo?}],
  formaPago, iva:true, iibb:false, dtoGlobal:0,
  estado:'pendiente'|'parcial'|'recibido',
  entregado:{ '<índice>': cantidad },
  convertidaA:'NEP00003', stockApplied:false, creadoPor, created }
```

- **`proveedor` es texto**, no una referencia
- **no tiene moneda**: el código dice «USD» a mano en los mensajes
- **no tiene ETA** ni fecha estimada de entrega — busqué y no existe
- `iva` es un **booleano**, no una alícuota
- `entregado` está indexado **por posición en el array de líneas**

Estados y bloqueos, que son buenos y vale la pena conservar: con una NEP
derivada las líneas no se editan más; `parcial` deja seguir generando NEPs por
lo pendiente; `recibido` cierra el pedido.

## G · Recepción / albarán (NEP)

`generarNotaProvDesdePedidoCompra(refPC, cantidadesParciales)`:

```js
{ ref:'NEP00001', fromPedidoCompra:'PC00001', proveedor, titulo, fecha,
  formaPago, iva, items, base, ivaAmount, total, uds,
  estado:'pendiente'|'facturada', convertidaA:'FP00001', creadoPor, created }
```

- calcula lo pendiente por línea: `pedido − ya entregado`, acotado
- **suma stock real**: `applyStockRestoration(itemsNEP, 'sr', np.ref)`
- cierra el PC sólo cuando **todas** las líneas están completas
- deja traza: `logAct('pc', …, 'derive', …)`

## H · Factura de proveedor (FP)

`generarFacturaProvDesdeNEP(refNEP)`:

```js
{ ref:'FP00001', fromNEP:'NEP00001', fromPedidoCompra:'PC00001',
  proveedor, titulo, fecha, formaPago, iva, items,
  base, ivaAmount, total, uds, estado:'pendiente'|'pagada', creadoPor, created }
```

- **una NEP = una factura**: rechaza si ya existe una para esa NEP
- marca la NEP como `facturada`
- el vencimiento se **estima desde la forma de pago** cuando no hay fecha
  explícita (lo dice el propio dashboard financiero)

## I · Pagos

**No existen.** «Recibos de proveedor» es una de las tres subsecciones
placeholder. Lo único que hay es el campo `estado: 'pagada'` en la factura —un
booleano disfrazado— y dos widgets de dashboard que cuentan «pagos a proveedor
vencidos» y «por vencer en 7 días» mirando ese estado.

No hay importe pagado, ni fecha de pago, ni pagos parciales, ni un pago que
cubra varias facturas.

## J · Importador de PDF

**No hay importador del lado de Compras.**

El importador que existe (`pdf.js` + IA, `_ocExtractRows`, `doExtractAndProcess`)
está montado en los editores de **cotización** y **pedido de venta**
(`oc-upload-zone`, `oc-upload-zone-ped`): lee la **orden de compra que manda el
cliente** y propone las líneas de un documento de Ventas. Ya está en el backlog
como no migrado, porque la API key viaja del lado del cliente.

Un importador de facturas o remitos **de proveedor** sería una función nueva,
no una migración.

## K · Relaciones con Ventas

**Ninguna real.** Un PC no apunta a un pedido de venta ni al revés. Lo único
que los junta es un **widget del dashboard** (línea 11379) que lista los PC
pendientes al lado de los pedidos de venta pendientes: los lee de dos claves
distintas y no los relaciona.

O sea: hoy **no se puede responder «este pedido a proveedor es para cubrir tal
pedido de venta»**. Si eso hace falta, es una decisión nueva, no una migración.

## L · Relaciones con Stock

Ésta sí es fuerte y hay que respetarla:

| evento | efecto |
|---|---|
| crear un PC | **ninguno** (`stockApplied:false`) |
| generar una NEP | **suma stock real** (`applyStockRestoration(..., 'sr', ref)`) |
| facturar | ninguno |

En el kardex legacy los movimientos llevan `kind: 'sr'` (stock real) o `'sv'`
(stock virtual/reservado). El backend nuevo ya tiene el tipo
**`purchase_receipt`** en `stock_movements` y el par `source_type` /
`source_id` para apuntar a la recepción. **El circuito calza sin inventar
nada.**

Queda por decidir —igual que en Ventas— si la recepción reserva, si admite
recibir de más y qué depósito usa: hoy hay **un solo depósito** por empresa.

## M · Diferencias obligatorias con el backend nuevo

Cosas que **no** se migran tal cual porque están mal, en el mismo espíritu de
Ventas y Clientes:

| # | legacy | qué hay que hacer |
|---|---|---|
| 1 | **`Number(pc.iva)` con `iva: true` da 1** — la NEP y la factura derivada se calculan con **1 % de IVA** en vez de 21 % | totales **en el servidor**, con alícuota real por línea. Es un bug de plata, no de estilo |
| 2 | `entregado` indexado **por posición del array** | `purchase_order_line_id`, FK real. Es exactamente lo que costó el backfill de 484 líneas en Ventas |
| 3 | `proveedor` guardado como **texto** | `supplier_id`, FK |
| 4 | `PROV/PC/NEP/FP` por **`MAX+1` local** | `document_sequences`, como el resto |
| 5 | **sin moneda**, USD implícito | `currency_code` explícito. Los proveedores son importados: hay USD y EUR seguro |
| 6 | **sin ETA** | campo propio si se lo quiere; hoy no existe nada que migrar |
| 7 | dirección del proveedor en **texto libre** | `supplier_addresses`, o dejarla en texto y no inventar |
| 8 | pagos **no existen** | `supplier_payments` + asignaciones, si se decide construirlo |
| 9 | borrador de PC **único y global** en `localStorage` | cada documento con su URL, como en Ventas |
| 10 | listado paginado **en memoria** | server-side |
| 11 | permisos por `state.user` | RLS |

## N · Plan por entregas, propuesto

| # | entrega | incluye | escribe |
|---|---|---|---|
| **0** | **Export y auditoría de datos** | leer las 5 claves del origen legacy sin escribir; contar PC, NEP y FP reales; medir cuántos proveedores están en uso | no |
| **1** | **Schema** | `suppliers`, `supplier_contacts`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `supplier_invoices`; secuencias, RLS, totales en el servidor | migración |
| **2** | **Proveedores** | migrar los 142; listado server-side, ficha, alta y edición. Es casi el mismo trabajo que Clientes | sí |
| **3** | **Pedidos a proveedor** | listado, ficha, alta y edición, con numeración del servidor y totales calculados | sí |
| **4** | **Recepciones** | recepción total y parcial **por línea**, con el movimiento de stock atómico e idempotente | sí |
| **5** | **Facturas de proveedor** | desde la recepción, con el vencimiento derivado de la condición de pago | sí |
| **6** | **Cierre** | impresión, adjuntos, mobile, RLS, revisión visual | sí |

**Pagos a proveedor** queda **fuera** salvo que se decida lo contrario: en el
legacy no existen y construirlos es funcionalidad nueva, no migración. Lo
mismo con tickets, libro de facturas recibidas y el importador de PDF de
proveedor.

## O · Riesgos

| # | riesgo | mitigación |
|---|---|---|
| 1 | **No sabemos cuánto hay que migrar.** El backup no trae Compras | entrega 0: export de sólo lectura antes de planificar |
| 2 | El IVA al 1 % puede estar **ya escrito** en NEPs y facturas históricas | decidir explícitamente: ¿se respeta el total histórico como en Ventas, o se corrige? Yo propongo **respetarlo y marcarlo**, igual que los 636 documentos |
| 3 | `entregado[idx]` puede tener el mismo desfasaje que en Ventas | reconstruir sólo con evidencia determinística; lo ambiguo queda marcado |
| 4 | Sin moneda en el histórico | igual que los 32 documentos «sin moneda» de Ventas: no se supone USD, se deja en `null` y se muestra como faltante |
| 5 | Los 142 proveedores tienen CUIT vacío en muchos casos | mismo tratamiento que Clientes: índice único parcial, y lo dudoso a `needs_review` |
| 6 | Tocar `stock_movements` puede mover el stock actual | las 381 filas existentes no se tocan; la recepción sólo agrega |
| 7 | Compras toca **precios de costo** | no exponerlos a roles externos: RLS desde el primer día |
| 8 | Tres subsecciones son placeholders | `NOT_MIGRATED_BY_DESIGN`, como clientes potenciales |

## P · Tests, mínimo

- **Reconciliación**: proveedores legacy vs migrados, con conteo explícito; PC,
  NEP y FP idem cuando exista el export
- **Numeración concurrente**: `PROV`, `PC`, `NEP`, `FP` sin huecos ni repetidos
- **Recepción parcial**: por `purchase_order_line_id`, nunca por índice
- **Sobre-recepción**: rechazada o marcada, según la regla que se decida
- **Stock**: una recepción suma exactamente lo recibido, es idempotente y no
  toca las 381 filas históricas
- **Totales**: calculados en el servidor; el IVA al 1 % no se puede reproducir
- **Una NEP = una factura**: intento real de duplicar, rechazado
- **RLS por rol**: admin, employee, salesperson, technician, customer,
  distributor y anónimo. Un externo **no ve precios de costo ni proveedores**
- **Mobile** 390 / 430 / 768 / 1440
- **Regresión de Ventas y Clientes**: las siete + las cinco suites, 288 / 166 /
  182 / 636 y la huella `8091b9166350c5bf2c331b1d882ec654` intacta

---

## Lo que necesito para arrancar

1. **El export de sólo lectura** de `erp_proveedores`, `erp_pedidos_compra`,
   `erp_notas_proveedor`, `erp_facturas_prov` y `erp_facturas` del origen
   legacy. Sin eso, la entrega 1 se diseña a ciegas.
2. **Tres decisiones**:
   - ¿el histórico con IVA al 1 % se **respeta** (como los 636 de Ventas) o se
     **corrige**?
   - ¿**pagos a proveedor** entra en el alcance o queda fuera como el legacy?
   - ¿hace falta relacionar un pedido a proveedor con un pedido de venta? Hoy
     **no existe** esa relación.
