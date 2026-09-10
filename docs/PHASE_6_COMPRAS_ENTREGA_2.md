# Fase 6 · Compras — Entrega 2: proveedores

Estado: **EJECUTADA**. Los 142 proveedores del maestro legacy están migrados y
tienen pantalla: listado, ficha, alta, edición, baja lógica y adjuntos.

No se empezó nada de lo que quedaba fuera de alcance: **no** hay pedidos de
compra, **ni** recepciones, **ni** facturas de proveedor, **ni** Mantenimiento.

| | |
|---|---|
| SQL aplicado | [`docs/database/PHASE_6_PURCHASES.sql`](database/PHASE_6_PURCHASES.sql) |
| Migración de datos | [`scripts/fase6-migrar-proveedores.mjs`](../scripts/fase6-migrar-proveedores.mjs) |
| Suite | [`scripts/fase6-proveedores-tests.mjs`](../scripts/fase6-proveedores-tests.mjs) |
| Rutas | `#/compras/proveedores` · `#/compras/proveedores/nuevo` · `#/compras/proveedores/:id` |

Migraciones nuevas:

| versión | nombre |
|---|---|
| 20260910125441 | `fase6_proveedores_pais_y_adjuntos` |
| 20260910131825 | `fase6_proteger_borrado_proveedor` |

La segunda no estaba en el plan: salió de un test que falló. Está en **I**.

---

## A · Proveedores migrados — 142 de 142

Todos, sin excepciones ni pendientes.

| | |
|---|---:|
| en el maestro legacy | **142** |
| migrados | **142** |
| con referencia legacy única y bien formada | **142** |
| con `imported_at` y `legacy_source` | **142** |
| marcados para revisión | **19** |
| duplicados | **0** |
| sin resolver | **0** |
| dados de baja | **0** |

Los 142 están **embebidos en el HTML del legacy**, no en `localStorage`: la
clave `erp_proveedores` no existe en el origen. Se leen del bloque
`<script id="proveedores-data">`, que es lo que documentó la entrega 0.

A diferencia de Clientes, acá **no hubo nada que cruzar**: `suppliers` arrancó
vacía y la referencia legacy es única y está bien formada en los 142. Ni una
sola regla de matching por CUIT, email, dominio o nombre normalizado.

## B · Reconciliación

Campo por campo, contra el HTML, **142 iguales en los diez**:

| legacy → columna | con dato | iguales |
|---|---:|---:|
| `ref` → `legacy_ref` | 142 | 142 |
| `nj` → `legal_name` | 142 | 142 |
| `nc` → `trade_name` | 113 | 142 |
| `cif` → `tax_id` | **0** | 142 |
| `email` → `email` | **0** | 142 |
| `tel` → `phone` | 115 | 142 |
| `direccion` → `address_text` | 142 | 142 |
| `actividad` → `activity` | **0** | 142 |
| `agente` → `agent` | 142 | 142 |
| `formaPago` → `payment_terms` | 139 | 142 |
| `notas` → `notes` | 60 | 142 |

**Los tres campos vacíos siguen vacíos.** El legacy no tiene ni un CUIT, ni un
email en el campo email, ni una actividad en los 142 registros. En la base hay
**0**, **0** y **0**. No se inventó ninguno, y está probado con una aserción
propia, no supuesto.

### La numeración

`PROV00008`…`PROV00145`, 142 usadas, **3 huecos: 41, 93 y 121**. Los tres
siguen vacíos y se prueba uno por uno. Próxima referencia: **146**, que es
donde la entrega 1 dejó la secuencia. Un hueco es información —dice que ahí
hubo algo que se borró—, no un lugar libre.

### La dirección

Se guarda **entera y literal**, con separadores y todo. 122 tienen la forma
`calle · localidad · provincia · CP · país` y **ninguna se partió**:

```
Direccion: Av.Saenz Peña 2227 · San Martin · BUENOS AIRES · CP 1651 · AR
```

Eso es exactamente lo que hay en `address_text` de `PROV00008`, y la suite lo
compara carácter por carácter.

### El país: lo único que se separó, y por qué

`suppliers` **no tenía ningún campo estructurado de dirección** —sólo
`address_text`—, así que no había nada que llenar automáticamente. Se agregó
**una** columna: `country_code`.

No es intuición. Los 142 registros, sin una sola excepción, o **son** un código
de dos letras (20 de ellos) o **terminan** en ` · ` más un código de dos letras
(los otros 122). La regla es estricta —exactamente dos mayúsculas, si no
devuelve `null`— y da:

| AR | ES | IT | UY | US | sin país |
|---:|---:|---:|---:|---:|---:|
| 136 | 2 | 2 | 1 | 1 | **0** |

Tres cosas que hacen que esto no rompa nada:

1. **`address_text` no perdió el país.** La dirección se guarda completa; la
   suite verifica que las 142 siguen terminando en el código que las originó.
2. **Calle, localidad, provincia y CP NO se separaron.** Ahí sí habría que
   adivinar dónde corta cada uno.
3. **`country_code` no se vuelve a derivar nunca.** Se sembró una vez en la
   migración y desde entonces es un campo editable más, así que no puede
   pelearse con la dirección.

Si preferís que el país no exista como columna, se saca: es aditiva y nada
depende de ella salvo una columna del listado.

### Los emails escondidos en las notas

**22 apariciones · 21 direcciones distintas · en 19 proveedores.**

> **Corrección a la entrega 0**, que decía «18 proveedores». Son **19**. Las
> «22 direcciones» eran apariciones: una está repetida dentro de la misma nota
> (`PROV00010`), así que las distintas son 21.

**No se extrajo ninguno.** El campo `email` de los 142 sigue en `null` y está
probado. La nota se migró entera —la más larga tiene 773 caracteres y entró
completa—, y los 19 proveedores quedaron con
`needs_review = true` y `review_reason = 'LEGACY_EMAIL_EN_NOTAS'`.

Marcarlos fue una decisión mía, no una instrucción: pedías registrar en backlog
la revisión manual de esos emails, y un `needs_review` la vuelve accionable
desde la ficha —con el filtro «Sólo los marcados para revisión»— en vez de
dejarla en un markdown. No cambia ningún dato y se limpia con un botón. Está
igual anotada en el backlog.

### La forma de pago

**139 de 142**, con los **13 valores distintos** del legacy tal cual, erratas
incluidas. No se armó una taxonomía: en el formulario es un `input` con
`datalist` que sugiere lo que ya existe, no un `select` que cierre la lista.
Mezcla incoterms, medios de pago y plazos porque así viene.

### El agente

`BUSCATOOLS` en los 142, migrado como dato histórico en `agent`. **No se usa
para nada**: ni permisos, ni `company_id`, ni filtros. Es un texto que se
muestra en la ficha.

## C · Schema adicional

Dos migraciones, ninguna tabla nueva.

**`fase6_proveedores_pais_y_adjuntos`**
- `suppliers.country_code text` + CHECK `^[A-Z]{2}$`. La única columna nueva.
- `attachments_select` partida por tipo de entidad (ver **I**, es un bug).

**`fase6_proteger_borrado_proveedor`**
- `app.proteger_borrado_proveedor()` + trigger BEFORE DELETE (ver **I**).

`suppliers` queda con **25 columnas, 5 índices y 2 triggers**. No se creó una
segunda tabla de adjuntos ni una segunda auditoría: las de la entrega 1 sirven.

## D · UI

Módulo nuevo en `src/modules/compras/`, con la misma forma que Clientes.

**Listado — `#/compras/proveedores`.** Todo del lado del servidor: filtros,
orden, página y total exacto. Columnas: referencia, razón social, país, forma
de pago, nombre comercial, teléfono, email y estado. Ordenable por referencia,
razón social, país y forma de pago, con desempate estable para que una fila no
salga dos veces entre páginas. Selección múltiple y exportación a CSV de lo
seleccionado o de lo que muestran los filtros.

**Filtros:** búsqueda libre (razón social, nombre comercial, referencia,
email), estado activo/inactivo, sólo los marcados para revisión, incluir dados
de baja. Viven en la URL, así que un listado filtrado es un link.

**No hay filtro por país** aunque el país exista: 136 de 142 son `AR`, no
separa nada. **Tampoco por actividad**: la columna está vacía en los 142.
Filtros sin datos detrás no se inventan.

**Ficha — `#/compras/proveedores/:id`.** Cuatro secciones:

| sección | qué muestra |
|---|---|
| Información | los 13 datos reales, con los faltantes marcados como faltantes |
| Compras relacionadas | pedidos, recepciones y facturas — **hoy 0, contado contra las tablas reales** |
| Adjuntos | subida, descarga firmada y borrado |
| Historial | `purchases_audit` de este proveedor |

«Compras relacionadas» **cuenta contra `purchase_orders`, `goods_receipts` y
`supplier_invoices`**; no devuelve un cero escrito a mano. Hoy da cero porque
el circuito no tiene pantalla todavía, y eso es lo que dice el texto. El día
que haya pedidos, los cuenta sin tocar nada.

«Historial» está vacío en los 142 y también lo explica: la migración corrió con
la clave de servicio, sin una persona detrás, así que **no se inventó un evento
de alta**. Un «Alta — sistema — 10/09/2026» sería falso en la parte que
importa. La fecha real está en la ficha como «Alta».

**Alta y edición.** La referencia la asigna `next_document_number` del lado del
servidor —jamás `MAX+1`—, se pide antes del insert y, si el insert falla, el
número se pierde: repetir una referencia es peor que saltearla. La dirección es
**un** campo de texto, con la explicación al lado de por qué no son cinco.

**Navegación.** «Proveedores» entra en el menú y sale de «Próximamente». El
enlace se le muestra sólo a admin y employee: ofrecerle a un vendedor una
pantalla que RLS le va a devolver vacía es maltratarlo. Esconder el enlace es
una cortesía; lo que impide el acceso es la policy.

## E · RLS

Probado con **sesiones reales de cada rol**, no leyendo el DDL.

| rol | ve el maestro | por id exacto | por referencia | puede crear |
|---|:--:|:--:|:--:|:--:|
| admin | 142 | ✓ | ✓ | ✓ |
| employee | 142 | ✓ | ✓ | ✓ |
| salesperson | **0** | 0 | 0 | `42501` |
| customer | **0** | 0 | 0 | `42501` |
| distributor | **0** | 0 | 0 | `42501` |
| anónimo | **0** | 0 | — | — |

Los tres caminos laterales están cubiertos: pedir el proveedor **por su id
exacto**, buscarlo **por su referencia** y listar **la empresa ajena** devuelven
cero filas, no un error que confirme que existe.

El caso que importa: **Jano es salesperson en Torquetools y no ve los
proveedores de su propia empresa**. Es deliberado y está aprobado.

> **Nota sobre el employee.** No hay credenciales del employee real
> (`ing.buscatools@gmail.com`), así que la suite **crea un usuario employee
> temporal**, lo prueba y lo borra —usuario y membresía— en la limpieza. Es la
> única forma de probar ese rol sin pedirte una contraseña. Si preferís que no
> cree usuarios, se saca y ese rol queda sin cobertura.

## F · Adjuntos

**Ni tabla nueva, ni bucket nuevo, ni base64.** La entrega 1 ya había agregado
`supplier` al CHECK de `attachments.entity_type` justamente para esto, y las
policies del bucket privado piden que la primera carpeta de la ruta sea una
empresa donde el usuario escribe —que es exactamente el conjunto de Compras—.

- Ruta: `<company_id>/supplier/<supplier_id>/<uuid>-<nombre>`.
- Primero el archivo, después la fila: al revés quedaría un adjunto apuntando a
  un archivo que no existe.
- Descarga con **URL firmada de cinco minutos**. Una URL pública es una URL que
  se reenvía y queda accesible para siempre.
- 20 MB, el límite del bucket.

Probado de punta a punta: subida real, fila en `attachments`, URL firmada, y
—lo importante— que un customer **no** ve esa fila. Ver **I**.

## G · Tests

**Suite contra la base: `scripts/fase6-proveedores-tests.mjs` — 0 fallos**, 11
secciones. Cubre los 15 puntos pedidos:

| # | sección |
|---:|---|
| 1 | el maestro migrado: 142, únicos, activos, con `imported_at` |
| 2 | campo por campo contra el HTML + los tres campos que siguen vacíos |
| 3 | dirección sin partir, país derivado, `address_text` intacto |
| 4 | notas, emails escondidos, forma de pago, agente |
| 5 | numeración: huecos vacíos, próxima 146, la secuencia avanza |
| 6 | alta con todos los campos, edición, CUIT repetido, país inválido |
| 7 | baja lógica, selector, DELETE frenado, reactivación |
| 8 | RLS por rol, por id, por referencia, por empresa |
| 9 | adjuntos: bucket, fila, URL firmada, y que un externo no la ve |
| 10 | auditoría: se escribe por RPC y no a mano |
| 11 | **idempotencia**: la migración corre de nuevo dentro de la suite |

La idempotencia se prueba en serio: la suite **ejecuta el script de migración
otra vez** y compara. Segunda corrida: **0 creados · 0 completados · 142 sin
cambios · misma huella MD5 · ningún `updated_at` se movió · 0 referencias
duplicadas.**

**Tests unitarios: 327 pasan** (+61 nuevos), y también con `test:isolated`.
Cubren validación (CUIT, email, país, el CUIT legacy que no obliga a
arreglarlo), permisos por rol, formato, CSV y el ida y vuelta de los filtros
en la URL.

La suite se limpia sola —prefijo `ZZ-C2`, y borra también por prefijo por si
una corrida muere a mitad—, repone la secuencia y verifica al final que quedan
**los 142 y nada más**.

## H · Mobile

**Pendiente de verificación real.** La revisión a 390 / 430 / 768 necesita una
sesión iniciada en el navegador y yo no puedo escribir una contraseña en un
formulario. El servidor de desarrollo está levantado y la revisión se hace
apenas inicies sesión en el panel del navegador.

Lo que sí está hecho, y es verificable en el código:

- La tabla scrollea **dentro de su propia caja** (`overflow-x: auto`); el body
  de la página nunca scrollea en horizontal.
- Por debajo de 768 el listado no es una tabla sino **tarjetas**: siete
  columnas en 390px obligan a scrollear toda la página.
- Inputs a **16px** —menos que eso y iOS hace zoom al enfocar— y **44px** de
  alto mínimo en todo lo que se toca.
- La forma de pago larga y el nombre comercial se recortan con elipsis y el
  texto completo queda en el `title`, así que no estiran la tabla.
- La dirección y las notas largas usan `overflow-wrap: anywhere` y
  `white-space: pre-wrap`: se cortan, no empujan.
- El único chequeo que pude correr sin sesión —la pantalla de login a 375px—
  da `scrollWidth == innerWidth`, sin scroll horizontal.

No lo doy por bueno hasta verlo.

## I · Bugs encontrados

Dos, los dos reales, los dos corregidos.

### 1 · Un salesperson podía leer —y bajarse— los adjuntos de un proveedor

`attachments_select` autorizaba a `app.current_internal_company_ids()`, que
incluye **salesperson y technician**. Con Ventas estaba bien. Pero la entrega 1
habilitó `supplier`, `purchase_order`, `goods_receipt` y `supplier_invoice` en
el CHECK de `entity_type`, y Compras es admin + employee.

El agujero completo: un salesperson veía la fila del adjunto de un proveedor
que no puede ni ver —nombre de archivo, tamaño, ruta— y, **como la policy del
bucket sólo pide que exista una fila en `attachments` con esa ruta**, con esa
fila podía firmar la URL y bajarse el archivo.

Corregido partiendo la condición por tipo de entidad: los cuatro tipos de
Compras piden `current_writer_company_ids()`, el resto queda **exactamente**
como estaba. Probado que un externo no ve la fila y que los adjuntos de Ventas
no se tocaron.

### 2 · Un proveedor sí se podía borrar

En la entrega 1 escribí que `suppliers` no tenía policy de DELETE. **Era
falso**: la policy es `FOR ALL`, y `FOR ALL` incluye DELETE. El test lo
desmintió en la primera corrida —un admin borró un proveedor de una fila— y por
eso está acá y no en producción.

Corregido con la misma guarda que tiene Clientes:
`app.proteger_borrado_proveedor()`, un trigger BEFORE DELETE que rechaza con
`restrict_violation` si el proveedor tiene pedidos, recepciones, facturas o
adjuntos. Se eligió un trigger y no partir la policy en cuatro por dos razones:
partir una policy probada es más riesgo que beneficio, y **un trigger frena
también a la clave de servicio**, cosa que una policy no hace.

La guarda es sobre la historia, no un «no se borra nunca»: un proveedor recién
creado y sin nada colgando sí se puede borrar. Desde la UI no hay ningún camino
al DELETE de todos modos.

### Y una corrección de números

La entrega 0 decía «18 proveedores con email en las notas». Son **19**. Las 22
direcciones eran apariciones; distintas hay 21.

## J · CI y deploy

- `npm run lint` · `tsc -b` · **327 tests** · `test:isolated` · `npm run build` — verde.
- **13 suites de regresión contra la base real**: 7 de Ventas, 5 de Clientes y
  la del schema de Compras. **0 fallos en las 13.**
- Invariantes intactos: 288 / 166 / 182 / 636 documentos, huella
  `8091b9166350c5bf2c331b1d882ec654`, 1010 clientes, 87 contactos, 14 alias,
  381 movimientos de stock, 379 saldos.
- DB: **97 MB** (96 MB antes de esta entrega). `suppliers` ocupa **472 kB** con
  las 142 filas.

Un arreglo de la suite de la entrega 1: verificaba que al terminar **no quedara
ningún proveedor**. Ahora quedan 142 y eso está bien, así que ahora captura el
número previo y compara contra él. Es el mismo error que la suite de Ventas
había cometido con `document_sequences`.

### La deuda de `database.types.ts` — saldada

Venía desde la Fase 5: el archivo estaba parcheado a mano porque generar con la
CLI necesita un access token que no está en esta máquina.

Las ocho tablas de Compras **no se escribieron a mano**: las genera
[`scripts/fase6-generar-tipos-compras.mjs`](../scripts/fase6-generar-tipos-compras.mjs)
desde el esquema OpenAPI que publica PostgREST, que es la misma fuente de la
que sale el archivo oficial. Dos cosas se derivan y las dos están comprobadas
contra `pg_constraint`: el nombre de la FK (`<tabla>_<columnas>_fkey`, lo
cumplen los 35 constraints) y `isOneToOne: false` (ninguna FK de Compras tiene
un índice único sobre exactamente sus columnas).

Las seis columnas de Fase 5 siguen escritas a mano y verificadas con
`fase5-verificar-tipos.mjs`. La deuda ahora es sólo ésa.

---

## Lo que queda para la entrega 3

El circuito: pedidos de compra, recepciones y facturas de proveedor. El schema
está desde la entrega 1 y probado; falta la pantalla.

Decisiones ya tomadas que hay que respetar: moneda obligatoria, sobre-recepción
bloqueada por defecto, `receipt_status` derivado por la base, sin cancelación
de recepciones confirmadas, y la relación Compras ↔ Ventas **no se reconstruye
históricamente por intuición**.
