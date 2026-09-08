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

## 8. Bloqueado: RLS por rol desde el navegador

**No ejecutado. Faltan credenciales.**

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
