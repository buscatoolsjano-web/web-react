# Fase 3 — Catálogo · resultados

Fecha: 2026-09-08 · Commit `ac2f033` · CI **verde**

## Resumen

| Bloque | Ejecutadas | PASS | FAIL | Bloqueadas |
|---|---:|---:|---:|---:|
| Unitarias (Vitest) | 48 | **48** | 0 | 0 |
| Lint / typecheck / build | 3 | **3** | 0 | 0 |
| Base de datos (RPC) | 6 | **6** | 0 | 0 |
| Acceso anónimo (API real) | 8 | **8** | 0 | 0 |
| Navegador sin sesión | 4 | **4** | 0 | 0 |
| Responsive | 4 | **4** | 0 | 0 |
| **RLS por rol con JWT real** | 0 | 0 | 0 | **9** |
| **TOTAL** | **73** | **73** | **0** | **9** |

Las 9 bloqueadas necesitan credenciales de los usuarios de prueba. Ver el
final del documento.

---

## 1. Unitarias — 48 PASS

```
Test Files  7 passed (7)
     Tests  48 passed (48)
  Duration  534ms
```

| # | Caso | Resultado |
|---|---|---|
| U1 | `construirPlanDeConsulta` traduce filtros, rango y orden | PASS |
| U2 | **Siempre** incluye `companyId`; sin empresa activa lanza error en vez de consultar | PASS |
| U2b | Acota `porPagina` a 100 aunque la URL pida 5000 | PASS |
| U3 | Sin precio devuelve "Consultar"; el 0 **no** se confunde con ausencia | PASS |
| U3b | Sin moneda no inventa una; código desconocido no rompe | PASS |
| U4 | Atributos con label y unidad ("250 Nm"), nunca el jsonb crudo | PASS |
| U4b | Descarta claves sin definición | PASS |
| U4c | Ordena por las definiciones, no por el orden del jsonb | PASS |
| U5 | Filtros de la URL: ida y vuelta sin pérdida; valores inválidos se descartan | PASS |
| U6 | **Orden por relevancia se reconstruye** tras `.in('id', ids)` | PASS |
| U6b | No muta el array original; lo que no está en el ranking va al final sin perderse | PASS |
| U7 | Suma de stock sobre varios depósitos | PASS |

## 2. Calidad

| Comando | Resultado |
|---|---|
| `npm run lint` | **0 errores, 0 warnings** |
| `npm run typecheck` | **0 errores** (strict, cero `any`) |
| `npm run build` | **534 ms**, 265 módulos |

Los 4 errores de lint que aparecieron durante el desarrollo se corrigieron
de raíz, sin desactivar ninguna regla:

1. `setState` dentro de `useEffect` en `EmpresaProvider` → se eliminó el
   efecto; la preferencia se valida durante el render.
2. Dos `onClick` con función que devuelve promesa (`navigate` devuelve
   `Promise` en React Router 7) → `void navigate(...)` en un callback.
3. Aserción de tipo innecesaria en `disponibilidad.ts`.
4. Contexts exportados desde archivos de componentes → movidos a
   `authContext.ts` y `empresaContext.ts` (rompían el Fast Refresh).

## 3. Base de datos — `search_products`

| # | Caso | Resultado |
|---|---|---|
| B1 | Búsqueda exacta "punta" → 32 resultados | PASS |
| B2 | **Typo "balanciador" → 20 balanceadores** (fuzzy real) | PASS |
| B3 | **Typo "atornillodor" → 4 atornilladores** | PASS |
| B4 | `total_count` correcto en los tres casos (32 / 20 / 4) | PASS |
| B5 | **Paginado estable**: 32 filas, 32 ids distintos, 0 duplicados, sin huecos | PASS |
| B6 | `REVOKE` efectivo: el usuario del MCP recibe *permission denied* | PASS |

**B5 es el caso que importa.** "punta" devuelve 32 resultados con sólo
**5 scores distintos**, y hay **15 filas que comparten el mismo score**.
Sin el desempate `(score DESC, name, id)` esas 15 podrían salir en
cualquier orden en cada consulta, y la página 2 duplicaría u omitiría
registros. Con el orden total: 0 duplicados, contiguo, sin huecos.

## 4. Acceso anónimo contra la API real

`curl` con la clave publicable, sin sesión:

| Recurso | HTTP | Resultado |
|---|---|---|
| `products` | **401** | PASS |
| `product_prices` | **401** | PASS |
| `stock_balances` | **401** | PASS |
| `product_availability` | **401** | PASS |
| `brands` | **401** | PASS |
| `company_memberships` | **401** | PASS |
| `profiles` | **401** | PASS |
| **RPC `search_products`** | **401** | PASS |

La función de búsqueda **no es una puerta trasera**: sin sesión devuelve
*permission denied for function*, igual que las tablas.

## 5. Navegador sin sesión

| # | Caso | Resultado |
|---|---|---|
| N1 | `#/catalogo` redirige a `#/auth/login?next=%2Fcatalogo` | PASS |
| N2 | **Cero requests a `/rest/v1/`** — ninguna query se dispara sin sesión | PASS |
| N3 | `localStorage` **vacío**: no escribimos sesión, usuario ni rol propios | PASS |
| N4 | Sin errores en consola | PASS |

N3 es la diferencia de fondo con el legacy, donde la sesión era una
entrada de localStorage editable desde la consola del navegador.

## 6. Responsive

Sin scroll horizontal en 390, 430, 768 y 1440 px.

## 7. Rendimiento — comparación con el legacy

| Métrica | Legacy | React | |
|---|---|---|---|
| Bytes hasta la primera fila | **≈ 24 MB** | **≈ 183 KB** (JS+CSS gzip) + ~40 KB de datos | **130× menos** |
| Requests bloqueantes | 1 XHR **síncrono** de 15,7 MB | 0 | |
| Productos en memoria | 21.772 | 50 | |
| Bundle inicial (gzip) | 5,33 MB sin comprimir | **183 KB** | |
| Chunk del catálogo | — | 8,8 KB | |

Detalle del bundle inicial: `vendor-react` 87,66 KB · `vendor-data`
67,02 KB · `index` 25,43 KB · CSS 2,19 KB · runtime 0,36 KB.

## 8. RLS por rol, con sesión real en producción

Ejecutadas el 2026-09-09 sobre
`https://buscatoolsjano-web.github.io/web-react/`, con login real. La
evidencia se tomó de las respuestas del servidor, no de la pantalla: en el
legacy el dato **llegaba** y se escondía con CSS, así que lo que hay que
comprobar es que **no llega**.

### `cliente.test@buscatools.com.ar` — customer · 9/9 PASS

| # | Caso | Evidencia |
|---|---|---|
| R6a | Columna **Disponibilidad**, no Stock | ✅ |
| R6b | Sin selector de listas | ✅ subtítulo fijo "Especial Cliente Demo" |
| R6c | Stock en el embed de products | ✅ `stock_balances: []` **aunque se pida explícitamente** |
| R6d | `price_lists` | ✅ **1 fila**: Especial Cliente Demo |
| R6e | `stock_balances` directo | ✅ **0 filas** (HTTP 200: RLS filtró, no falló) |
| R8a | Forzar `price_list_id` de "Lista base" | ✅ **0 filas** |
| R8b | Forzar el de "Distribuidores" | ✅ **0 filas** |
| R8c | `products` de una empresa ajena | ✅ **0 filas** |
| F2/F3 | Typo "balanciador" | ✅ 20 balanceadores · "1–20 de 20" · **1.929 bytes** |

De los **124 precios** que este usuario puede leer en total hay **un solo
`price_list_id` distinto**. No es que la interfaz filtre: el servidor no
manda otra cosa.

**La RPC no es una puerta lateral.** `search_products` recibe `p_company`
como parámetro, así que se le pasó el id de Torquetools —empresa ajena a
este usuario— y devolvió **0 resultados**. El `SECURITY INVOKER` sostiene.

### `buscatools.jano@gmail.com` — admin + salesperson

| # | Caso | Evidencia |
|---|---|---|
| R2 | Membresías propias | ✅ **exactamente 2**: Buscatools→admin, Torquetools→salesperson |
| R2a | Productos en Buscatools | ✅ **216** (`content-range: 0-0/216`) |
| R2b | Stock con cantidades reales | ✅ `on_hand=16, reserved=0` |
| R2c | `price_lists` en Buscatools | ✅ **3**: Lista base, Distribuidores, Especial Cliente Demo |
| R3 | Torquetools | ✅ **3 productos**, **1 lista** |

**Aislamiento de precios, mismo SKU, lado a lado:**

| SKU | cliente.test (Especial Cliente Demo) | Jano (Lista base) |
|---|---:|---:|
| CP.CP9911 | US$ 43,32 | US$ 54,15 |
| CP.CP9947 | US$ 164,28 | US$ 205,35 |
| CP.CP9958 | US$ 351,21 | US$ 439,01 |

Ninguno de los dos puede leer el precio del otro.

---

## 9. Tres bugs encontrados probando en el navegador

Ninguno lo detectaron los 48 tests unitarios. Los tres aparecieron sólo
con sesión real contra el deploy.

### 9.1 El buscador se perdía al llegar desde un link

Entrar a `#/catalogo?q=balanciador` **borraba el parámetro** y mostraba el
catálogo sin filtrar.

El input mantiene estado local para poder aplicar debounce, pero se
inicializaba una sola vez. Cuando la URL cambiaba por fuera —un link
compartido, o los botones atrás/adelante— el input seguía con su valor
anterior y el efecto de debounce pisaba la URL con ese valor viejo.

Rompía dos cosas que el diseño prometía: compartir un filtro por link y
que atrás/adelante recorran los filtros. Corregido en `525e5d7`.

### 9.2 La app se rompía al navegar después de un deploy

Con la app abierta se publicó una versión y el botón "Salir" tiró:

```
Failed to fetch dynamically imported module:
  .../assets/LoginPage-BoHNNOGv.js
```

Vite hashea el nombre de cada chunk; al desplegar, los del build anterior
dejan de existir. Cualquier ruta todavía no cargada falla con un 404.
**Le pasa a cualquier usuario con la pestaña abierta durante un deploy**,
no sólo a quien esté probando.

Corregido en `f281bb5` con `lazyConRecarga()`: ante un import fallido
recarga una vez —y sólo una, para que un corte de red no deje la página en
bucle—. Se agregó además `errorElement` con una pantalla propia; antes
React Router mostraba su stack trace de desarrollo con un "Hey developer".

### 9.3 El selector de empresa mostraba membresías de otros usuarios

A Jano el desplegable le listaba **8 entradas** en vez de sus 2: eran las
8 membresías de todo el sistema.

La política de `company_memberships` es

```sql
(user_id = auth.uid()) OR app.is_admin(company_id)
```

y es **correcta** — un admin necesita ver las membresías de su empresa
para administrar usuarios. El error era del servicio, que asumía que RLS
ya devolvía sólo las propias.

**No es un agujero de seguridad**: RLS sigue gobernando qué datos se leen
y pedir el `company_id` de una empresa ajena devuelve cero filas. Pero sí
es un error de identidad en la interfaz: la membresía activa podía
terminar siendo la de otra persona. Si la primera fila hubiera sido la del
`customer`, a Jano lo habría tratado como cliente externo y le habría
ocultado el stock. Corregido en `a3ebf53` con el filtro explícito por
`user_id`.

### 9.5 La empresa elegida sobrevivía al cambio de usuario

Al cerrar sesión quedaba `bt-empresa-activa` en `localStorage`: la
preferencia del usuario que se iba. No es explotable —se valida contra las
membresías del nuevo usuario y se descarta si no coincide— pero es un
residuo de otra sesión.

Corregido en `c2cffec`: se limpia en el botón "Salir" **y** en el evento
`SIGNED_OUT`, que cubre además el cierre desde otra pestaña y el token
vencido.

### 9.6 El catálogo consultaba dos veces y podía mostrar un precio ajeno

Visto en la red: `products` salía **dos veces** por carga.

La primera consulta se disparaba con `priceListId` en `null`, porque
`price_lists` todavía no había respondido — tardó **1.420 ms**. Sin ese
filtro, el embed de `product_prices` devuelve **todas** las listas
visibles y `product_prices[0]` toma una cualquiera.

Para un usuario externo da igual: RLS le deja ver una sola. **Pero un
usuario interno ve tres**, así que durante ese segundo y medio podía
mostrarse un precio que no era el de la lista elegida.

Corregido en `c41f366`: la consulta espera a que se resuelva la lista.
Desaparece la request duplicada y desaparece la ventana del precio
equivocado.

### 9.4 Al cambiar de empresa quedaban los datos de la anterior

Es el requisito que pediste explícitamente: *"NO quiero que durante ningún
instante se rendericen datos cacheados de la empresa anterior."*

Se midió muestreando el DOM cada pocos milisegundos al cambiar de
Buscatools a Torquetools:

| ms | Filas en la tabla | Paginador |
|---:|---:|---|
| 0 | **50** ← Buscatools | Cargando… |
| 30 | **50** | Cargando… |
| 80 | **50** | Cargando… |
| 150 | **50** | Cargando… |
| 300 | 3 ← Torquetools | 1–3 de 3 |

Entre 150 y 300 ms se veían las 50 filas de Buscatools.

`removeQueries` funcionaba bien; el problema era el `placeholderData` que
había puesto para suavizar el paginado. TanStack Query entrega los datos
de la consulta previa **aunque la clave de caché haya cambiado**, así que
anulaba el borrado.

Corregido en `6a25e20`: sólo conserva la página previa si la consulta
anterior era de la misma empresa, comparando la posición 1 de la clave.
Dentro de una empresa el paginado sigue siendo suave; al cambiar de
empresa la tabla pasa al estado de carga.

**Verificado después del fix**, midiendo la transición inversa
(Torquetools → Buscatools):

| ms | Filas | Primer SKU | Encabezado |
|---:|---:|---|---|
| 0 | **0** | — | Buscatools · admin |
| 30 | **0** | — | Buscatools · admin |
| 150 | **0** | — | Buscatools · admin |
| 300 | **0** | — | Buscatools · admin |
| 600 | 50 | PRO11733 | Buscatools · admin |

**Cero fotogramas con filas de la empresa anterior.** La tabla cae al
estado de carga en el mismo instante del cambio.

### Una falsa alarma, verificada antes de reportarla

En la misma medición el subtítulo parecía quedarse en "Buscatools · admin".
Era un error de mi medición: la expresión regular leía el texto del
`<select>` de empresas, que contiene todas las opciones, en vez del
subtítulo. Comprobado con un selector puntual, el subtítulo sí cambiaba a
"Torquetools · salesperson · Lista base", con SKU `TT-001`.

### `distribuidor.test@buscatools.com.ar` — distributor · 10/10 PASS

| # | Objetivo | Evidencia |
|---|---|---|
| 1 | Sólo ve "Distribuidores" | ✅ `price_lists` → 1 fila |
| 2 | NO ve "Especial Cliente Demo" | ✅ `false` |
| 3 | NO ve listas internas | ✅ `false` |
| 4 | Precio de distribuidor | ✅ CP.CP9911 = **46,0275** |
| 5 | No obtiene otro precio manipulando la request | ✅ forzar Lista base → 0 filas · forzar Especial Demo → 0 filas · 1 sola lista distinta entre 124 precios |
| 6 | No ve cantidades de stock | ✅ `stock_balances` → **0 filas** |
| 7 | Sí ve disponibilidad | ✅ `product_availability` → booleano |
| 8 | Logout / login / restore | ✅ F5 sobre `#/catalogo/PRO11733` mantuvo sesión y ruta |
| 9 | Navegación y refresh | ✅ listado → detalle → F5, sin redirección al login |
| 10 | Sin datos de un usuario anterior | ✅ 1 membresía, 1 empresa visible |

### `cliente.test@buscatools.com.ar` — caso inverso · 6/6 PASS

| Objetivo | Evidencia |
|---|---|
| Sólo "Especial Cliente Demo" | ✅ 1 fila |
| NO "Distribuidores" | ✅ `false` |
| NO listas internas | ✅ `false` |
| Su precio correcto | ✅ CP.CP9911 = **43,32** |
| Sin cantidades de stock | ✅ 0 filas |
| Disponibilidad permitida | ✅ 3 filas con booleano |

### Aislamiento de precios: el mismo SKU visto por tres roles

| CP.CP9911 | Lista | Precio |
|---|---|---:|
| `cliente.test` | Especial Cliente Demo | US$ 43,32 |
| `distribuidor.test` | Distribuidores | US$ 46,03 |
| Jano (interno) | Lista base | US$ 54,15 |

Ninguno puede leer el precio de otro: forzar el `price_list_id` ajeno
devuelve **0 filas**, no el importe.

---

## 9-bis. Cambio de usuario: ni un fotograma con datos residuales

Se instaló un grabador que muestrea el DOM y el almacenamiento cada 40 ms
y **sobrevive al logout y al login** (ninguno de los dos recarga la
página). Transición `distribuidor.test` → logout → `cliente.test`:

| ms | Claves `bt-*` | Sesión | Encabezado | Filas | SKU |
|---:|---|---|---|---:|---|
| 42 | `bt-auth`, `bt-empresa-activa` | distribuidor.test | Buscatools · distributor · **Distribuidores** | 50 | PRO11733 |
| 807 | **(vacío)** | — | — | **0** | — |
| 1121 | (vacío) | — | login | 0 | — |
| 22563 | `bt-auth` | cliente.test | — | **0** | — |
| 22891 | `bt-auth` | cliente.test | Buscatools · customer | **0** | — |
| 23167 | `bt-auth` | cliente.test | Buscatools · customer · **Especial Cliente Demo** | **0** | — |
| 23577 | `bt-auth` | cliente.test | Buscatools · customer · Especial Cliente Demo | 50 | PRO11733 |

**Fotogramas con residuo: 0.** La tabla permanece en 0 filas durante los
22 segundos entre sesiones. El encabezado se arma progresivamente
(empresa, después lista) pero **en ningún momento muestra la lista, el rol
ni la membresía del usuario anterior**.

La transición Jano → logout → distribuidor dio el mismo resultado: tras el
logout, `claves: ""`, `email: null`, `filas: 0`, `opciones: ""`.

---

## 9-ter. Revisión de red

Requests que hace el catálogo al cargar, con sesión de rol externo:

| # | Recurso | `select` |
|---|---|---|
| 1 | `company_memberships` | `company_id, role, customer_id, companies(name,slug)` |
| 2 | `price_lists` | `id, name, currency_code, is_default` |
| 3 | `brands` | `id, name` |
| 4 | `product_categories` | `id, name, slug, needs_review, position` |
| 5 | `product_attribute_definitions` | `key, label, unit, data_type, is_filterable, position` |
| 6 | `products` | sin ninguna columna de costo |
| 7 | `product_availability` | `product_id, is_available` |

| Comprobación | Resultado |
|---|---|
| ¿Alguna request trae costos? | **No.** `products` **no tiene columna de costo**: ni con `select=*`. No se filtra el costo — no existe en la Etapa 1 |
| ¿Alguna trae listas no autorizadas? | **No.** 1 sola lista distinta entre los 124 precios visibles |
| ¿Se pide `stock_balances` para externos? | **No.** El recurso no aparece en la red |
| ¿Responde `product_availability`? | **Sí**, con el booleano |

### Bytes medidos

| Recurso | Bytes | Filas |
|---|---:|---:|
| `products` (página de 50) | 21.405 | 50 |
| `product_availability` | 1.615 | 21 |
| `product_attribute_definitions` | 2.933 | 26 |
| `brands` | 1.604 | 25 |
| `product_categories` | 1.016 | 8 |
| `company_memberships` | 183 | 1 |
| `price_lists` | 119 | 1 |
| **Total primera carga** | **28.875 (28,2 KB)** | |
| Cambiar de página | 23.020 | |

Contra los **15,7 MB** del `productos-data.json` del legacy: **570 veces
menos**.

---

## 10. Pendiente

Nada de las pruebas de RLS. Queda abierta la decisión sobre la tabla N:N
de atributos ([evidencia](database/ATTRIBUTE_CATEGORY_RELATION.md)) y el
riesgo de origen compartido
([SHARED_ORIGIN_RISK.md](security/SHARED_ORIGIN_RISK.md)).

Estas 9 pruebas necesitan iniciar sesión de verdad con cada usuario, y no
hay forma de obtener un JWT sin la contraseña (crear sesiones con
`service_role` está prohibido, y con razón).

| # | Usuario | Qué verifica |
|---|---|---|
| R1 | Admin | ve los 216 productos, `on_hand`, las 3 listas |
| R2 | Jano — Buscatools | idéntico a R1 |
| R3 | Jano — **cambia a Torquetools** | ve 3 productos, el rol pasa a salesperson, la caché no mezcla |
| R4 | Norberto (employee) | ve stock |
| R5 | Facundo (salesperson) | ve stock y las 3 listas |
| R6 | cliente.test (customer) | **1 sola lista, sin selector**; `stock_balances` → 0 filas |
| R7 | distribuidor.test | ve "Distribuidores", **no** "Especial Cliente Demo" |
| R8 | cliente.test | forzar otro `price_list_id` en la URL → "Consultar" |
| F3 | cualquiera | fuzzy search end-to-end desde la UI |

Alcanza con **un** usuario interno y **un** externo para cubrir lo
esencial (R1, R6 y R8); con Jano se cubre además R3, que es la prueba de
multiempresa.

Lo que hace falta: una contraseña de prueba para
`cliente.test@buscatools.com.ar` y `distribuidor.test@buscatools.com.ar`
—las dos cuentas creadas justamente para esto—, definida desde
Authentication → Users del panel de Supabase.
