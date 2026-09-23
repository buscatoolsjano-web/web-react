# Fase 22 · Paridad Catálogo — legacy vs React

Auditoría del módulo **Catálogo** del HTML legacy contra el React actual, y
el cierre de las capacidades que faltaban.

**Estado: 38 de 57 en paridad estricta, 47 cubiertas.** Los 3 críticos están
cerrados. Lo que queda son 6 parciales y 4 faltantes, cada uno con su razón.
El conteo lo genera `scripts/audit/fase22-actualizar-matriz.mjs` desde la
tabla: contar 57 filas a ojo es la forma confiable de que el resumen y la
tabla digan cosas distintas.

Fuente del legacy: `app.js` (45.345 líneas) + `index.html`, leídos
programáticamente. Las referencias `app.js:NNNN` son verificables.

Criterio de §7: se compara **capacidad y comportamiento para el usuario**, no
implementación. `localStorage` contra Supabase no es falta de paridad.
Criterio de §8: React puede ser más seguro; no se copian vulnerabilidades.

---

## Parte 1 · Los dos casos concretos

### §1 · El HTML crudo en la ficha

```
LEGACY_RENDER  = texto plano en <p> + link aparte como botón «📄 Ver catálogo
                 técnico (PDF)». Los dos escapados con escapeHtml.
                 (app.js:16511-16514, función _descSplitLink en app.js:28648)
REACT_RENDER   = «…livianas.\n<a href="https://…"><strong>Ver catálogo
                 técnico (PDF)</strong></a>» a la vista, como texto.
ROOT_CAUSE     = el dato trae, pegado al final de `products.description`, un
                 salto de línea real MÁS un «\n» literal (barra invertida y
                 ene) MÁS un ancla HTML. React lo renderizaba como texto
                 —que es lo seguro— pero nunca lo separaba. El legacy ya
                 tenía la función que lo parte; su propio comentario describe
                 el bug: «que si se muestra tal cual queda como texto roto».
```

**Medido en la base:** 104 de 21.784 descripciones terminan con un ancla. Las
104 son `https:` y las 104 tienen la misma etiqueta, «Ver catálogo técnico
(PDF)». La función del legacy parte las 104.

**Otras 70 descripciones usan `<` como signo de menor** —«<2.5 m», «<93%RH»,
«<+2°C», «<10-2000»—. Por eso el arreglo **no** es un limpiador de etiquetas:
reconoce una estructura concreta al final del texto y deja el resto intacto.
Un `strip tags` genérico se comería media ficha técnica.

**Cómo quedó:** `lib/descripcion.ts` porta `_descSplitLink`.
`components/DescripcionProducto.tsx` renderiza el texto como hijo de JSX y el
link como un `<a>` real. **Cero `dangerouslySetInnerHTML`.** Además, más
estricto que el legacy: sólo `http`/`https` salen como link — un
`javascript:` se descarta y tampoco se muestra crudo. 16 tests.

```
RAW_HTML_FIXED = SÍ
```

### §2 · El distintivo «Equivalente»

El legacy tenía, **en la ficha**, dos secciones separadas:

| sección legacy | qué mostraba | app.js |
|---|---|---|
| `🔄 Productos similares (equivalencias)` | las cargadas a mano (`sim_tc`, `sim_cp`, `sim_ir`, `sim_sp`), **agrupadas por marca**: «Similar TECNA», «Similar CHICAGO P.»… como links de SKU | 16545-16553 |
| `🔗 Productos relacionados` | las **calculadas** por atributos, como tarjetas con foto, SKU, línea de atributos y precio | 16463-16484 |

Es decir: **el legacy sí distinguía**, no con un distintivo sino con dos
secciones de encabezado y forma distintos.

```
LEGACY_HOVER_EQUIVALENT_BADGE      = NO — el hover del legacy (app.js:16318,
                                     _catHoverInfoHtml) muestra nombre,
                                     marca, categoría, tipo, medida, largo,
                                     encastre, origen, costo, precio y stock.
                                     No muestra similares de ninguna clase.
LEGACY_DETAIL_EQUIVALENT_BADGE     = SÍ, como sección aparte agrupada por
                                     marca (no como etiqueta).
LEGACY_COMPARATOR_EQUIVALENT_BADGE = NO — y más que eso: el comparador del
                                     legacy EXCLUYE los campos sim_* de las
                                     filas comparables (ALWAYS_SKIP,
                                     app.js:17062). Coincide con §3.
```

**Dónde faltaba en React y qué se hizo:** la grilla «Productos similares» de
la ficha y del modal mezclaba curadas y calculadas sin distinguirlas. Ahora la
curada lleva el mismo distintivo «Equivalente» que ya tenía el comparador. Se
replicó la distinción del legacy en la forma de React; **no se agregó nada
nuevo**. 5 tests.

El comparador de React ya mostraba el distintivo y el legacy no lo mostraba
ahí. Queda como está: §2 dice no agregar funcionalidad nueva, y quitarla
sería otro cambio no pedido. Anotado abajo como `INTENTIONALLY_DIFFERENT`.

---

## Parte 2 · Matriz de paridad (§6)

`PARITY` · `PARTIAL` · `MISSING` · `INTENTIONALLY_DIFFERENT`

### Búsqueda y filtrado

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 1 | Búsqueda global | `includes` sobre sku+nombre+base+marca, en memoria sobre 21.775 productos | `search_products` en el servidor: tsvector español + trigram (`<%`, umbral 0,4) sobre nombre y sku | PARITY | React encuentra por aproximación y ordena por score; el legacy sólo por subcadena | — |
| 2 | Limpiar la búsqueda (×) | botón × dentro del input | botón × dentro del input | PARITY | — | — |
| 3 | «Limpiar» todos los filtros | botón en la barra | botón en el panel de facetas | PARITY | — | — |
| 4 | Filtro por marca | `<select>` en la fila de filtros | chips en el panel de facetas, con conteo | PARITY | — | — |
| 5 | Filtro por categoría | tarjetas/chips arriba (Puntas, Balanceadores, Atornilladores, Accesorios, Otros) con conteo y emoji | chips con conteo | PARITY | el legacy pone emoji y foto de muestra | — |
| 6 | Subcategoría (tipo/serie) | chips según la categoría, multi-selección | chips de tipo y serie, multi-selección | PARITY | — | — |
| 7 | Filtro por atributo técnico | `<select>` por columna dinámica según la categoría (medida, largo, encastre, min/max kg, carcasa, longitud, eslinga, torque…) | facetas por atributo, multi-selección, definidas por categoría | PARITY | — | — |
| 8 | Rango numérico | igualdad exacta (`min_kg === n`) | rango min/max de verdad (`rango.largo.min=25`) | PARITY | React es más capaz | — |
| 9 | Filtro por columna: Referencia | input de texto sobre sku+modelo | la búsqueda global cubre sku y nombre con tsvector + trigram | PARTIAL | no se puede acotar «sólo por referencia» | pendiente · LOW |
| 10 | Filtro por columna: Nombre | input sobre nombre+modelo+marca | ídem #9 | PARTIAL | ídem | pendiente · LOW |
| 11 | **Filtro por stock con operadores** | `>5`, `<=2`, `>=10` sobre stock real y virtual | — | **MISSING** | el stock vive en `stock_balances`, no en `products`: filtrarlo exige cambiar la forma de `search_products`, que usan cinco módulos | pendiente · MEDIUM |
| 12 | Estado de los filtros en la URL | no: viven en `state` en memoria | todo en el querystring, compartible y con historial | INTENTIONALLY_DIFFERENT | React sobrepasa | — |

### Orden, paginación y listado

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 13 | **Ordenar por columna** | click en Referencia, Marca, Modelo, Categoría, Serie, Stock real, Stock virtual, Costo — asc/desc con flecha | **implementado**: SKU, Producto, Marca, Categoría y Serie, asc/desc, en la URL, con `aria-sort` y accesible por teclado | **PARTIAL** | faltan Stock y Costo, por la misma razón que #11 y #22 | hecho (5 de 8 columnas) |
| 14 | Paginación | ⏮ ‹ 1 2 3 › ⏭ | componente `Pagination` con lo mismo | PARITY | — | — |
| 15 | Productos por página | 10/25/50/100/200/500 | selector de tamaño de página | PARITY | verificar que las opciones coincidan | ninguna por ahora |
| 16 | «Mostrando X-Y de Z» | sí | sí | PARITY | — | — |
| 17 | Columna Imagen | miniatura 48 px | miniatura | PARITY | — | — |
| 18 | Columnas SKU / Marca / Modelo / Categoría / Serie | sí | sí | PARITY | — | — |
| 19 | Columnas dinámicas por categoría | mapa fijo `CATEGORY_FILTERS` | **implementado**: salen de las facetas reales de la categoría, hasta 5, descartando las que cubren menos del 25 % | PARITY | React las deriva del dato en vez de una lista escrita a mano | hecho |
| 20 | Stock real y virtual | dos columnas con semáforo (rojo ≤0, ámbar <5, verde) | una columna «real / virt.» | PARTIAL | React no pinta semáforo — **decisión previa de Juan: nada de crítico/mínimo/semáforo** | ninguna: es deliberado |
| 21 | Sin saldo registrado | muestra `0` | muestra `—` con «Sin saldo registrado» | INTENTIONALLY_DIFFERENT | React corrige una mentira del legacy: 21.449 productos sin movimientos decían «0» | — |
| 22 | **Columna Costo (USD)** | sí, sólo para internos: `p.pu`, un campo del producto | no | **MISSING** | React no tiene costo en `products`: es un hecho de compras (`ultimo_precio_compra`). Mostrarlo en el listado es una consulta por página, no una columna | pendiente · MEDIUM |
| 23 | Columna Precio de venta | sí | sí, por lista de precios | PARITY | React resuelve la tarifa; el legacy calculaba `pu*3` en JS | — |
| 24 | Vista mobile en tarjetas | sí | sí (responsive) | PARITY | — | — |
| 25 | Estado vacío | «Sin coincidencias» | `EmptyState` con texto y sugerencia | PARITY | — | — |
| 26 | Estado de error | no hay | `ErrorState` + aislamiento por bloque | INTENTIONALLY_DIFFERENT | React sobrepasa | — |

### Ficha del producto

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 27 | Abrir el producto | modal encima del catálogo | modal encima del catálogo **+** página propia `/catalogo/:sku` | PARITY | React agrega la ruta con URL propia | — |
| 28 | Identidad (SKU, nombre, marca, categoría, serie) | sí | sí | PARITY | — | — |
| 29 | **Descripción con link de catálogo** | texto + botón 📄 | **arreglado en esta entrega** | PARITY | — | hecho |
| 30 | Atributos técnicos | grilla de 2 columnas | `ListaAtributos` con definiciones y unidades | PARITY | — | — |
| 31 | Datos físicos y aduana (peso, volumen, NCM, dimensiones) | sí, sólo internos | sí (peso, volumen, NCM, origen) | PARTIAL | `dim_balanceador` y `dim_caja` **no existen en el esquema de React**: es deuda de datos, no una pantalla faltante | pendiente · LOW |
| 32 | Precio y stock | costo + precio venta + stock real/virtual | precio por lista + stock real/virtual | PARTIAL | falta el costo, por lo mismo que #22 | pendiente · MEDIUM |
| 33 | Equivalencias curadas | sección propia agrupada por marca | grilla única, **con distintivo «Equivalente»** | PARITY | la forma cambia, la distinción existe | hecho |
| 34 | Similares calculados | sección propia, 6 tarjetas | mismos, en la misma grilla | PARITY | — | — |
| 35 | Historial de stock | últimos 15 movimientos | `HistorialStock`, bajo demanda | PARITY | React no lo carga hasta que se abre | — |
| 36 | Hoja del catálogo | imagen de la página, por `catalogo_id` + `catalogo_pagina` | `HojaCatalogo`, dos fuentes (diagrama compartido y el par del legacy) | PARITY | — | — |
| 37 | Galería de imágenes con lightbox | lightbox al click en la imagen | `ProductGallery` con lightbox | PARITY | — | — |
| 38 | Producto fuera del catálogo | no lo contempla | avisa «no está en el catálogo» y lo muestra igual | INTENTIONALLY_DIFFERENT | React sobrepasa | — |

### Hover

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 39 | Hover sobre la imagen | panel flotante: nombre, marca, categoría, tipo, medida, largo, encastre, origen, costo, precio, stock real y virtual | `PopoverProducto`: imagen a la izquierda, ficha a la derecha | PARITY | React no muestra el costo (ver #22) | — |
| 40 | Zoom de la imagen en el hover | imagen de 220 px junto al panel | imagen grande dentro del popover | PARITY | — | — |
| 41 | Comparador dentro del hover | no existe | sí: atributos en filas, productos en columnas | INTENTIONALLY_DIFFERENT | React sobrepasa (Fase 22 · B, aprobado) | — |

### Comparador

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 42 | **Elegir qué comparar** | checkbox por fila, de 2 a 4 productos **cualesquiera**, botón «🔀 Comparar (n)» | **implementado**: checkbox por fila, tope de 4 (el quinto se deshabilita), botón «Comparar (n)», mismo `ComparadorProductos` | PARITY | el legacy avisa con un toast al tildar el quinto; React lo deshabilita | hecho |
| 43 | Atributos en filas, productos en columnas | sí | sí | PARITY | — | — |
| 44 | Marcar las filas que difieren | punto naranja en la etiqueta + fondo alternado | verde/rojo/neutro por celda, con símbolo además del color | INTENTIONALLY_DIFFERENT | React marca por celda y no usa color solo (accesibilidad) | — |
| 45 | Quitar una columna | botón «× Quitar» por producto | **implementado**: «Quitar: × SKU» al pie del comparador | PARITY | — | hecho |
| 46 | «Limpiar selección» | sí | **implementado**, junto al botón Comparar | PARITY | — | hecho |
| 47 | Excluir `sim_*` del comparador | sí (`ALWAYS_SKIP`) | sí (los similares no son filas del comparador) | PARITY | — | — |
| 48 | Distintivo «Equivalente» en el comparador | no | sí | INTENTIONALLY_DIFFERENT | React sobrepasa; §2 dice no agregar, no dice quitar | — |

### Acciones

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 49 | **Exportar a Excel/CSV** | modal con alcance, 27 columnas en 3 grupos, «todas»/«ninguna», conteo en vivo, y el cliente nunca exporta stock virtual ni el catálogo completo | **implementado**: mismo modal, 21 columnas, las mismas reglas de rol, y el archivo respeta búsqueda, filtros y orden | PARITY | 21 y no 27: `familia`, `huella` y `eslinga` no existen en React. Se agrega «En catálogo», que en el legacy no existía | hecho |
| 50 | **Agregar al carrito desde el listado** | stepper − n + por fila; barra flotante con ítems y total; «Ver cotización»; «Vaciar». Carrito distinto para cliente e interno | **implementado**: stepper en tabla y tarjetas, barra flotante, persiste en `localStorage`, y «Ver cotización» lleva a **Nueva cotización** con las líneas puestas | PARITY | el legacy crea la cotización en su propio modal con su copia del cálculo; React usa la única pantalla que crea documentos. Un solo carrito: no hay portal de cliente (F23 · `PC-02`) | hecho |
| 51 | **Crear producto nuevo** | botón «➕ Nuevo» → modal de alta con secciones y atributos a medida (internos) | — | **MISSING** | el catálogo es de sólo lectura | ninguna por ahora |
| 52 | Ir de un similar a otro producto | click en la tarjeta reemplaza el producto | ídem, sin cerrar el modal | PARITY | — | — |
| 53 | Imprimir | no existe en el catálogo | no existe | PARITY | — | — |

### Permisos y visibilidad

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 54 | Cliente no ve costo ni stock virtual | `isCatCliente` decide en el navegador | RLS en Postgres + `p_solo_catalogo` en la RPC | PARITY | React lo decide en el servidor: el dato no llega al navegador | — |
| 55 | Cliente ve disponibilidad, no cantidad | muestra el número igual | `DisponibilidadBadge`: «Disponible» / «Consultar» | INTENTIONALLY_DIFFERENT | React es más estricto, decidido en Fase 22 · B7 | — |
| 56 | Marca inactiva fuera del catálogo | no existe el concepto | sí | INTENTIONALLY_DIFFERENT | React sobrepasa | — |

### Fuera del alcance de «Catálogo · Productos»

| # | Funcionalidad | Legacy | React | Paridad | Diferencia | Acción necesaria |
|---|---|---|---|---|---|---|
| 57 | Pestaña «Catálogo · Servicios» | `renderCatalogoServicios` + editor de servicios | — | MISSING | es otro submódulo del mismo menú | ninguna por ahora |

---

## Parte 3 · Conteo

Contado fila por fila, por sección:

| sección | filas | PARITY | PARTIAL | MISSING | INT. DIF. |
|---|---:|---:|---:|---:|---:|
| Búsqueda y filtrado (#1–12) | 12 | 8 | 2 | 1 | 1 |
| Orden, paginación, listado (#13–26) | 14 | 9 | 2 | 1 | 2 |
| Ficha (#27–38) | 12 | 9 | 2 | 0 | 1 |
| Hover (#39–41) | 3 | 2 | 0 | 0 | 1 |
| Comparador (#42–48) | 7 | 5 | 0 | 0 | 2 |
| Acciones (#49–53) | 5 | 4 | 0 | 1 | 0 |
| Permisos (#54–56) | 3 | 1 | 0 | 0 | 2 |
| Fuera de alcance (#57) | 1 | 0 | 0 | 1 | 0 |
| **total** | **57** | **38** | **6** | **4** | **9** |

```
CATALOG_LEGACY_FEATURES_TOTAL = 57

                          ANTES   DESPUÉS
PARITY                  =    32        38
PARTIAL                 =     5         6
MISSING                 =    11         4
INTENTIONALLY_DIFFERENT =     9         9
```

`PARTIAL` subió de 5 a 6 y no es un retroceso: **#9** y **#10** bajaron de
`MISSING` a `PARTIAL` —la búsqueda del servidor encuentra lo mismo, lo que
falta es acotar a un campo— y **#13** dejó de ser «no existe» para ser «5 de
8 columnas». Los que se cerraron enteros son #19, #42, #45, #46, #49 y #50.

### Lo que sigue faltando, y por qué

| # | qué | por qué no se hizo | sev |
|---|---|---|---|
| #11 | Filtrar por stock con operadores | El stock no está en `products`: vive en `stock_balances`. Filtrarlo exige cambiar la forma de `search_products`, que llaman cinco módulos. Es una decisión de arquitectura, no una pantalla | MEDIUM |
| #22 · 32 | Columna y dato de **costo** | El legacy tiene `p.pu` como campo del producto. En React el costo es un hecho de compras (`ultimo_precio_compra`), no una columna. Ponerlo en el listado es una consulta por página | MEDIUM |
| #31 | Dimensiones de producto y de caja | `dim_balanceador` y `dim_caja` **no existen en el esquema**. Es deuda de datos, no una pantalla faltante | LOW |
| #9 · 10 | Filtros por columna de referencia y de nombre | La búsqueda global encuentra lo mismo; falta poder acotar a un campo | LOW |
| #13 | Ordenar por Stock y por Costo | Lo mismo que #11 y #22 | LOW |
| #51 | Crear y editar producto | Es un ABM completo, no una capacidad del listado. Y hoy los productos entran por dos puertas —STEL y catálogo técnico— que ya produjeron 226 duplicados: abrir una tercera sin cerrar eso pide más duplicados | fase propia |
| #57 | Pestaña «Catálogo · Servicios» | Otro submódulo, con su listado y su editor | fase propia |

```
BLOCKING_CATALOG_GAPS = 0
```

Ninguno de los que quedan impide reemplazar el catálogo del legacy: se puede
buscar, filtrar, ordenar, comparar, exportar y armar una cotización. Lo que
falta es acotar por un campo, ver el costo, y dos submódulos que no son el
listado de productos.
## Parte 4 · Lo que NO es falta de paridad (§7 y §8)

- **localStorage contra Supabase.** El legacy guarda carrito, filtros y auth
  en `localStorage`. React usa la URL y la base. Para el usuario hace lo
  mismo, o más.
- **Permisos en el navegador contra RLS.** El legacy decide con `isCatCliente`
  en JS: el costo y el stock virtual **llegan al navegador** y se ocultan al
  dibujar. En React no llegan. Es la misma funcionalidad, mejor hecha — y no
  se va a copiar la versión insegura.
- **`innerHTML` en todas partes.** El legacy arma la UI concatenando strings y
  se protege con `escapeHtml` en cada interpolación. React escapa por
  omisión. El único lugar donde el legacy tenía que tratar HTML de verdad
  —el link de la descripción— se portó **sin** `dangerouslySetInnerHTML`.
- **`pu * 3` en JavaScript.** El legacy calculaba el precio de venta en el
  navegador. React lo resuelve por lista de precios en la base. No se replica.

---

## Parte 5 · Qué falta decidir

Nada de lo `MISSING` se implementó (§9). Cuando quieras avanzar, el orden que
sugiere el uso real es: **#50 carrito** (es por donde nace una cotización),
después **#49 exportar**, después **#42 comparar seleccionados**, y el resto
cuando aparezca la necesidad.
