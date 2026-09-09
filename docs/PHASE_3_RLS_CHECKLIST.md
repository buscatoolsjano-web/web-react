# Fase 3 — Guion de pruebas de RLS desde el navegador

Las 9 pruebas que faltan para cerrar la fase. Cada una se corre iniciando
sesión en https://buscatoolsjano-web.github.io/web-react/

**Cómo mirar la red:** F12 → pestaña *Network* → filtro `rest/v1`. Ahí se
ve exactamente qué pide la app y qué le contesta el servidor.

La idea de fondo: en el legacy el dato **llegaba** al navegador y se
escondía con CSS. Acá lo que hay que confirmar es que **no llega**. Por eso
no alcanza con mirar la pantalla: hay que mirar la respuesta del servidor.

---

## Tanda 1 — `cliente.test@buscatools.com.ar` (customer)

| # | Paso | Qué tiene que pasar |
|---|---|---|
| R6a | Entrar a **Catálogo** | Se ve el listado, con columna **Disponibilidad** (no "Stock") |
| R6b | En el header, al lado de "Catálogo" | **NO** aparece selector de lista de precios. Sólo hay una, no hay entre qué elegir |
| R6c | En *Network*, buscar la petición a `products` | En la respuesta **no existe la clave `stock_balances`** en ningún producto |
| R6d | En *Network*, buscar `price_lists` | Devuelve **exactamente 1 fila**: "Especial Cliente Demo" |
| R6e | En *Network*, buscar `product_availability` | Devuelve filas con `is_available` — un booleano, **nunca una cantidad** |
| R8 | En la barra de direcciones, agregar a mano un `price_list_id` de otra lista | El precio muestra **"Consultar"**, no el precio de la otra lista |

**El que más importa es R6c.** Si en esa respuesta aparecieran cantidades
de stock, la migración habría repetido el error del legacy.

---

## Tanda 2 — `buscatools.jano@gmail.com` (admin + salesperson)

Es el único usuario con dos membresías, así que es el único que puede
probar multiempresa de verdad.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| R2a | Entrar a Catálogo | Dice **"Buscatools · admin"** y el paginador marca **216** productos |
| R2b | Columna de stock | Se ven dos números: real / virtual |
| R2c | En *Network*, `price_lists` | Devuelve **3 filas**, y aparece el selector de listas |
| R3a | Cambiar la empresa a **Torquetools** en el selector del header | El subtítulo pasa a **"Torquetools · salesperson"** — el rol cambia con la empresa |
| R3b | Mirar el listado inmediatamente después de cambiar | Muestra **3 productos**, no 216. **En ningún instante** se ven los de Buscatools bajo el cartel de Torquetools |
| R3c | Recargar con F5 estando en Torquetools | Sigue en Torquetools con 3 productos |

**R3b es la prueba clave.** Es la razón por la que se usa `removeQueries` y
no `invalidateQueries`: invalidar dejaría los 216 productos en pantalla
mientras carga, aunque sean 300 ms.

---

## Tanda 3 — `distribuidor.test@buscatools.com.ar` (distributor)

| # | Paso | Qué tiene que pasar |
|---|---|---|
| R7a | Entrar a Catálogo, mirar `price_lists` en *Network* | Devuelve **1 fila: "Distribuidores"** |
| R7b | En esa misma respuesta | **NO** aparece "Especial Cliente Demo" — es la lista del otro cliente externo |
| R7c | Comparar el precio de un SKU con el que veía `cliente.test` | Son **distintos**, y ninguno de los dos ve el del otro |

---

## Prueba transversal — búsqueda (con cualquier usuario)

| # | Paso | Qué tiene que pasar |
|---|---|---|
| F2 | Buscar `punta` | Aparecen resultados. En *Network* se ve una llamada a `rpc/search_products` de **unos pocos KB** — no 15,7 MB |
| F3 | Buscar `balanciador` (mal escrito) | **Encuentra los balanceadores igual.** Es el fuzzy funcionando |
| F4 | Ir a la página 2 de esa búsqueda | No se repite ningún producto de la página 1, y el contador dice "51–100 de N" |

---

## Qué reportar

Alcanza con: número de prueba, si pasó o no, y en las que fallen, qué
mostró la respuesta en *Network*. Con eso actualizo
`PHASE_3_TEST_RESULTS.md` y cierro la fase.
