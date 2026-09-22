# Fase 22 · Etapa A — Auditoría del maestro de productos

**Fecha:** 2026-09-22 · **Generado por:** `scripts/fase22-a-auditoria-maestro.mjs`
**Cambios aplicados a la base: 0. Productos modificados: 0.**

---

## 0 · La conclusión, antes de los números

La base no está «a medio llenar». **Son dos catálogos pegados**, y el corte es
perfecto:

| origen | productos | con algún dato técnico |
|---|---:|---:|
| Catálogo técnico real | 9.180 | **9.180 (100,0 %)** |
| API de STEL Order | 12.592 | **4 (0,0 %)** |
| Creados en el ERP | 56 | — |

STEL es el ERP administrativo: factura, no describe. Los 12.592 productos que
entraron por ahí nunca tuvieron tipo, medida, largo, encastre ni serie — no se
perdieron en ninguna migración.

Y la segunda conclusión, que cambia el tamaño del trabajo: **del hueco técnico,
buena parte son repuestos**, que por naturaleza no tienen ficha. FIAM parecía el
segundo problema del catálogo con 3.374 productos vacíos; **3.223 son repuestos**
(«FIAM Repuesto SPINDLE Código 252534150»). El problema real de FIAM son **144
herramientas**.

---

## 1 · OUTPUT

```
TOTAL_PRODUCTS                = 21.828
TOTAL_BRANDS                  = 26
LEGACY_PRODUCTS_FOUND         = 21.772

EXACT_LEGACY                  = 21.765
CONFLICTS                     = 7
NO_MATCH (sólo en el ERP)     = 56
SOLO_EN_LEGACY                = 0

EXACT_OFFICIAL                = 0
OFFICIAL_SOURCES_FOUND        = 6 dominios oficiales identificados (ver §5)
OFFICIAL_PDFS_FOUND           = 1 verificado (Tohnichi 2025.10, 14 MB, cubre
                                toda la línea) + biblioteca IR sin inventariar
NO_OFFICIAL_SOURCE            = 21.828 (ningún producto verificado todavía
                                contra fabricante: esta corrida no lo hizo)

MISSING_TECHNICAL_FIELDS      = 12.637
POSSIBLE_DUPLICATES           = 96 productos en 48 grupos
SIN_MARCA                     = 5.509 (677 con marca sugerible)

PROPOSED_CORRECTIONS          = 701
AUTO_FIX_HIGH_CONFIDENCE      = 17
MANUAL_REVIEW_REQUIRED        = 684

DB_CHANGES_APPLIED            = 0
PRODUCTS_CHANGED              = 0
```

---

## 2 · ERP contra legacy: el ERP es una copia fiel

**7 conflictos en 21.828 productos.** Los 7 son descripciones reescritas: el ERP
conserva el formato viejo («MARCA: SPEEDRILL / MODELO: J3202B / DESCRIPCION…») y
el legacy tiene la versión en prosa. Ningún dato técnico difiere.

> **Corrección de método.** La primera corrida dio **4.512 conflictos**. Eran
> míos, no de los datos: `volume_cm3` es `integer` en el ERP y decimal en el
> legacy, así que 1,6 se guardó como 2 y yo lo comparaba como texto. Eso es el
> redondeo de la importación, no un desacuerdo sobre cuánto mide la caja.
> Reportarlo habría mandado a revisar 4.506 productos sanos.

**No hay nada que recuperar del legacy**: tiene exactamente los mismos agujeros.

| campo | legacy | ERP |
|---|---:|---:|
| marca | 16.316 | 16.319 |
| tipo | 9.181 | 9.165 |
| encastre | 8.422 | 8.281 |
| largo | 7.765 | 7.763 |
| peso (≠ 0) | 5.377 | 5.377 |

El legacy escribe `peso_g: 0` en los 16.395 productos que nunca se pesaron.
Contarlo como «tiene peso» da 21.772 de 21.772 — la clase de número con el que
se toma una decisión equivocada. Acá se cuenta como lo que es: sin dato.

---

## 3 · Dónde está el hueco de verdad

De los 12.637 sin ningún campo técnico:

| clase | productos | ¿tiene ficha técnica el fabricante? |
|---|---:|---|
| Herramienta o sin clasificar | 8.054 | sí, es el trabajo real |
| Repuesto | 3.391 | no: vive en despieces de servicio |
| Componente (cable, o-ring, racor…) | 497 | rara vez |
| Kit / juego | 404 | es un conjunto, no un modelo |
| Seguridad / EPP | 291 | otra familia, otros atributos |

Y por marca, separando repuestos de herramientas:

| marca | sin técnica | repuestos | **herramientas** |
|---|---:|---:|---:|
| (SIN MARCA) | 5.502 | 78 | **4.408** |
| TOHNICHI | 2.736 | 0 | **2.664** |
| INGERSOLL RAND | 676 | 0 | **596** |
| FIAM | 3.374 | 3.223 | **144** |
| FEIN | 130 | 79 | **44** |
| SPEEDRILL | 112 | 0 | **110** |
| CHICAGO PNEUMATIC | 24 | 1 | **23** |
| ESTIC | 27 | 0 | **22** |

**El universo enriquecible con marca identificada es ~3.640 herramientas**, no
21.000. TOHNICHI solo es el 73 % de eso.

---

## 4 · Taxonomía (A5)

### 4.1 · Ocho «marcas» que son el prefijo del SKU

`BR`, `GE`, `KI`, `MI`, `NA`, `RR`, `SI`, `TO` — 22 productos. No son marcas: son
las dos primeras letras del SKU. La marca real está en el nombre.

| marca falsa | marca real | ¿ya existe bien escrita? |
|---|---|---|
| `GE` | GEDORE | **sí** — duplicada |
| `TO` | TORERO | **sí** — duplicada |
| `KI` | KING TONY | no |
| `MI` | MILWAUKEE | no |
| `NA` | NAC | no |
| `RR` | RED ROOSTER | no |
| `SI` | SIOUX | no |
| `BR` | **BREMEN *y* BROPPE** | no — dos marcas distintas bajo una |

No se fusiona nada: se reporta (A5).

### 4.2 · Los 5.509 sin marca

**677** empiezan con una marca que ya existe en la tabla → propuesta MEDIUM en el
CSV. El resto necesita ojo humano, y lo digo explícitamente: agrupar por la
primera palabra del nombre devuelve una lista que **mezcla marcas reales con
sustantivos** — NORMECO, MACSI, OHMI, SUMAKE, ACRADYNE, QIMAROX conviven con
CAÑO, MARTILLO, PISTOLA, MANGUERA, TIJERA. No voy a proponer altas de marca a
partir de una palabra suelta.

Un caso aparte: **194 productos empiezan con «Mercedes»** («Mercedes
Benz.Modelo ULT-100-RK»). Mercedes Benz es un **cliente**, no una marca. Si eso
se asignara como marca, el catálogo mostraría una marca que no existe.

### 4.3 · Duplicados (A12) — 48 grupos, 96 productos

Todos son **el mismo producto con dos notaciones de SKU**:

```
SPEEDRILL J2312H      SP.J23-1/2H       ·  SP.J2312H
SPEEDRILL J2312HTEF   SP.J23-1/2H/TEF   ·  SP.J2312H/TEF
APEX      22MM13      AP.2.2MM13        ·  AP.22MM13
FIAM      FIAG60RA    FI.AG60-RA        ·  FI.AG60RA
```

Mismo marca+modelo normalizado, dos SKU. **No se fusionan.** Hay que decidir cuál
es el SKU vigente, y eso es dato propio de Buscatools (A1): no lo resuelve
ninguna web.

---

## 5 · Fuentes oficiales (A14)

| marca | dominio oficial | tipo | accesible | verificado |
|---|---|---|---|---|
| TOHNICHI | `tohnichi.com`, `en.global-tohnichi.com` | web + PDF | sí | **sí** |
| FIAM | `fiamgroup.com` | web + catálogos | sí | parcial |
| INGERSOLL RAND | `powertools.ingersollrand.com` | asset library | sí | parcial |
| APEX | `apex-tools.com` | web oficial | sí | no |
| FEIN | `fein.com` | web oficial | sí | no |
| CHICAGO PNEUMATIC | `cp.com` | web oficial | sí | no |

**Prueba de viabilidad, con evidencia.** Busqué nuestro modelo exacto
`CEM360N3X22D-G-BTA` en el sitio de Tohnichi. Lo resuelve, y además lo devuelve
bajo `/products/parts-discontinued-models/discontinued/` — es decir, **el propio
fabricante nos dice que está descontinuado**. Eso contesta A15 sin adivinar: «no
aparece en el catálogo de hoy» se puede distinguir de «es un modelo histórico».

Y existe **un PDF único, `Reference-Guide-2025.10`, 14 MB, que cubre toda la
línea Tohnichi**. Es exactamente el patrón de A18: se procesa una vez y sirve
para los 2.664 productos, en lugar de 2.664 visitas.

### Lo que NO es fuente oficial, y hoy lo parece

- **`apexbits.com.ar`** — origen de **3.544 imágenes**. No es APEX: es el sitio
  de **TorqueTools**, distribuidor, que además es la otra empresa de este mismo
  ERP. El oficial es `apex-tools.com`.
- **`www.buscatool.com`** — origen de **5.315 imágenes**. Es nuestro propio sitio
  viejo.

**Ninguna de las 8.859 imágenes viene de un fabricante.** Para derechos de uso es
buena noticia; para «imagen oficial» significa que ese camino está sin explorar.

---

## 6 · Imágenes (A10) — inventario, sin tocar nada

| | |
|---|---:|
| Productos sin imagen | **14.305** (66 %) |
| Productos con imagen | 7.523 |
| Filas de imagen | 8.859 |
| **URLs distintas** | **3.317** |
| Filas que comparten URL con otro producto | **7.138** |
| Guardadas en nuestro storage | **0** — todo enlazado a sitios externos |
| Rotas al última verificación | 3 |

El número que importa es el tercero contra el cuarto: 8.859 filas y 3.317 URLs.
**La mayoría no son fotos del producto, son diagramas de familia.** Un ejemplo
medido: `page-008-fam-3.png` ilustra **77 productos distintos**.

Esto es directamente relevante para la Etapa B: un comparador que ponga la misma
imagen a 77 productos no compara nada, y peor, parece que sí.

Todo está **hotlinkeado**: si `buscatool.com` o `apexbits.com.ar` se caen o
reorganizan, el catálogo se queda sin imágenes.

---

## 7 · Atributos por familia (A6) — el esquema ya existe

| categoría | productos | claves presentes |
|---|---:|---|
| **Otros** | **12.588** | **ninguna** |
| Puntas y tubos | 8.623 | encastre (8.281), largo (7.763), medida (4.367), sufijos (3.155) |
| Balanceadores | 376 | modelo, longitud, min_kg, max_kg, carcasa — **100 %** |
| Atornilladores | 129 | torq_min, torq_max, ergonomía — 100 %; encastre 120; alimentación 91 |
| Accesorios | 43 | modelo, torq_min/max, código |
| Llaves de impacto | 7 | voltaje, rpm, encastre, torque, peso |
| Remachadoras | 4 | peso, rpm, encastre, voltaje |
| Pendiente de clasificación STEL | 53 | ninguna |
| Herramientas | 3 | ninguna |
| Llaves dinamométricas | 2 | medida, largo, encastre, modelo |

Las tres familias que describe A6 —puntas/tubos, balanceadores,
atornilladores— **ya están modeladas y completas**. El problema no es el
esquema: es que **12.588 productos (58 %) están en «Otros»**, una categoría que
no es una familia y no tiene atributos que llenar.

Antes de enriquecer atributos hay que **clasificar**. Cargar un torque en un
producto cuya familia dice «Otros» no lo hace comparable con nada.

---

## 8 · Archivos

| archivo | qué es |
|---|---|
| `scripts/fase22-a-auditoria-maestro.mjs` | la auditoría, reproducible |
| `correcciones-propuestas.csv` | 701 filas, **no aplicadas** |
| `.cache-legacy-productos.json` | copia local del legacy (ignorada por git) |

El CSV tiene las columnas que pide A17: `product_id`, `sku`, `brand`, `model`,
`field`, `current_value`, `legacy_value`, `official_value`, `proposed_value`,
`source`, `reference`, `confidence`, `reason`.

`official_value` va **vacío en las 701 filas**: esta corrida no consultó
fabricantes producto por producto. Llenarla con el legacy y llamarla «oficial»
sería declarar verificado algo que no se miró.

**Responsabilidad de red (A18):** el legacy es **un archivo estático de 15 MB**,
así que toda la comparación de 21.772 productos costó **una descarga**, cacheada.
Las consultas a fabricantes fueron **4**, todas para identificar fuentes, ninguna
masiva.

---

## 9 · Lo que esta auditoría NO hizo

Para que no se lea más de lo que dice:

1. **No verificó ningún producto contra el fabricante.** `EXACT_OFFICIAL = 0` es
   un hecho, no una estimación. Se probó que es **viable** para Tohnichi; no se
   ejecutó.
2. **No abrió los PDF oficiales.** El de Tohnichi está identificado y medido
   (14 MB, toda la línea); no se procesó.
3. **No auditó imágenes una por una.** Se inventarió la tabla; no se comparó cada
   imagen contra el modelo que ilustra.
4. **No resolvió los 4.408 sin marca que no son sugeribles.** Hace falta una
   pasada humana, o una lista de marcas válidas que hoy no existe.
5. **No decidió qué SKU es el vigente** en los 48 grupos duplicados. Es dato
   propio, no lo dice ninguna web.

---

## 10 · Qué haría, y en qué orden

Cada paso deja el siguiente más barato.

1. **Clasificar los 12.588 de «Otros»** en familias. Sin esto, cualquier atributo
   que se cargue queda huérfano. Se puede hacer con nuestros propios datos: el
   nombre y el SKU alcanzan para separar repuestos, EPP, consumibles y
   herramientas.
2. **Separar los 3.391 repuestos** en su propia categoría. Dejan de contar como
   «producto sin ficha» y el hueco real pasa de 12.637 a ~8.000.
3. **TOHNICHI desde el PDF oficial** — 2.664 herramientas, una fuente, un
   procesamiento. Es el mejor retorno del catálogo.
4. **Las 8 marcas-prefijo**, incluida la fusión de `GE`→GEDORE y `TO`→TORERO, y
   la separación de BREMEN/BROPPE. 22 productos: es chico y es correctitud.
5. **Los 677 sin marca con sugerencia**, revisados a mano contra el CSV.
6. **Imágenes**: decidir si se bajan a nuestro storage, y marcar cuáles son
   diagrama de familia y cuáles foto de producto. La Etapa B depende de esa
   distinción.

**Para la Etapa B:** el comparador es viable **hoy** sobre las 9.180 del catálogo
técnico —puntas y tubos, balanceadores, atornilladores tienen atributos
completos y comparables—. Sobre los 12.592 de STEL no hay con qué comparar, y
conviene que la pantalla lo diga en vez de mostrar un comparador vacío.

Un hallazgo que sirve directo: **1.705 productos del legacy ya traen
equivalencias cargadas** (`sim_sp`, y `sim_tc`/`sim_cp`/`sim_ir` en 10 cada uno)
— pares de producto declarados como similares, que hoy el ERP no importó.
