# Fase 3 — Catálogo en React · Diseño

Documento de diseño. **No hay código escrito todavía.** Fecha: 2026-09-08.

Base: schema de la Etapa 1 ya ejecutado y probado (121/121) sobre
`uaxcfufvapzulqvynanp`. Referencia funcional: `buscatoolsjano-web/Buscatools`,
clonado en solo lectura. **No se modificó nada del legacy.**

---

## A. Auditoría específica del catálogo legacy

### A.1 Dónde vive

| Función | Línea | Qué hace |
|---|---:|---|
| `renderCatalogo` | 15056 | Shell con tabs Productos / Servicios / Visor |
| `renderCatalogoProductos` | 15308 | La grilla: filtros, tabla, cards, paginado |
| `catalogoFilterSort` | 15920 | Filtrado y orden — **todo en el cliente** |
| `wireCatalogoProductos` | 17168 | ~40 `addEventListener` que mutan `state` y llaman `renderMain()` |
| `renderProductDetail` | 16489 | Modal de detalle |
| `openProducto` / `closeProducto` | 34397 / 34406 | Ruta `#/producto/<sku>` + SEO |
| `renderCatalogoAdminPrecios` | 13558 | Panel interno de override de precio y stock |
| `precioVentaProd` | 13496 | Cálculo del PVP |

### A.2 Estado que maneja

```js
state.catFilters = { q:'', ref:'', nombre:'', sr:'', sv:'', marca:'', cat:'', serie:'', dyn:{} }
state.catPage = 1
state.catPerPage = 50            // opciones: 10, 25, 50, 100, 200, 500
state.catSort, state.catCompare, state.catOpenSku, state.puntasPanels
```

Nada de esto está en la URL salvo `catOpenSku`. **Recargar la página pierde
todos los filtros**, y un filtro no se puede compartir por link.

### A.3 Columnas y datos que muestra

**Escritorio:** checkbox de comparación · imagen · SKU · Marca · Producto ·
Categoría · Serie · columnas dinámicas según categoría · Stock Real ·
Stock Virtual *(sólo interno)* · `pu` *(sólo interno)* · PVP · botones +/− de carrito.

**Celular (cards):** imagen · SKU · precio · nombre · marca · encastre ·
Real/Virtual · +/−.

**Detalle:** SKU, nombre, marca, modelo, categoría, tipo, descripción,
imágenes con lightbox, encastre, medida, largo, dimensiones de balanceador y
de caja, peso (g / kg / embalado), volumen, origen, NCM, `catalogo_id`,
`fob_eur`, `pu`, similares (`sim_cp`, `sim_ir`, `sim_sp`, `sim_tc`),
link externo, stock real y virtual, acceso al kardex.

### A.4 El control de acceso del legacy

```js
const isCatCliente = !esUsuarioInterno();
```

Una sola línea decide todo. Si es cliente, el `<td>` del precio de costo y el
del stock virtual **no se renderizan** — pero el objeto completo ya está en
`PRODUCTOS`, en memoria, en el navegador del cliente. **Ocultar es toda la
seguridad que hay.** Un `console.log(PRODUCTOS)` expone los 21.772 productos
con costos incluidos.

Este es el punto que la Fase 3 tiene que invertir: el servidor no debe
mandar lo que el usuario no puede ver.

### A.5 Filtros dinámicos por categoría (línea 15087)

```js
CATEGORY_FILTERS = {
  'puntas y tubos': ['medida','largo','encastre'],
  'balanceador':    ['min_kg','max_kg','carcasa','longitud','eslinga'],
  'atornillador':   ['torq_min','torq_max','ergonomia','tipo'],
  'punta':          ['tipo','medida','largo'],
}
```

Un objeto literal hardcodeado en JavaScript. Las 12 claves ya existen como
filas en `product_attribute_definitions` — salvo `tipo`, que en el modelo
nuevo es la columna `products.product_type`, y `serie`, que es
`products.series`.

### A.6 Las tres cosas que hay que cambiar sí o sí

**1. El precio se calcula en JavaScript.**

```js
function precioVentaProd(p){
  if (typeof p.precio_venta === 'number') return p.precio_venta;
  if (typeof p.pu === 'number') return p.pu * 3;      // ← markup 3× hardcodeado
  return null;
}
```

El margen comercial de la empresa está escrito en el frontend público. Con
abrir el archivo, cualquiera calcula el costo desde el precio de venta.

**2. La búsqueda es un `includes()` sobre todo el array.**

```js
const hay = ((p.sku||'')+' '+(p.nombre||'')+' '+(p.base||'')+' '+(p.marca||'')).toLowerCase();
return hay.includes(q);
```

Sin tolerancia a errores de tipeo, sin ranking, y recorriendo 21.772 objetos
en cada tecla.

**3. El paginado es cosmético.**

```js
const start = (state.catPage - 1) * PER;
rows = filtered.slice(start, start + PER);
```

Se descargan y filtran los 21.772 productos; se muestran 50. La opción de
"500 por página" existe porque el costo de traerlos ya se pagó.

Y detrás de todo eso, en `app.js` línea 4:

```js
_pxhr.open('GET','productos-data.json', false);   // false = síncrono
```

15,7 MB de JSON con XHR bloqueante antes de pintar el primer pixel.

### A.7 Los overrides en localStorage

`renderCatalogoAdminPrecios` guarda cambios de precio y stock en
`localStorage['erp_producto_overrides']` y después intenta sincronizarlos.
El resultado es que **el precio depende del navegador**: dos usuarios
internos pueden ver precios distintos del mismo SKU. En el modelo nuevo esto
desaparece por construcción — el precio vive en `product_prices` y no hay
lugar donde escribirlo localmente.

### A.8 Lo que sí vale la pena conservar

Cards de categoría clickeables · chips de subcategoría multi-selección ·
selects de encastre/tipo/medida/largo para puntas · rangos min/max para
balanceadores y atornilladores · comparación de productos · lightbox de
imágenes · exportar a CSV/Excel · ruta `#/producto/<sku>` con SEO
(title, description, canonical, Open Graph, JSON-LD `schema.org/Product`) ·
"Ver historial completo" hacia el kardex.

---

## B. Mapa Legacy → React

### B.1 Datos

| Legacy | Origen | Destino en el modelo nuevo |
|---|---|---|
| `p.sku` | JSON | `products.sku` |
| `p.nombre` | JSON | `products.name` |
| `p.marca` | texto libre | `products.brand_id` → `brands.name` |
| `p.cat` / `p.categoria` | texto libre | `products.category_id` → `product_categories` |
| `p.base` | texto | `products.model_code` |
| `p.serie` | texto | `products.series` |
| `p.tipo` | texto | `products.product_type` |
| `p.desc` | HTML | `products.description` / `description_long` |
| `p.origen`, `p.ncm` | JSON | `products.origin_country`, `ncm_code` |
| `p.peso_g`, `p.volumen_cm3` | JSON | `products.weight_g`, `volume_cm3` |
| `p.encastre`, `p.medida`, `p.largo`, `p.min_kg`, `p.max_kg`, `p.torq_min`, `p.torq_max`, `p.carcasa`, `p.longitud`, `p.eslinga`, `p.ergonomia`, `p.modelo`, `p.rpm`, `p.voltaje` | columnas sueltas | `products.attributes` (jsonb, validado por trigger) |
| `p.precio_venta` / `p.pu * 3` | **calculado en JS** | `product_prices.amount` en la lista que corresponda |
| `p.pu` (costo) | JSON, oculto por CSS | **no se expone**; el costo es de Compras (Fase 5) |
| `getEffectiveStock(p,'sr')` | JSON + overrides | `stock_balances.on_hand` |
| `getEffectiveStock(p,'sv')` | JSON + overrides | `stock_balances.on_hand − reserved` |
| `p.imgs[]` | URLs de WordPress | **queda igual por ahora**; migrar a Storage es fase aparte |
| `erp_producto_overrides` | localStorage | **se elimina** — no tiene equivalente ni debe tenerlo |

### B.2 Comportamiento

| Legacy | React |
|---|---|
| `state.catFilters` en memoria | search params de la URL (`useSearchParams`) — filtro compartible y recuperable al recargar |
| `renderMain()` completo en cada cambio | re-render de React sólo del subárbol afectado |
| `filtered.slice()` | `.range(from, to)` + `count: 'exact'` en PostgREST |
| `includes()` sobre 21.772 | `word_similarity` + `tsvector` en Postgres, con índice GIN |
| `isCatCliente` que oculta `<td>` | RLS: la columna **no llega** al navegador |
| `precioVentaProd()` con `pu*3` | fila en `product_prices`, elegida por RLS |
| `loadProductoOverrides()` | *(no existe)* |
| `#/producto/<sku>` con `replaceState` | ruta real de React Router: `#/catalogo/:sku` |
| `esUsuarioInterno()` sobre localStorage | `company_memberships.role` vía JWT real |

### B.3 Lo que NO se replica

XHR síncrono · `productos-data.json` · datos embebidos en el HTML ·
overrides en localStorage · filtrado y paginado en el cliente ·
`state` global mutable · `innerHTML` con concatenación de strings ·
ocultar columnas como mecanismo de seguridad.

---

## C. Diseño de queries

### C.1 Principio

> Cada request trae **una página** de datos y **sólo las columnas que el rol
> puede ver**. El filtrado de seguridad lo hace RLS; el de negocio, Postgres.
> React no filtra ni recorta nada por seguridad.

### C.2 Listado — 1 request

```ts
const { data, count } = await supabase
  .from('products')
  .select(`
    id, sku, name, series, product_type, attributes, is_kit, status,
    brand:brands ( id, name ),
    category:product_categories ( id, name, slug ),
    prices:product_prices ( amount, price_list_id )
  `, { count: 'exact' })
  .eq('company_id', companyId)
  .eq('prices.price_list_id', priceListId)
  .is('deleted_at', null)
  .eq('status', 'active')
  .order('name', { ascending: true })
  .range(from, from + pageSize - 1)
```

Tres cosas que no son obvias:

**`.eq('company_id', companyId)` no es redundante.** RLS filtra a *todas* las
empresas del usuario. Jano tiene dos membresías, así que sin este filtro
vería productos de Buscatools y de Torquetools mezclados. El filtro es
**funcionalmente necesario** para la empresa activa; RLS sigue siendo la
barrera de seguridad, y por eso pedir el `company_id` de una empresa ajena
devuelve cero filas en vez de datos.

**`.eq('prices.price_list_id', …)` filtra el embed, no el padre.** Sin
`!inner`, un producto sin precio igual aparece con `prices: []`. Hace falta:
**92 de 219 productos no tienen precio** en el dataset actual (42 %).

**El precio no trae moneda.** `product_prices` no tiene `currency_code`; la
moneda vive en `price_lists.currency_code`. Se resuelve una vez con
`usePriceLists()` y se aplica a toda la página.

Para usuarios internos se agrega `stock:stock_balances ( on_hand, reserved, warehouse_id )`.
Para externos **no se pide** — RLS lo denegaría igual, pero pedir lo que no se
puede leer es ruido.

### C.3 Búsqueda — decisión que requiere tu aprobación

PostgREST no puede expresar `word_similarity(q, name) > 0.4` en un filtro de
URL: sus operadores son `columna.operador.valor`, sin llamadas a función del
lado izquierdo. Hay tres caminos:

| Opción | Fuzzy | Ranking | Objeto nuevo en la DB |
|---|---|---|---|
| 1. `.textSearch('search_vector', q)` | ❌ | parcial | ninguno |
| 2. `.or('sku.ilike.%q%,name.ilike.%q%')` | ❌ | ❌ | ninguno |
| **3. RPC `app.search_products()`** | ✅ | ✅ | **1 función** |

La columna `products.search_vector` ya existe, es **GENERATED STORED** con
pesos A/A/B/C (sku, name / model_code / description) y tiene índice GIN. Se
mantiene sola: no hace falta trigger.

**Recomiendo la opción 3**, porque es la única que cumple lo que pediste
(`word_similarity > 0.4` ordenado por score) y la única que tolera errores de
tipeo. Es **una función nueva**, `SECURITY INVOKER` — sin `DEFINER`, para que
RLS siga aplicando con el JWT de quien llama:

```sql
CREATE FUNCTION app.search_products(
  p_company uuid, p_query text, p_limit int DEFAULT 50, p_offset int DEFAULT 0
) RETURNS TABLE (id uuid, score real)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $fn$
  SELECT p.id,
         GREATEST(
           extensions.word_similarity(p_query, p.name),
           extensions.word_similarity(p_query, p.sku)
         )::real AS score
  FROM products p
  WHERE p.company_id = p_company
    AND p.deleted_at IS NULL
    AND p.status = 'active'
    AND ( p.search_vector @@ websearch_to_tsquery('spanish', p_query)
       OR extensions.word_similarity(p_query, p.name) > 0.4
       OR extensions.word_similarity(p_query, p.sku)  > 0.4 )
  ORDER BY score DESC, p.name
  LIMIT p_limit OFFSET p_offset;
$fn$;
```

Full-text para lo que matchea exacto, trigram para lo que viene con un typo,
y `GREATEST` como score único para ordenar. Devuelve sólo `id` + `score`: los
datos de cada producto los trae después la query de C.2 con `.in('id', ids)`,
así **no hay una segunda definición de qué columnas ve cada rol**.

**Si preferís no crear la función, arranco con la opción 1** y lo documento
como limitación conocida. Decidilo vos.

### C.4 Disponibilidad — 1 request, sólo para externos

```ts
supabase.from('product_availability')
  .select('product_id, warehouse_id, is_available')
  .in('product_id', pageIds)
```

La vista es `security_invoker = false` con su propio filtro de empresa y
expone un solo booleano. **No se puede embeber**: las vistas no tienen FK
declarada, y PostgREST necesita una para inferir la relación.

**168 de 219 productos no tienen fila en `stock_balances`** (77 %). Sin fila
no hay fila en la vista, así que "ausente" significa *sin stock*, no *error*.
La UI muestra "Consultar" y nunca un espacio en blanco.

### C.5 Facetas — 2 requests, una vez por sesión

`brands` y `product_categories` de la empresa activa, con
`staleTime: 5 min`. Son 25 y 8 filas.

### C.6 Detalle — 1 request

Mismo `select` que C.2 más `description_long`, `origin_country`, `ncm_code`,
`weight_g`, `volume_cm3`, filtrado por `sku` en vez de por rango.

### C.7 Cuentas

| | Legacy | React |
|---|---|---|
| Requests al abrir el catálogo | 1 | 3–4 (listado + facetas + disponibilidad) |
| Requests al cambiar de página | 0 | 1–2 |
| **Bytes de la primera carga** | **≈ 24 MB** | **≈ 40 KB de datos** |
| Productos en memoria | 21.772 | 50 |

El legacy gana en cantidad de requests y pierde por tres órdenes de magnitud
en lo único que importa.

### C.8 Claves de caché

```ts
['catalog','products', companyId, priceListId, filters, page, pageSize, sort]
['catalog','product',  companyId, priceListId, sku]
['catalog','availability', companyId, pageIds]
['catalog','brands', companyId]
['catalog','categories', companyId]
['catalog','priceLists', companyId]
```

`companyId` va **primero en todas**. Al cambiar de empresa se ejecuta
`queryClient.removeQueries({ queryKey: ['catalog'] })` — `remove`, no
`invalidate`: invalidar deja los datos viejos visibles mientras refetchea, y
mostrar productos de Buscatools bajo el cartel de Torquetools, aunque sea por
300 ms, es exactamente lo que hay que evitar.

---

## D. Diseño de componentes

### D.1 Lo que va antes del catálogo

El catálogo no se puede probar de verdad sin sesión real ni empresa activa.
Son prerequisitos, no extras:

**Auth.** `AuthProvider` que escucha `supabase.auth.onAuthStateChange` y
expone `{ session, user, loading }`. `LoginPage` con email y contraseña
contra `signInWithPassword`. `ProtectedRoute` que redirige a
`#/auth/login?next=<ruta>` mientras no haya sesión y muestra un spinner
mientras `loading`. Logout con `signOut()` + `removeQueries()` completo.

La sesión la persiste el SDK de Supabase en `localStorage` bajo la clave
`bt-auth` que ya configuramos en Fase 1, con refresh automático del token.
**No escribimos nada de sesión por nuestra cuenta** — ni usuario, ni rol, ni
password, ni hash.

Recuperación de contraseña: **queda fuera de esta fase**, documentado.

**Empresa activa.** `CompanyProvider` que lee `company_memberships` del
usuario (RLS ya limita a las suyas). Si tiene una, se selecciona sola y no se
muestra selector. Si tiene más de una — el caso de Jano — aparece un selector
en el header. La elección se guarda en `localStorage` sólo como
*conveniencia de UI*: al arrancar se valida contra las membresías reales, y
si no coincide se descarta. **Guardar el id de empresa no otorga ningún
permiso**: si alguien lo edita a mano, RLS devuelve cero filas.

El `role` de la empresa activa sale de esa misma membresía y se usa **sólo
para decidir qué pedir y cómo presentar**, nunca como control de acceso.

### D.2 Árbol de componentes

```
CatalogPage
├── CatalogToolbar        búsqueda (debounce 300 ms) · orden · por página · exportar
├── CatalogFilters        marca · categoría · serie · stock · filtros dinámicos
│   └── DynamicAttributeFilters   se arman según la categoría elegida
├── CatalogResults
│   ├── ResponsiveTable   ← ya existe (Fase 1)
│   │   ├── columnas: SKU · Marca · Producto · Categoría · Serie · dinámicas
│   │   ├── PriceCell         importe + moneda, o "Consultar"
│   │   ├── StockCell         interno: on_hand / on_hand−reserved
│   │   └── AvailabilityBadge externo: booleano
│   │   └── renderCard(...)   card en celular
│   ├── EmptyState        sin resultados, con botón de limpiar filtros
│   ├── ErrorState        mensaje + reintentar
│   └── SkeletonRows      50 filas gris durante la carga
└── Pagination            anterior / siguiente / "N–M de T"

ProductDetailPage
├── ProductGallery        imágenes + lightbox
├── ProductHeader         SKU · nombre · marca · badges (kit, revisar)
├── ProductPrice          reutiliza PriceCell
├── ProductStock          reutiliza StockCell / AvailabilityBadge
├── AttributeList         ← atributos con label y unidad, NUNCA el JSON crudo
└── ProductMeta           origen · NCM · peso · volumen
```

### D.3 `AttributeList` — el punto que pediste explícitamente

`products.attributes` es un jsonb con 25 claves distintas en uso. Renderizarlo
crudo sería mostrar `{"encastre":"1/2","torq_max":250}`. En su lugar:

1. `useAttributeDefinitions()` trae `product_attribute_definitions`
   (26 filas, `staleTime` largo).
2. Por cada clave del jsonb se busca su definición y se muestra
   **`label` + valor + `unit`** → "Torque máximo: 250 Nm".
3. Una clave sin definición **no se muestra** y se registra en consola en
   desarrollo. El trigger ya impide insertarlas, así que no debería pasar;
   si pasa, es un bug que hay que ver, no algo para tapar.
4. El orden es el de `product_attribute_definitions.key`, no el del jsonb
   (el orden de un jsonb no es estable).

### D.4 Filtros dinámicos por categoría — hueco de datos

El legacy tiene `CATEGORY_FILTERS` hardcodeado. La tabla
`product_attribute_definitions` fue diseñada para reemplazarlo con
`applies_to_category_id`… pero **está en NULL en las 26 filas**, y **4 de las
claves que el legacy usa como filtro tienen `is_filterable = false`**:

| Categoría legacy | Claves | Estado en la DB |
|---|---|---|
| puntas y tubos | medida, largo, encastre | ✅ las 3 filtrables |
| balanceador | min_kg, max_kg, **carcasa**, **longitud**, **eslinga** | ⚠️ 3 con `is_filterable = false` |
| atornillador | torq_min, torq_max, **ergonomia**, tipo | ⚠️ 1 en false; `tipo` es `products.product_type` |
| punta | tipo, medida, largo | ✅ |

Son **dos UPDATE de datos, sin cambio de schema**: poblar
`applies_to_category_id` y corregir `is_filterable` en 4 filas. Los propongo
en la sección I y los ejecuto sólo con tu visto bueno.

Mientras tanto, `DynamicAttributeFilters` se arma con lo que la tabla diga.
Si `applies_to_category_id` sigue en NULL, muestra todos los filtrables —
funciona, pero con más opciones de las necesarias.

### D.5 Estado en la URL

```
#/catalogo?q=punta+torx&cat=puntas-y-tubos&marca=speedrill&encastre=1%2F2&page=2&sort=name
```

Los filtros viven en los search params, no en un `useState`. Así el filtro es
compartible por link, sobrevive a un F5, y los botones atrás/adelante del
navegador funcionan solos. `useCatalogParams()` encapsula la lectura y la
escritura tipada, y cualquier cambio de filtro resetea `page` a 1.

---

## E. Estrategia de precios

### E.1 La regla

> **RLS decide qué listas de precio existen para este usuario. La UI sólo
> elige entre las que ya le llegaron, y por defecto la de la empresa.**

No hay ni una condición `if (role === …)` que decida un precio.

### E.2 Cómo se resuelve, por rol

`usePriceLists()` hace un `select` plano sobre `price_lists`. RLS devuelve:

| Rol | Listas que recibe | Qué hace la UI |
|---|---|---|
| admin, employee, salesperson, technician | las 3 de su empresa | elige `is_default`; selector visible |
| customer (Cliente Demo) | **1** — "Especial Cliente Demo" | la única; **sin selector** |
| distributor | **1** — "Distribuidores" | la única; **sin selector** |

El usuario externo no elige porque no hay entre qué elegir. Si manipula el
`priceListId` en la URL, la query de precios devuelve cero filas: el
`price_list_id` que puso no pasa la política de `product_prices`. El
resultado es "Consultar", no el precio de otra lista.

Selección del `is_default`: hay dos listas llamadas "Lista base" con
`is_default = true`, una por empresa. **El filtro por `company_id` es
obligatorio** o se toma la de la otra empresa.

### E.3 Lo que desaparece

```js
if (typeof p.pu === 'number') return p.pu * 3;   // ← no se porta
```

El markup 3× es una regla de negocio y su lugar es la carga de datos: al
migrar los 21.772 productos, la fila de `product_prices` en "Lista base" se
calcula una vez y queda materializada. El frontend nunca vuelve a ver un
costo ni un coeficiente.

Esto tiene una consecuencia que conviene decir en voz alta: **cambiar el
margen deja de ser editar JavaScript y pasa a ser un UPDATE sobre
`product_prices`.** Es más trabajo por única vez y muchísimo menos riesgo.

### E.4 Sin precio

92 de 219 productos no tienen fila de precio. `PriceCell` muestra
**"Consultar"** — nunca `null`, `NaN`, `$0` ni una celda vacía. Un cero sería
peor que no mostrar nada: parece un precio.

### E.5 Formato

`Intl.NumberFormat('es-AR', { style:'currency', currency: <de price_lists> })`.
La moneda viene de la lista, no está hardcodeada.

---

## F. Estrategia de disponibilidad

### F.1 Interno vs externo

| | Interno | Externo |
|---|---|---|
| Fuente | `stock_balances` | vista `product_availability` |
| Ve | `on_hand` y `on_hand − reserved` por depósito | un booleano |
| Si RLS niega | no aplica | ya está restringido por la vista |

Las dos columnas del legacy se mapean así: **Stock Real = `on_hand`**,
**Stock Virtual = `on_hand − reserved`**. El nombre "virtual" en la UI se
mantiene porque es el que usa el equipo.

### F.2 Por qué el externo no ve números

`stock_balances` no tiene ninguna política que lo alcance: la query devuelve
cero filas. La vista existe para darle la única información que necesita —
si puede comprarlo o no — sin exponer cuánto hay. Ya está verificado en las
pruebas R11–R14 de la Etapa 1.

### F.3 Varios depósitos

Hoy hay un depósito por empresa, pero el modelo admite varios. La vista y
`stock_balances` devuelven **una fila por depósito**, así que la UI suma
`on_hand` y aplica un OR sobre `is_available`. Sumar 1 o 2 filas de la página
actual no es el antipatrón del legacy; el antipatrón era traer 21.772 filas.

### F.4 Ausencia

Sin fila = sin stock. `AvailabilityBadge` muestra "Consultar", `StockCell`
muestra `0`. **Nunca un error.** Aplica al 77 % del dataset actual, así que
es el camino normal, no el borde.

---

## G. Estrategia mobile

### G.1 Puntos de corte

| Ancho | Layout |
|---|---:|
| 390 (iPhone 14) | cards · filtros en bottom sheet · drawer |
| 430 (iPhone Pro Max) | idem |
| 768 (tablet vertical) | **frontera** — cards abajo, tabla desde acá |
| 1024 | tabla, sidebar de filtros colapsado |
| 1440 | tabla + sidebar fijo |
| 1920 | idem, contenido con `max-width` |

`MOBILE_BREAKPOINT = 768` en TS y `--bp-mobile: 768px` en CSS, ya alineados
desde Fase 1. `ResponsiveTable` renderiza **una sola de las dos vistas**, no
las dos con `display:none`.

### G.2 Card en celular

Reproduce la del legacy: imagen 64×64 · SKU en monoespaciada · nombre a dos
líneas con elipsis · marca y encastre en una línea gris · precio destacado ·
stock o disponibilidad. Toda la card es un link al detalle; los controles de
carrito llegan con Ventas.

### G.3 Filtros

En celular, un botón "Filtros (3)" con la cantidad activa abre un bottom
sheet a pantalla completa con "Aplicar" y "Limpiar". Se aplican al cerrar,
para no disparar una query por cada tap. En escritorio, sidebar siempre
visible y aplicación inmediata.

### G.4 Reglas que no se negocian

Sin scroll horizontal a 390 px · área táctil mínima 44×44 · la tabla de
escritorio scrollea dentro de su contenedor, nunca el `body` · imágenes con
`width`/`height` y `loading="lazy"` para no provocar CLS.

---

## H. Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|:---:|:---:|---|
| H1 | **La búsqueda fuzzy necesita una función nueva en la DB** | alta | medio | Está diseñada y acotada (`SECURITY INVOKER`, sin `DEFINER`). Si no la aprobás, se arranca con `textSearch` y se documenta la limitación |
| H2 | **`applies_to_category_id` en NULL en las 26 filas** | **certeza** | medio | Dos UPDATE de datos (sección I). Sin eso los filtros dinámicos muestran todos los atributos filtrables en vez de los de la categoría |
| H3 | **Mezclar caché entre empresas** | media | **alto** | `companyId` primero en toda clave + `removeQueries` (no `invalidate`) al cambiar. Test M4 |
| H4 | **Que se cuele un `if (role === …)` que decida datos** | media | **alto** | Regla de revisión: ninguna decisión de *qué datos* depende del rol, sólo *qué se pide* y *cómo se presenta*. Verificado con 5 JWT reales (tests R1–R8) |
| H5 | El dataset tiene 219 productos, no 21.772 | certeza | medio | Las queries se diseñan con `.range()` y `count` desde el día uno. **`EXPLAIN` con 219 filas da Seq Scan y eso no es un fallo** — se valida la forma de la query, no el plan |
| H6 | 42 % sin precio y 77 % sin stock | certeza | bajo | Es el camino normal, no el borde. Tests U3 y U4 |
| H7 | Imágenes desde WordPress, dominio externo | media | bajo | `loading="lazy"` + placeholder ante error. Migrar a Storage es fase aparte |
| H8 | `count: 'exact'` es caro sobre 21.772 filas | baja | medio | Se mide al cargar el catálogo completo. Si molesta, se pasa a `planned`. Con 219 no se nota |
| H9 | Perder la sesión al refrescar el token | baja | medio | Lo maneja el SDK. Se prueba explícitamente (test A4) |
| H10 | Sin recuperación de contraseña | certeza | bajo | **Fuera de alcance declarado.** Se documenta |
| H11 | El detalle por SKU depende de `(company_id, sku)` único | baja | bajo | La constraint `products_company_id_sku_key` existe. Sin empresa activa la ruta no resuelve |
| H12 | Filtrar por atributos jsonb sin índice adecuado | media | bajo | `idx_products_attrs` es GIN sobre `attributes`; sirve para contención (`@>`), no para rangos numéricos. Los rangos min/max se miden y, si hace falta, se propone un índice de expresión |

### Riesgo que ya se eliminó

El legacy manda el costo (`p.pu`) al navegador de todos los clientes y lo
esconde con CSS. En el modelo nuevo **la columna no existe en la Etapa 1** y
el costo entra recién con Compras, con su propia RLS. No hay nada que
ocultar porque no hay nada que mandar.

---

## I. Archivos a crear / modificar

### I.1 A crear — auth y empresa (prerequisito)

```
src/features/auth/AuthProvider.tsx
src/features/auth/useAuth.ts
src/features/auth/ProtectedRoute.tsx
src/features/auth/pages/LoginPage.tsx
src/features/auth/pages/LoginPage.module.css
src/features/company/CompanyProvider.tsx
src/features/company/useCompany.ts
src/features/company/CompanySelector.tsx
src/features/company/CompanySelector.module.css
src/services/auth/session.ts
src/services/company/memberships.ts
```

### I.2 A crear — catálogo

```
src/features/catalog/pages/CatalogPage.tsx            + .module.css
src/features/catalog/pages/ProductDetailPage.tsx      + .module.css
src/features/catalog/components/CatalogToolbar.tsx
src/features/catalog/components/CatalogFilters.tsx
src/features/catalog/components/DynamicAttributeFilters.tsx
src/features/catalog/components/PriceCell.tsx
src/features/catalog/components/StockCell.tsx
src/features/catalog/components/AvailabilityBadge.tsx
src/features/catalog/components/AttributeList.tsx
src/features/catalog/components/Pagination.tsx
src/features/catalog/components/ProductGallery.tsx
src/features/catalog/components/EmptyState.tsx
src/features/catalog/components/ErrorState.tsx
src/features/catalog/hooks/useProducts.ts
src/features/catalog/hooks/useProduct.ts
src/features/catalog/hooks/useCatalogFacets.ts
src/features/catalog/hooks/usePriceLists.ts
src/features/catalog/hooks/useAttributeDefinitions.ts
src/features/catalog/hooks/useAvailability.ts
src/features/catalog/hooks/useCatalogParams.ts
src/features/catalog/lib/formatPrice.ts               ← puro, testeable
src/features/catalog/lib/buildProductQuery.ts         ← puro, testeable
src/features/catalog/lib/mergeAttributes.ts           ← puro, testeable
src/features/catalog/lib/catalogColumns.tsx
src/features/catalog/types.ts
src/services/catalog/products.ts
src/services/catalog/prices.ts
src/services/catalog/facets.ts
src/services/catalog/availability.ts
src/services/catalog/attributes.ts
src/types/database.ts                                  ← generado desde Supabase
```

Las funciones de `lib/` son puras a propósito: concentran la lógica que vale
la pena testear sin levantar red ni DOM (recordar que Vitest corre con
`environment: 'node'`).

### I.3 A modificar

| Archivo | Cambio |
|---|---|
| `src/app/router.tsx` | rutas `/auth/login`, `/catalogo`, `/catalogo/:sku`, envueltas en `ProtectedRoute`, con `lazy` por módulo |
| `src/app/providers.tsx` | montar `AuthProvider` y `CompanyProvider` sobre `QueryClientProvider` |
| `src/layouts/AppLayout.tsx` | `CompanySelector` + email + logout en el header; "Catálogo" en el menú |
| `src/components/tables/ResponsiveTable.tsx` | *(sin cambios previstos — si hicieran falta, se justifican)* |
| `MIGRATION_STATUS.md` | Catálogo a `WIP` y después a `OK` |
| `docs/LEGACY_MAPPING.md` | **crear**, con las tablas de la sección B |
| `docs/architecture/ADR-015…018` | ver abajo |

### I.4 ADRs nuevos

- **ADR-015** — Filtros del catálogo en la URL, no en `useState`
- **ADR-016** — El precio lo determina RLS; la UI sólo elige entre lo visible
- **ADR-017** — Búsqueda server-side con RPC de trigram + full-text *(sujeto a H1)*
- **ADR-018** — Empresa activa: contexto de UI, jamás control de acceso

### I.5 Cambios en la base de datos — requieren tu aprobación

Ninguno es de schema. Son datos y una función.

```sql
-- 1. Los 4 atributos que el legacy usa como filtro y están marcados en false
UPDATE product_attribute_definitions
   SET is_filterable = true
 WHERE key IN ('carcasa','longitud','eslinga','ergonomia');

-- 2. Vincular cada atributo a su categoría (hoy las 26 filas están en NULL)
--    Se detalla clave por clave antes de ejecutar.

-- 3. La función de búsqueda de C.3, si aprobás la opción 3.
```

**No ejecuto nada de esto sin tu OK**, igual que en la Etapa 1.

### I.6 Lo que NO se toca

`buscatoolsjano-web/Buscatools` · el Supabase legacy · las tablas de Ventas ·
la carga de los 21.772 productos · las imágenes en WordPress · la taxonomía
`otros` · `stock_movements` y `stock_reservations` (el catálogo sólo lee).

---

## J. Tests previstos

### J.1 Unitarios (Vitest, `environment: 'node'`)

| # | Qué |
|---|---|
| U1 | `buildProductQuery` arma filtros, rango y orden bien |
| U2 | `buildProductQuery` **siempre** incluye `company_id` — es la red de seguridad de H3 |
| U3 | `formatPrice` con importe y moneda → "$ 1.234,56"; **sin precio → "Consultar"**, nunca "$0" |
| U4 | `mergeAttributes` resuelve label y unidad; **descarta claves sin definición**; ordena estable |
| U5 | `useCatalogParams` serializa y parsea filtros; cambiar un filtro resetea `page` a 1 |
| U6 | `deriveCard` con una fila de producto real |
| U7 | Suma de stock sobre varios depósitos |

### J.2 RLS desde el navegador, con JWT reales (los 5 roles)

Esto es el corazón de la fase: no vale simular.

| # | Usuario | Qué se verifica |
|---|---|---|
| R1 | Admin (Buscatools) | ve los 216 · ve `on_hand` · ve las 3 listas |
| R2 | Jano — Buscatools | idéntico a R1 (admin en esta empresa) |
| R3 | Jano — **cambia a Torquetools** | ve **3 productos**, no 219; **el rol pasa a salesperson**; la caché no mezcla |
| R4 | Norberto (employee) | ve stock; no ve nada de otra empresa |
| R5 | Facundo (salesperson) | ve stock y las 3 listas |
| R6 | cliente.test (customer) | **1 sola lista** · **sin selector** · `stock_balances` → 0 filas · disponibilidad sí |
| R7 | distribuidor.test | ve "Distribuidores"; **no** ve "Especial Cliente Demo" |
| R8 | cliente.test | forzar otro `price_list_id` en la URL → **"Consultar"**, no el precio ajeno |
| R9 | sin sesión | `#/catalogo` redirige a login; no se dispara ninguna query |

R3 y R8 son los dos que realmente pueden fallar. El resto confirma.

### J.3 Funcionales

| # | Qué |
|---|---|
| F1 | Login → catálogo → 50 filas · paginado · "51–100 de 216" |
| F2 | Buscar "punta" → resultados server-side; el **network tab muestra un request chico**, no 15,7 MB |
| F3 | Búsqueda con typo ("balanciador") → encuentra "balanceador" *(sólo con la opción 3 de C.3)* |
| F4 | Filtro de marca + categoría + búsqueda, combinados |
| F5 | Elegir "puntas y tubos" → aparecen medida/largo/encastre |
| F6 | Detalle por SKU → atributos con label y unidad, **cero JSON crudo** |
| F7 | F5 sobre una URL filtrada → los filtros sobreviven |
| F8 | Atrás/adelante del navegador recorren los filtros |
| F9 | Sin resultados → empty state con "limpiar filtros" |
| F10 | Con la red cortada → error state con reintentar, no pantalla en blanco |
| F11 | Logout → la caché queda vacía; volver atrás no muestra datos |

### J.4 Responsive

390 · 430 · 768 · 1024 · 1440 · 1920 — sin scroll horizontal, cards abajo de
768, tabla arriba, filtros usables en celular, drawer funcionando.

### J.5 Rendimiento — comparación directa

| Métrica | Legacy | Objetivo |
|---|---|---|
| Bytes hasta la primera fila | ≈ 24 MB | **< 500 KB** (JS incluido) |
| Requests bloqueantes | 1 síncrono de 15,7 MB | 0 |
| Productos en memoria | 21.772 | 50 |
| Bundle inicial (gzip) | 5,33 MB sin comprimir | **< 200 KB** |
| Cambio de página | 0 requests, 0 ms | 1 request, < 300 ms |

Se mide con el network tab y `npm run build`, y va al informe final con
números, no con adjetivos.

### J.6 Lo que NO se testea en esta fase

Carrito y cotizaciones (Ventas) · alta y edición de productos ·
los 21.772 productos · exportar a Excel · comparador · lightbox ·
recuperación de contraseña.

---

## Resumen de lo que necesito de vos

| # | Decisión | Recomendación |
|---|---|---|
| 1 | **Búsqueda**: ¿creo `app.search_products()` (opción 3) o arranco con `textSearch` (opción 1)? | **Opción 3** — es la única que cumple lo que pediste |
| 2 | **Datos**: ¿ejecuto los dos UPDATE de `product_attribute_definitions` (I.5)? | **Sí** — sin eso los filtros por categoría quedan a medias |
| 3 | **URL del detalle**: `#/catalogo/:sku` (legible, igual que el legacy) o `:id` (uuid) | **`:sku`** — conserva el SEO y es único por empresa |
| 4 | **Recuperación de contraseña**: ¿fuera de alcance? | **Sí**, documentado |
| 5 | ¿Apruebo el diseño y arranco a programar? | — |

**No hay una sola línea de código de Fase 3 escrita.** Espero tu aprobación.
