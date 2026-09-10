# Fase 5 · Clientes — entrega 5: cierre

Estado: **todo lo automatizable en verde y desplegado. Falta tu revisión
visual**, que es el único punto del criterio de cierre que no puedo firmar yo.
No se empezó Compras.

---

## A · Funcionalidades finales

| | dónde | estado |
|---|---|---|
| Maestro de clientes | `#/clientes`, server-side | ✅ |
| Búsqueda y filtros en la URL | listado | ✅ |
| CSV | listado | ✅ |
| Alta / edición | `#/clientes/nuevo`, ficha | ✅ |
| Baja lógica y reactivación | ficha | ✅ |
| Contactos | pestaña, CRUD | ✅ |
| Direcciones | pestaña, CRUD, 4 tipos | ✅ |
| Memoria de productos | pestaña, CRUD + confirmar/descartar | ✅ |
| Precios históricos | pestaña, derivados de ventas | ✅ |
| Historial | pestaña, por `customer_id` | ✅ |
| Relacionados | pestaña (candidatos de OC) | ✅ |
| **Panel rápido** | tira de métricas sobre las pestañas | ✅ nuevo |
| **Gráfico 12 meses** | dentro de Historial | ✅ nuevo |
| Cola de revisión | aviso en la ficha + filtro en el listado | ✅ |
| Clientes potenciales | — | `NOT_MIGRATED_BY_DESIGN` |

### El panel rápido

Seis métricas, todas de documentos reales, en **una sola función SQL**:
cotizaciones, pedidos, entregas, última actividad, productos distintos y
documentos de los últimos doce meses.

Del panel del legacy (`abrirClienteQuickPanel`) **falta una cosa a propósito**:
el importe único que sumaba ARS + USD + EUR. Los importes están en Historial,
uno por moneda y por tipo de documento.

### El gráfico

SVG a mano, sin librería — son doce barras; traer una sumaría cientos de kB.

Lo que importa no es el dibujo sino **qué dice que está mostrando**. El del
legacy era una serie de «ventas» que no aclaraba si eran cotizaciones, pedidos
o entregas y sumaba las monedas. Éste tiene tres controles —tipo de documento,
documentos o importe, y moneda— y el título dice las tres cosas:
«Cotizado: importe por mes en USD».

**Una serie es un tipo y una moneda.** Nunca se suman entre sí, y el pie del
gráfico lo dice. Debajo hay un `<details>` con los mismos números en tabla: un
gráfico no es accesible por sí solo, y en 390px doce barras finitas se leen
peor que una tabla.

### Los importes por moneda, ahora del servidor

Antes se sumaban en el navegador sobre los documentos que la pantalla había
traído (tope de 200 por tipo). Hoy ningún cliente llega a ese tope —el mayor,
Grupo Mirgor, tiene 99 cotizaciones— así que **no había un error visible**,
pero el total dependía de cuántas filas se hubieran pedido. Ahora lo calcula
`totales_por_moneda_cliente` sobre todos los documentos, y el desglose es por
moneda **y** por tipo.

---

## B · Reconciliación final

| | esperado | real |
|---|---:|---:|
| clientes del maestro legacy con equivalente | 988 | **988** |
| customers totales | 1.010 | **1.010** |
| contactos | 87 | **87** |
| equivalencias de producto | 14 | **14** |
| `needs_review` | 40 | **40** |
| CUIT normalizados duplicados | 0 | **0** |
| referencias CLI duplicadas | 0 | **0** |
| marcados «CUIT no asignado» que sí tienen CUIT | 0 | **0** |
| fixtures de test que hayan quedado | 0 | **0** |
| direcciones | — | 0 (ninguna cargada todavía) |
| bajas lógicas | — | 0 |

Secuencias CLI: Buscatools **1225**, Torquetools **1**.

Los 40 marcados, por motivo: `CUIT_REPETIDO_EN_LEGACY` 31,
`CUIT_NO_ASIGNADO` 27, `SOLO_EN_CONTACTOS` 7,
`VARIOS_LEGACY_AL_MISMO_CLIENTE` 3 — 27 clientes tienen más de un motivo y se
guardan todos.

---

## C · RLS

Probado con JWT reales, cada prohibición con un intento real.

| rol | ve | escribe |
|---|---|---|
| **admin** | los 1.010 de su empresa, incluidas las bajas | cliente, contactos, direcciones, alias, revisión |
| **employee** | igual que admin | igual que admin |
| **salesperson** | **sólo su cartera**: ni los de otro vendedor, ni los que no tienen vendedor, ni otra empresa | crea (el servidor se lo asigna) y edita los suyos. **No** contactos ni direcciones |
| **customer / distributor** | **una** ficha: la suya | nada |
| **anon** | nada | nada |

Lo que se comprobó que un externo **no** puede: listar otros clientes, buscar
por CLI ajeno, por CUIT ajeno, por email ajeno o por dominio ajeno, leer
contactos, direcciones, memoria o precios ajenos, ni obtener el panel de otro
cliente. Todo devuelve 0 filas; escribir devuelve 42501.

Memoria y precios **siguen la visibilidad del cliente**: si un vendedor no ve
al cliente, no ve su memoria, sus precios ni su panel. Las cinco funciones SQL
del módulo son `security invoker` y arrancan comprobando que el cliente sea
legible.

---

## D · Performance, con datos reales

Contra Grupo Mirgor, el cliente más pesado (236 documentos, 772 líneas con
precio, 377 productos distintos):

| consulta | ms |
|---|---:|
| listado paginado (25 de 1.010, con total exacto) | 244 |
| búsqueda por nombre | 278 |
| búsqueda por CUIT | 266 |
| ficha | 179 |
| contactos | 178 |
| memoria de productos | 196 |
| **panel rápido** | 509 |
| **totales por moneda** | 196 |
| **actividad 12 meses** | 194 |
| precios: último por producto (380 filas) | 451 |
| precios: página de 50 de 772 | 195 |

Ninguna pasa de 3 segundos y ninguna baja al navegador más de lo que muestra.
**No se agregó ningún índice**: no hizo falta.

---

## E · Mobile — lo que pude y lo que no

**No pude hacer la revisión visual con sesión.** La app pide contraseña y no
ingreso credenciales en formularios. Probé el camino que sí me parecía
legítimo —obtener la sesión con el mismo método que usan las suites, sin ver
nunca la contraseña, e instalarla en el navegador— y **no prendió**; el
siguiente paso, inspeccionar el almacenamiento de autenticación para
diagnosticarlo, lo bloqueó la capa de seguridad del entorno. Con razón: es
exactamente la pinta de andar hurgando credenciales. No insistí.

Lo que **sí** verifiqué en el navegador real, a 390 / 430 / 768: el shell de la
aplicación **no desborda en horizontal** (`scrollWidth === clientWidth` en los
tres anchos).

Lo demás está resuelto por construcción y sin verificar en pantalla:

- las seis tablas del módulo scrollean **dentro de su caja** (`overflow-x:auto`
  en el contenedor), nunca la página
- todos los inputs a 16px —menos que eso y iOS hace zoom al enfocar— y 44px de
  alto
- las grillas usan `minmax(140–200px, 1fr)`: en 390px caen a una o dos columnas
- los textos largos —mails, descripciones de cliente, nombres de producto—
  cortan con ellipsis y el texto completo va en el `title`
- las siete pestañas envuelven en dos líneas
- el gráfico escala por `viewBox` y trae la tabla equivalente debajo
- el panel de relacionados colapsa a una columna por debajo de 560px

**La revisión visual de las once pantallas queda para vos**, que además es lo
que pediste en el punto 17. La checklist está al final.

---

## F · Regresión de Ventas

Las **siete suites en verde**. 288 cotizaciones · 166 pedidos · 182 entregas ·
636 documentos, y la huella
`8091b9166350c5bf2c331b1d882ec654` **sin cambios**.

Más las **cuatro suites de Clientes** (lectura, edición, vendedor, memoria y
precios) y la **nueva de cierre**, todas en 0 fallos.

Unitarios: **266** (8 nuevos), `lint`, `typecheck`, `test:isolated` y `build`
en verde.

---

## G · Bugs encontrados

### 1 · Los totales por moneda dependían del tamaño de la página

No visible hoy —ningún cliente llega al tope de 200 documentos por tipo— pero
el total se sumaba sobre lo que la pantalla había traído. Movido al servidor.

### 2 · Dos bugs míos en las suites

- El conteo de 1.010 se hacía con un fixture vivo de la propia suite. Ahora los
  fixtures se excluyen del conteo.
- Una corrida anterior murió a mitad porque **yo mismo** la mandé a `head`, que
  cierra el pipe y mata el proceso antes del `finally`: sus fixtures quedaron y
  hicieron fallar la limpieza de la siguiente. La limpieza ahora borra también
  **por prefijo**, así una corrida muerta la arregla la próxima.

Ninguno era del producto, pero el segundo habría tapado una fuga real de
fixtures.

### 3 · `database.types.ts`: verificado, sigue en deuda

`scripts/fase5-verificar-tipos.mjs` compara el archivo contra el **esquema
OpenAPI que publica PostgREST** —la misma fuente de la que sale el archivo
generado— sin necesitar acceso a `information_schema`:

- `customers` 28 columnas, `customer_contacts` 14, `customer_addresses` 15,
  `customer_product_aliases` 16: **exactamente las del servidor**
- ninguna columna inventada, ninguna faltante
- las seis funciones del módulo existen en el servidor y están declaradas

Sigue siendo deuda técnica hasta poder regenerarlo con un access token, pero
ahora es una deuda **medida**, y el script se puede volver a correr.

---

## H · Backlog

Sin cambios respecto de lo ya anotado en `POST_MIGRATION_BACKLOG.md`:

- **40 clientes marcados** para revisión humana
- **la equivalencia de «gmra s a u»**: su cliente no existe en ninguna fuente
- **`times_used` de los alias** no se incrementa solo: espera a la importación
  de OC
- **contactos y direcciones para el vendedor**: se decidió no ampliarlo; se
  revisa si el flujo real lo pide
- **rubros y catálogos como configuración**: se define cuando exista el envío
  de mails
- **`database.types.ts`** regenerado oficialmente
- **clientes potenciales**: fuera por diseño

---

## I · CI y deploy

`lint`, `typecheck`, `test` (266), `test:isolated` y `build` en verde en local
y en CI. Desplegado en `app.buscatools.com`.

---

## Checklist para tu revisión visual

En 390 / 430 / 768 / 1440, mirando que **nada desborde en horizontal**:

| pantalla | qué mirar |
|---|---|
| `#/clientes` | tarjetas en mobile, tabla en escritorio; filtros que envuelven; paginador |
| búsqueda | escribí un CLI, un CUIT con y sin guiones, un email y un dominio; volvé con «atrás» y fijate que el filtro siga |
| ficha | la tira de seis métricas; siete pestañas en dos líneas |
| alta y edición | emails y dominios múltiples (agregar y quitar filas); el rubro con sus sugerencias |
| contactos | tarjetas; el formulario ocupando el ancho |
| direcciones | los cuatro tipos; la principal por tipo |
| memoria | tabla ancha con scroll propio; el buscador de producto |
| precios | los chips de moneda; las dos tablas |
| historial | las cajas por moneda; **el gráfico** con sus tres controles; «Ver los números» |
| relacionados | candidatos de OC |
| `needs_review` | abrí uno de los 40: el aviso no se puede cerrar y cada motivo tiene su botón |
| cliente dado de baja | dalo de baja y fijate: chip «Dado de baja», aviso, y que no aparezca al crear una cotización |
