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

---

## 10. Pendiente

**`distribuidor.test@buscatools.com.ar`** (R7) y el cambio de empresa en
vivo (R3a/R3b) quedan por correr.

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
