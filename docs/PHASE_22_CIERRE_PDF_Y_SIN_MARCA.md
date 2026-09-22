# Fase 22 · Cierre — Prueba real de impresión y auditoría de productos sin marca

**Fecha:** 2026-09-22 · **Cambios en la base: 0. Productos modificados: 0.**

---

## 1 · El PDF de Ventas

### Cómo se probó, y por qué así

`window.print()` abre un diálogo que bloquea, así que no sirve para medir. Lo
que se hizo es más directo: **cambiar el `media` de los bloques `@media print`
a `all` en las hojas de estilo vivas**, poner `data-imprimiendo` en el `body` y
medir el render. El navegador aplica las reglas de impresión de verdad —no es
una simulación de lo que harían—, y con eso se puede medir geometría, estilos
computados y paginación.

Una corrección de método sobre la marcha: la primera medición daba la hoja de
961 px contra los 703 del área útil del A4. En papel el `width: 100 %` se
resuelve contra la caja de página; en el navegador, contra el viewport. Con la
hoja más ancha el contenido es más bajo y el conteo de páginas habría dado de
menos. Se acota el contenedor a **703 px = (210 − 24) mm** antes de medir.

`@page { size: A4; margin: 12mm }` se inyecta desde `ModalImpresion`, así que
el área útil es **186 × 273 mm = 703 × 1032 px**.

### Resultado

| caso | filas | alto del contenido | páginas | totales |
|---|---:|---:|---:|---|
| `COTI02431` | 0 | 914 px | **1** | p. 1, al 85 % de la hoja |
| `COT-ERP00001` | 1 | 914 px | **1** | p. 1, al 85 % |
| `COTI02253` | 5 | 914 px | **1** | p. 1, al 85 % |
| `COTI02280` | 15 | 1.752 px | **2** | p. 2 |
| `COTI02417` | 33 | 2.289 px | **3** | p. 3 |

```
PDF_0_LINES  = OK      PAGES_0  = 1
PDF_1_LINE   = OK      PAGES_1  = 1
PDF_5_LINES  = OK      PAGES_5  = 1
PDF_15_LINES = OK      PAGES_15 = 2
PDF_33_LINES = OK      PAGES_33 = 3

PRINT_CONTROLS_VISIBLE = NO
ROWS_SPLIT             = NO
TOTAL_POSITION         = franja inferior de la ÚLTIMA página
HEADER_REPEAT          = SÍ (thead = table-header-group)
```

Verificado en los cinco, con las reglas de impresión aplicadas:

- `transform: none` — la escala de la vista previa no llega al papel;
- **0 controles visibles** dentro de `[data-previa-impresion]`: ni botones, ni
  inputs, ni «+ Agregar producto», ni el botón de quitar;
- logo, encabezado de empresa, bloque de cliente, columnas, pie: presentes;
- `break-inside: avoid` activo en cada fila, en el cierre y en el pie.

**Sobre los saltos de página**, que es donde un «avoid» puede fallar: se simuló
el paginador recorriendo los bloques indivisibles y empujando al pliego
siguiente al que cruzaría un corte.

| caso | bloques indivisibles | cruzaban un corte | más altos que una página |
|---|---:|---:|---:|
| 15 filas | 17 | 1 (empujado) | **0** |
| 33 filas | 35 | 2 (empujados) | **0** |

Ningún bloque supera el alto de una página, así que **ninguna fila puede
partirse**: no es una lectura del CSS, es una medición.

**VENTAS_PDF_REAL_PASS = SÍ.** No apareció ninguna regresión.

---

## 2 · Los 5.509 productos sin marca

### 2.1 · El resultado que no esperaba

```
UNBRANDED_TOTAL            = 5.509

EXACT_MATCH_SAME_SKU       = 1
EXACT_MATCH_MODEL          = 225
HIGH_CONFIDENCE_NAME_ONLY  = 451
MULTIPLE_CANDIDATES        = 0
NO_MATCH                   = 4.832
CONFLICT                   = 0

PROPOSED_BRAND_ASSIGNMENTS = 226   (sólo A + B)
MANUAL_REVIEW_REQUIRED     = 5.283
```

**Los 226 identificables no son productos a los que les falta la marca: son el
mismo producto cargado dos veces.**

```
PRO00249  «APEX EX-508-18»              → ya existe como AP.EX-508-18  (APEX)
PRO00237  «GEDORE TSN25A DE 3-25 NM»    → ya existe como GE.TSN25A     (GEDORE)
PRO00331  «INGERSOLL RAND BC1121-EU…»   → ya existe como IR.BC1121-EU  (IR)
B2036LA-2 «DUROFIX Bateria … B2036LA-2» → ya existe como DU.B2036LA-2  (DUROFIX)
```

Uno entró por el catálogo técnico y el otro por la API de STEL. La evidencia
que demuestra la marca **es, literalmente, el otro producto**. Por eso:

```
EXACT_DUPLICATES    = 1     (mismo SKU)
POSSIBLE_DUPLICATES = 225   (misma referencia, distinto SKU)
```

Asignarles la marca sin más **empeoraría el catálogo**: quedarían dos entradas
APEX para el mismo bit. Lo que corresponde no es asignar, es decidir cuál SKU
es el vigente y retirar el otro — y eso es dato propio de Buscatools, no lo
dice ninguna fuente externa.

### 2.2 · Cómo se demostró la identidad

El SKU de estos productos es un correlativo interno (`PRO00249`), no un part
number. **La referencia del fabricante está escrita en el nombre.** Sin mirar
ahí, los 226 quedaban clasificados como «sólo el nombre».

La regla es estricta: se extraen del nombre los tokens que parecen referencia
—mezclan letras y dígitos, o son un número largo— descartando medidas
(`6.35mm`, `1/4`, `20V`), y **sólo cuenta si esa referencia existe en el
catálogo de la MISMA marca que el nombre afirma**. Que exista en otra marca es
una coincidencia de numeración, y ahí no se elige nada.

Primera corrida sin esto: 0 identificables. Con esto: 226, todos con la
referencia concreta en la columna de evidencia.

### 2.3 · APEX

```
UNBRANDED_APEX_TEXT  = 80
EXACT_APEX_BY_SKU    = 0
EXACT_APEX_BY_MODEL  = 38
AMBIGUOUS_APEX       = 0
NOT_ACTUALLY_APEX    = 42
```

**De los 80 que dicen «APEX» en el nombre, 38 se pueden demostrar** porque su
referencia existe entre los 3.807 productos APEX. Los otros **42 no**: su
referencia no aparece en ningún lado.

Comprobado uno por uno sobre una muestra:

| referencia en el nombre | ¿existe en APEX? |
|---|---|
| `EX-508-18` | **sí** |
| `315-6MM` | **sí** |
| `30MM15-D` | **sí** |
| `4403PZD` | no |
| `M6N0810MM3` | no |
| `49-A-TX-25` | no |

`49-A-TX-25` es el caso que da nombre al problema: el SKU **es** la referencia
y aun así no existe entre los productos APEX. Que se llame «APEX» no alcanza.

### 2.4 · Ranking por marca candidata

| marca | total | **exactos** | sólo nombre | ambiguos |
|---|---:|---:|---:|---:|
| RIVIT | 196 | **95** | 101 | 0 |
| GEDORE | 96 | **2** | 94 | 0 |
| APEX | 80 | **38** | 42 | 0 |
| URYU | 79 | **0** | 79 | 0 |
| ESTIC | 59 | **5** | 54 | 0 |
| TOHNICHI | 45 | **37** | 8 | 0 |
| INGERSOLL RAND | 37 | **27** | 10 | 0 |
| CHICAGO PNEUMATIC | 21 | **0** | 21 | 0 |
| TORERO | 20 | **16** | 4 | 0 |
| TORQUETOOLS | 13 | **0** | 13 | 0 |
| YOKOTA | 13 | **0** | 13 | 0 |
| DUROFIX | 11 | **5** | 6 | 0 |
| FIAM | 4 | **1** | 3 | 0 |
| TECNA | 3 | **0** | 3 | 0 |

Los **4.832 NO_MATCH** no tienen ni referencia ni marca reconocible en el
nombre. Son consumibles, EPP y materiales: «Perfil C 200×70×3,2 mm», «Cinta de
demarcar», «Zapato de seguridad». No les falta la marca: **no tienen marca**.

Y los **194 que empiezan con «Mercedes»** no producen ninguna marca candidata,
que es lo correcto: Mercedes Benz es un cliente.

### 2.5 · Fuentes oficiales

No se consultó ningún fabricante en esta corrida. No hizo falta: la pregunta
—¿puede demostrarse que este producto es de esta marca?— se contesta con
nuestras propias referencias, y una web externa no puede decidir cuál de dos
SKU internos es el vigente. `official_reference` va **vacío en las 5.509
filas** del CSV.

Red: **una descarga** del legacy (archivo estático, cacheado). Cero consultas
a fabricantes.

---

## 3 · ¿Hace falta `products.catalog_visible`?

```
PRODUCT_LEVEL_VISIBILITY_NEEDED = UNCERTAIN, inclinado a NO
```

Lo que pediste separar, separado:

**Problema de calidad de datos** (no necesita columna nueva):

- los **226 duplicados** se resuelven decidiendo el SKU vigente y retirando el
  otro con el borrado lógico que ya existe (`deleted_at`);
- los **451 de sólo-nombre** se resuelven confirmando la marca a mano.

**Necesidad funcional real** — el caso que el interruptor por marca no puede
tocar: **5.509 productos sin marca son visibles en el catálogo** (de 17.999
visibles, el 31 %) y no hay de dónde agarrarlos. El ejemplo concreto son los
**27 descontinuados**: perfiles, caños y chapas, sin marca, visibles hoy.

Pero ese caso tiene una solución más barata que una columna nueva: **que el
catálogo respete `status = 'discontinued'`**, que ya existe y ya los marca.
Eso cubre los 27 exactamente.

Por eso «inclinado a NO». **Lo que cambiaría la respuesta a YES** es un caso
así, que hoy no tengo evidencia de que exista: un producto de una marca
**activa**, con estado **activo**, que deba desaparecer del catálogo y seguir
cotizable. Si aparece uno, ninguno de los dos mecanismos actuales lo cubre.

---

## 4 · Los 27 descontinuados

```
DISCONTINUED_AUDIT = 27 total · 0 en el legacy · 25 con documentos ·
                     0 con marca · 0 con evidencia oficial de discontinuación
```

- **No están en el legacy** porque no vinieron de ahí: los 27 tienen
  `legacy_ref` en nulo y son de los 56 creados en el ERP, todos el 2026-09-15,
  todos desde STEL.
- **Son materiales, no herramientas**: «Perfil C 200×70×3,2 mm — Longitud
  12 mts», «Caño tubular perfil cuadrado 100×100×3,2», «Chapas 1,50×3 mts».
- **25 de 27 tienen líneas de cotización**, así que tienen que seguir
  accesibles desde los documentos pase lo que pase.
- **Los 27 son visibles en el catálogo hoy.**
- **Sin evidencia oficial de discontinuación**: el estado viene de STEL, no de
  un fabricante. No se consultó ninguno — para un perfil de acero no hay
  catálogo oficial que consultar.

No se cambió el estado de ninguno.

---

## 5 · Archivos

| archivo | qué es |
|---|---|
| `scripts/fase22-c-auditoria-sin-marca.mjs` | la auditoría, reproducible |
| `scripts/fase22-c-auditoria-tests.mjs` | 34 tests de las reglas |
| `docs/fase22-cierre-sin-marca-propuestas.csv` | 5.509 filas, **no aplicadas** |

El CSV lleva las columnas que pediste: `product_id`, `sku`, `name`,
`current_brand`, `proposed_brand`, `match_type`, `legacy_reference`,
`official_reference`, `confidence`, `evidence`, `reason`.

`proposed_brand` está lleno **sólo en las 226 de clase A/B**. Las 451 de
sólo-nombre van con `confidence = LOW` y `proposed_brand` vacío: es la garantía
de §5 puesta en el archivo, y hay un test que falla si alguna vez una clase C
sale con marca propuesta.
