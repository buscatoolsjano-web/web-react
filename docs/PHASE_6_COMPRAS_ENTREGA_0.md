# Fase 6 · Compras — entrega 0: export y auditoría real de datos

Export de sólo lectura del origen legacy y medición de lo que hay. **No se
creó ninguna tabla, no se programó UI, no se modificó nada del legacy.**

---

## El resultado, en una línea

**Compras no tiene datos que migrar.** Hay **un** pedido de compra, de prueba,
vacío. Las claves de recepciones y facturas de proveedor **ni siquiera
existen**. El único maestro real son los **142 proveedores**, y no están en
`localStorage`: están embebidos en el HTML.

---

## 1 · Export

| | |
|---|---|
| origen | `https://buscatoolsjano-web.github.io` · `localStorage` del Chrome real de este equipo |
| ruta de entrada | `/Buscatools/manifest.webmanifest` — **no se cargó `app.js`**, así que nada pudo disparar sincronización |
| método | `Object.keys(localStorage)` y `getItem()`. **Ningún `setItem`, `removeItem` ni `clear`** |
| momento | 2026-09-10T12:01:56Z |
| claves totales en el origen | **53** |
| guardado en | `C:\Users\janog\backups-legacy\compras-2026-09-10\` — **fuera del repo** |

### Lo exportado

| clave | archivo | bytes | tipo | registros | sha256 |
|---|---|---:|---|---:|---|
| `erp_pedidos_compra` | `erp_pedidos_compra.json` | 395 | array | **1** | `81a02598…6156b394` |
| `erp_facturas` | `erp_facturas.json` | 2 | array | **0** | `4f53cda1…1202b945` |

### Lo que **no existe** en el origen

```
erp_proveedores        AUSENTE
erp_notas_proveedor    AUSENTE
erp_facturas_prov      AUSENTE
```

No están vacías: **no existen como clave**. Es la diferencia entre «se usó y
se borró todo» y «nunca se usó».

Comprobado además que no hay variantes por empresa: listando los nombres de
las 53 claves, las únicas relacionadas con Compras o stock son
`erp_facturas`, `erp_kardex`, `erp_pedidos_compra` y `erp_stock_deltas`. No
hay ningún `erp_proveedores__erpemp_*` ni equivalente.

`erp_kardex` y `erp_stock_deltas` **no se leyeron**: no estaban entre las
cinco claves autorizadas. `erp_kardex` ya se conocía del backup de Ventas
(22 filas).

---

## 2 · Resultados A – S

| | qué | resultado |
|---|---|---|
| **A** | proveedores | **142** (embebidos en el HTML, no en `localStorage`) |
| **B** | pedidos de compra | **1** |
| **C** | líneas de pedido | **1** |
| **D** | recepciones / NEP | **0** — la clave no existe |
| **E** | líneas recibidas | **0** |
| **F** | facturas de proveedor | **0** — la clave no existe |
| **G** | rango de fechas | un solo documento: **2026-08-13** (creado el 2026-08-11) |
| **H** | numeración real | proveedores `PROV00001`…`PROV00145`, 142 usados, **3 huecos**, todas únicas y con formato. Pedidos: `PC00001`, el primero y único. NEP y FP: **nunca se emitió ninguno** |
| **I** | estados | el único PC está en `pendiente` |
| **J** | monedas | **el campo no existe**. Ni en el pedido ni en las líneas. Ver punto 4 |
| **K** | IVA almacenado | `iva: true` — un **booleano**, no una alícuota |
| **L** | documentos afectados por el bug del 1 % | **0**. El bug está en `generarNotaProvDesdePedidoCompra`, que nunca se ejecutó porque no hay ninguna NEP. Ver punto 3 |
| **M** | relaciones PC → NEP | **0** |
| **N** | relaciones NEP → FP | **0** |
| **O** | arrays `entregado[idx]` | **0**. El único PC no tiene ni siquiera la propiedad `entregado` |
| **P** | calidad del maestro de proveedores | ver punto 5 |
| **Q** | migrable fielmente | los 142 proveedores: referencia, razón social, nombre comercial, teléfono, dirección (como texto), forma de pago, notas |
| **R** | necesita revisión | las 60 notas con fichas de contacto adentro; las 20 direcciones que son sólo «AR»; los teléfonos con formatos mezclados |
| **S** | no reconstruible | CUIT (**ninguno de los 142 lo tiene**), email en su campo (**ninguno**), actividad (**ninguna**), y todo el circuito PC → recepción → factura, que nunca se usó |

---

## 3 · El bug del IVA al 1 %: no afectó a ningún dato

El bug es real y está en el código —`Number(pc.iva)` con `iva: true` da `1`, o
sea 1 % en vez de 21 %— pero vive en `generarNotaProvDesdePedidoCompra`, y
**no hay ninguna nota de entrega de proveedor**. Nunca corrió.

Así que la decisión de preservar el histórico exacto con
`review_reason = LEGACY_VAT_CALCULATION_BUG` **no tiene a qué aplicarse hoy**.
Queda registrada por si aparece otro perfil o un backup más viejo con NEPs
adentro: en ese caso se preserva subtotal, IVA y total originales tal cual, se
marca, y no se convierte nada.

Lo que sí hay que hacer, y es lo importante: **el modelo nuevo no puede
reproducir ese bug**. La alícuota se guarda como número por línea y los totales
los calcula el servidor, igual que en Ventas.

---

## 4 · Moneda: el campo no existe

Medido, no supuesto. El único pedido de compra es:

```json
{"proveedor":"","titulo":"Pedido a proveedor","fecha":"2026-08-13",
 "items":[{"sku":"TE.X-LIGHT.3","nombre":"TECNA X-LIGHT.3 - BALANCEADOR DE 2.0 A 3.0 KG",
           "desc":"…","qty":1,"price":0,"dto":0}],
 "formaPago":"","iva":true,"iibb":false,"dtoGlobal":0,
 "estado":"pendiente","stockApplied":false,"creadoPor":"ADMIN",
 "created":1786647370628,"ref":"PC00001"}
```

**No hay `moneda` ni en la cabecera ni en la línea.** El código muestra «USD»
escrito a mano en los mensajes, pero eso es la interfaz, no el dato.

Como pediste: **no se convierte eso en `currency = USD`**. Para el diseño, el
campo va a existir y va a ser obligatorio en los documentos nuevos; para el
único histórico, queda **sin moneda**, igual que los 32 documentos de Ventas
que tampoco la tienen.

---

## 5 · Calidad del maestro de proveedores

142 registros, todos con referencia única y bien formada.

| campo | con dato | de 142 |
|---|---:|---|
| `ref` | **142** | numeración `PROV00001`–`PROV00145`, 3 huecos |
| `nj` razón social | **142** | ninguna repetida, ni normalizando |
| `nc` nombre comercial | 113 | |
| `direccion` | 142 | pero ver abajo |
| `agente` | 142 | **siempre «BUSCATOOLS»** — el campo no distingue nada |
| `formaPago` | 139 | **13 valores distintos**, texto libre |
| `tel` | 115 | formatos mezclados: `47247600`, `(341) 526-3888`, `11 4766 7915 int. 106` |
| `notas` | 60 | |
| **`cif` (CUIT)** | **0** | **ninguno** |
| **`email`** | **0** | **ninguno** |
| **`actividad`** | **0** | **ninguna** |

### Las direcciones son semiestructuradas

122 de 142 tienen la forma `calle · localidad · provincia · CP · país`:

```
Hipolito Yrigoyen 1225 General Pacheco Buenos Aires · Pacheco · Buenos Aires · AR
```

Las otras **20 son sólo el país** («AR»). Países detectados: AR 136, ES 2,
IT 2, UY 1, US 1 — o sea, **hay proveedores del exterior**, lo cual refuerza
que la moneda va a hacer falta en los documentos nuevos.

Como pediste: **la dirección se conserva como texto tal cual**. Que 122 tengan
separadores no la convierte en estructurada, y partirla por « · » sería una
suposición.

### Los emails y los contactos están escondidos en las notas

De las 60 notas, **43 parecen fichas de contacto** (tienen saltos de línea) y
**18 contienen al menos un email** — 22 direcciones en total. Por ejemplo:

> Mauricio Mendez / Comercial / Ejecutivo de cuentas / DHL Express Argentina /
> Larrazábal 2255 / C1440 CABA / Argentina / Teléfono…

O sea: el campo `email` está vacío en los 142, pero **hay 22 emails escritos
adentro de `notas`**. Eso es exactamente el mismo caso que los 87 contactos de
Clientes, y merece el mismo trato: **no extraerlos automáticamente**. Se migra
la nota tal cual, y si alguna vez se quieren como contactos, se hace con
revisión humana.

### Forma de pago: 13 valores distintos

`FOB 180 DIAS` · `100% ANTICIPADO` · `50% adelanto 50% 30 dias contra` ·
`MERCADOPAGO` · `TRANSFERENCIA BANCARIA` · `30 DIAS F/F con ECHEQ` ·
`TARJETA DE CREDITO AMEX` · `ExWorks 30 dais FF` ·
`CONTADO CONTRA ENTREGA` · `Efectivo` · `CUENTA CORRIENTE` ·
`CUENTA CORRIENTE 30 DIAS` · …

Hay de todo mezclado: incoterms, medios de pago y plazos, con erratas
(«dais»). **Se migra como texto**, igual que `payment_terms` en clientes. No se
inventa una taxonomía.

---

## 6 · Qué significa esto para el plan

El plan de seis entregas que propuse **cambia de forma**, porque no hay
migración de datos que hacer salvo los proveedores:

| entrega | qué cambia |
|---|---|
| **0 · export** | ✅ hecha. No hay datos de compras |
| **1 · schema** | igual de necesaria, pero **se diseña sin la presión del histórico**: nada que preservar, nada que reconstruir. Es la primera vez en todo el proyecto que podemos hacerlo bien de entrada |
| **2 · proveedores** | **es la única migración de datos real**: 142 registros |
| **3 · pedidos de compra** | **funcionalidad nueva**, no migración. El único PC existente es una prueba vacía |
| **4 · recepciones** | ídem: nada que migrar, todo por construir |
| **5 · facturas de proveedor** | ídem |
| **6 · cierre** | igual |

Y hay una consecuencia que conviene decir en voz alta: **Compras en el legacy
está prácticamente sin usar**. Cuatro pantallas implementadas, tres
placeholders, y un solo documento de prueba en un año. Vale la pena confirmar
con quien vaya a usarlo **cómo se compra hoy de verdad** —quizá por mail y
planilla— antes de reproducir un circuito que nadie ejerció. Si el circuito
PC → recepción → factura es el que se quiere, se construye; pero se construye
como funcionalidad nueva y bien, no como copia de algo que no se probó contra
la realidad.

---

## 7 · Lo que quedó registrado en el backlog

- **Pagos a proveedor** (`supplier_payments`, asignaciones, tesorería): fuera
  de alcance, segunda pasada.
- **Compras ↔ Ventas** como `procurement_allocations` N:N a nivel de línea
  (`purchase_order_line_id`, `sales_order_line_id`, `quantity_allocated`):
  funcionalidad nueva, segunda pasada. **No se reconstruye históricamente**, y
  ahora sabemos que además no habría con qué: hay un solo pedido de compra.
- **Recibos de proveedor, tickets y libro de facturas recibidas**:
  `NOT_MIGRATED_BY_DESIGN` · `LEGACY_PLACEHOLDER`.
- **Importador de PDF de Compras**: no se construye; el que existe es de la OC
  del cliente y pertenece a Ventas.
- **Los 22 emails y las 43 fichas de contacto dentro de `notas`** de
  proveedores: revisión humana si alguna vez se quieren como contactos.

---

## 8 · Lo que hace falta decidir antes de la entrega 1

1. **¿Se construye el circuito completo** PC → recepción → factura, sabiendo
   que en el legacy nunca se usó? ¿O se arranca sólo por **proveedores** y se
   define el resto con quien vaya a comprar?
2. **Moneda**: los documentos nuevos, ¿llevan moneda obligatoria por documento
   como en Ventas? (Hay proveedores en ES, IT, UY y US, así que parece que sí.)
3. **Depósito**: hoy hay **uno solo** por empresa. ¿La recepción elige depósito
   o va siempre al principal?
4. **Sobre-recepción**: recibir más de lo pedido, ¿se bloquea, se permite o se
   marca? En Ventas la sobre-entrega se rechaza y el histórico quedó exento.
