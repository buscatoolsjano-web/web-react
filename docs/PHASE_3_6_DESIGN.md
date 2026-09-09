# Fase 3.6 — Catálogo funcional completo · diseño

**Nada implementado.** Entrega A–K para revisión. Medido contra los 21.772
productos reales, no estimado.

---

## A. Auditoría de las facetas actuales

Estado del código hoy ([`services/facetas.ts`](../src/modules/catalogo/services/facetas.ts),
[`CatalogoFiltros.tsx`](../src/modules/catalogo/components/CatalogoFiltros.tsx)):

| filtro | de dónde salen las opciones | ¿depende del contexto? | ¿conteo? |
|---|---|---|---|
| Categoría | las 8 de la empresa | **no** | no |
| Marca | las 25 activas de la empresa | **no** | no |
| Serie | `<input type="text">` libre | — | no |
| Atributos | claves de la N:N por categoría | sólo **qué** claves, no **qué valores** | no |
| Valores de atributo | `<input>` libre — hay que adivinar | **no** | no |

Las tres consultas (`listarMarcas`, `listarCategorias`,
`listarAtributosPorCategoria`) son incondicionales y se cachean 5 minutos.
Ninguna recibe el contexto de filtros.

### Cuánto duele, medido

| categoría | productos | marcas **con** productos | marcas en el desplegable |
|---|---:|---:|---:|
| `punta` | 8.623 | **2** | 25 |
| `balanceador` | 376 | **3** | 25 |
| `atornillador` | 129 | **3** | 25 |
| `llave-de-impacto` | 7 | **1** | 25 |
| `otros` | 12.588 | 21 | 25 |

En `balanceador`, 22 de las 25 marcas del desplegable (88 %) llevan a cero
resultados. En `punta`, 23 de 25.

---

## A2. Subcategorías — auditoría de la taxonomía del legacy

Pediste que las categorías tengan subcategorías, tomando como base la web
anterior. Auditado.

### La buena noticia: el dato ya está migrado

La subcategoría del legacy es el campo `tipo`, y **ya está en la base** como
`products.product_type`, poblado en el 100 % de los productos que lo tenían.
No hay que importar nada.

| categoría | productos | subtipos | sin subtipo |
|---|---:|---:|---:|
| `otros` | 12.588 | **0** | **12.588** |
| `punta` | 8.623 | **21** | 3 |
| `balanceador` | 376 | 1 | 0 |
| `atornillador` | 129 | 5 | 0 |
| `accesorio` | 43 | 13 | 0 |
| `llave-de-impacto` | 7 | 1 | 0 |
| `remachadora` | 4 | 1 | 0 |
| `llave-dinamometrica` | 2 | 1 | 0 |

**Donde más rinde es `punta`**: 8.623 productos que hoy no se pueden filtrar
por subtipo y que se abren en 21 —Embocadura 4.279, Extensión 802, Allen 572,
Adaptador 568, Torx 463, Cardánico 284, Phillips 250, Plana 218…—. Es el
segundo bloque más grande del catálogo y hoy es un muro.

### Lo que NO está correcto en esa taxonomía

Seis problemas, todos medidos:

**1. `otros` no tiene subcategorías. Ninguna.** 12.588 productos (57,8 %) con
`product_type` vacío, **cero atributos**, **cero series**. La única faceta
posible ahí es la marca —que sí discrimina: FIAM 3.374, TOHNICHI 2.736,
INGERSOLL RAND 676, y 5.456 sin marca—. **Las subcategorías no ayudan a la
mayor parte del catálogo.**

Y no hay de dónde sacarlas: verifiqué `_apexFamilyTitle`, que un documento
mío anterior proponía para esto, y **0 de sus 3.807 productos están en
`otros`** (3.557 ya están en `punta`). Corregido en
[`database/CATALOG_DATA_CLEANUP.md`](database/CATALOG_DATA_CLEANUP.md).

**2. `Gatillo` cruza tres categorías** — `atornillador` (29),
`llave-de-impacto` (7), `remachadora` (4). Es el **único** valor que lo hace,
pero alcanza para que un árbol estricto no funcione: habría que duplicarlo
como tres hijos distintos. Es el mismo problema que ya demostramos con los
atributos en la Fase 3.5, cuando probamos que conjuntos que se solapan sin
anidarse no se representan con un árbol.

Además `Gatillo` no es un tipo de producto: es el accionamiento. Convive con
`Atornillador Pistola` y `Atornillador Recto Neumático`, que sí lo son. La
lista mezcla dos criterios.

**3. Tres subtipos degenerados**: `balanceador → "Balanceador"`,
`llave-dinamometrica → "Llave dinamométrica"`. Un solo hijo con el nombre del
padre no filtra nada; la UI no debería dibujarlo.

**4. `accesorio` tiene `-` como subtipo** en 8 de 43 productos (19 %).
Marcador de ausencia, igual que en `encastre`. En tu captura aparece como un
chip vacío entre «Todas» y «Adaptador Programación».

**5. Duplicado probable**: `Atornillador Angular` (6) y
`Atornillador Angular Neumático` (20). Y hay diferencias de caja entre el
dato (`Cabezal angular`) y tu captura (`Cabezal Angular`) — la UI del legacy
capitaliza para mostrar. Eso es presentación, no dato.

**6. Tu captura muestra 5 chips, pero hay 8 categorías.** Los 13 productos de
`llave de impacto` (7), `remachadora` (4) y `llave dinamométrica` (2) no
tienen chip: sólo se llega a ellos por «Todos». `21772 = 8623 + 376 + 129 +
43 + 12588 + 13`.

### Propuesta: subcategoría como faceta, no como árbol

**No agrego `parent_id` a `product_categories`.** Por `Gatillo`: un árbol
obligaría a duplicarlo o a mentir sobre a qué categoría pertenece.

En cambio, `product_type` entra como **una faceta más**, la primera después
de categoría. Con eso se obtiene, sin schema nuevo:

- **Dependencia gratis.** Elegir `punta` hace que la faceta de subtipo traiga
  sólo sus 21 valores con sus conteos. Elegir `Gatillo` hace que la faceta de
  categoría traiga las tres donde existe — que es la verdad, no un error.
- **Conteos.** `Embocadura (4279)`, `Extensión (802)`, exactamente como pediste.
- **Se esconde sola cuando no sirve.** Si la faceta trae 0 valores (`otros`) o
  1 solo con el nombre del padre (`balanceador`), no se dibuja. Regla de
  datos, no 8 casos en el código.
- **La UI puede verse igual que tu captura**: una fila de chips bajo la de
  categorías. Que por detrás sea una faceta y no un árbol no se nota.

Si más adelante querés una jerarquía real y editable, el camino es una tabla
`product_subcategories` con N:N a categorías —igual que resolvimos los
atributos— y no un `parent_id`.

### Qué cambia en el resto del diseño

- La RPC suma `p_type text[]` y devuelve la faceta `types`.
- La URL suma `tipo` (multi-valor): `#/catalogo?cat=punta&tipo=Torx&tipo=Allen`.
- La limpieza de valores suma `accesorio → '-'` (8 productos) al Bloque 3, y
  `Atornillador Angular` / `Atornillador Angular Neumático` a los casos que
  necesitan tu criterio.
- Tests nuevos: `F13` subtipos de `punta` = 21 con conteos correctos ·
  `F14` `Gatillo` devuelve las 3 categorías · `F15` la faceta no se dibuja en
  `otros` ni en `balanceador`.

---

### Un agujero que las facetas cierran solas

`otros` —12.588 productos, el 57,8 % del catálogo— tiene **0 filas** en la
N:N `product_attribute_categories`, así que
[`filtrarAtributosDeCategoria`](../src/modules/catalogo/lib/atributosPorCategoria.ts)
cae al fallback de mostrar los 15 atributos filtrables, casi ninguno
aplicable.

Con facetas eso se corrige sin tocar la taxonomía: si las claves disponibles
se derivan del **conjunto de resultados** en vez de la tabla N:N, `otros`
recibe exactamente las claves que sus productos tienen. La N:N pasa de ser la
fuente de verdad a ser un orden de presentación.

---

## B. Diseño SQL/RPC

**Una sola RPC**, `public.catalog_facets`, `SECURITY INVOKER`, misma firma de
filtros que `search_products` para que ambas describan el mismo conjunto.

```sql
catalog_facets(
  p_company  uuid,
  p_query    text  default null,
  p_category uuid  default null,
  p_brand    uuid   default null,
  p_type     text[] default null, -- subcategoría (products.product_type)
  p_attrs    jsonb  default null  -- {"encastre":["1/4 HEX","3/8 SQ"], ...}
) returns jsonb
```

### Por qué una y no siete

Medido (§I): la pasada completa sobre el catálogo entero cuesta 423 ms y el
caso típico 64 ms. Siete round-trips no serían siete veces más caros en CPU,
pero sí siete veces la latencia de red (~200 ms cada uno en la medición
real) — que es el término dominante. **Una request.**

### La regla de exclusión (§3 del pedido)

Cada faceta se calcula con todos los filtros activos **menos el suyo**:

| faceta | filtros que se aplican |
|---|---|
| marcas | query + categoría + subtipo + atributos |
| categorías | query + marca + subtipo + atributos |
| **subtipos** | query + categoría + marca + atributos |
| atributo `k` | query + categoría + marca + subtipo + **los demás** atributos |
| `total` | **todos** |

En SQL es un `universo` (empresa + query + RLS) y predicados booleanos por
fila, agregados con `FILTER (WHERE …)`. No hace falta una pasada por faceta.

### Forma

```sql
create function public.catalog_facets(...) returns jsonb
language sql stable security invoker
as $$
with universo as (          -- RLS se aplica acá, una sola vez
  select p.id, p.brand_id, p.category_id, p.attributes
  from products p
  where p.company_id = p_company
    and (p_query is null or p.search_vector @@ plainto_tsquery('spanish', p_query))
),
marcado as (                -- un booleano por filtro, calculado una vez por fila
  select u.*,
         (p_category is null or u.category_id = p_category) as ok_cat,
         (p_brand    is null or u.brand_id    = p_brand)    as ok_marca,
         app.attrs_match(u.attributes, p_attrs)             as ok_attrs
  from universo u
)
select jsonb_build_object(
  'total',      (select count(*) from marcado where ok_cat and ok_marca and ok_attrs),
  'brands',     (select ... from marcado where ok_cat and ok_attrs   group by brand_id),
  'categories', (select ... from marcado where ok_marca and ok_attrs group by category_id),
  'attributes', (select ... from marcado where ok_cat and ok_marca   ...)
);
$$;
```

Para `attributes` hace falta excluir **cada clave de sí misma**, no el bloque
entero: al calcular las opciones de `encastre` se aplican los demás
atributos pero no `encastre`. Se resuelve con `app.attrs_match_except(attrs,
p_attrs, key)` dentro del `lateral` que desanida las claves.

`deleted_at`, `status`, `company_id` y el rol **no aparecen** en la función:
los pone RLS. Ver §8 del pedido y la nota de seguridad más abajo.

### Alternativas descartadas

- **B) una RPC por faceta.** 7 round-trips de ~200 ms cada uno.
- **C) vista materializada de facetas.** Habría que refrescarla en cada
  cambio de producto y **no puede respetar RLS**: los conteos quedarían
  precalculados sobre el universo completo. Rompe §8.
- **Calcular en el cliente.** Descargar 21.772 productos. Descartado por el
  propio pedido.

---

## C. Ejemplo de respuesta

Contexto: `cat=balanceador`, sin marca ni atributos.

```json
{
  "total": 376,
  "brands": [
    { "id": "…", "name": "TECNA",             "count": 268 },
    { "id": "…", "name": "Chicago Pneumatic", "count":  81 },
    { "id": "…", "name": "Ingersoll Rand",    "count":  27 }
  ],
  "categories": [
    { "id": "…", "slug": "otros",       "name": "Otros",        "count": 12588 },
    { "id": "…", "slug": "punta",       "name": "Punta",        "count":  8623 },
    { "id": "…", "slug": "balanceador", "name": "Balanceador",  "count":   376 }
  ],
  "types": [
    { "value": "Balanceador", "count": 376 }
  ],
  "attributes": {
    "carcasa": { "kind": "enum", "values": [
      { "value": "ALUMINIO",   "label": "Aluminio",   "count": 292 },
      { "value": "INOXIDABLE", "label": "Inoxidable", "count":  56 },
      { "value": "NYLON",      "label": "Nylon",      "count":   9 }
    ]},
    "max_kg": { "kind": "range", "min": 0.5, "max": 180, "unit": "kg", "count": 376 },
    "longitud": { "kind": "enum", "unit": "m", "values": [
      { "value": "2.5", "count": 143 }, { "value": "3", "count": 93 }
    ]}
  }
}
```

Los conteos de `brands` son **con** la categoría aplicada; los de
`categories`, **sin** ella — por eso `balanceador` aparece ahí con sus 376 y
las demás con sus totales. Es la regla de exclusión, visible en la respuesta.

Tamaño estimado del peor caso (sin filtros, 1.373 pares clave/valor
distintos medidos): ~60 KB de JSON. Si molesta, se recorta con
`limit`/`others` por faceta.

---

## D. Discretos vs numéricos

**No se impone una UI.** El `kind` se decide por atributo con una regla
medible, y la medición ya está hecha:

| regla | resultado | UI |
|---|---|---|
| ≤ 12 valores distintos | `carcasa` (6), `longitud` (11), `ergonomia` (3), `eslinga` (3), `voltaje` (2) | **dropdown / chips** |
| > 12 valores y **100 % numéricos** | `largo` (176, 3–600 mm), `min_kg` (40), `max_kg` (42), `torq_min` (48), `torq_max` (63) | **rango min/máx** |
| > 12 valores y **mixtos** | `encastre` (35), `medida` (258) | **multiselect con buscador** |
| ≈ 1 valor por producto | `modelo` (512/513) | **no es filtro** |
| 1 solo valor | `alimentacion` | **no es filtro** |

Dos casos que **no** siguen la intuición y por eso conviene medir antes:

- **`rpm`** está declarado `number` pero 22 de sus 24 valores son rangos de
  texto (`0-2600`, `50-800`). **No puede ser un filtro de rango.** Va como
  dropdown de valores literales.
- **`medida`** tiene 258 valores pero sólo 71 son numéricos: mezcla métrico
  (`10`, `8`), imperial (`1/2"`, `9/16"`) y calibres (`#2`). Un rango
  numérico daría resultados falsos.

Los pares `min_*`/`max_*` (`min_kg`/`max_kg`, `torq_min`/`torq_max`)
describen **un rango del producto**, no dos atributos independientes. La UI
debería ofrecer un control «capacidad entre X e Y» que devuelva los productos
cuyo rango **se solapa** con el pedido. Es una decisión de producto: lo dejo
señalado, no resuelto.

---

## E. Auditoría de valores sucios

Está completa en
**[`CATALOG_FILTER_VALUE_CLEANUP.md`](CATALOG_FILTER_VALUE_CLEANUP.md)**, con
el mapeo canónico propuesto y separado en tres bloques por nivel de
confianza. **Nada aplicado.**

Titular: el catálogo está más limpio de lo que sugería `encastre`. Cero
espacios sobrantes, cero valores vacíos, un solo marcador de ausencia (`-`).
De los 35 valores de `encastre`, **una sola** colisión es puramente
tipográfica (`1/4 HEX` / `1/4 Hex`, 9 productos); el resto exige criterio
comercial.

**Las facetas no dependen de esa limpieza.** Con conteos, `1/4 Hex (9)` y
`1/4 HEX (1167)` se ven como dos opciones y el usuario elige — hoy tiene que
adivinar la cadena exacta. La limpieza mejora el resultado; no lo bloquea.

---

## F. Estrategia de imágenes

### Lo que hay, medido sobre el JSON legacy

| | |
|---|---:|
| Productos con imagen | **7.523** (34,6 %) |
| Productos sin imagen | **14.249** (65,4 %) |
| Referencias totales | 8.859 |
| **Archivos distintos** | **3.317** |
| Con 1 imagen | 6.187 |
| Con 2 imágenes | 1.336 |
| **Con 3 o más** | **0** |

**Ningún producto tiene más de dos imágenes.** Eso simplifica la galería
entera.

El campo `imgs` es **siempre** un array. Todas las URLs son HTTPS. Dos
dominios, y no son lo mismo:

| dominio | URLs | refs | reuso máx | qué son |
|---|---:|---:|---:|---|
| `www.buscatool.com` | 2.990 | 5.315 | 52 | fotos de producto (WordPress) |
| `apexbits.com.ar` | **327** | 3.544 | **77** | **diagramas de página de catálogo**, compartidos |

Los 327 de APEX son diagramas (`/images/diagrams/page-011-…`) que se repiten
en hasta 77 productos. **No son fotos del producto** y conviene marcarlos
distinto: como «diagrama de catálogo», no como imagen principal.

### Disponibilidad y peso, medidos

Muestra de 30 URLs: **30/30 responden 200**. Pesos entre **12 KB y 62 KB**.
Tipos `image/jpeg` y `image/png`.

WordPress genera miniaturas y **existen**:

| variante | peso |
|---|---:|
| original | 24–60 KB |
| `-768x768` | 14,7 KB |
| `-300x300` | **3,5 KB** |
| `-150x150` | 1,4 KB |
| `-1024x1024` | 404 |

**Pero no siempre**: 17 de 28 probadas (61 %) tienen `-300x300`; las de
apexbits, **ninguna**. Así que **no se puede reescribir la URL a miniatura a
ciegas** — un 39 % daría imagen rota.

### Propuesta

**Ahora (Fase 3.6):** consumir la URL legacy tal cual, sin migrar a Storage.
Con 50 productos por página y ~35 % con imagen, son ~17 imágenes × ~40 KB ≈
**700 KB por página**, con `loading="lazy"` así que sólo se descarga lo
visible.

**Un paso opcional que rinde mucho:** un script administrativo que pruebe una
vez las 3.317 URLs distintas y guarde la miniatura **cuando exista**. 3.317
peticiones HEAD, offline, sin tocar el frontend. Bajaría el peso del listado
de ~700 KB a ~60 KB donde haya miniatura. Lo propongo como paso separado y
aprobable aparte.

**Después (fase de Storage):** migrar los 3.317 archivos. El modelo de §G ya
lo contempla sin volver a migrar datos.

Obligatorio en cualquier caso: `width`/`height` fijos en el CSS para que no
haya CLS, placeholder mientras carga, y `onError` que deja el placeholder en
vez de un icono roto.

---

## G. Cambios de schema

### G1 · `product_images` (nueva tabla)

No meto un array de URLs en `products`. La razón concreta: hoy ya hacen falta
dos atributos por imagen (orden y si es diagrama), y con Storage harán falta
tres más (`storage_path`, `width`, `height`). Un array de strings no los
aguanta y obligaría a migrar dos veces.

```sql
create table product_images (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  product_id    uuid not null references products(id)  on delete cascade,
  source_url    text,          -- URL legacy; null cuando ya esté en Storage
  storage_path  text,          -- se completa en la fase de Storage
  thumb_url     text,          -- miniatura verificada, null si no existe
  kind          text not null default 'photo'
                check (kind in ('photo','diagram')),
  position      int  not null default 0,
  is_primary    boolean not null default false,
  alt_text      text,
  created_at    timestamptz not null default now(),
  check (source_url is not null or storage_path is not null)
);

create unique index uq_product_images_primary
  on product_images (company_id, product_id) where is_primary;
create index idx_product_images_producto
  on product_images (company_id, product_id, position);
```

El índice único parcial garantiza **una sola** imagen principal por producto.
`kind` separa las fotos de los diagramas de APEX.

RLS: `SELECT` con la misma condición que `products` (una imagen no puede ser
más visible que su producto); escritura sólo admin/employee.

Carga: 8.859 filas desde el JSON legacy, script idempotente por
`(product_id, source_url)`, con reconciliación como en la Fase 3.5.

### G2 · Índices para las facetas

```sql
create index idx_products_attributes_gin
  on products using gin (attributes jsonb_path_ops)
  where deleted_at is null and status = 'active';
```

`jsonb_path_ops` es más chico y más rápido que el GIN por defecto para
`@>`, que es el único operador que usan los filtros por atributo.

**No lo doy por bueno todavía**: hay que medir si el planner lo elige. Con
8.422 filas de 21.772 en `encastre`, la selectividad puede no justificarlo.
Va con EXPLAIN antes y después.

### G3 · Metadatos de faceta en las definiciones

```sql
alter table product_attribute_definitions
  add column facet_kind text
    check (facet_kind in ('enum','range','none'));
```

Para no recalcular en cada request la regla de §D ni hardcodearla en React.
Se puede poblar con una consulta a partir de los datos y revisar a mano.

### G4 · Lo que **no** cambio

- Ni una columna nueva en `products`.
- La taxonomía, intacta.
- `product_attribute_categories` (N:N) se queda: deja de decidir qué filtros
  existen y pasa a decidir su **orden**.

---

## H. Componentes React

### Nuevos

| componente | qué hace |
|---|---|
| `FacetaEnum` | dropdown ≤ 12 opciones / multiselect con buscador si hay más. Muestra conteos |
| `FacetaRango` | dos `number` min/máx con los extremos reales como placeholder |
| `PanelFacetas` | ordena las facetas y decide `kind` con `facet_kind` |
| `ChipsFiltrosActivos` | filtros aplicados, cada uno con ✕, más «Limpiar» |
| `HojaFiltrosMobile` | bottom sheet; el panel de escritorio no sirve en 390 px |
| `ImagenProducto` | `<img>` con caja fija, `loading="lazy"`, placeholder y `onError` |
| `ProductGallery` | principal + miniaturas + lightbox. **Diseñado en Fase 3 y nunca construido** |
| `Lightbox` | overlay, `Esc`, flechas, foco atrapado. Sin librería: con 2 imágenes máximo no se justifica |
| `TarjetaProducto` | card mobile (§12 del pedido) |

### Modificados

| archivo | cambio |
|---|---|
| [`CatalogoFiltros.tsx`](../src/modules/catalogo/components/CatalogoFiltros.tsx) | pasa de inputs libres a `PanelFacetas` |
| [`facetas.ts`](../src/modules/catalogo/services/facetas.ts) | agrega `obtenerFacetas()` contra la RPC |
| [`useCatalogoFacetas.ts`](../src/modules/catalogo/hooks/useCatalogoFacetas.ts) | `useFacetas(companyId, filtros)`; clave con `companyId` primero, `placeholderData` para que los conteos no parpadeen |
| [`useFiltrosCatalogo.ts`](../src/modules/catalogo/hooks/useFiltrosCatalogo.ts) | multi-valor por atributo en la URL |
| [`types/index.ts`](../src/modules/catalogo/types/index.ts) | `atributos: Record<string, string>` → `Record<string, string[]>`, y `rangos` |
| [`columnas.tsx`](../src/modules/catalogo/components/columnas.tsx) | columna de imagen; destacados por categoría |
| [`ProductoDetallePage.tsx`](../src/modules/catalogo/pages/ProductoDetallePage.tsx) | monta `ProductGallery` |

### Atributos destacados por categoría (§12), sin hardcodear

Los 2 primeros atributos filtrables de la categoría según `position` en la
N:N. Para `balanceador` da `medida, min_kg` — ajustable moviendo `position`,
que es dato, no código. Para `otros` (sin N:N) se usan las claves más
frecuentes del propio resultado.

### El bug de sincronización que no se puede reintroducir

[`busquedaDiferida.ts`](../src/modules/catalogo/lib/busquedaDiferida.ts)
existe porque en Fase 3 el valor con debounce pisaba el `?q=` de la URL. Las
facetas suman controles que escriben en la URL, así que la regla se mantiene:
**la URL es la única fuente de verdad**; los controles de faceta escriben
directo, sin debounce (son clicks, no tipeo); sólo el buscador de texto lleva
debounce y pasa por `debePropagarBusqueda`.

---

## I. Impacto de performance esperado

### Medido hoy, sin RLS (`EXPLAIN ANALYZE, BUFFERS`)

| escenario | tiempo | buffers |
|---|---:|---:|
| facetas, catálogo entero sin filtros (**peor caso**) | **424 ms** | 3.935 + temp 462 |
| facetas, con categoría (**caso típico**) | **64 ms** | 3.937 + temp 462 |

Desglose del peor caso: base 246 ms, faceta de marcas 269 ms, categorías
9 ms, atributos 142 ms. El desanidado de atributos produce sólo 1.373 pares
distintos sobre 28.289 valores: es barato.

### El bloqueante

Esos números son **sin RLS**. Con la policy actual, `products` paga hasta dos
llamadas `SECURITY DEFINER` por fila y el `count` exacto ya cuesta **6 s**
(§16 del pedido). La RPC de facetas es `SECURITY INVOKER` y hace **la misma
lectura**, así que heredaría el mismo coste.

**Sin el arreglo de RLS, las facetas no pueden funcionar.** Ya está analizado
y medido en
[`performance/RLS_COUNT_ANALISIS.md`](performance/RLS_COUNT_ANALISIS.md): de
6.088 ms a **8 ms**, con el Index Only Scan recuperado y los buffers de
47.473 a 210. Esa corrección es el **primer paso** de esta fase, no un
paralelo.

### Objetivo y margen

| escenario | objetivo | esperado con RLS corregida |
|---|---:|---:|
| carga inicial + facetas | < 800 ms | ~450 ms |
| cambio de categoría | < 400 ms | ~250 ms |
| cambio de marca / atributo | < 400 ms | ~250 ms |
| búsqueda + facetas | < 800 ms | ~500 ms |
| 4–5 filtros combinados | < 400 ms | ~250 ms |

Con ~200 ms de red por request, una sola RPC deja el resto de holgura al SQL.
Cualquier consulta que quede por encima de 500 ms de forma consistente se
analiza con `EXPLAIN ANALYZE` antes de tocar nada.

---

## J. Tests

Los del pedido, más los que agrego por lo que encontré midiendo.

**Facetas** — `F1` marcas de balanceador ⊆ marcas con balanceadores ·
`F2` categorías de TECNA · `F3` carcasa para balanceador+TECNA ·
`F4` **la faceta no se filtra a sí misma** (con `marca=TECNA` activo, la
faceta de marcas sigue trayendo las 3) · `F5` los conteos coinciden con
`count(*)` real · `F6` filtros + búsqueda · `F7` cambio de empresa recalcula
y limpia · `F8` un externo no infiere productos ajenos por los conteos.

**Agregados por hallazgos:** `F9` una faceta nunca ofrece una opción con
conteo 0 · `F10` `otros` (sin N:N) recibe facetas derivadas del resultado ·
`F11` `modelo` y `alimentacion` no aparecen como filtro · `F12` `rpm` se
ofrece como enum, nunca como rango.

**Imágenes** — `I1` una imagen · `I2` dos · `I3` sin imagen → placeholder ·
`I4` URL rota → fallback, sin icono roto · `I5` mobile · `I6` **una sola
`is_primary` por producto** (el índice único lo rechaza) · `I7` los
diagramas de APEX no se usan como imagen principal.

**URL** — `U1` compartir link · `U2` refresh · `U3` atrás · `U4` adelante ·
`U5` multi-valor (`?encastre=1/4+HEX&encastre=3/8+SQ`) sobrevive al viaje ·
`U6` `debePropagarBusqueda` sigue en verde (regresión del bug de Fase 3).

**RLS** — la batería de 5 roles después de tocar policies: otra empresa → 0,
lista ajena → 0, stock interno para externo → 0, inactivos según rol,
`search_products` y `catalog_facets` respetando RLS.

---

## K. Riesgos

| # | riesgo | probabilidad | mitigación |
|---|---|---|---|
| 1 | **La RPC de facetas hereda el coste de RLS y tarda segundos** | **alta si no se arregla primero** | El arreglo de RLS es el paso 1. Medido: 6.088 → 8 ms |
| 2 | El JSON de facetas es grande sin filtros (~60 KB, 1.373 pares) | media | Límite por faceta + «ver más»; medir antes de optimizar |
| 3 | Reescribir URLs a miniaturas rompe el 39 % | **alta si se hace a ciegas** | No reescribir. Verificar una vez, offline, y guardar sólo las que existen |
| 4 | 700 KB de imágenes por página en 4G | media | `loading="lazy"`; sólo se baja lo visible. La verificación de miniaturas lo bajaría a ~60 KB |
| 5 | Cambiar `atributos` de `string` a `string[]` rompe links compartidos | **alta** | El lector acepta ambas formas; un valor suelto se lee como array de uno |
| 6 | Depender de dominios externos: si `buscatool.com` cae, el catálogo queda sin fotos | media | `onError` → placeholder. La página funciona sin imágenes |
| 7 | Reintroducir el bug de sincronización input/URL/debounce | media | Las facetas escriben sin debounce; sólo el buscador pasa por `debePropagarBusqueda`, que ya tiene 7 tests |
| 8 | Los conteos filtran existencia de productos que el usuario no puede ver | **baja pero es seguridad** | `SECURITY INVOKER` + el `universo` se lee con RLS aplicada. Test F8 explícito |
| 9 | `product_images` con 8.859 filas se desordena al reimportar | baja | Idempotencia por `(product_id, source_url)`, como en Fase 3.5 |
| 10 | Normalizar valores rompe links compartidos que usan el valor viejo | media | La limpieza va **después** de las facetas y en bloques aprobados uno a uno |

### El riesgo que no es técnico

`otros` tiene 12.588 productos (57,8 %) sin clasificar. Las facetas lo hacen
**tolerable** —el usuario verá qué atributos existen ahí dentro— pero no lo
resuelven. Mientras más de la mitad del catálogo esté en una categoría
llamada «otros», el filtro por categoría sirve poco. Está en
[`database/CATALOG_DATA_CLEANUP.md`](database/CATALOG_DATA_CLEANUP.md) y
sigue siendo el problema de fondo del catálogo.

---

## Orden de ejecución propuesto

1. **Arreglar RLS** (`RLS_COUNT_ANALISIS.md`) + regresión de 5 roles. Bloquea todo lo demás.
2. RPC `catalog_facets` + medición antes/después.
3. `PanelFacetas` y componentes de faceta; URL multi-valor.
4. `product_images` + carga de las 8.859 filas + reconciliación.
5. `ImagenProducto`, `ProductGallery`, `Lightbox`.
6. Cards mobile y bottom sheet de filtros.
7. Tests, CI, deploy.

La limpieza de valores (`CATALOG_FILTER_VALUE_CLEANUP.md`) va **después** del
paso 3 y en bloques separados: no bloquea nada.
