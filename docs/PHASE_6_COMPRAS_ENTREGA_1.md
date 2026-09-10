# Fase 6 · Compras — Entrega 1: el schema, ejecutado

Estado: **EJECUTADA**. Cuatro migraciones aplicadas sobre `uaxcfufvapzulqvynanp`.
Alcance respetado: **no** se migraron los 142 proveedores, **no** se escribió UI,
**no** se crearon pedidos reales, **no** se tocó Mantenimiento.

SQL textual de lo aplicado: [`docs/database/PHASE_6_PURCHASES.sql`](database/PHASE_6_PURCHASES.sql).
Suite: [`scripts/fase6-compras-schema-tests.mjs`](../scripts/fase6-compras-schema-tests.mjs).

Migraciones, en orden:

| versión | nombre |
|---|---|
| 20260910121328 | `fase6_compras_schema` |
| 20260910121423 | `fase6_compras_totales_y_estados` |
| 20260910121538 | `fase6_compras_rls_funciones_y_series` |
| 20260910123224 | `fase6_compras_endurecimiento_advisors` |

La cuarta no estaba en el plan: salió de los advisors de Supabase corridos
después del DDL. Está detallada en **J**.

---

## A · Tablas creadas — 8

Las 7 aprobadas más `purchases_audit`, exactamente como quedó acordado.

| tabla | columnas | checks | FKs | únicos | RLS |
|---|---:|---:|---:|---:|:--:|
| `suppliers` | 24 | 1 | 4 | 2 (parciales) | sí |
| `purchase_orders` | 20 | 3 | 5 | 1 | sí |
| `purchase_order_lines` | 17 | 7 | 3 | 1 | sí |
| `goods_receipts` | 17 | 1 | 7 | 1 | sí |
| `goods_receipt_lines` | 9 | 1 | 4 | 1 | sí |
| `supplier_invoices` | 20 | 2 | 5 | 2 | sí |
| `supplier_invoice_lines` | 18 | 7 | 5 | 1 | sí |
| `purchases_audit` | 10 | 2 | 2 | — | sí |
| **total** | **135** | **24** | **35** | **9** | **8/8** |

Conteo final exacto, como se pidió antes de ejecutar: **8 tablas nuevas**, ni una más.
Lo demás fueron modificaciones a objetos existentes:

- `attachments_entity_type_check` extendido con `goods_receipt`, `supplier_invoice`
  y `supplier`. **No** se creó una segunda tabla de adjuntos.
- `uq_warehouse_default` sobre `warehouses`: un solo depósito por defecto por empresa.
- `uq_stock_mov_recepcion`: único parcial sobre
  `(source_type, source_id, product_id, warehouse_id)` donde `source_type='goods_receipt'`.
  Es lo que hace idempotente a la confirmación (ver **G**).

`sales_audit` no se generalizó: su semántica está atada a los estados de venta.
`purchases_audit` es una tabla chica y separada, como se aprobó.

## B · Índices — 32

4 por tabla en promedio, ninguno decorativo. Los que importan:

- `uq_suppliers_cuit_norm` — único **parcial** sobre el CUIT normalizado, sólo
  cuando tiene 11 dígitos y el proveedor no está dado de baja. Un CUIT informado
  no se repite; uno vacío o malformado no bloquea nada.
- `uq_suppliers_legacy_ref` — parcial, para que la entrega 2 sea idempotente.
- `idx_suppliers_legal_trgm` — GIN trigram, mismo patrón que clientes.
- `uq_si_supplier_number` — parcial: el mismo número de factura del mismo
  proveedor no entra dos veces.
- `idx_po_estado (company_id, status, receipt_status)` — el listado de pendientes.
- `idx_sil_order_line` — agregado en la cuarta migración (ver **J**).

Los índices únicos parciales **no** se pueden inferir desde `ON CONFLICT`;
la entrega 2 tiene que hacer el upsert a mano.

## C · Funciones — 14

**12 en `app`** (todas con `search_path` fijo):

| función | volatilidad | qué hace |
|---|---|---|
| `tasa_de_tratamiento(text)` | IMMUTABLE | `vat_21`→21, `vat_105`→10.5, `vat_0`/`exempt`/`not_taxed`→0, `other`→null |
| `normalizar_linea_compra()` | trigger | deriva alícuota y neto de la línea |
| `totales_pedido_compra(uuid)` | STABLE | subtotal / IVA / total del pedido |
| `totales_factura_proveedor(uuid)` | STABLE | ídem factura, flete incluido en el neto |
| `recalcular_totales_pedido_compra()` | BEFORE UPDATE | cabecera |
| `recalcular_totales_factura_proveedor()` | BEFORE UPDATE | cabecera |
| `empujar_totales_pedido_compra()` | AFTER en líneas | dispara el recálculo |
| `empujar_totales_factura_proveedor()` | AFTER en líneas | ídem |
| `derivar_receipt_status(uuid)` | VOLATILE | `pending` / `partially_received` / `received` mirando **todas** las líneas |
| `proteger_receipt_status()` | trigger | la aplicación no escribe el estado derivado |
| `proteger_lineas_pedido_compra()` | trigger | con mercadería recibida, las líneas se congelan |
| `proteger_estado_pedido_compra()` | trigger | un pedido con recepciones no se cancela |

**2 en `public`** (SECURITY DEFINER, expuestas como RPC):
`confirmar_recepcion(uuid)` y `registrar_evento_compra(...)`.

**`next_document_number` no necesitó ningún cambio.** Su rama por defecto ya exige
`app.current_writer_company_ids()`, que es exactamente admin + employee: el mismo
conjunto que la RLS de Compras. El riesgo que había marcado en la propuesta no existía.

## D · Policies — 8

Una por tabla, todas `TO authenticated`, todas con la función sin argumentos
dentro de un subquery.

- 7 tablas: `FOR ALL USING (company_id IN (SELECT app.current_writer_company_ids()))`
  con el mismo `WITH CHECK` — **admin y employee, nadie más**.
- `purchases_audit`: **sólo SELECT**. Se escribe por la RPC, no por PostgREST.

`salesperson`, `technician`, `customer` y `distributor` no tienen ninguna policy
en Compras. No es que la UI les esconda el botón: la base no les devuelve filas.

## E · Grants

`grant select, insert, update, delete` a `authenticated` sobre las 7 operativas;
`grant select` sobre `purchases_audit`. `grant execute` a `authenticated` sobre
las dos RPC.

`anon` conserva los grants de tabla que Supabase pone por defecto en el schema
`public`, igual que todas las tablas de Ventas — y, como no tiene ninguna policy,
RLS le devuelve cero filas y rechaza toda escritura con `42501`. Está probado, no
supuesto (sección 1 de la suite).

## F · Tests — 73 PASS, 0 FAIL

`scripts/fase6-compras-schema-tests.mjs`, 10 secciones. Cada prohibición se prueba
con un **intento real** y se verifica el `SQLSTATE`, no el mensaje.

| # | sección | qué prueba |
|---:|---|---|
| 1 | RLS por rol | 15 aserciones: customer, distributor, salesperson y anónimo no ven ni escriben |
| 2 | Numeración | series arrancan en 146 / 2; 10 altas simultáneas sin huecos |
| 3 | Pedido de compra | nace `draft` + `pending`; sin moneda `23502`; moneda inexistente `23503` |
| 4 | Líneas, IVA y totales | alícuota derivada, descuento en el neto, totales del servidor |
| 5 | Recepción parcial | por línea; el borrador no toca stock |
| 6 | Sobre-recepción | rechazada con el detalle de cuánto quedaba |
| 7 | Confirmación idempotente | dos llamadas simultáneas, un solo movimiento |
| 8 | Estado derivado | la aplicación no puede escribir `receipt_status` |
| 9 | Facturas de proveedor | varias facturas por OC, flete, exento, número duplicado |
| 10 | Adjuntos, auditoría, depósito | los 3 `entity_type` nuevos; un solo depósito por defecto |

La suite se limpia sola —prefijo `ZZ-C1`, y la limpieza borra **también por prefijo**
por si una corrida muere a la mitad— y repone las cuatro secuencias al valor previo.

Los 18 tests obligatorios pedidos están todos cubiertos. Tres puntos concretos:

- **El bug del IVA al 1 % del legacy no se puede reproducir.** No hay forma de
  escribir una alícuota a mano: sale de `tasa_de_tratamiento()`. Un tratamiento
  inventado se rechaza con `23514`.
- **`other` deja la alícuota en `null`**, que es lo correcto para el histórico:
  no inventa un 21 % que nadie declaró.
- **Nunca se suman monedas distintas.** No hay ninguna función que agregue
  importes sin agrupar por `currency_code`.

## G · Concurrencia

- **Numeración.** 10 altas simultáneas: 0 errores, 10 referencias distintas,
  `147…156` sin huecos. `document_sequences` con `UPDATE … RETURNING`, jamás `MAX+1`.
- **Confirmación de recepción.** Dos llamadas simultáneas a `confirmar_recepcion`
  sobre la misma recepción: **las dos responden bien y el movimiento de stock se
  hace una sola vez**. Lo garantiza `uq_stock_mov_recepcion`, no un `if` en la
  aplicación. Una tercera llamada avisa que ya estaba confirmada.

## H · Stock

- Una recepción en **borrador no mueve nada**. Probado con el contador antes y después.
- Confirmar genera un `stock_movements` por línea con `source_type='goods_receipt'`
  y `source_id` = la recepción, y el saldo sube exactamente lo recibido (30 → 30).
- Una recepción **sin depósito es rechazada** (`23502`): el depósito no se adivina.
- **Sobre-recepción bloqueada por defecto**, como se decidió: intentar 31 sobre 30
  pendientes falla con el detalle (`Línea 1: se intenta recibir 31.0000 y quedan
  30.0000 pendientes`) y **no recorta silenciosamente**. La recepción queda en
  borrador y el stock intacto.
- No hay cancelación de recepciones confirmadas, como se aprobó. Un pedido con
  mercadería recibida no se cancela y sus líneas se congelan (`23001` en ambos casos).

Al terminar la suite: **381 movimientos y 379 saldos**, los mismos que antes.

## I · RLS

Enabled en las 8. Verificado con usuarios reales de cada rol, no leyendo el DDL:

| rol | suppliers | purchase_orders | goods_receipts | supplier_invoices | escritura |
|---|:--:|:--:|:--:|:--:|:--:|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| employee | ✓ | ✓ | ✓ | ✓ | ✓ |
| salesperson | 0 filas | 0 | 0 | 0 | `42501` |
| customer | 0 filas | 0 | 0 | 0 | `42501` |
| distributor | 0 filas | 0 | 0 | 0 | `42501` |
| anónimo | 0 filas | 0 | 0 | 0 | `42501` |

`salesperson` es el caso interesante: **no ve los proveedores de su propia empresa**.
Es deliberado y está aprobado — Compras es admin + employee.

## J · Bugs encontrados

Cuatro cosas aparecieron durante la ejecución. Ninguna llegó al cierre sin corregir.

1. **Falso PASS en mi propia suite** (heredado del patrón de Ventas): medir el
   *error* de una operación prohibida no sirve cuando PostgREST devuelve éxito con
   0 filas. Las aserciones de prohibición verifican el `SQLSTATE` o que la fila
   sobreviva, nunca la ausencia de error.

2. **Mi limpieza dejó un saldo huérfano** (380 saldos donde había 379). La rutina
   ahora distingue entre saldos que existían antes —a los que recalcula el total
   desde los movimientos— y los que creó la corrida, que borra.

3. **`anon` podía ejecutar tres RPC `SECURITY DEFINER`.** Lo detectó el advisor de
   Supabase después del DDL. `confirmar_recepcion` y `registrar_evento_compra`
   (Compras) y `resolver_revision_cliente` (Fase 5) quedaron con el `EXECUTE` por
   defecto; las gemelas de Ventas —`confirmar_entrega`, `registrar_evento_venta`—
   ya lo tenían revocado. Corregido: `revoke execute … from anon` en las tres. La
   asimetría era el bug; ninguna de las tres tenía por qué ser pública.

4. **`app.tasa_de_tratamiento` sin `search_path` fijo.** No referencia ningún
   objeto, así que el riesgo real era nulo, pero es la única función de `app` que
   se había quedado sin la regla de la casa. Corregido.

Advisors después de la corrección: los dos hallazgos nuevos desaparecieron. Lo que
queda es todo previo y deliberado — `document_sequences` con RLS y sin policy (sólo
se llega por `next_document_number`), la vista `product_availability`, las 6 RPC
`SECURITY DEFINER` accesibles a `authenticated` que verifican membresía por dentro,
y la protección de contraseñas filtradas de Auth, que sigue en backlog.

Del lado de performance el advisor marca FKs sin índice de cobertura en las tablas
nuevas. Se agregó **uno solo**: `idx_sil_order_line`, porque derivar lo facturado
por línea de pedido sí consulta por `purchase_order_line_id`. Los demás son
`created_by` / `updated_by` / `currency_code` —que nadie usa como filtro— y
`supplier_id`, ya cubierto por los compuestos `(company_id, supplier_id)`. Es el
mismo criterio que en Ventas; el advisor marca 125 en toda la base.

## K · Tamaño de la base

**96 MB después.** De eso, las 8 tablas de Compras ocupan **664 kB** — vacías, o
sea que son índices y catálogo.

**No tengo la medición de antes.** No la tomé previo al DDL y no la voy a estimar
hacia atrás. Lo que sí es cierto: las tablas están vacías, y 664 kB es el techo de
lo que pudo haber crecido por esta entrega.

## L · CI y deploy

- `npm run lint` · `npm run typecheck` · **266 tests** · `npm run build` — verde.
- `npm run test:isolated` — verde.
- **12 suites de regresión contra la base real**, corridas *después* de la cuarta
  migración: 7 de Ventas y 5 de Clientes, **0 fallos en las 12**.
- Los invariantes siguen intactos: 288 / 166 / 182 / 636 documentos, huella
  `8091b9166350c5bf2c331b1d882ec654`, 1010 clientes, 87 contactos, 14 alias,
  381 movimientos, 379 saldos.
- 0 proveedores, 0 pedidos, 0 recepciones, 0 facturas, 0 filas de auditoría:
  la base quedó como estaba, más el schema.

- Commit `5424809`, push a `main`, workflow «Deploy to GitHub Pages» **success**.

No hay cambios de frontend en esta entrega, así que no hay nada visual que revisar.

---

## Lo que queda para la entrega 2

Migrar los 142 proveedores del legacy. Decisiones ya tomadas que hay que respetar:

- La secuencia arranca en **146**; `PROV00146` fue el primer número libre.
- Los **22 emails encontrados dentro de las notas no se extraen automáticamente**.
- El pedido `PC00001` del legacy **no se migra**: es una prueba, no histórico.
  Por eso la serie de pedidos arranca en 2 sin reutilizar ese número.
- No hay `supplier_contacts` en este modelo.
