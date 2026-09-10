# Fase 6 · Compras — Entrega 5: facturas de proveedor

Estado: **COMPLETA**.

El circuito cierra entero: pedido confirmado → recepción confirmada → **factura
de proveedor**, parcial o total, sobre una recepción o sobre varias, con
conceptos que no salen de ninguna mercadería.

Fuera de alcance y **no empezado**: pagos a proveedores, OCR/importación,
Entrega 6, Mantenimiento.

| | |
|---|---|
| SQL aplicado | [`docs/database/PHASE_6_PURCHASES.sql`](database/PHASE_6_PURCHASES.sql) |
| Suite | [`scripts/fase6-facturas-tests.mjs`](../scripts/fase6-facturas-tests.mjs) |
| Fixtures de revisión | [`scripts/fase6-facturas-fixtures.mjs`](../scripts/fase6-facturas-fixtures.mjs) |
| Rutas | `#/compras/facturas` · `#/compras/facturas/nueva` · `#/compras/facturas/:id` |

Migraciones nuevas:

| versión | nombre |
|---|---|
| 20260910170718 | `fase6_facturas_proveedor_reglas` |
| 20260910180512 | `fase6_limpiar_auditoria_huerfana_de_facturas` |
| 20260910183904 | `fase6_confirmar_y_registrar_solo_por_su_funcion` |

La última salió de un agujero que apareció probando. Está en **K**.

---

## A · Modelo final usado

**No se creó ninguna tabla.** El modelo de la entrega 1 ya sostenía todo lo que
pedía el punto 1; la auditoría del punto 0 lo confirmó columna por columna y lo
único que hizo falta fueron reglas —triggers y dos funciones—, no estructura.

```
purchase_orders ──< purchase_order_lines
                          ▲            ▲
                          │            │
goods_receipts ──< goods_receipt_lines │
                          ▲            │
                          │            │
supplier_invoices ──< supplier_invoice_lines
```

`supplier_invoice_lines` tiene **dos** claves hacia atrás, las dos opcionales:

| columna | para qué |
|---|---|
| `goods_receipt_line_id` | la mercadería que se está facturando |
| `purchase_order_line_id` | el snapshot del pedido, para comparar |

Las dos en `null` es una **línea libre**: flete, seguro, un gasto, una
diferencia. Es un caso de primera clase, no un remiendo.

**No hay FK de cabecera** a `purchase_orders` ni a `goods_receipts`, y no se
agregó ninguna: una factura puede tocar varias recepciones y varias órdenes, y
una clave sola en la cabecera obligaría a elegir una y mentir sobre el resto.
La trazabilidad se **deriva** por las líneas —factura → recepción → pedido— y
así la muestra la ficha. La suite lo verifica: la cabecera no tiene ni una
columna que empiece con `goods_receipt` o `purchase_order`.

### Los dos números

Son **dos conceptos distintos** y el schema ya los distinguía, como sospechabas
en el punto 5:

| campo | qué es | unicidad |
|---|---|---|
| `id` | identidad interna | PK |
| `number` (`FP00001`) | referencia interna, la da `next_document_number` | `(company_id, number)` |
| `supplier_number` | **el número del papel**, lo escribe la persona | `(company_id, supplier_id, supplier_number)` **parcial**, `where supplier_number is not null` |

El único parcial es exactamente la combinación que pediste. Dos facturas del
mismo proveedor con el mismo número real: rechazadas. El mismo número de **otro**
proveedor: entra. Dos sin número todavía cargado: conviven. Las tres cosas
están probadas.

La pantalla titula la ficha con el **número del proveedor**, no con la
referencia interna: es el que la gente busca. La referencia va al lado, como
«ref. FP00005».

### Estados

`draft → registered → cancelled`. Ninguno inventado por simetría.

- **draft**: se edita entero, se descarta, no reserva nada.
- **registered**: congelada. Ni el proveedor, ni la moneda, ni las fechas, ni
  las líneas, ni los importes. Sólo puede anularse.
- **cancelled**: no vuelve de ahí, y **libera lo facturado**.

`registered` y `cancelled` **no se borran**, se anulan — pensando justamente en
lo que decís en el punto 14 sobre pagos futuros: un comprobante contra el que
alguien pagó no puede desaparecer.

## B · Cambios de schema

Ninguno estructural. Ninguna tabla, ninguna columna nueva. Lo que se agregó son
**reglas**:

| objeto | qué hace |
|---|---|
| `app.sellar_autor_factura()` | `created_by`/`updated_by` los pone el servidor; no se pueden borrar a mano |
| `app.validar_factura_proveedor()` | el proveedor existe y es de la misma empresa |
| `app.validar_linea_factura()` | recepción confirmada, mismo proveedor, misma empresa, **misma moneda**; deriva `product_id` y `purchase_order_line_id` desde la recepción |
| `app.proteger_factura_registrada()` | transiciones válidas, congelado, referencia inmutable |
| `app.proteger_lineas_factura()` | las líneas de una factura que no es borrador no se tocan |
| `app.totales_factura_proveedor()` + `recalcular` + `empujar` | totales del servidor |
| `app.auditar_factura_proveedor()` | alta, registro y anulación |
| `public.pendiente_de_facturar()` | la cuenta de cuánto queda por facturar |
| `public.registrar_factura_proveedor()` | registrar, con bloqueo y validación |
| `idx_si_fecha` | `(company_id, invoice_date desc, number desc)` para el listado |

`normalizar_linea_compra` —el trigger que ya existía— se reusa tal cual: es el
que **siempre** deriva la alícuota del tratamiento.

## C · Facturación parcial

`pendiente_de_facturar(company, recepciones, proveedor, excluir_factura)`
devuelve, por línea de recepción:

| campo | qué cuenta |
|---|---|
| `recibido` | `goods_receipt_lines.quantity` |
| `facturado` | suma de líneas de facturas **`registered`** |
| `en_borrador` | suma de líneas de facturas `draft` |
| `pendiente` | `recibido − facturado` |

**Los borradores no reservan.** Es la misma decisión que tomó la entrega 4 con
las recepciones en borrador y por la misma razón: un borrador abandonado no
puede bloquear mercadería para siempre. Pero **sí se informan**, y la pantalla
lo dice con todas las letras:

> «12 en otra factura en borrador · no reservado»
>
> «Hay cantidades anotadas en otras facturas en borrador. No están reservadas:
> lo pendiente se cuenta sólo con las facturas registradas. Si las dos se
> registran, la segunda va a fallar por sobre-facturación.»

Y falla de verdad. Probado en el navegador, a 390: la segunda muestra
*«Línea 1: se intenta facturar 12.0000 y quedan 0.0000 por facturar»* y se
queda en borrador.

Sólo se ofrecen recepciones **confirmadas**: facturar lo que todavía no llegó
no es facturar, es adelantar. Una línea de una recepción en borrador se rechaza
en la base.

El recorrido 100 → 30 → 40 → 30 → 0 está probado entero, y `facturado` termina
en 100.

## D · Concurrencia

`registrar_factura_proveedor()` bloquea con `for update`, **ordenadas por id**,
las `goods_receipt_lines` que toca la factura, y recién después cuenta lo ya
facturado. Es la misma forma que usa `confirmar_recepcion` desde la entrega 4,
y por el mismo motivo: bloquear la factura no sirve, porque cada transacción
tiene la suya; hay que bloquear **el recurso disputado**, que es la línea de
recepción.

Probado con dos facturas de 20 sobre una línea de 30, lanzadas con
`Promise.all`:

```
de dos que intentan 20 sobre 30, entra UNA — 1
  se facturaron 20, no 40 — 20
  la otra falla con un error de verdad — 23514
```

Sobre-facturación acumulada: 20 registradas + 20 sobre 30 recibidas → rechazo
`23514`, sin recorte silencioso, y la factura **se queda en borrador**.

La numeración interna: 15 pedidos simultáneos, 15 referencias distintas.

## E · Totales e impuestos

Los calcula el servidor, siempre: `app.totales_factura_proveedor()` sumada por
un `BEFORE UPDATE` en la cabecera y un `AFTER` en las líneas. El cliente sólo
previsualiza.

Un total mandado por el cliente **se ignora**: probado mandando
`subtotal/tax_amount/total = 1` sobre una factura de 2.936 — sigue en 2.936.

El impuesto es **por línea**, con la alícuota de su tratamiento. Cuatro líneas
con `vat_21`, `vat_105`, `exempt` y un descuento del 10 % dan 2.600 de subtotal
y **336** de impuesto, no un 21 % sobre el total.

**El bug del 1 % no se puede reproducir.** Mandando `tax_treatment = 'vat_21'`
con `tax_rate_snapshot = 1`, el servidor guarda **21** y cobra 210, no 10. La
única excepción es `other`, donde la alícuota la escribe la persona porque no
hay ninguna de dónde derivarla — ahí un 3 se respeta.

## F · RLS

Sin cambios de política: las ocho tablas de Compras usan
`app.current_writer_company_ids()` = **admin + employee**.

Probado con intentos reales, no leyendo el catálogo:

| rol | listado | por id | por nº de proveedor | por proveedor | líneas | por línea de recepción | por línea de pedido | registrar | pendiente | adjuntos |
|---|---|---|---|---|---|---|---|---|---|---|
| customer | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 42501 | 0 filas | 0 |
| distributor | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 42501 | 0 filas | 0 |
| anon | 0 | — | — | — | — | — | — | 42501 | — | — |
| salesperson (en su empresa) | 0 | — | — | — | — | — | — | — | — | 0 |

`anon` no tiene `EXECUTE` ni sobre `registrar_factura_proveedor` ni sobre
`pendiente_de_facturar`: se revocó desde el principio, sin repetir el hallazgo
de la entrega 1.

El enlace de Compras en la navegación se filtra por rol, pero eso es cortesía:
lo que protege es la RLS. Un salesperson que escriba la URL a mano llega a una
pantalla vacía.

## G · Adjuntos

Tabla `attachments` y bucket privado existentes. `supplier_invoice` ya estaba
en el CHECK de `entity_type` **y** en la partición de `attachments_select` que
hizo la entrega 2, así que estos adjuntos tienen la RLS de Compras: ni
salesperson ni technician los ven. Probado.

En la ficha: PDF/XML de la factura, remito del proveedor, comprobante, foto,
otro. Cada descarga usa una **URL firmada de cinco minutos**.

Para no escribir un tercer service igual, `adjuntosPedido` pasó a
[`adjuntosCompras`](../src/modules/compras/services/adjuntosCompras.ts) con el
tipo de entidad como parámetro, y `PanelAdjuntosPedido` a
[`PanelAdjuntosCompras`](../src/modules/compras/components/PanelAdjuntosCompras.tsx).
El pedido sigue funcionando igual.

## H · Auditoría

`purchases_audit` guarda **acciones de negocio**:

| acción | cuándo |
|---|---|
| `create` | alta |
| `confirm` | `draft → registered` |
| `cancel` | anulación |

Editar un borrador **no se audita**, como pediste en el punto 25: se midió el
conteo antes y después de un UPDATE de notas y no cambió.

`created_by` lo sella el servidor y no se puede borrar a mano: probado mandando
`created_by = null`, vuelve con el autor puesto.

La ficha muestra el historial. Los eventos se leen por
[`historialDeEntidad`](../src/modules/compras/services/auditoria.ts), que ahora
comparte proveedor y factura en vez de tener dos copias.

## I · Stock intacto

Una factura **no mueve stock, en ningún estado**. Verificado de tres formas:

1. Ni un `stock_movements` con `source_id` de ninguna de las facturas creadas.
2. Ni un `stock_movements` con `source_type = 'supplier_invoice'`.
3. Contando la tabla entera antes y después de crear y registrar una factura
   de puros gastos: **386 = 386**.

Al terminar la suite, los invariantes del punto 30, exactos:

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

## J · Mobile real

Con fixtures temporales y **medido en el navegador**, no por inspección de CSS.
`document.documentElement.scrollWidth === window.innerWidth` en todas.

| pantalla | 390 | 430 | 768 |
|---|---|---|---|
| listado | 390 = 390 | 430 = 430 | 768 = 768 |
| nueva factura | 390 = 390 | 430 = 430 | 768 = 768 |
| ficha registrada | 390 = 390 | — | 768 |
| ficha borrador | 390 = 390 | — | 768 |

**Cero scroll horizontal global en todas.**

- **Filtros plegados** detrás de «Filtros» con contador: el primer resultado
  queda en **y = 259** de 844 a 390, y en 259 a 430. Mismo número que pedidos y
  recepciones.
- **La grilla de facturación son tarjetas** por debajo de 1024 —el mismo corte
  que la grilla de recepción de la entrega 4, por la misma razón medida— y
  tabla desde ahí. A 390, 430 y 768 no tiene **ningún** scroll interno. Cada
  tarjeta muestra recibido / facturado / pendiente / precio OC y los campos de
  cantidad, precio e impuesto.
- **Todos los controles ≥ 44px** y todos los campos a **16px**: ningún input
  dispara el zoom de iOS.

**Recorrido completo hecho a 390, sin tocar el escritorio**: entrar por
«Facturar» desde la recepción confirmada → «Facturar todo lo pendiente» →
escribir el número del proveedor → crear el borrador → registrarlo → ver que el
total del servidor coincide con la previsualización (**USD 39.724,82**) → y que
el otro borrador ahora falla por sobre-facturación con el mensaje correcto.

### Lo que NO se cambió, a propósito

La tabla de líneas de la **ficha** —8 columnas— scrollea dentro de su propia
caja: 876px adentro de 323 a 390. Es el mismo patrón que ya usan la ficha de
pedido (831 adentro de 323) y los cuatro listados de Compras a 768 (988 a 1151
adentro de ~470), aprobados en las entregas 2, 3 y 4. Es **lectura, no carga**:
donde se escribe —la grilla de facturación— sí hay tarjetas.

Cambiarlo sólo acá dejaría la ficha de factura distinta de la de pedido. Si
querés tarjetas también en las fichas de lectura, es una pasada aparte sobre
las cuatro pantallas y la pido como tal.

## K · Bugs encontrados

### 1 · FUNCIONAL, grave — confirmar y registrar se podían saltear

**El peor de la entrega, y no estaba en facturas solamente.**

La validación pesada de los dos circuitos vive adentro de sus funciones, pero
**nada obligaba a pasar por ellas**. Un admin o employee con un cliente REST
podía hacer:

```
update goods_receipts   set status = 'confirmed'   -- sin UN SOLO stock_movement
update supplier_invoices set status = 'registered'  -- facturando 999 sobre 40
```

Los dos **reproducidos contra la base real** antes de arreglarlos:

```
UPDATE directo goods_receipts.status=confirmed:  ACEPTA -> [{"status":"confirmed"}]
movimientos de stock antes/después: 383 383

RPC registrar_factura_proveedor: RECHAZA (23514)
UPDATE directo status=registered: ACEPTA -> [{"status":"registered"}]
estado final: {"status":"registered","total":120879}
```

El de recepciones es el peor: deja la mercadería marcada como recibida y el
stock sin entrar, o sea el saldo desincronizado **en silencio**. Venía de la
entrega 4 y la suite no lo agarró porque probaba la RPC, que hace lo correcto,
sin probar el camino de al lado.

Corregido en `fase6_confirmar_y_registrar_solo_por_su_funcion`: la transición
al estado que dispara efectos sólo se acepta si viene desde adentro de su
función, que deja una marca local a la transacción con `set_config(..., true)`.
PostgREST envuelve cada request en una transacción, así que la marca no se
filtra de un pedido al siguiente.

Después del arreglo:

```
UPDATE directo recepción→confirmed:  RECHAZA (23001)
la RPC sigue funcionando: movimientos 383 -> 384
UPDATE directo factura→registered:   RECHAZA (23001)
y la RPC la rechaza por sobre-facturación: 23514
con 7 sí registra: {"lineas":1,"ya_estaba":false}
anular sigue siendo un UPDATE directo: [{"status":"cancelled"}]
```

**Anular una factura y cancelar un pedido siguen siendo un UPDATE directo**: no
tienen ninguna validación que saltear. Sólo se cerraron las dos transiciones
que sí la tienen.

### 2 · FUNCIONAL — el impuesto previsualizado daba cero

En la pantalla de alta, con tres líneas de IVA 21 % y un flete exento, el panel
decía **«Impuesto USD 0,00 · Total USD 33.151,50»** cuando el servidor iba a
guardar **USD 39.724,82**. Alguien que compara la pantalla contra el papel ve
que no coincide y no entiende por qué.

La causa: `totalesDeFactura()` leía sólo `tasaImpuesto`, y la línea **nace con
la tasa en null** —la alícuota se derivaba recién al tocar el desplegable—.

Corregido en dos lados: la cuenta ahora deriva la alícuota **del tratamiento**,
igual que el servidor, y la línea nace ya con la suya. Tres tests unitarios
nuevos lo fijan, incluido el caso del 1 % del lado del cliente. Verificado en el
navegador: 6.573,32 / 39.724,82, idéntico al servidor.

### 3 · FUNCIONAL — faltaban puntos de entrada y adjuntos

El punto 2 pide acciones desde el pedido y la recepción, y el 16 los adjuntos.
No estaban. Agregados: **«Facturar»** en la recepción confirmada —que lleva a
la pantalla con esa recepción y ese proveedor puestos— y en el pedido
confirmado con algo recibido, más el panel de adjuntos y el historial en la
ficha.

### 4 · VISUAL — el selector de tamaño de página hacía zoom en iOS

`Paginador` tenía el `<select>` a 14px. Por debajo de 16px iOS hace zoom al
enfocar y la página queda corrida. Es de la entrega 2 y afecta a los cuatro
listados de Compras. Una línea de CSS.

### 5 · SUITE — la de schema dejaba auditoría huérfana

`fase6-compras-schema-tests.mjs` borraba los eventos de auditoría de pedidos y
recepciones, pero no los de las facturas que crea. Antes de esta entrega las
facturas no tenían trigger de auditoría, así que no importaba; ahora sí, y la
suite de proveedores empezó a fallar al encontrar 2 filas huérfanas. Corregido,
y las 2 filas que ya estaban se limpiaron con
`fase6_limpiar_auditoria_huerfana_de_facturas`.

### 6 · SCRIPT — los fixtures fallaban en silencio

Los primeros fixtures salieron con las facturas en cero: la clave de servicio
**no tiene rol en ninguna empresa**, así que `confirmar_recepcion` y
`registrar_factura_proveedor` le fallan, y el script no miraba los errores.
Ahora crea con una sesión de admin de verdad, usa la clave de servicio sólo
para limpiar, y **corta con un mensaje** ante cualquier error. La limpieza
además busca por proveedor y no por la marca en las notas, porque lo que se
carga a mano durante la revisión no lleva marca y quedaba atrás.

## L · Regresión

| | |
|---|---|
| Suites de base | **15 / 15** en verde, 0 FAIL |
| Tests unitarios | **411** en 39 archivos |
| `npm run test:isolated` | 411, misma cuenta |
| `npm run lint` | limpio |
| `npx tsc --noEmit` | limpio |
| `npm run build` | ok |

Las suites de Compras corridas en orden después del arreglo de los triggers:
schema, proveedores, pedidos, recepciones y facturas, todas en cero fallos.
Estado final de la base, exacto al punto 30.

## M · CI / deploy

Commit y push a `main`; el workflow de GitHub Pages publica en
`https://app.buscatools.com`.

---

## Decisiones propias, todas reversibles

1. **La tabla de líneas de la ficha queda como tabla** (ver **J**), por
   consistencia con la ficha de pedido.
2. **`historialDeProveedor` pasó a delegar** en `historialDeEntidad`, compartido.
   Es el mismo query; si preferís que cada módulo tenga el suyo, se separa.
3. **El título de la ficha es el número del proveedor**, no la referencia FP.
4. **Los adjuntos de factura ofrecen `invoice` como clase por defecto**; los del
   pedido siguen con `other`.
5. **El botón «Facturar» del pedido no filtra por pedido**: lleva a la pantalla
   con el proveedor puesto, porque se factura lo *recibido*, que puede venir de
   varios pedidos. Si querés que precargue sólo lo de ese pedido, es un filtro
   más en la query string.
