# Fix de seguridad · `delivery_serials.serials_select`

Aplicado antes de la Entrega 2, como pediste. Una migración, una policy, sin
cambios de schema, sin tocar datos y sin funciones nuevas.

| | |
|---|---|
| Migración | `fix_rls_delivery_serials_select` |
| SQL | [`docs/database/PHASE_7_MAINTENANCE.sql`](database/PHASE_7_MAINTENANCE.sql) |
| Suite | [`scripts/fix-rls-delivery-serials-tests.mjs`](../scripts/fix-rls-delivery-serials-tests.mjs) |

---

## 1 · Policy anterior

```sql
EXISTS (
  SELECT 1 FROM delivery_lines dl
   WHERE dl.id = delivery_serials.delivery_line_id
     AND dl.company_id = delivery_serials.company_id
)
```

Compara la línea de entrega con la empresa **de la propia fila**, nunca con las
del usuario autenticado. Para cualquier fila bien formada es equivalente a
`true`, y como `authenticated` tiene `SELECT` sobre la tabla, **cualquier
usuario logueado —incluido un `customer`— habría visto los seriales de todas
las empresas**.

No filtró nada en producción porque la tabla tiene **0 filas**; habría filtrado
en cuanto Ventas empezara a registrar seriales.

## 2 · Policy nueva

```sql
company_id IN (SELECT unnest(app.current_company_ids()))
AND (
  company_id IN (SELECT unnest(app.current_internal_company_ids()))
  OR customer_id IN (SELECT unnest(app.current_customer_ids()))
)
```

Es **exactamente el patrón de `deliveries_select`**, que es su documento padre:
la empresa tiene que ser una de las del usuario, y además o es interno de esa
empresa, o es el cliente dueño del serial.

`delivery_serials` ya trae `customer_id` propio, así que no hace falta recorrer
la cadena hasta la entrega. Todas las referencias van calificadas y los tres
helpers ya existían.

**No se tocó `serials_write`**, que ya estaba bien
(`app.current_writer_company_ids()`).

## 3 · Tests

Como la tabla está vacía, la única forma de probarlo era **armar la cadena
completa en tres empresas**: cliente → rubro → producto → depósito → entrega →
línea → serial. Incluida una **empresa nueva sin ninguna membresía**.

| identidad | ve | no ve | por id ajeno | por serial ajeno | por empresa ajena |
|---|---|---|---|---|---|
| **admin** en Buscatools · **salesperson** en Torquetools | los 2 suyos | el de la ajena | 0 | 0 | 0 |
| **customer** | ninguno | los 3 | 0 | 0 | 0 |
| **distributor** | ninguno | los 3 | 0 | 0 | 0 |
| **anon** | ninguno | los 3 | 0 | 0 | 0 |

Los `customer` y `distributor` de prueba ven **0 de 3** porque el fixture de
Buscatools es de otro cliente: la rama de `current_customer_ids()` está en la
policy y funciona, pero a ellos no les corresponde ninguno de estos tres.

También verificado que **la escritura no cambió**: el admin no puede escribir en
la empresa ajena (`42501`), y en Torquetools —donde es salesperson— **lee pero
no escribe**.

**0 fallos.** Los fixtures se borran solos, incluida la empresa temporal:
empresas 2 · clientes 1010 · productos 21.775 · depósitos 2 · entregas 182 ·
líneas 600 · seriales 0.

## 4 · Auditoría de `PUBLIC EXECUTE` — sólo lectura, nada corregido

Barrido de las funciones `SECURITY DEFINER` en `public` y `app`:

### `public` — el único schema expuesto por PostgREST

**Cero funciones ejecutables por `anon` o por PUBLIC.** Las 11 que hay
—`confirmar_entrega`, `confirmar_recepcion`, `registrar_factura_proveedor`,
`next_document_number`, `duplicar_pedido_compra`, `registrar_evento_compra`,
`registrar_evento_venta`, `resolver_revision_cliente` y las tres de
Mantenimiento— son **`authenticated` únicamente**.

### `app` — 51 funciones conservan el EXECUTE heredado de PUBLIC

Pero **no son alcanzables**, y hacen falta dos cosas que no se dan:

| | |
|---|---|
| ¿`anon` tiene USAGE sobre el schema `app`? | **NO** (`false`) |
| ¿`app` está expuesto por PostgREST? | **No** — sólo `public` y `graphql_public` |

Sin USAGE sobre el schema, el `EXECUTE` no sirve de nada: la llamada falla
antes. Y además **la enorme mayoría son funciones de trigger** (sin argumentos,
devuelven `trigger`), que no son invocables por RPC ni aunque el schema
estuviera abierto.

Las únicas con argumentos son `derivar_cumplimiento(uuid)` y
`derivar_receipt_status(uuid)`; y de las sin argumentos, las interesantes serían
`current_internal_company_ids()`, `current_writer_company_ids()`,
`current_price_list_ids()` y las dos de Mantenimiento — que devuelven **las
membresías del propio llamador**, o sea un array vacío para un anónimo.

### Lo único que anoto, y no toqué

Hay una **inconsistencia cosmética**: `current_company_ids`,
`current_customer_ids`, `current_role`, `is_admin`, `is_internal` y
`shares_company` **sí** tienen el EXECUTE revocado de PUBLIC, y sus hermanas
`current_internal_company_ids`, `current_writer_company_ids`,
`current_price_list_ids` y las dos nuevas de Mantenimiento **no**.

No es explotable —falta el USAGE— y **no lo corregí**, como pediste. Si querés
emparejarlo es una migración de cinco `revoke`, sin riesgo pero sin urgencia.

## 5 · El mismo bug en otras seis policies — reportado, NO tocado

El barrido encontró que **`delivery_serials` no era la única**. Hay **seis más**
con la construcción idéntica:

| tabla | policy | filas hoy |
|---|---|---|
| `delivery_lines` | `delivery_lines_select` | **600** |
| `sales_quote_lines` | `quote_lines_select` | reales |
| `sales_order_lines` | `order_lines_select` | reales |
| `sales_invoice_lines` | `invoice_lines_select` | reales |
| `customer_purchase_order_lines` | `po_lines_select` | reales |
| `product_images` | `product_images_select` | reales |

Todas con la misma forma:

```sql
EXISTS (SELECT 1 FROM <padre> p
         WHERE p.id = <hija>.<fk> AND p.company_id = <hija>.company_id)
```

**A diferencia de `delivery_serials`, estas tienen datos reales**, así que el
problema no es teórico.

**No las toqué**, y el motivo no es sólo que sean de módulos cerrados: el
arreglo **cambia lo que ve un `customer`**. Hoy un cliente ve todas las líneas
de todas las cotizaciones; con la policy corregida vería sólo las de sus
propios documentos. Eso es lo correcto, pero es un cambio de comportamiento en
Ventas y Clientes que quiero que apruebes con los ojos abiertos.

El arreglo, para cada una, es heredar la visibilidad del padre —que en los seis
casos ya la tiene bien— con el mismo patrón que acabo de aplicar:

```sql
company_id IN (SELECT unnest(app.current_company_ids()))
AND (company_id IN (SELECT unnest(app.current_internal_company_ids()))
     OR EXISTS (SELECT 1 FROM <padre> p
                 WHERE p.id = <hija>.<fk>
                   AND p.customer_id IN (SELECT unnest(app.current_customer_ids()))))
```

(`product_images` es más simple: no tiene cliente, alcanza con la empresa y con
respetar el `status = 'active'` que ya tiene `products_select`.)

**Decisión tuya.** Si querés, lo hago como un fix aparte con su propia suite,
igual que éste.

## 6 · Regresión

| | |
|---|---|
| Suites de base | **18 / 18**, 0 FAIL (17 previas + la nueva del fix) |
| Tests unitarios | 436 en 40 archivos |
| lint · build | limpios |

Invariantes intactos: 142 proveedores · 1010 clientes · 21.775 productos ·
381 movimientos · 379 saldos · 288/166/182/636 · huella `8091b916…` ·
2 empresas · 0 seriales · 0 auditoría de compras y de mantenimiento.

## 7 · Backlog

Registrados en [`POST_MIGRATION_BACKLOG.md`](POST_MIGRATION_BACKLOG.md):

- **`POLITICA_STOCK_NEGATIVO_MANTENIMIENTO`** — hoy permitido, sin cambios.
- **Torque sin unidad ni instrumento** — no hay evidencia en el legacy.
- **Impuestos en la cotización de mantenimiento** — el legacy no los tiene.
- **`revoke … from anon` no alcanza** — hay que revocarle a PUBLIC.
- **Las seis policies con el mismo bug** — pendientes de tu decisión.
