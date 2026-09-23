# Fase 24 · E0 — Facturación de venta: qué hay de verdad

**Auditoría. No se implementó nada, no se importó nada, no se tocó producción.**

```
DB_CHANGES_APPLIED = 0
PROD_DATA_CHANGED  = 0
STEL_WRITES        = 0
```

---

## 0. Tres cosas que cambian el planteo

Antes del detalle, lo que encontré y que conviene leer primero:

1. **Las tablas ya existen.** `sales_invoices`, `sales_invoice_lines`,
   `payments` y `payment_allocations` están en el esquema desde antes, con
   `external_source` / `external_id` / `synced_at`. Están **vacías**.
   Mi auditoría de F23 dijo «no existen como documento, ni pantalla, ni
   tabla». Eso era incorrecto: no existe la pantalla, y no hay datos, pero el
   modelo está.

2. **STEL tiene facturas y no las podemos leer.** El recurso `invoices`
   existe en la API y devuelve **HTTP 403 «Insufficient permissions»**. No es
   que no esté: es que esta clave no tiene el permiso. Sin ese acceso no hay
   importación posible, ni dry run con números reales.

3. **El módulo de facturación del legacy parece no haberse usado nunca.** La
   evidencia está en §5 y no es concluyente al 100 %, pero apunta fuerte en
   esa dirección — y si se confirma, F24 es mucho más chica de lo que F23
   suponía.

---

## 1. El flujo del legacy (§2)

```
LEGACY_INVOICE_FLOW =
  remito → «→ Generar factura» (#ne-gen-factura, app.js:23642)
         → generarFacturaDesdeNotaEntrega (app.js:27042)
         → copia cliente, título, líneas y totales del remito
         → número LOCAL: nextFactRef() → «FC00001», un contador propio
         → vencimiento = hoy + 30 días
         → estado 'pendiente'
         → marca el remito como 'facturada' y le pone facturaRef
         → guarda en localStorage: erp_facturas

LEGACY_PAYMENT_FLOW =
  crearRecibo(facturaRef, monto, fecha, formaPago, notas)  (app.js:26793)
         → número local «RC…», ligado a UNA factura
         → llama a actualizarEstadoFactura()
         → guarda en localStorage: erp_recibos

LEGACY_CREDIT_NOTE_FLOW =
  crearNotaCredito(facturaRef, monto, fecha, motivo)  (app.js:26815)
         → número local «NC…», ligado a UNA factura
         → NO es una factura negativa: es un monto que baja el saldo
         → guarda en localStorage: erp_notas_credito
```

**La regla de saldo** (`actualizarEstadoFactura`, app.js:26773) es explícita
y vale la pena copiarla tal cual:

```
total efectivo = total de la factura − notas de crédito
si cobrado ≥ total efectivo − 0,01  →  'pagada'  (+ paidDate)
si estaba 'pagada' y deja de estarlo →  vuelve a 'pendiente'
'cancelada' no se toca nunca
```

```
PARTIAL_PAYMENTS     = SÍ. Varios recibos por factura; el saldo es
                       total − NC − Σ recibos. NO es un booleano `pagada`.
CREDIT_NOTE_BEHAVIOR = baja el saldo de UNA factura. No es un comprobante
                       independiente ni una factura en negativo.
```

### Lo que el legacy NO tiene

Busqué en las 45.259 líneas de código (excluidas las de imágenes en base64):

| | apariciones |
|---|---|
| `AFIP` | 0 |
| `CAE` | 0 |
| punto de venta / `ptoVta` | 0 |
| tipo de comprobante (A/B/C) | 0 |
| facturación electrónica | 0 |

```
LEGACY_INVOICE_BEHAVIOR = REGISTRO INTERNO. No emite nada fiscal.
                          El número «FC00001» es un contador en localStorage.
```

---

## 2. STEL (§3)

Probé, **sólo con GET**, todos los nombres de recurso plausibles:

| recurso | resultado |
|---|---|
| `salesEstimates` (cotizaciones) | **OK** |
| `salesOrders` (pedidos) | **OK** |
| `salesDeliveryNotes` (remitos) | **OK** — y no estaba en la integración actual |
| **`invoices`** | **HTTP 403 · Insufficient permissions (E000006)** |
| `salesInvoices` | 404 |
| `salesCreditNotes` · `creditNotes` · `refunds` · `salesRefunds` | 404 |
| `receipts` · `salesReceipts` · `payments` · `collections` · `charges` · `incomes` | 404 |
| `salesInvoicePayments` · `invoicePayments` · `dueDates` · `maturities` | 404 |

```
STEL_INVOICE_SOURCE     = recurso `invoices`, EXISTE pero devuelve 403 con
                          la clave actual. No se pudo leer ni un registro.
STEL_CREDIT_NOTE_SOURCE = no se encontró ningún recurso (404 en 4 nombres)
STEL_PAYMENT_SOURCE     = no se encontró ningún recurso (404 en 6 nombres)
```

**Lo que esto significa.** No puedo contestar §4 con números reales:

```
STEL_SALES_INVOICES   = DESCONOCIDO (403)
STEL_CREDIT_NOTES     = DESCONOCIDO (sin recurso)
STEL_RECEIPTS         = DESCONOCIDO (sin recurso)
STEL_PAYMENTS         = DESCONOCIDO (sin recurso)
STEL_OPEN_RECEIVABLES = DESCONOCIDO

INVOICE_DELIVERY_LINK_COVERAGE = DESCONOCIDO
INVOICE_ORDER_LINK_COVERAGE    = DESCONOCIDO
INVOICE_CUSTOMER_LINK_COVERAGE = DESCONOCIDO
PAYMENT_INVOICE_LINK_COVERAGE  = DESCONOCIDO
```

**Cómo se destraba:** pedir el permiso de lectura del módulo de facturación
para la clave de API de STEL. Es un cambio de configuración en STEL, no de
código. Hasta que exista, cualquier diseño de importación se apoya en
suposiciones sobre la forma del dato.

Que no haya recursos de notas de crédito ni de cobros en la API es una
segunda pregunta para STEL: puede ser que el plan contratado no los exponga,
o que no existan en su modelo.

---

## 3. Lo que sincroniza el legacy

El legacy escribe su `localStorage` a **otro proyecto de Supabase**
(`hnyngsejohkmlaccpkux`, «Buscatools»), en una tabla llave-valor `erp_store`.
No es el proyecto del ERP React.

Las 30 claves que hay ahí, ordenadas por tamaño:

| clave | elementos |
|---|---|
| `erp_trazabilidad_log` | 2.000 |
| `erp_traz_ADMIN` | 1.627 |
| `erp_cotizaciones` | 313 |
| `erp_notas_entrega` | 204 |
| `erp_pedidos` | 180 |
| `erp_contactos` | 87 |
| `erp_kardex` | 22 |
| `erp_client_leads` | 6 |
| `erp_client_solicitudes` | **1** |
| `erp_client_carrito` | 0 |

**No están** `erp_facturas`, `erp_recibos`, `erp_notas_credito` ni
`erp_finanzas_rates`.

**Pero eso no prueba que no se hayan usado**, y la distinción importa: la
lista `SUPA_SYNC_KEYS` (app.js:1176) **no incluye ninguna de esas cuatro
claves**. Si se crearon facturas, quedaron en el navegador que las creó y
nunca se subieron.

---

## 4. La evidencia indirecta: los 204 remitos

Como las facturas no se sincronizan pero los remitos sí, y el legacy marca el
remito al facturarlo, se puede preguntar por ese lado:

| estado del remito | cantidad | con `facturaRef` |
|---|---:|---:|
| `facturada` | 140 | **0** |
| `pendiente` | 43 | 0 |
| `pendiente de facturar` | 21 | 0 |

`generarFacturaDesdeNotaEntrega` pone **las dos cosas**: `estado='facturada'`
**y** `facturaRef`. Hay 140 remitos «facturada» y **ninguno** con
`facturaRef`.

Es decir: **esos 140 no los marcó el botón «Generar factura».** Los marcó
alguien a mano, con el desplegable de estado del editor de remitos
(app.js:23710).

Y «pendiente de facturar» —los otros 21— **no existe en el código del
legacy**: no aparece ni una vez. Viene de afuera, es decir de la importación
de STEL.

```
CURRENT_BUSINESS_AUTHORITY = STEL.
  El legacy trata «facturado» como un ESTADO del remito, puesto a mano,
  no como un documento propio. La factura de verdad se emite en STEL.
```

**Esto es fuerte pero no concluyente.** Lo que falta para cerrarlo:

> **Para Juan:** abrir el HTML legacy, ir a Facturación, y decirme cuántas
> facturas, recibos y notas de crédito hay en el listado. Si son cero, queda
> demostrado. Si hay, están sólo en ese navegador y hay que exportarlas antes
> de apagar el legacy — sería el único dato del sistema que no está en
> ninguna base.

---

## 5. ¿Emitir o registrar? (§5)

```
RECOMMENDED_MODE = REGISTER_ONLY
```

Con cuatro razones, en orden de peso:

1. **El legacy tampoco emite.** No hay AFIP, ni CAE, ni punto de venta. Su
   «factura» es un documento comercial con numeración propia. Replicar eso en
   React no aporta paridad fiscal porque no había paridad fiscal.
2. **STEL es quien factura.** El estado «pendiente de facturar» de 21 remitos
   viene de STEL, no del legacy.
3. **Emitir fiscalmente es otro proyecto.** Certificado, homologación,
   numeración autorizada, contingencia, libro IVA. Nada de eso está en el
   alcance de «recuperar paridad».
4. **El modelo ya está preparado para registrar.** `sales_invoices` tiene
   `external_source`, `external_id`, `external_number`, `external_status` y
   `synced_at`. Eso es el diseño de un registro, no de un emisor.

**No implemento emisión sin tu aprobación explícita**, y mi recomendación es
que no se apruebe en F24.

---

## 6. El esquema (§6)

```
SCHEMA_CURRENT = existe y está vacío
```

| tabla | columnas | filas | procedencia |
|---|---:|---:|---|
| `sales_invoices` | 26 | 0 | `external_source`, `external_id`, `external_number`, `external_status`, `synced_at` |
| `sales_invoice_lines` | 14 | 0 | enlaza a `order_line_id` y `delivery_line_id` |
| `payments` | 15 | 0 | `external_source`, `external_id`, `synced_at` |
| `payment_allocations` | 7 | 0 | imputación pago → factura, con `amount` |

`payment_allocations` **ya modela el pago parcial correctamente**: un pago se
imputa a una o varias facturas por monto. No hay ningún booleano `pagada`.
Coincide con lo que hace el legacy.

```
SCHEMA_REQUIRED = tres faltantes, ninguno urgente hasta destrabar el 403

  1. sales_credit_notes — no existe. Hoy no hay dónde poner una NC.
     El legacy la modela como {facturaRef, monto, motivo}: es una imputación
     negativa, no una factura. Podría entrar como un tipo más en
     `payment_allocations`, pero eso hay que decidirlo con el dato real de
     STEL a la vista, no antes.

  2. Un lugar para el tipo de cambio. Hoy `exchange_rate` es una columna por
     documento y no hay tabla de cotizaciones. Ver §7.

  3. Nada más. No hace falta inventar tablas de «cuentas por cobrar»:
     el saldo se calcula (total − NC − Σ imputaciones), como en el legacy.
```

---

## 7. Tipo de cambio (§10)

```
FX_SOURCE = dolarapi.com, API pública, sin credenciales.
            `fetchRates()` (app.js:28248) trae oficial/blue/bolsa/ccl/
            mayorista y EUR; guarda en localStorage `erp_finanzas_rates`;
            se refresca solo si tiene más de 6 horas.

LA REGLA   = la moneda base del catálogo es USD.
             `tc` significa «1 USD = tc <moneda>», se guarda EN EL DOCUMENTO
             y se puede editar a mano (app.js:20004, `_defaultTC`).
             Por omisión: ARS → dólar oficial; EUR → 1/eurUsd.
             Si no hay cotización: ARS = 1000, EUR = 0,92 escritos en el
             código.
```

**Medido en React:**

| tabla | moneda | documentos | con `exchange_rate` |
|---|---|---:|---:|
| `sales_quotes` | USD | 255 | 1 |
| `sales_quotes` | ARS | 51 | 1 |
| `sales_quotes` | EUR | 1 | 0 |
| `sales_orders` | USD | 144 | 0 |
| `sales_orders` | ARS | 29 | 0 |
| `deliveries` | USD | 153 | 0 |
| `deliveries` | ARS | 41 | 0 |

```
FX_COVERAGE = 2 de 674 documentos (0,3 %).
              121 documentos están en ARS y ninguno tiene tipo de cambio.
```

Hoy eso no causa un error porque **F21 decidió no sumar monedas distintas**:
los informes muestran cada moneda por separado. La regla se sostiene por no
convertir, no por tener cotizaciones.

Para cuentas por cobrar hace falta decidir una cosa que el legacy resolvió
mal: **usa el dólar del día en que se mira**, no el del día de la factura.
Eso hace que el saldo de una factura vieja cambie solo. Lo correcto es
guardar el `exchange_rate` al registrar y no recalcularlo. La columna ya
existe para eso.

---

## 8. Portal del cliente (§17)

```
PORTAL_USERS            = 2 en React (1 customer, 1 distributor)
PORTAL_ACTIVE_LAST_30D  = 2
PORTAL_ACTIVE_LAST_90D  = 2
PORTAL_QUOTES           = 0
PORTAL_LAST_ACTIVITY    = 2026-09-14
```

Los dos usuarios son **«Cliente Demo S.A.»** y **«Distribuidor Demo
S.R.L.»**, creados el 2026-09-08, con último ingreso el 2026-09-14 con
cuatro segundos de diferencia entre uno y otro, y **cero documentos
creados**. Son cuentas de prueba.

Del lado legacy, en el almacén sincronizado:

```
erp_client_accounts     = 1 objeto (1.128 bytes)
erp_client_solicitudes  = 1 elemento
erp_client_leads        = 6 elementos
erp_client_carrito      = 0 elementos
```

**Una solicitud. Seis leads. Un carrito vacío.**

```
VEREDICTO = candidato a OBSOLETE, no BLOCKER.
```

F23 lo marcó HIGH por su capacidad; el uso real no lo sostiene. Antes de
reconstruirlo conviene preguntar a quién se le dio acceso y si alguien lo
usó alguna vez — una solicitud en toda la vida del sistema es más compatible
con «se probó» que con «se usa».

---

## 9. Email (§16)

```
EMAIL_LEGACY_BEHAVIOR = mailto:. La sección ENVIAR DOCUMENTO POR MAIL
                        (app.js:37282) arma un cuerpo de texto y abre el
                        cliente de correo. NO adjunta el PDF: mailto: no
                        puede. 5 apariciones en todo el archivo.

EMAIL_RECOMMENDED_ARCHITECTURE = backend propio (F9, Cloud Run), con adjunto
                        y traza. React ya lo tiene andando para la bandeja.
```

Replicar `mailto:` sería copiar una limitación, no una capacidad: hoy el
vendedor abre Outlook y adjunta el PDF a mano. **No lo implemento en F24**,
como pediste: queda para cuando se defina el alcance de VE-15/CO-10.

---

## 10. Dry run (§18)

```
WOULD_IMPORT_INVOICES     = 0
WOULD_IMPORT_LINES        = 0
WOULD_IMPORT_CREDIT_NOTES = 0
WOULD_IMPORT_PAYMENTS     = 0
WOULD_IMPORT_ALLOCATIONS  = 0

MATCHED_CUSTOMERS   = n/d      UNMATCHED_CUSTOMERS  = n/d
MATCHED_DELIVERIES  = n/d      UNMATCHED_DELIVERIES = n/d
MATCHED_ORDERS      = n/d      UNMATCHED_ORDERS     = n/d
AMBIGUOUS           = n/d
```

**No hay dry run posible**, y no es una omisión: no hay de dónde leer. STEL
devuelve 403 y el legacy no sincroniza sus facturas. Un dry run con datos
inventados no serviría para decidir nada.

---

## 11. Lo que hay que hacer antes de E1

Tres cosas, y ninguna es de programar:

1. **Pedir a STEL el permiso de lectura de facturación** para la clave de
   API. Sin eso F24 no puede avanzar a importar.
2. **Mirar el listado de Facturación del legacy** y decirme cuántas facturas,
   recibos y notas de crédito hay. Si hay, son el único dato del sistema que
   no está en ninguna base y hay que exportarlo antes de apagar nada.
3. **Confirmar que no vamos a emitir fiscalmente desde React** en esta fase.

Con las tres contestadas, E1 es: modelar `sales_credit_notes`, escribir el
importador idempotente contra `invoices`, y las pantallas de lectura. Sin
ellas, cualquier cosa que escriba ahora se apoya en una suposición sobre la
forma del dato de STEL.

---

## 12. Aparte: un secreto en un repositorio público

Mientras leía el `app.js` del legacy encontré, en texto plano y versionadas
en **`github.com/buscatoolsjano-web/Buscatools`, que es público**:

- la URL y la clave anónima del proyecto Supabase `hnyngsejohkmlaccpkux`;
- un token de aplicación propio (`SUPA_APP_TOKEN`), que es lo que la política
  de RLS de `erp_store` usa para autorizar — el comentario del propio código
  dice que sin ese header la clave anónima sola no alcanza.

Es decir: **cualquiera que clone ese repositorio puede leer y escribir
`erp_store`**, que hoy tiene 313 cotizaciones, 204 remitos, 180 pedidos,
87 contactos y los hashes de contraseñas de `erp_auth_users` y
`erp_client_accounts`.

No lo toqué, no probé el acceso y no repito los valores acá. **No es algo que
introduzca esta migración** —es del legacy— pero mientras el legacy siga
prendido, sigue expuesto. Rotar esa clave y ese token es independiente de
F24 y no debería esperar a que termine.

---

## Resumen

| | |
|---|---|
| ¿El legacy emite facturas fiscales? | **No.** Ni AFIP, ni CAE, ni punto de venta |
| ¿El legacy usó su módulo de facturación? | **Probablemente no.** 140 remitos «facturada» sin un solo `facturaRef` |
| ¿Quién factura de verdad? | **STEL** |
| ¿Podemos leer esas facturas? | **No.** 403 Insufficient permissions |
| ¿Existe el modelo en React? | **Sí**, y vacío |
| ¿Se puede importar hoy? | **No**, y por eso el dry run da 0 |
| ¿El portal del cliente es un bloqueante? | **Probablemente no.** 1 solicitud, 6 leads, 2 cuentas demo |
