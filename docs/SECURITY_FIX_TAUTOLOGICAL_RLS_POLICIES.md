# Fix de seguridad · policies de SELECT que no autorizaban por sí mismas

Estado: **CERRADO**. Siete policies corregidas más dieciséis emparejadas a la
convención del proyecto. Sólo SELECT, sin cambios de schema y sin tocar datos.

| | |
|---|---|
| Migraciones | `fix_rls_delivery_serials_select` · `fix_rls_policies_tautologicas` · `fix_rls_policies_to_authenticated` · `fix_policies_publicas_a_authenticated` |
| Suites | [`fix-rls-tautologicas-tests.mjs`](../scripts/fix-rls-tautologicas-tests.mjs) · [`fix-rls-delivery-serials-tests.mjs`](../scripts/fix-rls-delivery-serials-tests.mjs) |

---

## Corrección a lo que te reporté antes

En el turno anterior dije que estas policies **filtraban datos hoy** y que «seis
tienen datos reales, así que el problema no es teórico». **Era incorrecto, y lo
medí antes de tocar nada:**

```
customer (Cliente Demo S.A.), conteo exacto, ANTES del fix:
  delivery_lines        0   de 600
  sales_quote_lines     0   de 992
  sales_order_lines     0   de 593
```

Si la condición fuera efectivamente `true`, el customer habría visto las 600.
Vio 0. **Postgres aplica RLS también dentro de la subconsulta de una policy**,
así que la cadena terminaba en la policy del padre, que sí está bien escrita.

Lo mismo valía para `delivery_serials`, que arreglé en el turno anterior: su
cadena iba a `delivery_lines` → `deliveries`, y `deliveries_select` es correcta.
**Tampoco filtraba.**

### Entonces, ¿por qué corregirlas igual?

Porque la garantía era **implícita**, y eso es exactamente lo que decís en tu
punto 2: `parent.company_id = child.company_id` comprueba **consistencia
interna**, no permiso. La seguridad venía de un comportamiento sutil de
Postgres y de que la policy del padre siguiera siendo correcta. Si mañana
alguien mete un helper `SECURITY DEFINER` en el medio, reescribe la del padre,
o consulta la hija en un contexto donde esa RLS no aplique, **la hija se queda
sin ninguna protección propia**.

Es defensa en profundidad, no un incendio. Y como el comportamiento actual ya
era correcto, el criterio de éxito pasó a ser: **la visibilidad tiene que
quedar exactamente igual**. Se midió antes, se midió después.

## La tabla

| tabla | policy vieja | riesgo | policy nueva | roles probados | resultado |
|---|---|---|---|---|---|
| `delivery_serials` | `EXISTS(delivery_lines dl … dl.company_id = ds.company_id)` | no autoriza sola; dependía de la RLS anidada de `delivery_lines` → `deliveries` | empresa del usuario **+** (interno **o** `customer_id` propio) | admin, salesperson, customer, distributor, anon | **PASS** |
| `delivery_lines` | `EXISTS(deliveries d … d.company_id = dl.company_id)` | ídem, vía `deliveries` | empresa **+** (interno **o** `d.customer_id` propio) | los 5 | **PASS** |
| `sales_quote_lines` | `EXISTS(sales_quotes q … q.company_id = l.company_id)` | ídem | empresa **+** (interno **o** `q.customer_id` propio) | los 5 | **PASS** |
| `sales_order_lines` | `EXISTS(sales_orders o … o.company_id = l.company_id)` | ídem | empresa **+** (interno **o** `o.customer_id` propio) | los 5 | **PASS** |
| `sales_invoice_lines` | `EXISTS(sales_invoices i … i.company_id = l.company_id)` | ídem. **0 filas hoy**: se corrige antes de que se carguen | empresa **+** (interno **o** `i.customer_id` propio) | los 5 | **PASS** |
| `customer_purchase_order_lines` | `EXISTS(customer_purchase_orders p … p.company_id = l.company_id)` | ídem. 0 filas hoy | empresa **+** (interno **o** `p.customer_id` propio) | los 5 | **PASS** |
| `product_images` | `EXISTS(products p … p.company_id = pi.company_id)` | ídem, vía `products` | empresa **+** producto no borrado **+** (interno **o** `status='active'`) | los 5 | **PASS** |

## `product_images` no sigue el patrón de los documentos — y eso es correcto

Es el caso que pediste auditar primero, y tiene una semántica propia:
**`products_select` no tiene cliente**. Deja ver los productos **activos** a
cualquier miembro de la empresa, y a los internos también los no activos.

Copiarle el patrón de los documentos —«sólo interno o dueño»— **habría roto el
catálogo** para customer y distributor. La policy nueva sigue a su padre real.

| identidad | producto activo de su empresa | de otro cliente, misma empresa | de Torquetools | de la empresa ajena |
|---|---|---|---|---|
| admin BT / salesperson TT | ve | ve | **ve** | **NO ve** |
| customer | ve | **ve** | NO ve | NO ve |
| distributor | ve | **ve** | NO ve | NO ve |
| anon | NO ve | NO ve | NO ve | NO ve |

Que un customer vea la imagen de un producto activo de otro cliente **no es un
agujero**: las imágenes no tienen cliente, son del catálogo.

Y la distinción que sí importa, probada:

| | customer | interno |
|---|---|---|
| imagen de un producto **activo** | ve | ve |
| imagen de un producto **`discontinued`** | **no ve** | **ve** |

## Los tests

Fixtures en **cuatro situaciones** a la vez: un documento del cliente de prueba,
otro de **otro cliente de la misma empresa**, uno en **Torquetools** y uno en una
**empresa nueva sin ninguna membresía**. Cada caso verificado **por id exacto y
por id del padre exacto**, no contando filas.

**Líneas de documento** (`delivery_lines`, `sales_quote_lines`, `sales_order_lines`):

| identidad | propio | de otro cliente, misma empresa | de Torquetools | de la empresa ajena |
|---|---|---|---|---|
| admin BT / salesperson TT | ve | ve | ve | **NO ve** |
| customer (Cliente Demo) | **ve** | **NO ve** | NO ve | NO ve |
| distributor (Distribuidor Demo) | NO ve | NO ve | NO ve | NO ve |
| anon | NO ve | NO ve | NO ve | NO ve |

El caso central —**un customer no ve las líneas de la cotización de otro cliente
de su misma empresa**— queda probado con un documento real, no por ausencia de
datos.

**0 fallos**, y las 16 tablas vuelven a su número exacto.

## Verificación de que nada cambió

Conteo exacto con JWT real, antes y después, 4 roles × 6 tablas:

| | jano | customer | distributor | anon |
|---|---|---|---|---|
| `delivery_lines` | 600 = 600 | 0 = 0 | 0 = 0 | 0 = 0 |
| `sales_quote_lines` | 992 = 992 | 0 = 0 | 0 = 0 | 0 = 0 |
| `sales_order_lines` | 593 = 593 | 0 = 0 | 0 = 0 | 0 = 0 |
| `sales_invoice_lines` | 0 = 0 | 0 = 0 | 0 = 0 | 0 = 0 |
| `customer_purchase_order_lines` | 0 = 0 | 0 = 0 | 0 = 0 | 0 = 0 |
| `product_images` | 8859 = 8859 | 8859 = 8859 | 8859 = 8859 | 0 = 0 |

**Idéntico en las 24 celdas.**

### El catálogo, con su propia consulta

La sesión del navegador local había expirado, así que en lugar de mirar la
pantalla corrí **la consulta embebida exacta que usa
`src/modules/catalogo/services/productos.ts`** —`products` con
`product_images ( source_url, thumb_url, kind, position, is_primary )`— con JWT
real:

| identidad | productos | con imagen | thumbnails | principales |
|---|---|---|---|---|
| admin BT | 200 | 200 | 157 | 136 |
| customer | 200 | 200 | 157 | 136 |
| distributor | 200 | 200 | 157 | 136 |
| anon | `42501` — sin acceso al catálogo, igual que antes | | | |

El join embebido es justamente donde se aplica la RLS de `product_images`, y da
idéntico para las tres identidades. Si querés la comprobación visual en el
Catálogo, iniciá sesión en `localhost:5173` y la hago.

## Un bug que introduje y corregí

**`create policy` sin cláusula `TO` la crea `TO PUBLIC`.** Todas las policies
previas del proyecto son `TO authenticated`. Se me pasó en cuatro migraciones:

| dónde | efecto medido |
|---|---|
| `fix_rls_policies_tautologicas` (las seis) | `anon` pasó de **0 filas** a **`42501: permission denied for function current_company_ids`** — no tiene EXECUTE ni USAGE sobre `app` |
| `fix_rls_delivery_serials_select` (turno anterior) | lo mismo, y no lo había detectado |
| Compras entrega 5 (`attachments_select`) | ninguno: su policy usa helpers que `anon` **sí** puede ejecutar |
| Mantenimiento entrega 1 (sus 15) | ninguno, por lo mismo |

Funcionalmente `anon` seguía sin ver nada en los cuatro casos, pero en los dos
primeros cambiaba la respuesta de `200 []` a un error. Corregido: **las 23
policies quedaron `TO authenticated`**.

> Que el resultado fuera correcto **según qué helper usa cada policy** es
> exactamente la clase de garantía implícita que este fix vino a eliminar. Por
> eso emparejé también las 16 donde no rompía nada.

## Verificación final

```
policies con el patrón tautológico en public ......... 0
policies en PUBLIC en vez de authenticated ........... 0
```

## Regresión

| | |
|---|---|
| Suites de base | **19 / 19**, 0 FAIL |
| Módulos cubiertos | Ventas · Clientes · Catálogo · Compras · Mantenimiento |

### Invariantes

| | esperado | medido |
|---|---|---|
| cotizaciones / pedidos / entregas históricas | 288 / 166 / 182 | **288 / 166 / 182** |
| huella md5 de Ventas | `8091b916…` | **verificada por `fase5-cierre` y `fase6-cierre`** |
| customers · contacts · aliases | 1010 / 87 / 14 | **1010 / 87 / 14** |
| suppliers | 142 | **142** |
| stock_movements · stock_balances | 381 / 379 | **381 / 379** |
| **productos Buscatools** | **21.772** | **21.772** |
| productos totales | 21.775 | 21.775 |
| delivery_lines / quote_lines / order_lines | 600 / 992 / 593 | **600 / 992 / 593** |
| product_images | 8859 | **8859** |
| empresas | 2 | **2** |
| órdenes de mantenimiento · auditoría de compras | 0 / 0 | **0 / 0** |

---

# TAUTOLOGICAL RLS FIX = CLOSED
