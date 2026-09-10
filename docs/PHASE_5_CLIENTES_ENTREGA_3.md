# Fase 5 · Clientes — entrega 3: alta y edición

Estado: **entregado, pendiente de revisión visual.** No se empezó la entrega 4
(memoria de productos) ni Compras.

---

## Cambios de schema

Una sola migración: **`fase5_clientes_edicion`**. Cuatro cosas, todas
necesarias para que la entrega funcione; ninguna «por simetría».

### 1 · Un cliente dado de baja tiene que seguir siendo legible

`customers_select` filtraba `deleted_at is null` **para todos**. Con eso, dar
de baja a un cliente lo hacía desaparecer también de sus documentos históricos
—el embed de `customers` volvía `null` y el remito quedaba «Sin cliente»— y la
pantalla no tenía forma de mostrarlo como inactivo.

Ahora la baja la ven los roles internos; para el cliente externo el filtro
sigue en pie. Los listados que no quieren ver bajas las excluyen ellos: eso es
una decisión de pantalla, no de autorización.

### 2 · El CUIT no se repite, comparado normalizado

Ya existía `idx_customers_taxid`, único sobre el **texto literal**, que no ve
que `30-50328441-0` y `30503284410` son el mismo CUIT. Se agregó

```sql
create unique index uq_customers_cuit_norm
  on customers (company_id, (regexp_replace(tax_id, '\D', '', 'g')))
  where tax_id is not null and deleted_at is null
    and length(regexp_replace(tax_id, '\D', '', 'g')) = 11;
```

**El histórico no se toca.** El índice sólo alcanza a los valores que *son* un
CUIT. En la base hay 21 `tax_id` que no lo son —«Básculas Magris S.A», «?», un
teléfono— y dos de ellos normalizan a la cadena vacía. Eso es basura heredada,
no un CUIT repetido, y corregirla automáticamente sería inventar un dato.

En el formulario, además, el CUIT **sólo se valida si cambió**: obligar a
arreglarlo para poder corregir un teléfono sería obligar a inventarlo.

### 3 · La marca de revisión no se borra editando cualquier cosa

`app.revisar_motivos_cliente()`, BEFORE UPDATE. Dos caminos y sólo dos:

| | |
|---|---|
| **verificable** | el motivo se cae solo cuando el dato que faltaba está: `CUIT_NO_ASIGNADO` y `CUIT_REPETIDO_EN_LEGACY` con un CUIT de once dígitos, `REF_DUPLICADA` con una referencia |
| **explícito** | una persona lo da por revisado, y lo hace llamando a la RPC, no escribiendo la columna |

Todo lo demás —`SOLO_EN_CONTACTOS`, `VARIOS_LEGACY_AL_MISMO_CLIENTE`, los
`AMBIGUO_*`, `CONFLICTO_DE_DATO`— no lo resuelve un dato: lo resuelve alguien
que mira los dos clientes y decide.

Lo que la aplicación mande en `needs_review` o `review_reason` **se ignora**:
el trigger los recalcula a partir de lo que había. La clave de servicio está
exenta, porque es la que corre las migraciones y la que calculó la marca.

### 4 · Resolver a mano, diciendo qué

`public.resolver_revision_cliente(p_customer uuid, p_motivos text[])`,
SECURITY DEFINER, admin y employee. Sin lista se dan por revisados todos; con
lista, sólo ésos: confirmar «ya vi que son dos empresas distintas» no tiene por
qué borrar «no tiene CUIT».

### Lo que NO se cambió

**`customer_addresses.kind`** acepta `billing`, `shipping` y `both`. Pediste
distinguir **entrega, facturación y otra**: las dos primeras están, «otra» no
existe y **no se agregó**. Agregar un valor al CHECK es cambiar el modelo y
querías que se reportara antes. Si hace falta, es un `alter` de una línea.

---

## Funcionalidades

| | dónde |
|---|---|
| **Alta de cliente** | `#/clientes/nuevo`. La referencia `CLI00001` la da `next_document_number`, la misma función que numera cotizaciones, pedidos y remitos |
| **Edición** | botón «Editar» en la pestaña Información de la ficha |
| **Contactos** | pestaña propia, con alta, edición y borrado |
| **Direcciones** | pestaña propia, con alta, edición y borrado |
| **Baja lógica** | «Dar de baja» / «Reactivar» en la ficha |
| **Resolver revisión** | un botón por motivo, en el aviso de la ficha |

Los campos son los que **existen de verdad** en `customers`. No hay «vendedor
asignado» ni «lista de precios» editables: la columna existe, el legacy nunca
la usó por cliente, y ponerle un desplegable sería invitar a inventar un dato.

**Emails**: `emails text[]`, varios por cliente, con *trim*, minúsculas y sin
repetidos comparando sin distinguir mayúsculas. Un `ventas@empresa.com` **no**
se convierte en contacto: no es una persona.

**Baja lógica**: se escriben `deleted_at` y `status = 'inactive'` juntos y a
propósito. `deleted_at` es la baja y `status` el estado comercial; dejar
`status = 'active'` en un cliente dado de baja sería guardar una contradicción.
Un cliente dado de baja conserva su historial, sus relaciones y su nombre en
los documentos anteriores, y **no se ofrece** al armar uno nuevo.

### Un cambio en Ventas que hubo que hacer

El selector de cliente de la cabecera era un `<select>` con **todos** los
clientes de la empresa. Con 60 andaba; después de la entrega 2 son **1.010**, y
un desplegable de mil opciones no se usa.

Ahora es `BuscadorCliente`: el mismo patrón que el buscador de productos, cada
tecla —debounceada— pide como mucho 20 filas al servidor, y **excluye a los
dados de baja y a los inactivos**. El filtro de los listados sí los incluye,
marcados «(dado de baja)»: sus documentos existen y hay que poder buscarlos.

---

## Permisos

Los del modelo. **No se amplió ninguno.**

| rol | cliente | contactos y direcciones | resolver revisión |
|---|---|---|---|
| **admin** | crear, editar, dar de baja | sí | sí |
| **employee** | crear, editar, dar de baja | sí | sí |
| **salesperson** | crear y editar **los suyos** | **no** | **no** |
| **customer / distributor** | no | no | no |
| **anon** | nada | nada | nada |

`customers_insert` / `customers_update` incluyen a `salesperson`;
`contacts_write` y `addresses_write` usan `app.current_writer_company_ids()`,
que es **admin y employee**. Los botones se muestran según esto, pero lo que
impide escribir es la policy: la suite lo prueba con intentos reales.

**No hay policy de DELETE sobre `customers`.** Desde la aplicación un cliente
no se borra nunca: el intento no da error, simplemente no alcanza ninguna fila.

---

## Bugs y hallazgos

### 1 · Un cliente dado de baja desaparecía de sus propios documentos

El más importante, y lo encontró el propio diseño de la entrega: con la policy
anterior, `deleted_at is null` valía para todos, así que el remito de un
cliente dado de baja pasaba a decir «Sin cliente». Arreglado en el punto 1 de
la migración y cubierto por un test.

### 2 · `salesperson` puede crear un cliente que después no ve

`customers_insert` lo autoriza, pero `customers_select` sólo le muestra los que
tienen `salesperson_id = auth.uid()`. Como los 1.010 clientes tienen ese campo
en `NULL`, **hoy un salesperson no ve ningún cliente**, y si crea uno sin
asignarse, tampoco lo verá.

**No se tocó**: pediste verificar qué permite el modelo y no ampliar permisos.
Queda registrado como decisión pendiente: o el alta le asigna el vendedor
automáticamente, o la policy cambia, o el rol no debería poder crear clientes.

### 3 · Un falso PASS en la propia suite

La prueba «un cliente no se borra» medía el **error** del DELETE. Sin policy de
DELETE, PostgREST no da error: filtra y afecta cero filas. Se corrigió para
medir lo que importa —que el cliente siga estando después del intento—, que es
la misma distinción que ya nos costó un falso PASS en la Fase 3.5.

### 4 · Dos totales por moneda con «SIN MONEDA» en la ficha

No es nuevo, pero se ve más ahora: 32 documentos históricos no dicen en qué
moneda están y forman su propio grupo, rotulado. No se supone ARS.

---

## Tests

**Unitarios**: 245 en total (32 nuevos), lint, typecheck, `test:isolated` y
build en verde.

- `validacion`: CUIT normalizado, las dos formas del mismo CUIT, el CUIT
  histórico mal cargado que **no** se obliga a corregir si no se lo tocó,
  emails con *trim* / minúsculas / repetidos, los tres tipos de dirección que
  el CHECK admite y el rechazo de «otra»
- `permisos`: qué puede cada rol, incluido que salesperson **no** escribe
  contactos ni direcciones

**Contra los datos reales** — `scripts/fase5-clientes-edicion-tests.mjs`, con
sesión real y limpieza propia. **0 fallos**, 45 comprobaciones:

| sección | qué se probó |
|---|---|
| Alta | mínima (sólo razón social) y completa; formato `CLI01225`; los dos emails; un cliente nuevo **no** nace marcado |
| CUIT | el mismo CUIT escrito distinto es rechazado (23505); dos clientes sin CUIT conviven; el histórico mal cargado sigue intacto |
| Concurrencia | 12 altas simultáneas: 0 errores, 12 referencias distintas, **sin huecos** (1230…1241); dos altas simultáneas con el **mismo CUIT**: gana una sola |
| Edición | razón social y teléfono; la referencia CLI **no** se toca |
| Contactos | alta, edición, borrado; un contacto **sin cliente** es rechazado (23502); dos principales a la vez, rechazado (23505) |
| Direcciones | alta de entrega y de facturación conviviendo como principales; un tipo inventado es rechazado (23514); edición |
| `needs_review` | cambiar el teléfono **no** borra la marca; escribir la columna a mano **no** resuelve nada; cargar el CUIT resuelve **sólo** el motivo del CUIT; la RPC resuelve el motivo pedido |
| Baja lógica | da de baja sin borrar; el interno lo sigue viendo; **no se ofrece** para un documento nuevo; el DELETE no alcanza ninguna fila |
| Ventas | renombrar no cambia el `customer_id`; el documento muestra el nombre nuevo porque lo lee por FK; un documento de un cliente dado de baja **lo sigue nombrando**; ni la clave de servicio borra un cliente con documentos (23001) |
| RLS | el externo no crea clientes, no edita **ni su propia ficha**, no crea contactos ni direcciones, no resuelve revisiones, no ve un cliente dado de baja; anónimo, cero |
| Limpieza | 1.010 / 87 / 0 vuelven a su número, 0 fixtures, secuencia CLI repuesta en 1225 |

**Regresión de Ventas**: las siete suites en verde, 288 / 166 / 182 / 636 y la
huella `8091b9166350c5bf2c331b1d882ec654` **sin cambios**. Más la suite de
lectura de Clientes, también en verde.

---

## Mobile

Revisado en el código, no en pantalla: **no pude entrar a la aplicación**
porque pide contraseña y no ingreso credenciales en formularios. La revisión
visual en 390 / 430 / 768 queda para vos.

Lo que sí está resuelto por construcción: todos los inputs a 16px (menos que
eso y iOS hace zoom al enfocar) y 44px de alto; las grillas de formulario usan
`minmax(180–200px, 1fr)`, así que en 390px caen a una columna; las tablas
scrollean **dentro de su caja**, nunca la página; los textos largos —mails,
direcciones— cortan con `overflow-wrap: anywhere`; el panel de relacionados
colapsa a una columna por debajo de 560px.

---

## CI y deploy

`lint`, `typecheck`, `test` (245), `test:isolated` y `build` en verde.
**No se hizo deploy**: el commit queda local, sin push.
