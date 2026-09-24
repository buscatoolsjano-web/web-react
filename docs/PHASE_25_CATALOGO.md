# Fase 25 · Catálogo: ocultar categorías, stock ordenable, una sola forma de abrir un producto y la hoja del catálogo

Cinco pedidos concretos sobre el Catálogo. Este documento dice qué se hizo, con
qué números se decidió cada cosa, y qué se aplicó en la base.

> **Estado: aplicado.** Los dos SQL y la migración de datos corrieron en
> producción el 23/09/2026 y están verificados contra la base y en pantalla
> (§7). El código y la base están en la misma versión.

---

## 1 · Ocultar categorías, como se hace con marcas

`brands.is_active` existe desde la Fase 22 · B y saca del catálogo a los
productos de esa marca sin borrar nada. Las categorías no tenían ese
interruptor, y hacía falta: de las diez que hay, dos son bolsas de «todavía no
clasificado».

| Categoría | Productos | `needs_review` |
|---|---:|---|
| **Otros** | **12.588** | sí |
| **Pendiente de clasificación STEL** | **53** | sí |
| Puntas y tubos | 8.623 | no |
| Balanceadores | 376 | no |
| Atornilladores | 129 | no |
| Accesorios | 43 | no |
| Llaves de impacto | 7 | no |
| Remachadoras | 4 | no |
| Herramientas | 3 | no |
| Llaves dinamométricas | 2 | no |

**Consecuencia, decidida a sabiendas:** ocultar «Otros» deja el catálogo en
**9.240 de 21.828 productos**. El diálogo de confirmación dice el número exacto
antes de tocar el botón, porque es lo que cambia la decisión.

Semántica, calcada de las marcas:

* la categoría desaparece del filtro **y sus productos del listado**;
* **Ventas, Compras y los documentos no cambian**: un producto de categoría
  oculta se sigue cotizando, comprando y abriendo desde cualquier documento que
  lo nombre. El interruptor lo mira `p_solo_catalogo`, que sólo manda el
  Catálogo;
* una categoría con productos **no se elimina: se desactiva**;
* queda en la bitácora (`CATEGORY_DISABLED` / `CATEGORY_ENABLED`).

Un producto **sin** categoría sigue visible, por la misma razón por la que uno
sin marca sigue visible: no hay quién lo oculte.

## 2 · Stock real y stock virtual, dos columnas, las dos ordenables

Paridad con el legacy, que tiene las dos como columnas propias y ordenables
(`app.js:15518`, `data-cat-sort="sr"` y `"sv"`). Antes acá eran una sola celda
«12 / 10», que no se puede ordenar por separado.

El orden lo decide `search_products`, no el navegador: el listado está paginado,
así que si ordenara React la página 2 no sería la continuación de la página 1.

**Dos diferencias con el legacy, las dos medidas:**

| | Legacy | Acá |
|---|---|---|
| Sin saldo registrado | vale 0 (`getEffectiveStock`) | vale «—», y ordena **al final en las dos direcciones** |
| Desempate dentro del mismo saldo | el orden en que estaban en memoria | el nombre |

La primera no es un capricho: **sólo 379 de 21.828 productos tienen fila en
`stock_balances`**. Tratar los otros 21.449 como cero pondría 21.449 filas de
«—» antes de la primera con stock, y ordenar por stock no serviría para nada.

Ordenar por stock es sólo para roles internos. `stock_balances` no la puede leer
un rol externo (policy `stockbal_select`), y `search_products` es
`SECURITY INVOKER`: desde afuera el lateral no devuelve filas, los dos saldos
quedan en NULL y no se filtra ni se ordena nada. La pantalla tampoco ofrece esas
columnas — un rol externo sigue viendo «Disponibilidad».

Precio sigue sin ser ordenable, y no es un olvido: vive en `product_prices` y
depende de qué lista se esté mirando, que la RPC no recibe.

## 3 · «Datos a revisar» ya no se muestra en el Catálogo

Lo tenían **12.593 de 21.828 productos** —casi todos los de «Otros»— así que
marcaba más de la mitad del catálogo, y un cartel que aparece siempre no
informa nada.

Se saca del listado, de las tarjetas del teléfono, del modal y de la ficha. **El
dato no se toca**: sigue en `products.needs_review` y se sigue viendo en
Configuración → Categorías. Clientes, Ventas y Compras siguen mostrando el suyo,
que es otro dato y otra proporción.

## 4 · Cualquier parte de la fila abre el producto de la misma manera

Antes la fila abría el modal y **el nombre navegaba a la ficha**, así que el
mismo producto se veía de dos formas distintas según dónde se hubiera tocado —y
la ficha era la peor de las dos (§5).

Ahora el click pelado sobre el nombre abre el modal, igual que el resto de la
fila. El nombre **sigue siendo un `<a>` con href de verdad**: ctrl-click, botón
del medio y «abrir en pestaña nueva» llevan a la ficha, que es una URL
compartible. Si el listado se usa sin modal —otra pantalla que lo reutilice—, el
enlace navega como antes.

En el teléfono la tarjeta sigue llevando a la ficha: no hay hover ni espacio
para un modal, y la ficha ahora está completa.

## 5 · La ficha muestra lo mismo que el modal

A `#/catalogo/:sku` le faltaban **la tabla comparativa de similares** y **la
hoja del catálogo**, que el modal sí tenía. Se agregaron las dos, con el mismo
componente y la misma variante —no una segunda versión, que serían dos
respuestas para la misma pregunta— y además el **historial de stock** para roles
internos, que también estaba sólo en el modal.

## 6 · La hoja del catálogo, extraída del legacy

El legacy sabía ubicar productos en la página de un catálogo impreso. La base
sólo tenía 48 (los de DUROFIX). Esto lo traslada.

### De dónde sale

| Fuente en el legacy | Qué da | Cuántos |
|---|---|---:|
| `_SPEEDRILL_SKU_TO_PAGE` (`app.js:29`) | SKU → página del catálogo SPEEDRILL | 1.418 |
| `_TECNA_SKU_TO_PAGE` (`app.js:79`) | SKU → catálogo + página (nogravity 40, generale 130, food 115) | 285 |
| `_asignarCatalogoTorero` (`app.js:45`) | TORERO serie LTR/LTU → torero p. 1 | 13 |
| `_asignarCatalogoTecna` (`app.js:89`) | respaldo por serie de los balanceadores TECNA, **sin página** | resto de TECNA |
| ya en la base | DUROFIX | 48 |

Los seis catálogos y su cantidad de páginas salen de `_CATALOGOS_INFO`
(`app.js:16654`): nogravity 12, generale 36, food 20, speedrill 168, torero 1,
durofix 12. Una página fuera de ese rango no pide ninguna imagen, en vez de
pedir una que va a dar 404.

### Las imágenes

Cinco catálogos están publicados en `janoguarini.github.io/catalogos-buscatools`,
que es de donde los tomaba el legacy (verificado: HTTP 200 en speedrill, torero,
nogravity, generale y food). El nombre del archivo se arma igual que allá
(`app.js:16830`): página rellenada a 3 dígitos para SPEEDRILL, a 2 para el resto.

**DUROFIX no está ahí** (404). El legacy llevaba sus 12 páginas embebidas en
base64 dentro del propio `app.js` —2,25 MB de literal—. Se extrajeron a
`public/catalogos/durofix-01..12.jpg` (12 archivos, 1489×993, 1,61 MB en total)
y salen de esta misma app.

### Precedencia, que es lo que cambió

Cuando un producto tiene **las dos** cosas —la página del catálogo impreso y una
lámina `shared_diagram` de apexbits— gana **la página del catálogo**. Lo que se
pidió es «la hoja del catálogo donde aparecía ese producto», y eso es la página
impresa; la lámina compartida queda como respaldo para los miles de productos
que no están en ningún catálogo mapeado.

### Cómo se aplica

```bash
node scripts/fase25-e6-hojas-legacy-extraer.mjs <ruta-al-legacy>   # lee el legacy, escribe el mapeo y las imágenes
set -a; source .env.migration; set +a
node scripts/fase25-e6-hojas-aplicar.mjs                            # dry run: dice cuántos y de qué regla
node scripts/fase25-e6-hojas-aplicar.mjs --apply
```

El script que aplica **no pisa un `catalogo_id` que ya esté** (los 48 de DUROFIX
no se tocan), **no toca ninguna otra clave de `attributes`**, y es idempotente.
Lo que no cae en ninguna regla se queda sin hoja y se reporta cuántos son: no se
adivina.

---

## 7 · Lo que se aplicó, y en qué orden

| # | Qué | Archivo | Estado |
|---|---|---|---|
| 1 | `product_categories.is_active`, la bitácora, `config_categorias_listar`, `config_categoria_estado`, y el filtro de categoría en `search_products` + `catalog_facets` | `scripts/fase25-e1-categorias-ocultables.sql` | **aplicado** |
| 2 | `search_products` con el orden por `stock_real` / `stock_virtual` (incluye el filtro de E1: es la versión final de la función) | `scripts/fase25-e2-orden-por-stock.sql` | **aplicado** |
| 3 | El mapeo de hoja del catálogo en `products.attributes` | `scripts/fase25-e6-hojas-aplicar.mjs --apply` | **aplicado: 1.716 productos** |

Lo que quedó, verificado contra la base y en pantalla:

* la columna existe, las 10 categorías quedaron activas y ninguna oculta — el
  interruptor está disponible y nadie lo usó todavía;
* el catálogo sigue mostrando **17.996 productos**, los mismos que antes: el
  filtro de categoría no sacó a nadie porque no hay categorías ocultas;
* ordenar por «Stock real» de mayor a menor da 2.000 · 1.516 · 1.431 · 1.387 ·
  1.350, y los «sin saldo registrado» quedan al final;
* **1.764 productos tienen hoja de catálogo**: los 1.716 nuevos más los 48 de
  DUROFIX que ya la tenían. Ninguna página quedó fuera del rango de su catálogo,
  así que ninguna imagen da 404. Probado en pantalla con `SP.TX40` →
  «SPEEDRILL · Catálogo SPEEDRILL · página 43», imagen de 843×1186 cargada.

Antes de aplicarlos el Catálogo devolvía 400 y mostraba «No se pudo cargar el
catálogo», porque el listado pide `product_categories ( … is_active )` y la
columna no existía. Quedó registrado acá porque es la forma de la dependencia:
el código y estas migraciones van juntos, y el orden es SQL primero.

Nota de proceso: el `search_products` que estaba en producción —el que la Fase 22
dejó ordenando por columna— **no tenía su SQL en el repo**. Los dos archivos de
esta fase lo dejan escrito, y el de E2 es la definición completa y vigente.

## 8 · Lo que NO se hizo

* **Filtrar por stock con operadores** (`>5`, `<=2`), que el legacy tiene y
  sigue faltando (#11 de la matriz de paridad). Ordenar y filtrar son dos cosas:
  esto agrega el orden.
* **Tocar `products.needs_review`**: el cartel se dejó de mostrar, el dato quedó.
* **Desactivar ninguna categoría.** El interruptor queda disponible; cuál se
  apaga y cuándo lo decide quien mira el catálogo.
* **Cambiar qué ve un rol externo.** Sigue viendo «Disponibilidad» y no
  cantidades, que es una decisión de RLS y no de pantalla.
