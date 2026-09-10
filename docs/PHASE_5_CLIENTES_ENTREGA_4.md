# Fase 5 · Clientes — entrega 4: memoria de productos, precios y rubros

Estado: **entregado, pendiente de revisión visual.** No se empezó la entrega 5
ni Compras.

---

## Auditoría, antes de tocar nada

Tres cosas había que auditar antes de decidir, y las tres cambiaron la
decisión.

### `bterp_price_memory` — era un caché redundante

La función legacy (`app.js:769`) es:

```js
mem[cliente][sku] = { precio, precioAnterior, cotRef, qty, fecha, veces }
```

Se escribe al guardar cada cotización, la clave es el **nombre** del cliente y
**no guarda la moneda**. La auditoría del perfil real ya lo había dicho:

> «bterp_price_memory es un caché de UNA cotización (Grupo Mirgor, 9 productos,
> 2026-09-04, COTI02530), no un histórico»

Contrastado contra la base: **COTI02530 existe, es de Grupo Mirgor, tiene 9
líneas, las 9 con precio, las 9 en USD**. Los nueve registros se reconstruyen
enteros —y con la moneda que el caché nunca tuvo—.

**Decisión: no se migra y no se crea ninguna tabla equivalente.** Queda
documentado como caché redundante. Una salvedad honesta: el contenido del
caché no está en el backup —vive en el navegador del perfil legacy—, así que
lo verificado es que **el documento que cacheaba está migrado completo**, no un
cotejo valor por valor.

### Rubros y catálogos — no hay datos que migrar

| qué | dónde | qué guarda |
|---|---|---|
| `RUBROS_SEED` | código | 4 nombres, cada uno con marcas y plantilla de mail |
| `buscatools_rubros_config` | `localStorage` | la versión editada… **que no existe en el perfil real** |
| `buscatools_catalogo_links` | `localStorage` | PDFs por marca… **tampoco existe** |

Y para qué sirve: en `app.js:37354`, al **componer un mail** con un documento,
el rubro del cliente preselecciona qué catálogos adjuntar y precarga el asunto
y el cuerpo. Los catálogos son **PDFs de marca**, los mismos para todos.

Dos conclusiones:

- **No hay relación cliente ↔ catálogo.** Es cliente → rubro → marcas → PDFs de
  marca. No existe un sistema documental por cliente, así que no hay nada que
  duplicar ni que llevar a `attachments`.
- Es la configuración de **mandar mails con catálogos**, una función que no
  está migrada (ya estaba en el backlog). Migrar la configuración de una
  pantalla que no se puede abrir sería guardar una preferencia muerta.

**Decisión:** el rubro sigue siendo `customers.industry`, texto nullable, como
estaba aprobado. **No se creó `industries`.** Lo único que se migró es lo que
la ficha legacy sí hace con ellos: ofrecer los **cuatro nombres** al cargar el
rubro. Como sugerencia, no como lista cerrada — y si el cliente ya tiene un
rubro que no está en la lista, se agrega adelante para no borrárselo al
guardar.

### `spd_client_memory_v1` — la memoria de productos

`{ nombreClienteNormalizado: { textoDelCliente: SKU } }`. 15 equivalencias en
4 clientes. 14 están migradas; **la quinceava sigue sin migrar**: pertenece a
«gmra s a u», un cliente que no existe ni en el maestro de 988 ni en el
histórico de ventas. El producto (`SP.2520/8B`) sí existe. No se inventa el
cliente.

---

## Cambios de schema

Dos migraciones: **`fase5_memoria_y_precios`** y
**`fase5_ultimo_precio_sin_truncar`**.

### 1 · Los alias siguen la visibilidad del cliente

`aliases_select` dejaba leer los alias de **cualquier** cliente a cualquier rol
interno. Para admin y employee da igual, pero un `salesperson` sólo ve los
clientes de su cartera y sin embargo podía leer la memoria de productos de los
demás — el código con el que otro cliente llama a cada SKU es información
comercial de ese cliente.

Ahora la condición es «si podés leer el cliente, podés leer sus alias».
**Restringe, no amplía.**

### 2 · Dos funciones para los precios, ninguna tabla

```
precios_historicos_cliente(p_customer, p_product, p_limit, p_offset)
ultimo_precio_cliente(p_customer, p_product)
```

`security invoker`: las policies de `sales_quotes` y `sales_orders` se aplican
al que llama, y además ambas exigen poder leer al cliente. **Si un vendedor no
ve al cliente, no ve sus precios** — probado.

El cálculo va en SQL y no en el navegador porque el volumen lo pide: Grupo
Mirgor tiene **772 líneas con precio**. `precios_historicos_cliente` devuelve
la página pedida más el total con `count(*) over ()`, en una sola consulta.

### Un bug que encontré probándolo

`ultimo_precio_cliente` se apoyaba en `precios_historicos_cliente(…, 500, 0)`,
que topea en 500 filas. Con 772 líneas, **el último precio de un producto
cotizado más atrás de la fila 500 no aparecía. Y sin avisar.** Eran 85
productos de 380.

Corregido: `p_limit => null` significa «todas», y el tope de 500 sigue valiendo
para cualquier valor que se pase.

---

## Funcionalidades

### Memoria de productos

Pestaña propia, con alta, edición, **confirmar**, **descartar** y borrar.
Muestra código del cliente, descripción del cliente, SKU, producto, estado,
origen y fecha.

Lo que cambia respecto del legacy:

| legacy | acá |
|---|---|
| la clave era el **nombre normalizado del cliente** | `customer_id`. Renombrar al cliente ya no le borra la memoria — probado |
| dos clientes homónimos compartían memoria | unicidad `(empresa, cliente, clave)`: **el mismo código puede ser otro producto en otro cliente** |
| el valor era un SKU suelto en un texto | `product_id`, FK real y **NOT NULL**: una equivalencia sin producto no equivale a nada |
| no había estados | `suggested` / `confirmed` / `rejected`, los del CHECK |

Las 14 migradas están en `confirmed` **sin persona detrás** —las dio por buenas
un script—. La pantalla las marca con ⚠ y ofrece «Confirmar», que deja
registrado quién.

«Descartar» pone `rejected` en vez de borrar: deja dicho que alguien la miró y
decidió que no. Borrar también está, y no rompe ningún histórico — los
documentos guardan su propio `sku_snapshot`.

### Precios

Pestaña propia, dos partes:

- **Último precio por producto**, una fila por producto **y por moneda**, con
  el precio anterior, la variación, la fecha, el documento y cuántas veces.
  Chips para filtrar por moneda cuando hay más de una.
- **Todas las líneas con precio**, paginadas del lado del servidor, con enlace
  al documento.

**Nunca hay una fila «última vez» que mezcle monedas.** Un producto cotizado en
USD y en ARS aparece dos veces: son dos respuestas distintas a la misma
pregunta. En Grupo Mirgor hay 3 productos así.

### Rubro

Un `input` con `datalist` de los cuatro nombres del legacy. No es un `select`
porque `industry` es texto libre y no hay tabla de rubros.

### La ficha

**Información · Contactos · Direcciones · Memoria de productos · Precios ·
Historial · Relacionados.** Están las cinco pestañas del legacy más
Direcciones —que en el legacy no existían estructuradas— y Relacionados.
Ninguna duplica datos: cada una consulta lo suyo contra el backend nuevo, y los
alias salieron de «Relacionados», donde estaban en modo lectura.

---

## Performance

Medido contra el cliente más pesado que hay, **Grupo Mirgor** (772 líneas con
precio, 236 documentos, 22 contactos):

| consulta | resultado | tiempo |
|---|---|---|
| `ultimo_precio_cliente` | 380 filas (producto × moneda) | ~740 ms |
| `precios_historicos_cliente`, página de 50 | 50 filas de 772 | ~195 ms |
| alias por cliente | 14 | inmediato |
| historial del cliente | 236 documentos | ~500 ms |
| búsqueda de producto para el alias | 20 filas de 21.772 | server-side |

Todo del lado del servidor. Lo único que baja al navegador es la página que se
muestra. Los ~740 ms del resumen son el caso peor de los 1.010 clientes: es una
agregación sobre las 772 líneas y se cachea 60 segundos.

---

## Tests

**Unitarios**: 258 (13 nuevos), lint, typecheck, `test:isolated` y build en
verde.

- `lib/alias`: la clave normalizada reproduce exactamente la de la migración;
  «SP.553 Tubo» y «sp 553 tubo» son el mismo alias; el código gana sobre la
  descripción
- `lib/rubros`: son los cuatro del legacy; un rubro que no está en la lista se
  agrega adelante para no perderlo al guardar

La normalización vive en `lib/` y no en el servicio a propósito: `test:isolated`
corre sin `.env` y detecta el acoplamiento al cliente de Supabase. Ya nos había
pasado con `TRATAMIENTOS` en Ventas, y volvió a pasar acá — el archivo se movió
por eso.

**Contra los datos reales** — `scripts/fase5-memoria-precios-tests.mjs`, sesión
real, limpieza propia, **0 fallos**:

| sección | qué se probó |
|---|---|
| Memoria migrada | 14 alias, todos con producto real, todos por `customer_id`, ninguno confirmado por una persona; repartidos 12 Mabe / 1 Mirgor / 1 Integra |
| Unicidad | **el mismo código en otro cliente es otro producto**; repetirlo en el mismo cliente, rechazado (23505); «tubo.38» y «TUBO-38» son el mismo alias; sin producto, rechazado (23502); estado inventado, rechazado (23514) |
| Renombrar | renombrar al cliente **no** le borra la memoria |
| Precios | 380 filas producto × moneda; `{USD: 375, SIN MONEDA: 4, EUR: 1}`; una sola fila por pareja; 3 productos en más de una moneda; página de 50 sobre 772; la página 2 no repite |
| El caché legacy | las 9 líneas de COTI02530 se reconstruyen, con precio, **con moneda**, y la que no resolvió producto se recupera por su SKU |
| RLS | externo: 0 memoria, 0 precios, no crea (42501); distribuidor: 0; anónimo: 0 y 0 |
| Vendedor | **no ve la memoria ni los precios de un cliente que no es suyo** |

**Regresión**: las siete suites de Ventas y las tres de Clientes en verde.
288 / 166 / 182 / 636 y huella `8091b9166350c5bf2c331b1d882ec654` **intacta**.
Estado final: 1.010 clientes, 87 contactos, 0 direcciones, **14 alias**,
0 fixtures, secuencias CLI en 1225 y 1.

### Dos bugs de mi propia suite

- Esperaba 2 equivalencias en un cliente al que la sección anterior le había
  rechazado 3 por duplicadas: eran 1.
- «Otro vendedor» se elegía con `limit(1)` sin excluir a Jano, que **es**
  salesperson en Torquetools, así que el «cliente ajeno» a veces quedaba
  asignado a él y el test fallaba por razones equivocadas.

Ninguno de los dos era del producto, pero los dos habrían tapado uno real.

---

## Mobile

Revisado en el código, **no en pantalla**: la app pide contraseña y no ingreso
credenciales en formularios. La revisión visual en 390 / 430 / 768 queda para
vos.

Lo resuelto por construcción: las dos tablas nuevas —alias y precios— scrollean
**dentro de su caja**, nunca la página; las descripciones largas del cliente y
los nombres de producto se recortan con ellipsis y el texto completo va en el
`title`; los chips de moneda envuelven; el formulario de alias cae a una
columna por debajo de 200px de ancho de celda; todos los inputs a 16px y 44px
de alto. Las siete pestañas de la ficha envuelven en dos líneas en 390px.

---

## Lo que queda

- **La equivalencia de «gmra s a u»**: su cliente no existe en ninguna fuente.
- **Rubros y catálogos como configuración**: se define cuando exista el envío
  de mails, no antes.
- **`times_used` no se incrementa solo.** La columna existe y está en 0 en las
  14 migradas; se llenará cuando la importación de OC use los alias para
  reconocer productos —que es la función que hoy no está migrada—.
- **Contactos y direcciones para el vendedor**: sin cambios, a revisar en la
  entrega 5.

---

## CI y deploy

`lint`, `typecheck`, `test` (258), `test:isolated` y `build` en verde.
