# Fase 6 · Compras — Entrega 3: pedidos de compra

Estado: **EJECUTADA**. El circuito del pedido de compra tiene pantalla:
listado, alta, edición, ficha, líneas, estados, totales, ETA, adjuntos y
relacionados.

Fuera de alcance y **no empezado**: recepciones y facturas de proveedor.

| | |
|---|---|
| SQL aplicado | [`docs/database/PHASE_6_PURCHASES.sql`](database/PHASE_6_PURCHASES.sql) |
| Suite | [`scripts/fase6-pedidos-compra-tests.mjs`](../scripts/fase6-pedidos-compra-tests.mjs) |
| Rutas | `#/compras/pedidos` · `#/compras/pedidos/nuevo` · `#/compras/pedidos/:id` |

Migraciones nuevas:

| versión | nombre |
|---|---|
| 20260910134126 | `fase6_pedidos_compra_reglas` |
| 20260910140432 | `fase6_alicuota_siempre_del_tratamiento` |
| 20260910140758 | `fase6_limpiar_auditoria_huerfana_de_pruebas` |

Las dos últimas no estaban en el plan: salieron de tests que fallaron. Están
en **I**.

---

## A · Funcionalidades

### Listado — `#/compras/pedidos`

Todo del lado del servidor. Columnas: número, fecha, proveedor, total con su
moneda, estado, recepción, líneas y creado por. Ordenable por número, fecha,
proveedor, total y ETA, con desempate estable.

**No hay fila de total general.** En este listado conviven pedidos en USD, ARS
y EUR; sumarlos daría el mismo número sin sentido que daba el panel del
legacy. Cada importe lleva su moneda al lado.

Los siete filtros pedidos, todos en la URL: número, proveedor, estado,
recepción, moneda, rango de fecha del pedido y rango de ETA. Más uno que hacía
falta: **«sin fecha estimada»**, que es una pregunta real cuando la ETA puede
ser nula. El filtro de moneda ofrece **las monedas que se usaron de verdad**,
no las tres de la tabla.

### Alta — `#/compras/pedidos/nuevo`

Proveedor obligatorio (buscador contra el servidor, no un `<select>` de 142),
moneda obligatoria, fecha del pedido, ETA opcional, condición de pago y notas.
Se cargan las líneas y se guarda todo junto. El pedido **nace en borrador**.

### Ficha — `#/compras/pedidos/:id`

Tres secciones: **Pedido** (datos + líneas + totales), **Adjuntos** y
**Relacionados**. Acciones: editar, confirmar, cancelar y duplicar, cada una
visible sólo cuando el estado la permite.

### Líneas

Tres tipos: producto del catálogo, **línea libre** (se compra algo que no está
en el catálogo) y capítulo (un título que no suma). Cada línea con su `id` y su
`line_no`: **el orden es un dato, no la posición en un array**. Subir, bajar y
borrar operan sobre el id.

Campos, los del schema: `product_id` nullable, `sku_snapshot`,
`name_snapshot`, `description_snapshot`, `quantity`, `unit_price`,
`discount_pct`, `tax_treatment`, `tax_rate_snapshot`.

### Selector de productos

Contra `search_products`, por SKU, nombre y marca, 20 filas por búsqueda con
debounce. El legacy tenía los 21.775 en un array global.

**No muestra ningún precio**, a diferencia del selector de Ventas. Ver **F**.

## B · Cambios de schema

Ninguna tabla ni columna nueva. Todo lo que hacía falta —`expected_date`,
`payment_terms`, `line_type`, los snapshots, `tax_treatment`— ya estaba desde
la entrega 1. Lo que se agregó son **reglas**:

**`fase6_pedidos_compra_reglas`**

- `app.sellar_autor_compra()` — `created_by` y `updated_by` los pone el
  servidor con `auth.uid()`, no el navegador. Misma razón por la que
  `salesperson_id` se asigna del lado del servidor en Clientes.
  `purchase_orders` tampoco tenía el trigger de `updated_at`; ahora lo tiene, y
  `purchase_order_lines` también.
- `app.proteger_estado_pedido_compra()` reescrita: la matriz completa de qué se
  edita en cada estado (ver **A** y la tabla de abajo), las transiciones
  válidas, y el número que no se cambia nunca.
- `app.proteger_lineas_pedido_compra()` extendida: un pedido **cancelado** no
  acepta cambios de líneas, y el trigger ahora cubre también el **INSERT** —
  antes se le podían agregar líneas a un pedido con mercadería ya recibida.
- `app.auditar_pedido_compra()` y `app.auditar_lineas_pedido_compra()` — la
  auditoría de lo que importa la escribe la base, no el navegador (ver **G**).
- `public.duplicar_pedido_compra(uuid)` — ver **A**/**G**.
- `public.ultimo_precio_compra(...)` — ver **F**.
- `idx_po_fecha (company_id, order_date desc, number desc)` para el orden por
  defecto del listado.

**`fase6_alicuota_siempre_del_tratamiento`** — un bug real, ver **I**.

**`fase6_limpiar_auditoria_huerfana_de_pruebas`** — limpieza de filas que dejó
la propia suite, ver **I**.

### La matriz de edición

|  | draft | confirmed | confirmed + recepción | cancelled |
|---|:--:|:--:|:--:|:--:|
| proveedor | ✓ | ✗ | ✗ | ✗ |
| moneda / tipo de cambio | ✓ | ✗ | ✗ | ✗ |
| fecha del pedido | ✓ | ✗ | ✗ | ✗ |
| número | ✗ nunca | ✗ | ✗ | ✗ |
| ETA / condición de pago | ✓ | ✓ auditado | ✓ auditado | ✗ |
| notas | ✓ | ✓ auditado | ✓ auditado | ✗ |
| líneas | ✓ | ✓ auditado | **✗** | ✗ |
| confirmar | ✓ | — | — | ✗ |
| cancelar | ✓ | ✓ | **✗** | ✗ |
| duplicar | ✓ | ✓ | ✓ | ✓ |

Transiciones: `draft → confirmed`, `draft → cancelled`,
`confirmed → cancelled`. **Reabrir un pedido confirmado no está previsto**: se
cancela y se duplica. Cualquier otra transición se rechaza con
`restrict_violation`.

Todo esto lo aplican **triggers**, no botones deshabilitados: corren aunque la
escritura venga de un script con la clave de servicio. Los controles apagados
de la pantalla son para no ofrecer algo que va a fallar.

## C · Tests

**Suite contra la base: `scripts/fase6-pedidos-compra-tests.mjs` — 0 fallos**,
14 secciones. Los 18 tests obligatorios están todos cubiertos:

| # | sección | qué prueba |
|---:|---|---|
| 1 | Alta | número del servidor, nace en `draft`+`pending`, `created_by` sellado, **condición de pago que no cambia cuando cambia la del proveedor** |
| 2 | Obligatorios | sin proveedor `23502`, sin moneda `23502`, moneda inexistente `23503` |
| 3 | Líneas | producto del catálogo, línea libre, capítulo que no suma, cada línea con su propio uuid |
| 4 | IVA y totales | alícuota derivada, IVA por línea, **la alícuota a mano no cambia nada**, tratamiento inventado `23514`, la app no escribe el total |
| 5 | ETA | puede ser nula, se pone, se saca |
| 6 | Estados | `receipt_status` no se escribe, el número no se cambia, identidad congelada al confirmar, logística editable, no se reabre |
| 7 | **Confirmar no mueve stock** | contadores antes/después + 0 movimientos con `source_type='purchase_order'` |
| 8 | Cancelar | borrador sí, confirmado sin recepción sí, cancelado congelado (cabecera, líneas e inserts) |
| 9 | Con recepción | líneas congeladas y cantidad intacta, no se cancela, ETA sí se ajusta |
| 10 | Duplicar | uuid y número nuevos, `draft`, copia líneas y totales, **no** copia recepciones ni auditoría |
| 11 | Auditoría | create / confirm / cancel / update con diff, **y que editar un borrador no deja ruido** |
| 12 | Concurrencia | 20 altas simultáneas, dos confirmaciones simultáneas |
| 13 | RLS | por listado, id, número, proveedor y empresa ajena |
| 14 | Adjuntos | bucket, fila, URL firmada, y que un externo no la ve |

**Tests unitarios: 380 pasan** (+53), y también con `test:isolated`. Cubren las
cuentas de líneas y totales, la matriz de editabilidad, la validación del
pedido y el ida y vuelta de los filtros en la URL.

La suite se limpia sola —prefijo `ZZ-C3`—, revierte el stock que movió la
recepción de prueba, repone las secuencias y verifica al final que no queda
ningún pedido, que los proveedores vuelven a ser 142 y que los movimientos y
saldos vuelven a 381 y 379.

## D · RLS

Probado con sesiones reales, por los cinco caminos que pediste:

| rol | listado | por id | por número | por `supplier_id` | empresa ajena | crear |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| admin / employee | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| salesperson | **0** | 0 | 0 | 0 | **0** | `42501` |
| customer | **0** | 0 | 0 | 0 | 0 | `42501` |
| distributor | **0** | 0 | 0 | 0 | 0 | `42501` |
| anónimo | **0** | 0 | — | — | — | — |

También se prueba que **las líneas** (`purchase_order_lines`) le vuelven vacías
a los externos: no alcanza con proteger la cabecera.

El caso que importa: Jano es salesperson en Torquetools y **no ve los pedidos
de su propia empresa**, ni por id ni listando.

## E · Numeración

- `next_document_number(company, 'purchase_order')`. **Jamás `MAX+1`.**
- Primer pedido: **PC00002**. El `PC00001` del legacy era una prueba y no se
  migró, así que ese número no se reutiliza.
- El número se pide **antes** del insert. Si el insert falla, ese número se
  pierde: repetir es peor que saltear.
- **El número no se puede cambiar nunca**, en ningún estado. Rechazado con
  `restrict_violation`.
- **20 altas simultáneas**: 0 errores, 20 números distintos, **sin huecos por
  carrera** (rango verificado y contiguo).

## F · Totales y costo

### Los totales los calcula el servidor

`app.totales_pedido_compra()` (STABLE) + `recalcular` en la cabecera +
`empujar` desde las líneas. La aplicación **no manda nunca** `subtotal`,
`tax_amount` ni `total`, y está probado que si los mandara el trigger los
pisaría: un intento de escribir `total = 999999` deja el total en 1460.

El IVA es **por línea, con la alícuota de su tratamiento**. En el pedido de
prueba: 1000 al 21 % + 250 exento = 210 de IVA, no un 21 % parejo sobre 1250.

En pantalla, mientras hay cambios sin guardar se muestra una **cuenta
provisoria** con el aviso de que el definitivo lo calcula el servidor. En
cuanto se guarda vuelve el del servidor. El descuento se muestra restando —
bruto menos neto— porque no hay columna de descuento en la cabecera y no se
inventó una.

### El costo: auditoría y decisión

**No existe ninguna fuente de costo en el backend.** Se auditó:

| dónde se buscó | qué hay |
|---|---|
| `price_lists` | 4 listas, **todas de venta**: Lista base (12.254 precios), Distribuidores (124), Especial Cliente Demo (124), y la de Torquetools (3) |
| `products` | 26 columnas, **ninguna de costo** |
| tabla de precios de proveedor | **no existe** |
| `PC00001` del legacy | una línea a precio 0, clasificado como prueba y no migrado |

Conclusión, y es lo que se hizo: **el precio de compra se escribe a mano**. El
selector de productos de Compras **no muestra ningún precio**, justamente para
que nadie confunda lo que se cobra con lo que se paga.

Lo único que se agregó —y lo señalo como una decisión mía, no como algo que
hayas pedido— es `public.ultimo_precio_compra()`: al lado del campo de precio,
cuando existe, aparece **cuánto se pagó la última vez por ese producto, en esa
misma moneda, en un pedido confirmado**. Es un dato derivado de documentos
reales, igual que los precios históricos de Clientes; **nunca autocompleta** y
hoy no muestra nada porque no hay ningún pedido confirmado. Si preferís que no
esté, se saca: son una función y un renglón.

## G · Auditoría

La escribe **la base**, no el navegador: si dependiera de que el frontend se
acuerde de llamar a la RPC, un script o una pestaña cerrada a destiempo dejaría
el evento sin registrar.

Se registran **sólo** los cuatro que pediste:

| evento | acción |
|---|---|
| alta | `create` |
| confirmación | `confirm` |
| cancelación | `cancel` |
| cambio en un pedido **ya confirmado** | `update`, con el `diff` de lo que cambió |
| duplicado | el `create` del pedido nuevo |

**Editar un borrador no deja rastro** y está probado: dos cambios de notas y
una línea nueva sobre un pedido en `draft` producen un solo evento, el del
alta. Un borrador todavía no salió de la empresa.

Un cambio de líneas sobre un pedido confirmado también se audita, con la línea
y la operación en el `diff`.

## H · Mobile

**Pendiente de verificación real.** La revisión a 390 / 430 / 768 necesita
sesión iniciada y no puedo escribir una contraseña en un formulario. El
servidor de desarrollo está levantado y la hago apenas inicies sesión en el
panel del navegador.

Lo que sí está hecho y es verificable en el código:

- El listado es **tabla en escritorio y tarjetas por debajo de 768**: nueve
  columnas en 390px obligan a scrollear toda la página.
- La tabla de líneas scrollea **dentro de su propia caja** (`overflow-x:auto`,
  `min-width:46rem`), nunca el body.
- Inputs a **16px** —menos que eso y iOS hace zoom— y **44px** de alto mínimo;
  los botones de subir/bajar/borrar pasan de 32 a 44px por debajo de 768.
- El buscador de proveedor abre un panel **superpuesto**, no empuja el
  formulario hacia abajo con cada letra.
- El panel de totales tiene `min-width: min(20rem, 100%)`: no se desborda en
  390px.
- Los nombres de proveedor y las condiciones de pago largas se recortan con
  elipsis y el texto completo queda en el `title`.
- Login a 375px: `scrollWidth == innerWidth`, sin scroll horizontal.

No lo doy por bueno hasta verlo.

## I · Bugs encontrados

Tres, los tres los encontró un test que falló.

### 1 · El bug del 1 % del legacy SÍ se podía reproducir

Es el importante, y contradice lo que reporté en la entrega 1.

`app.normalizar_linea_compra()` derivaba la alícuota del tratamiento **sólo
cuando venía en null**. Mandando `tax_treatment = 'vat_21'` junto con
`tax_rate_snapshot = 1`, la línea quedaba con IVA al 1 %: la suite lo hizo y
el IVA de una línea de 1000 dio **10** en vez de 210.

La entrega 1 había probado que un *tratamiento* inventado se rechaza. El
agujero era el otro: el tratamiento válido con la alícuota escrita a mano.

Corregido: la alícuota se deriva **siempre** del tratamiento y se pisa lo que
venga. La única excepción es `other`, que existe justamente para las alícuotas
que no están en la lista. Vale también para las líneas de factura de
proveedor, que usan el mismo trigger.

> Corrección a la entrega 1: donde dice «el bug del 1 % no se puede
> reproducir», hay que leer «no se puede reproducir **desde la interfaz**». Por
> PostgREST sí se podía. Ahora no.

### 2 · Se le podían agregar líneas a un pedido con mercadería recibida

`trg_pol_congelar` estaba declarado `BEFORE DELETE OR UPDATE`: no cubría el
INSERT. Un pedido ya recibido podía crecer con líneas nuevas. Corregido
agregando `INSERT` al trigger, y probado.

### 3 · Mi propia limpieza dejó doce filas de auditoría huérfanas

La suite borraba `purchases_audit` **antes** que las líneas. Borrar una línea
de un pedido confirmado dispara `trg_pol_auditar`, que escribe un evento
nuevo: quedaban filas apuntando a pedidos que ya no existían. La limpieza pasó
al final y las doce filas se borraron con una migración.

Es el mismo error que ya había cometido con los saldos de stock en la entrega
1: **el orden de la limpieza importa cuando hay triggers**.

## J · Regresión

**14 suites contra la base real: 0 fallos en las 14.**

7 de Ventas · 5 de Clientes · schema de Compras · Proveedores.

Invariantes intactos:

| | |
|---|---:|
| cotizaciones / pedidos / entregas / documentos | 288 / 166 / 182 / 636 |
| huella de Ventas | `8091b9166350c5bf2c331b1d882ec654` |
| clientes / contactos / alias | 1010 / 87 / 14 |
| movimientos de stock / saldos | 381 / 379 |
| proveedores | 142 |
| pedidos de compra reales | **0** |

## K · CI y deploy

- `npm run lint` · `tsc -b` · **380 tests** · `test:isolated` · `npm run build` — verde.
- `database.types.ts`: se agregaron a mano las dos funciones nuevas
  (`duplicar_pedido_compra`, `ultimo_precio_compra`). Las ocho tablas siguen
  generadas por `scripts/fase6-generar-tipos-compras.mjs`.
- «Pedidos de compra» entra en el menú, visible sólo para admin y employee.

---

## Lo que queda para la entrega 4

Recepciones —notas de entrada de proveedor— y facturas de proveedor. El schema
está desde la entrega 1 y probado; falta la pantalla.

Decisiones ya tomadas: sobre-recepción bloqueada por defecto y sin recorte
silencioso, `receipt_status` derivado por la base, confirmación de recepción
idempotente, sin cancelación de recepciones confirmadas, y la relación
Compras ↔ Ventas **no se reconstruye por intuición**.
