# Fase 6 · Compras — Entrega 6: cierre funcional

Estado: **CERRADA**. Con esto, **COMPRAS queda migrado a React**.

El circuito completo —proveedores, pedidos de compra, recepciones, facturas de
proveedor, stock, adjuntos, auditoría, impresión, export y navegación entre
documentos— funciona, está probado contra la base real y revisado en pantalla
de 390 a 1440.

Fuera de alcance y **no empezado**: Mantenimiento.

| | |
|---|---|
| SQL aplicado | [`docs/database/PHASE_6_PURCHASES.sql`](database/PHASE_6_PURCHASES.sql) |
| Suite de cierre | [`scripts/fase6-cierre-tests.mjs`](../scripts/fase6-cierre-tests.mjs) |
| Fixtures de revisión | [`scripts/fase6-facturas-fixtures.mjs`](../scripts/fase6-facturas-fixtures.mjs) |

**Sin migraciones nuevas.** Esta entrega no tocó el schema.

---

## A · Cobertura funcional

El menú **Compras** del legacy tenía **siete** entradas. Están en la línea 235
de `app.js`, en un solo objeto:

| # | legacy | estado |
|---|---|---|
| 1 | Proveedores | **MIGRADO** |
| 2 | Pedidos a proveedores | **MIGRADO** |
| 3 | Notas de entrega de proveedor | **MIGRADO** |
| 4 | Facturas de proveedor | **MIGRADO** |
| 5 | Recibos de proveedor | **NOT_MIGRATED_BY_DESIGN** |
| 6 | Tickets y otros gastos | **NOT_MIGRATED_BY_DESIGN** |
| 7 | Libro de facturas recibidas | **NOT_MIGRATED_BY_DESIGN** |

Las tres últimas **nunca existieron**, y eso no es una interpretación:
`renderCompras()` sólo despacha las cuatro primeras y todo lo demás cae en
`empty()`, que pinta «🚧 Próximamente · Esta sección se está desarrollando».
`recibos-prov` y `libro-recibidas` aparecen **una sola vez en los 5,3 MB del
archivo**: en esa línea del menú. No hay función de render, ni capa de datos,
ni una sola fila guardada.

No se construyeron para poder decir «100 %».

### Acciones, documento por documento

| acción | legacy | React |
|---|---|---|
| Nueva / editar | sí | sí |
| Confirmar pedido | sí | sí |
| Duplicar pedido | sí | sí |
| Eliminar pedido | sí | sí (sólo borrador; con recepción lo frena el servidor) |
| Recibir mercadería | sí | sí |
| Confirmar recepción | sí | sí, y **mueve stock** —el legacy no tenía stock— |
| Facturar | parcial | sí, con parciales y consolidación |
| Adjuntar | sí | sí, en las **cuatro** entidades |
| Imprimir | pedido y recepción | pedido, recepción **y factura** |
| Exportar CSV | no | los cuatro listados |
| Enviar por mail | sí | **BACKLOG** — el módulo Emails es de otra fase |

## B · Navegación y relacionados

Todo por identificador, **nunca por texto**:

```
Proveedor ──┬─→ Pedidos de compra   (?prov=<id>)
            ├─→ Notas de entrada    (?prov=<id>)
            └─→ Facturas            (?prov=<id>)

Pedido ─────┬─→ Recepciones  (por purchase_order_id)
            └─→ Facturas     (derivadas por línea)

Recepción ──┬─→ Pedido
            └─→ «Facturar» con esa recepción precargada

Factura ────┬─→ Recepciones y pedidos, derivados por sus líneas
            └─→ Proveedor
```

**Dos arreglos acá.** La pestaña «Compras» del proveedor mostraba tres números
sueltos con un texto de la entrega 2 que decía que el circuito «todavía no
tiene pantalla»: ahora cada número es un enlace al listado filtrado. Y la
pestaña «Relacionados» del pedido **contaba** las facturas pero no dejaba
llegar a ellas: ahora las lista con su número del proveedor, fecha, importe,
referencia interna y estado.

## C · Impresión y export

### Qué imprimía el legacy — la auditoría

`getDocTypeMeta()` mapea seis tipos, y dos son de Compras: `pc` («PEDIDO A
PROVEEDOR») y `np` («NOTA DE ENTREGA DE PROVEEDOR»). El tercero, `factura`, es
una factura **de cliente** (`persona: 'cliente'`). Para la factura de proveedor
no había nada: `fp` figura en un mapa de logging pero no en `getDocTypeMeta`,
así que habría salido titulada «COTIZACIÓN DE VENTA».

### Por qué acá NO hay seis plantillas

El legacy usaba **un solo modal para todo**, con los mismos seis formatos de
Ventas —valorado, sin valorar, sin impuestos, pro forma, sin totales, ticket—
también para `pc` y `np`. No fueron pensados para Compras: son la lista de
Ventas reutilizada. Mirados de a uno:

- **sin valorar** en un pedido a proveedor es un pedido sin precios, o sea sin
  lo único que hay que acordar con él;
- **pro forma** es un documento que se le manda a un cliente;
- **ticket** es un comprobante de mostrador;
- **sin totales / sin impuestos** esconden justo lo que el proveedor confirma.

Así que **un formato por documento** y lo único que se elige es el papel —que
en el legacy también era real—.

| documento | qué lleva |
|---|---|
| **Pedido de compra** | empresa, proveedor, referencia del proveedor, número, fecha, moneda, tipo de cambio, **ETA**, **condición de pago**, líneas con precio, descuento e impuesto, subtotal / impuestos / total, observaciones |
| **Recepción** | empresa, NEP, proveedor, **pedido**, depósito, fecha, remito del proveedor, líneas con cantidades, observaciones — **sin un solo importe** |
| **Factura** | empresa, **número del proveedor como título**, **referencia interna FP**, proveedor, fecha, vencimiento, moneda, líneas con su **origen** (de qué NEP vienen), impuestos, total, **documentos relacionados** |

Los datos que faltan **no se imprimen vacíos**: se omite la fila entera. Un
pedido sin ETA no dice «Entrega estimada: —».

La recepción, en vez de dejar el hueco de los totales, explica por qué no los
tiene: *«Documento logístico: registra qué llegó, no cuánto cuesta. Los
importes están en el pedido de compra y en la factura.»*

### Lo que se previsualiza es lo que se imprime

Verificado estructuralmente, no de palabra: la hoja está **dentro** de
`[data-previa-impresion]`, que es el único nodo que la hoja `@media print`
global deja visible, y **hay 0 iframes** en la página. El legacy escribía un
string de HTML en un iframe, así que la vista previa y el PDF salían de dos
caminos parecidos pero no idénticos.

### CSV

Los cuatro listados exportan **lo que muestran los filtros**, pidiendo páginas
al servidor de a 1000 y cortando en 5000. Nada se trae entero al navegador.

Medido interceptando el blob real:

| listado | sin filtro | con filtro |
|---|---|---|
| facturas | 2 filas | `?prov=…&estado=registered` → **1 fila** |
| pedidos | 1 fila, con la columna **ETA** | — |
| recepciones | 1 fila, **sin columna de importe** | — |

Los importes van con **punto decimal y sin separador de miles** —`2215.67`— para
que una celda pueda sumarse, y la **moneda va en su propia columna**: el archivo
nunca suma monedas distintas.

> `exportarPedidos()` ya existía desde la entrega 3 pero **nunca había tenido
> botón**. Ahora lo tiene, junto con los dos que faltaban.

## D · Estados

| documento | estados | qué se congela |
|---|---|---|
| Pedido | `draft` · `confirmed` · `cancelled`, más `receipt_status` derivado (`pending` · `partially_received` · `received`) | con mercadería recibida las líneas se congelan y no se puede cancelar; ETA, condición de pago y notas sí se ajustan |
| Recepción | `draft` · `confirmed` | confirmada: no se edita, no vuelve a borrador, no se borra |
| Factura | `draft` · `registered` · `cancelled` | registrada: sólo se anula; anulada no vuelve |

Cada ficha lo dice con todas las letras arriba de todo, no sólo deshabilitando
botones. Y lo impone el servidor: los `UPDATE` directos que saltaban las
validaciones se cerraron en la entrega 5.

## E · RLS

Repetido con JWT real en la suite de cierre, sobre las **ocho** tablas:

| rol | ocho tablas | por id / número / proveedor / línea de pedido / línea de recepción | RPC | adjuntos |
|---|---|---|---|---|
| admin / employee | acceso a su empresa | sí | sí | sí |
| salesperson | **0** en su propia empresa, y no puede escribir (42501) | — | — | **0** |
| customer | **0** | **0** | las 4 lo rechazan | **0** |
| distributor | **0** | **0** | las 4 lo rechazan | **0** |
| anon | **0** | — | las 3 lo rechazan | — |

## F · Adjuntos

Las cuatro entidades —`supplier`, `purchase_order`, `goods_receipt`,
`supplier_invoice`— probadas de punta a punta: se adjunta, el admin lo ve, y
**ningún externo ve ninguna**. La partición de `attachments_select` por
`entity_type` que hizo la entrega 2 es lo que evita que un tipo herede el
acceso de otro; se verificó tipo por tipo, no en bloque.

Bucket privado, URL firmada de cinco minutos, 20 MB.

## G · Auditoría

Medida sobre un flujo completo, evento por evento:

```
pedido      create · confirm · receive · receive     (4)
recepción 1 create · confirm · stock_applied         (3)
recepción 2 create · confirm · stock_applied         (3)
factura 1   create · confirm                         (2)
factura 2   create · confirm                         (2)
                                              TOTAL  14
```

**Catorce eventos y ni uno más.** El alta de un proveedor no se audita, y el
ruido tampoco: 5 ediciones de cabecera + 5 de líneas sobre un borrador dejan
**1** fila —el alta— y no tocan la auditoría de ningún otro documento.

## H · Performance

Mediana de tres corridas, con los datos reales:

| | ms |
|---|---|
| listado de proveedores (25 de 142) | 212 |
| listado de pedidos (25) | 194 |
| listado de recepciones (25) | 188 |
| listado de facturas (25) | 205 |
| ficha de pedido + líneas | 415 |
| ficha de recepción + líneas | 380 |
| ficha de factura + líneas | 367 |
| búsqueda por número de pedido | 180 |
| búsqueda de proveedor por nombre | 182 |
| pendiente de facturar | 192 |

Ninguna pasa de 1,5 s y casi todas están en el piso de red (~180 ms de ida y
vuelta). **No se agregó ningún índice**: no hay nada que optimizar todavía.

## I · Mobile y desktop

11 pantallas (12 vistas, contando la ficha de factura en borrador y
registrada) × **390 / 430 / 768 / 1440**, medido en el navegador con
`documentElement.scrollWidth` contra `documentElement.clientWidth` —no
`innerWidth`, que incluye la barra de scroll y daría un falso desborde de
~15px—.

| ancho | resultado |
|---|---|
| 390 | **12/12 limpio**: sin scroll horizontal, sin controles < 16px, sin botones < 44px |
| 430 | **12/12 limpio** |
| 768 | sin scroll horizontal; con mouse los campos densos quedan en 14px **a propósito**, con dedo pasan a 16 |
| 1440 | sin scroll horizontal |

Lo que scrollea es **sólo dentro de su propia caja**: las tablas anchas de los
listados y de las fichas de lectura, que es el patrón aprobado en las entregas
2, 3 y 4. Ningún botón queda cortado: los que caen fuera de la pantalla a 768
están dentro de esa caja y se alcanzan corriéndola.

El modal de impresión a 390: sin scroll horizontal, la hoja se escala a 342px y
sus tres controles miden 44px.

### El circuito, mirado en pantalla

Con los fixtures cargados: el pedido muestra **Confirmado + Recibido**, ETA
30/11/2026 y el aviso de líneas congeladas; la recepción muestra
**Confirmada**, su pedido y su depósito; la pantalla de nueva factura muestra
**Recibido 40 · Facturado 15 · Pendiente 25**, o sea la facturación parcial
real; y la pestaña Relacionados del pedido lleva a la recepción y a las dos
facturas por link.

## J · E2E

`fase6-cierre-tests.mjs` corre el circuito entero contra la base real:

```
proveedor PROV00146
  → pedido PC00002 (USD, ETA, condición de pago, 3 líneas, 2 alícuotas + exento)
      totales del servidor: 34.822,00 + 3.974,78 = 38.796,78
  → recepción parcial  (15 + 12)  → 2 movimientos, pedido partially_received
  → recepción final    (25 + flete) → 1 movimiento, pedido received
      el flete no tiene producto: se recibe documentalmente y no mueve stock
  → factura parcial (15)  → registrada, NO mueve stock, quedan 38 por facturar
  → factura final (4 líneas, una libre) → 0 pendiente
      toca 2 recepciones; las líneas del pedido las derivó el servidor
```

## K · Bugs encontrados

### 1 · BUG VISUAL — controles a 14px en iPad

`EditorLineas` y `FiltrosPedidos` subían sus campos a 16px con
`@media (max-width: 767px)`. El comentario decía «en desktop el heredado
alcanza» — pero **un iPad en vertical mide 768**, justo afuera del breakpoint,
y es táctil: por debajo de 16px iOS hace zoom al enfocar y la página queda
corrida. Medido: 7 controles en el listado de pedidos, 18 en la ficha, 4 en
recepciones y 4 en facturas.

Corregido con `@media (max-width: 767px), (pointer: coarse)`: la pregunta
correcta no es el ancho sino **si hay un dedo**. Verificado que la regla queda
compilada y evalúa bien, y que con puntero grueso los 18 campos pasan a 16px.
Con mouse siguen en 14 y las tablas densas no se ensanchan.

### 2 · BUG VISUAL — el selector de página y el filtro de estado hacían zoom

Lo mismo, en `Paginador` (los cuatro listados de Compras) y en
`FiltrosProveedores`. Dos líneas de CSS.

### 3 · MEJORA UX — el botón «Cambiar» del buscador de proveedor

32px de alto en la pantalla de nueva factura. Cambia el proveedor del
documento —no es un adorno— y con 32 no se acierta con el dedo. Subido a 44.

### 4 · MEJORA UX — desde el pedido no se llegaba a sus facturas

La pestaña Relacionados **contaba** 2 facturas y no las listaba, mientras que
sí listaba la recepción. Ahora las lista con link, y el texto que decía que las
facturas «no tienen pantalla» —de la entrega 3— se fue.

### 5 · MEJORA UX — la pestaña Compras del proveedor no llevaba a ningún lado

Tres números sueltos y un texto de la entrega 2 explicando que el circuito
todavía no tenía UI. Ahora cada número es un enlace al listado filtrado por ese
proveedor.

### 6 · BUG DE HERRAMIENTA — los fixtures no reponían las series

`fase6-facturas-fixtures.mjs --limpiar` borraba las filas pero dejaba
`document_sequences` corrida, así que las suites que verifican que `supplier`
arranca en 146 empezaban a fallar **por numeración, no por lógica**. Ahora
guarda el estado de las series al crear y lo repone al limpiar.

### Lo que NO se tocó

- Las tablas de las fichas de lectura siguen siendo tablas con scroll interno,
  como aprobaste: la pasada a cards es transversal y va al backlog.
- Los botones de ordenar de las cabeceras de tabla miden 18px. Son texto en un
  `<th>` de una tabla de escritorio, existen así desde la entrega 2 y son
  iguales en Ventas. Backlog transversal.
- Los mismos campos a 14px existen en Ventas. No los toqué: cerrar Compras no
  es la pasada para eso, y va al backlog como ítem transversal.

## L · Backlog — explícitamente fuera de Fase 6 v1

- supplier payments · payment allocations · procurement_allocations
- sobre-recepción con tolerancia
- reversión de recepción confirmada
- supplier contacts
- extracción de los 22 emails que viven dentro de `notes`
- OCR / importación automática de factura desde PDF o XML
- relación Compras ↔ Ventas
- mejora transversal de fichas mobile a cards
- envío de documentos por mail (es del módulo Emails)
- los campos a 14px en Ventas, y los botones de ordenar de 18px

## M · Regresión

| | |
|---|---|
| Suites de base | **16 / 16**, 0 FAIL |
| Tests unitarios | **436** en 40 archivos |
| `npm run test:isolated` | 436, misma cuenta |
| lint · tsc · build | limpios |

### Invariantes finales

| | esperado | medido |
|---|---|---|
| suppliers | 142 | **142** |
| purchase_orders | 0 | **0** |
| goods_receipts | 0 | **0** |
| supplier_invoices | 0 | **0** |
| stock_movements | 381 | **381** |
| stock_balances | 379 | **379** |
| purchases_audit | 0 | **0** |
| attachments | 0 | **0** |
| cotizaciones / pedidos / entregas históricas | 288 / 166 / 182 | **288 / 166 / 182** |
| documentos históricos | 636 | **636** |
| huella md5 de Ventas | `8091b916…` | **8091b9166350c5bf2c331b1d882ec654** |
| customers | 1010 | **1010** |
| customer_contacts | 87 | **87** |
| customer_product_aliases | 14 | **14** |

Los fixtures `ZZ-M5` se borraron y las series volvieron a
`supplier=146 · purchase_order=2 · goods_receipt=1 · supplier_invoice=1`.

## N · CI / deploy

Commit y push a `main`; el workflow de GitHub Pages publica en
`https://app.buscatools.com`.

---

# COMPRAS = CLOSED / MIGRADO A REACT
