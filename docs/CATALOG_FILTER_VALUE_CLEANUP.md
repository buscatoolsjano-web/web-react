# Valores de filtro sucios — auditoría y mapeo propuesto

**Nada de esto está aplicado.** Es una propuesta que necesita tu aprobación
antes de tocar un solo dato.

Fuente: los 21.772 productos de Buscatools en la base, no el JSON legacy.
Fecha: 2026-09-09.

---

## Resumen: los 15 atributos filtrables

| clave | etiqueta | productos | valores | ¿limpio? | UI propuesta |
|---|---|---:|---:|---|---|
| `encastre` | Encastre | 8.422 | 35 | **no** | multiselect |
| `largo` | Largo (mm) | 7.765 | 176 | sí | **rango** |
| `medida` | Medida | 4.745 | 258 | sí\* | multiselect agrupado |
| `modelo` | Modelo | 513 | 512 | — | **quitar de filtros** |
| `min_kg` / `max_kg` | Capacidad (kg) | 376 | 40 / 42 | sí | **rango** |
| `longitud` | Long. de cable (m) | 376 | 11 | **no** | dropdown |
| `carcasa` | Material de carcasa | 376 | 6 | **no** | multiselect |
| `torq_min` / `torq_max` | Torque (Nm) | 173 | 48 / 63 | sí | **rango** |
| `ergonomia` | Ergonomía | 141 | 3 | sí | dropdown |
| `alimentacion` | Alimentación | 91 | **1** | — | **quitar de filtros** |
| `rpm` | Revoluciones | 57 | 24 | **no** | dropdown (no rango) |
| `voltaje` | Voltaje | 48 | 2 | **no** | dropdown |
| `eslinga` | Eslinga | 10 | 3 | sí | dropdown |

\* `medida` no tiene variantes equivalentes, pero mezcla tres sistemas de
unidades. Ver §5.

---

## 1. `encastre` — 35 valores, 8.422 productos

Es el filtro más usado y el más sucio. Los 35 valores, agrupados por
`upper(btrim(...))`:

**Una sola colisión pura de mayúsculas.** Todo lo demás son diferencias
reales de texto, no de tipografía:

| canónico propuesto | variantes | productos | confianza |
|---|---|---:|---|
| `1/4 HEX` | `1/4 HEX` (1.167) + `1/4 Hex` (9) | 1.176 | **alta** — sólo cambia la caja |
| `1-1/2 SQ` | `1-1/2 SQ` (49) + `1 1/2 SQ` (3) | 52 | **alta** — guion vs espacio |
| `1/2 SQ` | `1/2 SQ` (2.253) + `1/2 Cuadrado` (9) | 2.262 | **media** — SQ = *square* = cuadrado |
| `3/8 SQ` | `3/8 SQ` (929) + `3/8 Cuadrado` (8) | 937 | **media** — ídem |
| `1/4 SQ` | `1/4 SQ` (405) + `1/4 Cuadrado` (1) | 406 | **media** — ídem |

Los que **no** propongo tocar sin que lo decidas:

| valor | productos | por qué es una decisión tuya |
|---|---:|---|
| `1/4` | 41 | ¿es SQ, HEX o «sin especificar»? No se puede deducir |
| `3/8` | 29 | ídem |
| `1/2` | 19 | ídem |
| `3/4` | 5 | ídem |
| `-` | 11 | marcador de «sin dato». Propongo **borrar la clave**, no mapearla |
| `Cabezal hexagonal` | 9 | es una descripción, no una medida de encastre |

**El problema de fondo, que el mapeo no resuelve.** `encastre` mezcla dos
dimensiones independientes: la **medida** (`1/4`, `3/8`, `1/2`, `3/4`, `1`,
`5/16`, `7/16`, `5/8`, `9/32`, `1-1/2`) y el **tipo** (`SQ`, `HEX`, `QC`), más
calificadores sueltos (`BIT`, `con anillo`, `con bola`, `ERGO-DRIVE`).

Quien busque «1/4» hoy no encuentra los 1.176 de `1/4 HEX`. Separarlo en dos
atributos (`encastre_medida` + `encastre_tipo`) haría el filtro
verdaderamente útil, pero es un cambio de modelo, no una limpieza. Lo dejo
planteado; no lo incluyo en esta propuesta.

---

## 2. `longitud` — el mapeo más claro de todos

Unidad declarada: metros. Y sin embargo:

| canónico | variantes | productos |
|---|---|---:|
| `3` | `3` (93) + `3 MTS` (6) | 99 |
| `2.5` | `2.5` (143) + `2.5 MTS` (4) | 147 |

`3` y `3 MTS` son el mismo valor escrito de dos formas, con la unidad ya
declarada en la definición del atributo. **Confianza alta.**

Quedan sin tocar: `2` (82), `1.6` (27), `2.1` (8), `2.7` (6), `1.295` (3),
`1.35` (3), `0.9` (1). El `1.295` llama la atención — parece precisión falsa
para 1,3 m — pero no lo toco: sería inventar un dato.

---

## 3. `carcasa` — 6 valores, uno compuesto

```
ALUMINIO (292) · INOXIDABLE (56) · NYLON (9) · ACERO (6) · PLASTICO (4)
Doble ALUMINIO, recubierto de GOMA (9)
```

No hay duplicados. Dos observaciones:

- Todo en mayúsculas menos el compuesto. Es cuestión de **presentación**, no
  de datos: la UI puede mostrar «Aluminio» sin cambiar el valor almacenado.
- `Doble ALUMINIO, recubierto de GOMA` es una descripción, no un material.
  Como filtro es una opción con 9 productos que nadie va a elegir a
  propósito. **Decisión tuya:** dejarlo, o mapearlo a `ALUMINIO` y perder el
  matiz del recubrimiento.

---

## 4. `voltaje` y `alimentacion` — valores que no son valores

- `voltaje`: `20V` (44) y **`No`** (4). «No» no es un voltaje: es «no
  aplica». Propongo **borrar la clave** en esos 4, no mapearla.
- `alimentacion`: un único valor, `NEUMATICA` (91). Un filtro con una sola
  opción no filtra nada. Propongo **quitarlo de los filtrables**; el dato se
  sigue mostrando en la ficha.

---

## 5. `medida` — 258 valores, tres sistemas mezclados

No hay variantes equivalentes que corregir, pero el conjunto mezcla:

- métrico: `10` (166), `8` (132), `6` (127), `4` (111), `15` (108)…
- imperial: `1/2"` (100), `3/8"` (94), `9/16"` (87)…
- calibres: `#2` (112)…

Sólo 71 de los 258 son numéricos puros, así que **no se puede usar un rango
numérico**. Propongo multiselect con las opciones agrupadas por sistema
(métrico / imperial / calibre), derivando el grupo del formato del valor. No
requiere tocar datos.

---

## 6. `rpm` — declarado `number`, contiene rangos de texto

24 valores, y sólo 2 son números. Los demás son intervalos: `0-2600` (4),
`50-800` (4), `262-375` (3)… más `-` (9) y un `0-1200 / 0-1900 / 0-3000` que
son tres rangos en un campo.

`data_type = 'number'` es **incorrecto**. Corregirlo a `text` es seguro hoy
—el trigger valida que la clave exista, no el tipo— y evita que un futuro
validador rechace filas válidas.

Como filtro: dropdown de los valores tal cual. Un rango exigiría parsear
intervalos y decidir qué significa «RPM entre 500 y 1000» para un producto
`50-800`. Eso es una decisión de producto, no una limpieza.

**Mismo problema en otras dos claves** (ya anotado en
`database/CATALOG_DATA_CLEANUP.md`): `catalogo_pagina` declarada `text` con
valores numéricos, y `sufijos` declarada `text` conteniendo arrays.

---

## 7. `modelo` — 512 valores distintos sobre 513 productos

Es prácticamente un identificador único. Como filtro es inútil: cada opción
devuelve un producto. Propongo **quitarlo de los filtrables** y dejarlo como
dato de la ficha y como término de búsqueda (ya entra en `search_vector`).

---

## 8. Lo que NO encontré

Vale decirlo porque cambia el tamaño del trabajo:

- **Cero** valores con espacios al principio o al final.
- **Cero** valores vacíos (`''`).
- **Cero** URLs de imagen inválidas.
- Un solo tipo de marcador de ausencia: `-`, en `encastre` (11) y `rpm` (9).

El catálogo está bastante más limpio de lo que sugería el caso de `encastre`.

---

## Propuesta de ejecución

Si aprobás, en tres bloques separados y con conteos antes/después:

**Bloque 1 — confianza alta, sin criterio comercial** (61 productos)
`1/4 Hex → 1/4 HEX` · `1 1/2 SQ → 1-1/2 SQ` · `3 MTS → 3` · `2.5 MTS → 2.5`

**Bloque 2 — necesita tu confirmación** (18 productos)
`1/2 Cuadrado → 1/2 SQ` · `3/8 Cuadrado → 3/8 SQ` · `1/4 Cuadrado → 1/4 SQ`

**Bloque 3 — borrar la clave, no mapear** (24 productos)
`encastre = '-'` (11) · `rpm = '-'` (9) · `voltaje = 'No'` (4)

**Aparte, sin tocar datos:** `alimentacion` y `modelo` dejan de ser
filtrables; `rpm.data_type` pasa a `text`.

**Sin resolver, esperando decisión de negocio:** los `encastre` desnudos
(`1/4`, `3/8`, `1/2`, `3/4` — 94 productos), `Cabezal hexagonal`, el
`carcasa` compuesto, y la separación medida/tipo del encastre.

Cada bloque llevaría respaldo en JSON fuera del repositorio antes de
ejecutarse, igual que la limpieza de los 124 precios del seed.
