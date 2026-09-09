# Imágenes del catálogo — verificación offline

Generado por [`scripts/verificar-imagenes-legacy.mjs`](../scripts/verificar-imagenes-legacy.mjs)
el 2026-09-09. Sólo peticiones `HEAD`: **no se descargó ninguna imagen, no se
tocó WordPress, no se migró nada a Storage.**

El informe completo (3.317 filas con `original_url`, `status`,
`thumbnail_exists`, `thumbnail_url`, `bytes_original`, `bytes_thumbnail`,
`host`, `clasificacion`) se escribió **fuera del repositorio**.

## Resultado

| | |
|---|---:|
| URLs distintas verificadas | **3.317** |
| Responden 200 | **3.315** |
| No responden | **2** (HTTP 503) |
| **Con miniatura verificada** | **1.624 (49,0 %)** |

### Por host

| host | URLs | con miniatura |
|---|---:|---:|
| `www.buscatool.com` (WordPress) | 2.990 | **1.624 (54,3 %)** |
| `apexbits.com.ar` | 327 | **0** |

### Clasificación (punto 12)

| clase | URLs | qué son |
|---|---:|---|
| `PRODUCT_IMAGE` | **2.990** | fotos de producto en WordPress |
| `SHARED_DIAGRAM` | **309** | diagramas de página de catálogo usados por **más de un** producto |
| `TECHNICAL_DIAGRAM` | 18 | diagramas usados por un solo producto |
| `UNKNOWN` | **0** | — |

Los 327 de apexbits viven en `/buscador/images/diagrams/page-NNN-…` y se
repiten en **hasta 77 productos**. No son fotos: son páginas del catálogo
APEX. Por eso van clasificados aparte y **nunca como imagen principal**.

### Pesos

| | mediana | máximo |
|---|---:|---:|
| original | **34,1 KB** | 652 KB |
| miniatura `-300x300` | **4,8 KB** | 10 KB |

Ahorro medio por imagen con miniatura: **28 KB**.

Peso total: originales **119,6 MB**; las 1.624 miniaturas suman **8,0 MB**.

### Impacto en una página de listado

50 productos, ~35 % con imagen ≈ 17 imágenes:

| estrategia | peso |
|---|---:|
| sólo originales | ~579 KB |
| miniatura cuando existe, original si no | **~335 KB** |

Con `loading="lazy"` sólo se descarga lo visible, así que el peso real es
menor. La mejora del 42 % es gratis: no requiere migrar nada.

### Content-type

`image/jpeg` 2.967 · `image/png` 345 · `image/webp` 3.

### Las dos que fallan

Dos URLs de `buscatool.com` (subidas 2026/06, marca DUROFIX) devuelven
**503**, usadas por 3 productos en total. Puede ser transitorio. En cualquier
caso el fallback las cubre: si el original falla, placeholder.

## La regla de miniaturas (punto 10)

Confirmada por la medición, y **no se puede relajar**:

1. Usar la miniatura **sólo** si `thumbnail_exists = true` en esta
   verificación. Nunca derivarla reescribiendo el nombre del archivo.
2. Si no existe miniatura verificada → **original**.
3. Si el original falla → **placeholder**.

Reescribir a ciegas rompería el **51 %** de las imágenes de WordPress y el
**100 %** de las de apexbits.

## Revisión pendiente

La verificación es una foto del 2026-09-09. Si se suben imágenes nuevas al
WordPress, hay que volver a correr el script para que las miniaturas nuevas
entren. No es un proceso automático.
