# Fase 4 — Ventas · diseño

**Nada implementado.** Ninguna tabla creada, ningún dato migrado, ninguna UI.
Entrega A–P para aprobación.

Auditoría hecha sobre el `app.js` real del legacy (45.345 líneas, 5,1 MB, sólo
lectura) y sobre la base nueva. Cada afirmación sale de una línea concreta.

---

## A. Auditoría del módulo Ventas del legacy

### A1. Dónde viven los datos — y por qué esto cambia todo

El legacy **no tiene servidor de datos de ventas**. Todo vive en
`localStorage`, y un subconjunto se sincroniza a un Supabase legacy en una
tabla `erp_store (key, value)`: un almacén clave-valor de blobs JSON, no un
modelo relacional.

```js
// app.js:1210
const r = await fetch(SUPA_URL + '/rest/v1/erp_store?select=key,value', {headers:_supaH});
```

Firebase está, pero **sólo para el chat** (`FB_PATH_MSGS`, `FB_PATH_GROUPS`) y
las push. No guarda ni una venta.

**Qué se sincroniza y qué no** (`SUPA_SYNC_KEYS`, app.js:1183):

| clave | contenido | ¿sincroniza? |
|---|---|---|
| `erp_cotizaciones` | cotizaciones | **sí** |
| `erp_pedidos` | pedidos de venta | **sí** |
| `erp_notas_entrega` | entregas | **sí** |
| `erp_clientes` | clientes | **sí** |
| `spd_client_memory_v1` | equivalencias producto↔cliente | **sí** |
| `erp_kardex` | movimientos de stock | **sí** |
| **`erp_facturas`** | **facturas** | **NO** |
| **`erp_recibos`** | **cobranzas** | **NO** |
| **`erp_notas_credito`** | **notas de crédito** | **NO** |
| **`erp_contactos`** | **contactos** | **NO** |
| **`erp_attachments`** | **adjuntos** | **NO** |

**Las facturas, las cobranzas y las notas de crédito existen en un solo
navegador.** Si esa máquina se formatea, se pierden. No hay copia en ningún
servidor. Esto es lo más urgente que salió de la auditoría, y no es un
problema de diseño: es un riesgo operativo hoy.

### A2. El modelo real de un pedido

```js
// app.js:22646 — crearPedidoVacio
const ped = {
  ref: nextPedRef(),                 // "PDV123", calculado del máximo LOCAL
  fromCotizacion: null,              // enlace por TEXTO
  cliente: data.cliente || '',       // TEXTO, no un id
  titulo, fecha, formaPago,
  iva: true, iibb: false, dtoGlobal: 0,
  items: [{ sku:'', nombre:'', desc:'', qty:1, price:0, dto:0 }],
  base, ivaAmount, total, uds,
  estado: 'pendiente',
  standalone: true, stockApplied: false,
  creadoPor: state.user, created: Date.now()
};
```

Siete problemas estructurales, todos verificados:

1. **`cliente` es texto libre.** No hay `customer_id`. Renombrar un cliente
   rompe su historial.
2. **`sku` es texto.** No hay `product_id`. Un SKU que cambia deja la línea
   huérfana.
3. **Las cantidades entregadas se indexan por POSICIÓN DE ARRAY**:
   `ped.entregado[idx] >= it.qty` (app.js:22137). Insertar o borrar una línea
   corre todas las entregas. Es el problema que ya identificaste.
4. **La numeración se calcula del máximo local**: `nextPedRef()` recorre
   `loadPedidos()` y busca `PDV(\d+)`. Dos vendedores sin conexión generan el
   mismo número.
5. **No hay líneas como entidad.** Son índices dentro de un JSON.
6. **`iva: true` con 21 % hardcodeado**, `iibb` booleano. No hay modelo fiscal.
7. **Enlaces por `ref` de texto** en toda la cadena: `fromCotizacion`,
   `fromPedido`, `fromNE`, `facturaRef`.

### A3. La OC del cliente NO existe como entidad

Tenías razón, y el legacy lo dice explícitamente en su propia documentación
interna:

```
// app.js:6781
| OC | Orden de Compra del CLIENTE (documento que manda el cliente) | VENTAS | se importa como COTI |
```

La OC se parsea (hay un importador con PDF.js y matching contra el catálogo) y
**se convierte en una cotización**. El documento del cliente no se conserva
como tal: su número, su fecha, su centro de costo y su PDF no tienen dónde
vivir. Lo que el cliente pidió y lo que nosotros cotizamos quedan mezclados en
el mismo registro.

### A4. Lo que el legacy SÍ hace bien y hay que conservar

No todo es deuda. Tres cosas están bien resueltas:

**Moneda y tipo de cambio por documento** (app.js:20061):
```js
const moneda = doc.moneda || 'USD';
const tc = doc.tc || _defaultTC(moneda);
```
USD/ARS/EUR, con el TC guardado en el documento. Es exactamente el snapshot
que pedís en el punto 17: ya está resuelto conceptualmente.

**Reserva vs. descuento de stock.** `applyStockDeductions(items, kind, docRef)`
usa `'sv'` (stock virtual = reserva) al cotizar/pedir y `'sr'` (stock real) al
entregar. La distinción reserva/entrega ya existe.

**Kits con snapshot de componentes** (app.js:22021): al crear el documento se
congelan los componentes del kit, y sólo se cae al catálogo actual si no hay
snapshot. Es el criterio correcto y hay que mantenerlo.

**Cobranzas múltiples por factura**: `recibosDeFactura(facturaRef)` suma varios
recibos, y hay notas de crédito. El punto 16 ya está cubierto conceptualmente.

### A5. Lo que el legacy hace mal y NO hay que copiar

**Una factura por nota de entrega, y sólo una:**
```js
// app.js:27xxx
const existing = list.find(f => f.fromNE === refNE);
```
No hay facturación parcial ni consolidada. Tu punto 15 no está cubierto.

**Adjuntos en localStorage como base64.** `erp_attachments` es un objeto JSON
en el navegador; los logos ya están como `data:image/png;base64,...`
(app.js:279). El cuota de localStorage es de unos pocos MB: esto se rompe
solo.

**La memoria de equivalencias se indexa por NOMBRE de cliente normalizado:**
```js
// app.js:17778
function normClienteKey(s){ return s.toLowerCase()…replace(/[^a-z0-9]+/g,' ').trim(); }
mem[normClienteKey(nombreCliente)] = { "texto de la OC": "SKU" }
```
Dos clientes con nombres parecidos colisionan. Renombrar a un cliente pierde
todo lo aprendido. La idea es correcta —y valiosa—; la clave está mal.

### A6. Lo que directamente NO existe

Busqué y no hay nada:

| falta | evidencia |
|---|---|
| **Números de serie** | 0 coincidencias de `numeroSerie`, `nroSerie`, `serial` |
| **Direcciones de cliente** | `customers` nuevo no tiene ni una columna de dirección |
| **Contactos como entidad** | `erp_contactos` existe pero no sincroniza |
| **Entidad OC del cliente** | se importa como cotización (A3) |
| **Facturación parcial** | una factura por NE (A5) |
| **Centro de costo** | 0 coincidencias |
| **Estados separados** | un solo `estado` por documento |

### A7. Hallazgos de seguridad del legacy

No es el objeto de esta fase y **no toqué nada**, pero salieron al auditar y
callarlos sería peor:

1. **El control de acceso del legacy es una cadena pública.**
   `SUPA_APP_TOKEN = 'bterp_Klq…'` está hardcodeada en `app.js` (línea 1182) y
   viaja como header `x-erp-token`. `app.js` es un archivo público: cualquiera
   que abra la web lo lee. Si ese token es lo que autoriza escribir en
   `erp_store`, el ERP entero es escribible por cualquiera.
2. **`erp_openai_key`** — una API key de OpenAI guardada en localStorage.
3. **Credenciales de servicio de Firebase en `Downloads`**:
   `buscatoolserp-firebase-adminsdk-*.json` y dos `spotme-*.json`. Son claves
   de administrador. No las abrí.

Recomendación: rotar el token y la key de OpenAI, y sacar los JSON de
`Downloads`. Es tu decisión y no bloquea esta fase.

---

## B. Inventario de datos reales — **no lo pude completar**

Y prefiero decírtelo antes que estimar.

Las cantidades de cotizaciones, pedidos, entregas, facturas y cobranzas están
en dos lugares, y **no tengo acceso autorizado a ninguno**:

1. **El `localStorage` de cada navegador.** Es donde viven facturas, recibos,
   notas de crédito y contactos, que no sincronizan.
2. **La tabla `erp_store` del Supabase legacy.** Tu instrucción permanente es
   «No tocar Supabase legacy», y no interpreté por mi cuenta que una lectura
   estuviera incluida.

Sin esos números no puedo decirte cuántas ventas históricas hay, ni de qué
años, ni cuántos clientes tienen movimiento. Todo el punto O (migración)
depende de esto.

**Necesito que elijas una de estas tres** (ver P1).

---

## C. Qué de la base nueva ya sirve

17 tablas hoy. Para Ventas:

| tabla | filas | veredicto |
|---|---:|---|
| `companies` | 2 | **sirve** — multiempresa ya resuelto |
| `profiles` + `company_memberships` | 7 + 8 | **sirve** — vendedores y roles |
| `customers` | 3 | **sirve con faltantes**, ver D |
| `currencies` | 3 | **sirve** — ARS/USD/EUR |
| `price_lists` + `product_prices` | 4 + 12.505 | **sirve** — sugieren precio |
| `products` | 21.775 | **sirve** |
| `warehouses` | 2 | **sirve** |
| `stock_movements` / `stock_balances` | 381 / 379 | **sirve** — no se duplica |
| **`stock_reservations`** | **0** | **sirve y está esperando esto** |

`stock_reservations` ya tiene exactamente los ganchos que Ventas necesita:

```sql
source_type text NOT NULL,   -- 'sales_order'
source_id   uuid,            -- id de la línea de pedido
expires_at  timestamptz
```

Está vacía porque nunca hubo quién la usara. **No hace falta un segundo
sistema de stock** (tu punto 11): el que hay alcanza.

---

## D. `customers` — qué falta, comparado contra datos reales

Las 21 columnas actuales cubren razón social, nombre comercial, CUIT, email
(dominios), teléfono, vendedor, condición de pago, moneda, lista de precios,
descuento, notas y estado.

**Falta lo que el legacy sí maneja y no tiene dónde ir:**

| falta | por qué | evidencia |
|---|---|---|
| **Direcciones** | no hay ni una columna | un cliente factura en una dirección y recibe en otra, a veces en varias plantas |
| **Contactos** | `erp_contactos` existe en el legacy | una OC llega con un contacto y la entrega se coordina con otro |
| **Email directo** | sólo hay `email_domains` (para reconocer remitentes) | hace falta el mail de facturación |

Propongo **dos tablas nuevas** en vez de columnas:

- `customer_addresses` — porque un cliente tiene N direcciones con propósito
  (`billing`, `shipping`), y una de cada tipo es la predeterminada.
- `customer_contacts` — porque un cliente tiene N personas, y el pedido guarda
  a cuál se le coordinó.

**No agrego** país/provincia/ciudad como columnas de `customers`: van en
`customer_addresses`, que es donde tienen sentido. Y **no agrego** centro de
costo al cliente: es un dato de la OC, no del cliente (ver E).

---

## E. Modelo relacional propuesto

Trece tablas nuevas. Ninguna duplica algo existente.

### E1. Cliente

```
customer_addresses (id, company_id, customer_id, kind, is_default,
                    street, city, state, postal_code, country_code, notes)
customer_contacts  (id, company_id, customer_id, full_name, role, email,
                    phone, is_default, notes)
```

### E2. Cotización

```
sales_quotes       (id, company_id, number, customer_id, contact_id,
                    salesperson_id, quote_date, valid_until,
                    currency_code, exchange_rate,
                    payment_terms, discount_pct,
                    tax_regime, notes, status,
                    created_by, created_at, updated_at)

sales_quote_lines  (id, company_id, quote_id, line_no,
                    product_id,                       -- puede ser NULL
                    sku_snapshot, name_snapshot, description_snapshot,
                    brand_snapshot,
                    quantity, unit_price, discount_pct, tax_rate,
                    kit_components_snapshot jsonb,    -- como hace el legacy
                    line_type,                        -- 'item' | 'chapter'
                    notes)
```

**`number` no se calcula en el cliente.** Va con una secuencia por empresa y
tipo de documento en el servidor (ver E8), no con un `max()` sobre lo que hay
en el navegador.

### E3. OC del cliente — entidad propia

Los datos reales lo justifican: número, fecha, centro de costo, dirección de
entrega y el PDF original no tienen dónde vivir hoy.

```
customer_purchase_orders      (id, company_id, customer_id, quote_id,
                               po_number,               -- el número DEL CLIENTE
                               po_date, currency_code, exchange_rate,
                               payment_terms, cost_center,
                               shipping_address_id, contact_id,
                               received_at, received_by,
                               raw_text,                -- el texto tal como llegó
                               match_status, notes)

customer_purchase_order_lines (id, company_id, po_id, line_no,
                               product_id,                    -- resuelto, puede ser NULL
                               customer_product_code,         -- EXACTO como lo mandó
                               customer_description,          -- EXACTO como lo mandó
                               quantity, unit_price, discount_pct, currency_code,
                               match_status, match_confidence, matched_by,
                               quote_line_id)                 -- contra qué línea cotizada
```

**`customer_product_code` y `customer_description` se guardan sin tocar.** Es
tu punto 7: la línea conserva las dos identidades, la nuestra y la del cliente.

### E4. Match OC ↔ cotización

`match_status` con cuatro valores, en la línea y en la cabecera:

| valor | significado |
|---|---|
| `match` | coincide con la cotización |
| `difference` | mismo producto, distinto precio / cantidad / descuento / moneda |
| `missing` | estaba en la cotización y no vino en la OC |
| `extra` | vino en la OC y no estaba cotizado |

Y una tabla que guarda **qué** cambió, no sólo que cambió:

```
purchase_order_discrepancies (id, company_id, po_id, po_line_id, quote_line_id,
                              field,        -- 'unit_price','quantity','currency',…
                              quote_value, po_value,
                              severity, resolved_at, resolved_by, resolution_note)
```

Sin esta tabla, «la IA puede explicar qué cambió el cliente» se convierte en
volver a comparar los documentos cada vez y adivinar. Con ella, la diferencia
quedó registrada en el momento en que se detectó, con el valor de cada lado.

**Nada se corrige solo.** Una discrepancia se resuelve con una persona
apretando un botón, y queda quién y cuándo.

### E5. Equivalencias por cliente

```
customer_product_aliases (id, company_id, customer_id,     -- ID, no el nombre
                          customer_code, customer_description,
                          normalized_key,                  -- para buscar
                          product_id,
                          status,        -- 'confirmed' | 'suggested' | 'rejected'
                          confidence,
                          times_used, last_used_at,
                          created_by, confirmed_by, created_at, updated_at)

unique (company_id, customer_id, normalized_key)
```

Arregla el defecto de A5: la clave es `customer_id`, no el nombre normalizado.
Renombrar un cliente ya no borra lo aprendido, y dos clientes con nombres
parecidos no se pisan.

**El alias nunca cruza clientes.** El `unique` lleva `customer_id`: que
«ABC-001928» sea el TE.9322 de Nordex no dice nada sobre qué es para SIMPA.

### E6. Pedido de venta

```
sales_orders      (id, company_id, number, customer_id, contact_id,
                   salesperson_id, order_date,
                   quote_id, po_id,          -- de dónde salió
                   origin,                   -- 'quote_po'|'po_only'|'direct'|'manual'
                   currency_code, exchange_rate,
                   payment_terms, discount_pct, cost_center,
                   shipping_address_id, billing_address_id,
                   commercial_status, fulfillment_status,
                   invoicing_status, payment_status,
                   notes, created_by, created_at, updated_at)

sales_order_lines (id, company_id, order_id, line_no,
                   product_id, quote_line_id, po_line_id,
                   sku_snapshot, name_snapshot, description_snapshot,
                   customer_product_code, customer_description,
                   quantity_ordered, unit_price, discount_pct, tax_rate,
                   kit_components_snapshot jsonb,
                   line_type, notes)
```

Las cantidades reservada, entregada y pendiente **no son columnas**: se
derivan (ver J y K). Guardarlas como columnas es tener dos verdades.

### E7. Entrega, remito, factura, cobranza

```
deliveries        (id, company_id, number, order_id, customer_id,
                   delivery_date, shipping_address_id, contact_id,
                   carrier, tracking, status, notes)

delivery_lines    (id, company_id, delivery_id, order_line_id,
                   product_id, quantity, warehouse_id, notes)

delivery_serials  (id, company_id, delivery_line_id, product_id,
                   serial_number, customer_id, delivery_date, notes)

sales_invoices    (id, company_id, number, customer_id, order_id,
                   invoice_date, due_date,
                   currency_code, exchange_rate,
                   subtotal, tax_amount, total, status, notes)

sales_invoice_lines (id, company_id, invoice_id, order_line_id, delivery_line_id,
                     product_id, sku_snapshot, name_snapshot,
                     quantity, unit_price, discount_pct, tax_rate)

payments          (id, company_id, customer_id, payment_date, amount,
                   currency_code, exchange_rate, method, reference, notes)

payment_allocations (id, company_id, payment_id, invoice_id, amount)
```

**`payment_allocations` es la pieza que el legacy no tiene.** Sin ella, un
cheque que paga tres facturas no se puede representar. Con ella, un pago se
reparte entre facturas y una factura recibe pagos de varios.

`sales_invoice_lines.delivery_line_id` es lo que habilita facturar entregas
parciales y consolidar varias entregas en una factura: **la relación pedido↔
factura es N:N a través de las entregas**, no 1:1.

### E8. Numeración y adjuntos

```
document_sequences (company_id, doc_type, prefix, next_number)   -- PK compuesta

attachments        (id, company_id, entity_type, entity_id,
                    storage_path,          -- Supabase Storage, NUNCA base64
                    file_name, mime_type, bytes, kind,
                    uploaded_by, created_at)
```

Una tabla genérica de adjuntos y no una por documento: los campos son los
mismos en los siete casos y el `entity_type` + `entity_id` alcanza. Se paga
con no tener FK real al documento — es la contrapartida, y la acepto porque la
alternativa son siete tablas idénticas.

El número se pide al servidor con una función que hace `UPDATE … RETURNING`
sobre `document_sequences`: atómico, sin colisiones, sin depender de lo que
haya en el navegador.

---

## F. El ciclo, y qué documento crea qué

```
CLIENTE
  │
  ├─ customer_addresses, customer_contacts
  │
COTIZACIÓN ─────────────────────── sales_quotes / _lines
  │  (snapshot de precio y descripción)
  │
OC DEL CLIENTE ────────────────── customer_purchase_orders / _lines
  │  ├─ match contra la cotización → purchase_order_discrepancies
  │  └─ aprende → customer_product_aliases
  │
PEDIDO DE VENTA ───────────────── sales_orders / _lines
  │  origin: quote_po | po_only | direct | manual
  │
RESERVA ───────────────────────── stock_reservations (source_type='sales_order')
  │
ENTREGA (parcial o total) ─────── deliveries / delivery_lines
  │  └─ descuenta ─────────────── stock_movements
  │  └─ serie ────────────────── delivery_serials
  │
REMITO ──────────── es la IMPRESIÓN de una entrega, no otra tabla
  │
FACTURA ───────────────────────── sales_invoices / _lines
  │  (una factura puede cubrir varias entregas; una entrega, varias facturas)
  │
COBRANZA ──────────────────────── payments + payment_allocations
```

**El remito no es una tabla.** En el legacy tampoco lo es: la «nota de
entrega» ES el remito, y lo que cambia es el formato impreso. Crear
`remitos` aparte sería duplicar `deliveries` para agregarle un número. Si más
adelante el remito necesita numeración fiscal propia, se le agregan
`remito_number` y `remito_date` a `deliveries` — no una tabla.

---

## G. Máquina de estados

Tu punto 10: no un `status` gigante. **Cuatro estados independientes en el
pedido**, porque son cuatro preguntas distintas que se responden en momentos
distintos.

**Comercial** — dónde está la venta
```
draft → confirmed → cancelled
```

**Cumplimiento (`fulfillment_status`)** — derivado de las entregas
```
pending → partially_reserved → reserved → partially_delivered → delivered
```

**Facturación (`invoicing_status`)** — derivado de las facturas
```
not_invoiced → partially_invoiced → invoiced
```

**Cobro (`payment_status`)** — derivado de las asignaciones de pago
```
unpaid → partially_paid → paid → overdue
```

Los tres últimos **se calculan, no se escriben a mano**. Un pedido está
`partially_delivered` porque existen entregas que cubren parte de las
cantidades, no porque alguien apretó un botón. Guardarlos como columna es
opcional y sólo por performance; la verdad son las líneas.

Estados propios de cada documento: cotización `draft → sent → accepted →
rejected → expired`; OC `received → matched → converted → rejected`; entrega
`draft → shipped → delivered → cancelled`; factura `draft → issued → paid →
cancelled`.

**El legacy mezcla todo en uno solo** (`erp_pedidos: pendiente|parcial|
entregado|cerrada|cancelado`), y por eso no puede expresar «entregado pero sin
facturar» ni «facturado y sin cobrar».

---

## H. Líneas y snapshots

La regla, en una frase: **`product_id` dice a qué apunta la línea;
los campos `_snapshot` dicen qué se vendió.**

| campo | de dónde sale | cuándo cambia |
|---|---|---|
| `product_id` | FK a `products` | nunca |
| `sku_snapshot` | copiado al crear | **nunca** |
| `name_snapshot` | copiado al crear | **nunca** |
| `unit_price` | sugerido por `product_prices` | **nunca** después de crear |
| `kit_components_snapshot` | copiado al crear | **nunca** |

Si mañana cambia el nombre, el precio, la marca o los componentes del kit, la
cotización de hace seis meses sigue diciendo lo que decía. **Nunca se
recalcula una venta histórica.**

`product_id` es nullable a propósito: una OC puede traer una línea que todavía
no matcheó contra nada, y esa línea tiene que poder existir.

**Precio de lista vs. precio acordado vs. descuento** (tu punto 19) van
separados y no se mezclan:

```
list_price_snapshot   lo que decía la lista al cotizar
unit_price            lo que se acordó
discount_pct          el descuento de esa línea
```

Con los tres se puede reconstruir qué pasó. Con `unit_price` solo, no se sabe
si hubo descuento o si se cotizó fuera de lista.

---

## I. Equivalencias de productos por cliente

El flujo, con el legacy como referencia de comportamiento:

1. Llega la OC. Cada línea trae `customer_code` y/o `customer_description`.
2. Se busca en `customer_product_aliases` por `(customer_id, normalized_key)`.
   Si hay uno `confirmed`, se resuelve solo y sube `times_used`.
3. Si no, se propone: por código, por SKU contenido, por similitud de texto.
   El legacy ya tiene un diccionario de sinónimos —`phillips/ph/cruz`,
   `hex/hexagonal/allen`, `embocadura/vaso/socket/bocallave`— que **conviene
   migrar como dato**, no reescribir.
4. La propuesta queda `suggested` con su `confidence`. **No se aplica sola.**
5. Cuando una persona confirma, pasa a `confirmed` con `confirmed_by`.

Esto es lo que el legacy ya hace bien; lo único que cambia es la clave
(`customer_id` en vez del nombre) y que la sugerencia queda registrada en vez
de aplicarse en silencio.

---

## J. Integración con stock

**No se crea un segundo sistema.** Se usa el que hay.

Al confirmar un pedido, por cada línea con stock disponible se inserta en
`stock_reservations` con `source_type = 'sales_order'` y
`source_id = sales_order_lines.id`. Las columnas ya existen.

Las cuatro cantidades de tu punto 11 se **derivan**:

| cantidad | de dónde |
|---|---|
| pedida | `sales_order_lines.quantity_ordered` |
| reservada | `sum(stock_reservations.quantity)` por `source_id` |
| entregada | `sum(delivery_lines.quantity)` por `order_line_id` |
| pendiente | pedida − entregada |

Al entregar: se inserta en `stock_movements` (`movement_type='sale'`) y se
libera la reserva correspondiente. El trigger `trg_stock_apply` que ya existe
actualiza `stock_balances` solo.

**Faltante:** si no hay stock, la línea queda con reserva parcial o sin
reserva. El pedido cae en `partially_reserved` y aparece en «pedidos con
faltante» sin necesidad de un flag.

**Ingreso futuro:** cuando exista Compras, una línea de OC de proveedor podrá
apuntar a una línea de pedido de venta. No lo diseño ahora, pero el modelo no
lo impide.

Una advertencia medida: el trigger de stock es **AFTER INSERT**, así que
borrar un movimiento **no revierte el saldo**. Ya nos mordió en la Fase 3.5.
Cancelar una entrega tiene que generar un movimiento compensatorio, nunca un
DELETE.

---

## K. Entregas parciales

Tu ejemplo, en el modelo:

```
sales_order_lines   id=L1  quantity_ordered = 100
delivery_lines      id=D1  order_line_id=L1  quantity = 30
delivery_lines      id=D2  order_line_id=L1  quantity = 40
                                             pendiente = 30 (derivado)
```

Cada entrega y cada línea tienen id propio y FK. **Ningún índice de array.**
Insertar o borrar una línea del pedido no toca lo ya entregado, que es
exactamente lo que hoy se rompe.

Una entrega puede contener sólo algunas líneas y sólo parte de las cantidades:
`delivery_lines` no tiene que cubrir todas las `sales_order_lines`.

Regla que hay que hacer cumplir en el servidor, no en la UI: la suma de lo
entregado por línea **no puede superar lo pedido**. Va en la función que
registra la entrega, no en un CHECK —porque un CHECK no puede mirar otras
filas—.

---

## L. Números de serie

No existen en el legacy: es construcción nueva, no migración.

```
delivery_serials (id, company_id, delivery_line_id, product_id,
                  serial_number, customer_id, delivery_date, notes)
unique (company_id, product_id, serial_number)
```

Responde tus cuatro preguntas con joins normales:

- **¿A quién se entregó?** → `customer_id`
- **¿Cuándo?** → `delivery_date`
- **¿Con qué pedido?** → `delivery_line → order_line → order`
- **¿Con qué remito?** → `delivery_line → delivery`
- **¿Para qué destino?** → `delivery.shipping_address_id`

Pensado para Servicio Técnico: cuando exista, una orden de trabajo apunta a
`delivery_serials.id` y hereda cliente, fecha y pedido sin copiarlos.

**Sólo para productos serializados.** Hace falta un flag `is_serialized` en
`products` para saber cuáles lo exigen — es la única columna que agregaría al
catálogo, y sólo cuando definas qué productos lo son.

---

## M. Multiempresa y RLS

Las trece tablas llevan `company_id NOT NULL` con FK a `companies`.

Las policies siguen exactamente el patrón que arreglamos en la Fase 3.6, con
las funciones sin argumentos y dentro de un subquery:

```sql
create policy sales_orders_select on sales_orders for select to authenticated
using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or customer_id in (select unnest(app.current_customer_ids()))
  )
);
```

**No repetir el error que ya cometimos dos veces:**

1. **Nunca** `app.is_internal(company_id)` con la columna como argumento: es
   una llamada por fila y ya nos costó 6 s en un `count`.
2. **Siempre** la referencia calificada dentro de un subquery
   (`sales_orders.company_id`), o resuelve contra la tabla del subquery y se
   convierte en una tautología.

Hace falta una función nueva, `app.current_customer_ids()`, para que un
`customer` o un `distributor` vea **sólo sus propios pedidos**. Sin ella, un
cliente externo con acceso vería los de todos.

Una venta de Buscatools no puede aparecer en Torquetools porque el
`company_id` está en la policy, no en el `WHERE` de la consulta.

---

## N. Permisos

No alcanza con esconder botones. Dos capas:

**RLS** para lo que se puede LEER y para las escrituras que son puramente de
fila. **Funciones `SECURITY DEFINER`** para las acciones que tienen reglas de
negocio, porque una policy no puede expresar «confirmar un pedido reserva
stock y numera el documento».

| acción | admin | employee | salesperson | customer / distributor |
|---|---|---|---|---|
| ver cotización | ✓ | ✓ | propias | propias |
| crear / editar cotización | ✓ | ✓ | ✓ | — |
| aprobar cotización | ✓ | — | — | — |
| convertir a pedido | ✓ | ✓ | ✓ | — |
| **ver margen / costo** | ✓ | — | — | **nunca** |
| cancelar pedido | ✓ | — | — | — |
| registrar entrega | ✓ | ✓ | — | — |
| facturar | ✓ | ✓ | — | — |
| registrar cobranza | ✓ | — | — | — |

**El margen y el costo son el caso crítico.** No se resuelve ocultando una
columna en React: si el dato viaja al navegador, está. Se resuelve como ya
hicimos con el stock en el catálogo — **el dato no sale del servidor** para
quien no corresponde. Por eso el costo no va en `sales_order_lines`: va en una
vista o tabla aparte con su propia policy.

---

## O. Estrategia de migración

**No la puedo cerrar sin B.** Lo que sí puedo decir por adelantado:

**Migra fielmente:** cotizaciones, pedidos y notas de entrega con sus líneas
—están sincronizados y tienen estructura estable—, moneda y tipo de cambio
(ya están por documento), y la memoria de equivalencias.

**Necesita transformación:**
- `cliente` (texto) → `customer_id`. Por nombre normalizado, con revisión
  humana de lo ambiguo.
- `sku` (texto) → `product_id`, dejando `sku_snapshot`. Los que no matcheen
  quedan con `product_id NULL`, que el modelo permite a propósito.
- `entregado[idx]` → filas de `delivery_lines`. **Acá está el riesgo real**:
  si el array de items cambió después de registrar una entrega, la
  correspondencia posición↔línea ya no es confiable, y no hay forma de saber
  desde afuera si cambió.

**Está incompleto:** facturas, cobranzas, notas de crédito y contactos sólo
existen en un navegador. Si esa máquina no está disponible, no hay qué migrar.

**No se puede reconstruir con certeza:** qué OC originó cada cotización (la OC
no se guardó como entidad); qué entrega corresponde a qué línea cuando el
array cambió; y el histórico de precios de lista al momento de cada venta.

**Nada de eso se inventa.** Lo que no se pueda reconstruir se marca
`needs_review`, como hicimos con los 12.593 productos de la Fase 3.5.

---

## P. Riesgos y decisiones que necesito de vos

### P1 · El inventario de datos — **bloquea la migración**

Elegí una:

- **(a)** Autorizás una lectura **de sólo lectura** del `erp_store` del
  Supabase legacy, únicamente para contar registros. No escribo nada.
- **(b)** Exportás vos el `localStorage` desde el navegador que tiene los
  datos completos (el que tiene facturas y recibos) y me pasás el JSON.
- **(c)** Diseñamos sin migración histórica y arrancamos Ventas en cero.

Sin una de las tres, O queda como está: incompleto y honesto.

### P2 · Facturas y cobranzas sin respaldo — **riesgo operativo hoy**

No sincronizan a ningún servidor. Están en un navegador. Esto no es un
problema de la Fase 4: es un problema de esta semana. **¿Querés que la primera
entrega sea un export de esos datos, antes que cualquier tabla nueva?**

### P3 · El token público del legacy

`SUPA_APP_TOKEN` está hardcodeado en `app.js`, que es público, y es el header
que autoriza escribir en `erp_store`. ¿Lo rotás? ¿Querés que audite qué
permite exactamente antes de decidir? (Sería una lectura del legacy: cae bajo
P1.)

### P4 · Decisiones de modelo

1. **¿El remito necesita numeración fiscal propia?** Si sí, son dos campos en
   `deliveries`; si no, es la impresión de la entrega y no lleva nada.
2. **¿Qué productos son serializados?** Sin esa lista, `is_serialized` no se
   puede poblar y los números de serie quedan como campo libre.
3. **¿El IVA es siempre 21 %?** El legacy lo tiene hardcodeado. Si hay
   exentos, alícuotas reducidas o percepciones de IIBB por provincia, el
   modelo fiscal es más grande que un `tax_rate` por línea y prefiero
   diseñarlo con los casos reales a la vista.
4. **¿Un pedido puede tener líneas de dos monedas?** Propongo que no: la
   moneda va en la cabecera. Confirmame.
5. **¿Quién aprueba una cotización?** Puse «sólo admin» en N. Si Facundo o
   Norberto tienen que poder, cambia la matriz.

### P5 · Auditoría sin repetir los 984 MB

El `audit_logs` del legacy llegó a 984 MB registrando cada UPDATE. La
propuesta es **no auditar cambios de campo**, sino **transiciones de estado y
acciones de negocio**:

```
sales_audit (id, company_id, entity_type, entity_id, action,
             from_status, to_status, actor_id, created_at, detail jsonb)
```

Una fila cuando un pedido se confirma, se cancela, se entrega, se factura o se
cobra. No una fila por cada tecla. Estimado: decenas de filas por pedido, no
miles.

`created_at`/`created_by`/`updated_at` ya están en las tablas; para «quién
modificó» alcanza con `updated_by`, sin historial completo.

**¿Te sirve ese nivel, o necesitás poder reconstruir el valor anterior de un
campo?** Si necesitás lo segundo, es otro diseño y cambia el volumen.

---

## Lo que NO hice

No creé tablas. No migré datos. No escribí UI. No toqué el legacy. No
modifiqué producción. No leí el Supabase legacy ni las credenciales de
`Downloads`.
