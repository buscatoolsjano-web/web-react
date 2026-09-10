# Fase 5 · Clientes — auditoría del legacy y plan de migración

**Todavía no se programó nada.**

Fuente auditada: `~/Downloads/index.html` (3,2 MB) y su `index_files/app.js`
(45.345 líneas), la copia del 2026-09-08. Sólo lectura. Los números de la base
salen de consultas a producción.

---

## A · Pantallas del legacy

`Clientes` es una sección con **cuatro subsecciones** declaradas en un solo
lugar (app.js 216):

| subsección | qué hay |
|---|---|
| **Clientes** | listado + ficha. `renderClientes` 18293, `renderClienteDetalle` 18677 |
| **Clientes potenciales** | **nada**. Cae en `empty()` y muestra «Próximamente» |
| **Personas de contacto** | listado propio, `renderContactos` |
| **Rubros y catálogos** | configuración de 4 rubros con sus catálogos |

Y un **panel rápido** (`abrirClienteQuickPanel` 18180) que se abre desde el
listado con el resumen del cliente y un gráfico de ventas de 12 meses.

### Listado

Columnas: Referencia · Nombre jurídico · Nombre · CUIT · Email · Dominio ·
Rubro · Memoria. Con filtro por columna en las seis primeras, orden por
cabecera, búsqueda libre, paginado de 25 **en el cliente**, y un menú «Más»
con sólo dos acciones: **exportar a CSV** y **seleccionar todas**.

### Ficha — cinco pestañas

| pestaña | contenido |
|---|---|
| **Información** | identificación, emails, dominios, rubro, país |
| **👤 Contactos** | los contactos de ese cliente |
| **🧠 Memoria de productos** | «cómo llama el cliente a cada SKU» |
| **💰 Precios** | último precio cotizado por SKU, con anterior, fecha y veces |
| **Historial** | cotizaciones, pedidos, notas de entrega y facturas |

Menú «Más» de la ficha: **Nueva cotización**, **Nueva incidencia**, **Borrar
memoria**. No hay eliminar cliente — **el legacy no borra clientes.**

---

## B · Funciones

| función legacy | qué hace |
|---|---|
| `renderClientes` 18293 | listado, filtros, orden, paginado |
| `_clientes_applyFilters` 18085 | filtra y ordena **en memoria** sobre los 988 |
| `renderClienteDetalle` 18677 | la ficha con sus cinco pestañas |
| `abrirClienteQuickPanel` 18180 | panel lateral con resumen y gráfico |
| `getClienteObj` / `saveClienteObj` 24579 | leer y guardar un cliente |
| `nextClienteRef` | `CLI00001` por **`MAX+1` local** |
| `loadClientesExtra` / `saveClientesExtra` | los campos editables, en `localStorage` |
| `getDocumentosCliente` 17805 | los documentos, **cruzados por nombre normalizado** |
| `loadContactos` / `saveContactos` 17821 | los contactos |
| `loadPriceMemory` / `recordClientePrice` 769 | la memoria de precios |
| `getMemoriaCliente` | la memoria de productos |
| `loadRubrosConfig` 16692 | los rubros y sus catálogos |

---

## C · Datos

### De dónde salen los clientes

```js
let CLIENTES = JSON.parse(document.getElementById('clientes-data').textContent);
```

Un array **embebido en el HTML**, más un parche por cliente en `localStorage`
(`buscatools_clientes_extra`) con lo que se edita desde la ficha.

**988 clientes**, y sus campos:

| campo | cuántos lo tienen |
|---|---:|
| `ref` (CLI00001) | 988 |
| `nj` — nombre jurídico | 988 |
| `nc` — nombre comercial | 958 |
| `emails[]` | 877 |
| `doms[]` — dominios de mail | 670 |
| `cif` — CUIT | 592 |
| **con al menos CUIT, email o dominio** | **935** |

`rubro`, `pais` y `tel` **no están en el array**: viven en el parche de
`localStorage`, que **sí sincroniza** al servidor legacy
(`buscatools_clientes_extra` está en `SUPA_SYNC_KEYS`).

### Lo que hay hoy en la base nueva

| | |
|---|---:|
| clientes | **60** |
| con razón social | 60 |
| con nombre comercial · CUIT · dominios · forma de pago · lista | **3** |
| con vendedor | **1** |
| contactos | **55** |
| **direcciones** | **0** |
| equivalencias de producto | 14 |

Los 57 que creó la migración de Stage 2 tienen **sólo el nombre**: se crearon
a partir del histórico de ventas, no del maestro de clientes.

### El cruce, medido

| | |
|---|---:|
| clientes en el legacy | **988** |
| clientes en la base | **60** |
| **legacy que corresponde a uno de la base** | **46** |
| de la base **sin correspondencia** en el legacy | **14** |
| legacy que **no está** en la base | **~942** |

De esos 14: tres son los clientes de prueba de Stage 1 (Cliente Demo,
Distribuidor Demo, Otro Cliente) y once vienen del histórico de ventas con un
nombre que no coincide con ninguno del maestro.

---

## D · Contactos

Campos del legacy: `cliente` · `nombre` · `cargo` · `email` · `telefono` ·
`fax`.

**El vínculo con el cliente es el NOMBRE, en texto.** Es el mismo problema que
`fromCotizacion` en Ventas, y por eso Stage 2 migró 55 de 87 contactos: los
otros 32 nombran clientes que no están en el histórico de ventas.

`customer_contacts` ya tiene todos los campos, incluido `fax`, y una FK real.

---

## E · Direcciones

**El legacy no tiene direcciones de cliente.** No hay campo de calle, ciudad ni
código postal en el array ni en la ficha; lo más cercano es un `dir` suelto
dentro del parche de `localStorage`, que la ficha ni siquiera muestra.

`customer_addresses` existe, está vacía (0 filas) y es la que necesita el
selector de dirección de envío del remito. **No hay nada que migrar: hay que
cargarlas.**

---

## F · Vendedor asignado

**No existe en el legacy.** No hay campo de vendedor en el cliente ni en
ninguna de las cinco pestañas.

`customers.salesperson_id` existe y tiene **1 de 60** cargado, puesto a mano
en las pruebas de Stage 1.

---

## G · Condiciones de pago

**No existen a nivel cliente.** `formaPago` en el legacy es un campo **del
documento**, con el valor por defecto `'30 DIAS F/F con ECHEQ'` escrito en el
código.

`customers.payment_terms` existe (3 de 60). Que la cotización tome la forma de
pago del cliente sería una mejora, no una migración.

---

## H · Listas de precios

Tampoco existen a nivel cliente en el legacy. Lo que sí hay es **la memoria de
precios**: por cliente y por SKU, el último precio cotizado, el anterior, la
fecha, la cotización y cuántas veces se usó.

Y hay un detalle importante: **`bterp_price_memory` NO está en
`SUPA_SYNC_KEYS` ni pasa por `_supaDirectSave`**. Es local de cada navegador —
el mismo caso que las facturas en Stage 2. Puede que exista sólo en una
máquina, o en ninguna.

En la base nueva hay `price_lists` (4) y `product_prices` (12.505), y
`customers.default_price_list_id` (3 de 60). **Son dos cosas distintas**: una
lista de precios es un precio de catálogo; la memoria es «a este cliente le
cotizamos esto la última vez». No hay dónde poner la segunda.

---

## I · Documentos relacionados

`getDocumentosCliente` cruza **por nombre normalizado** contra cotizaciones,
pedidos, notas de entrega y facturas. En la base nueva es un `customer_id`, y
las tres primeras ya están migradas y enlazadas.

La ficha calcula además tres totales: cotizado, facturado y cobrado. **Suma
importes sin mirar la moneda** — y en el histórico hay cuatro. Ese total no se
puede migrar como está.

---

## J · Acciones

| acción | legacy | ¿se migra? |
|---|---|---|
| buscar, filtrar, ordenar, paginar | sí, **en memoria** | sí, **server-side** |
| exportar a CSV | sí | sí |
| seleccionar todas | sí | sí |
| alta de cliente | sí, `MAX+1` local | sí, con numeración del servidor |
| editar (rubro, país, y el parche) | sí | sí |
| **eliminar** | **no existe** | se define |
| nueva cotización desde la ficha | sí | sí |
| nueva incidencia | sí (Mantenimientos) | **no**: es de otro módulo |
| borrar memoria de productos | sí | sí |
| exportar memoria | sí | sí |
| ver historial de documentos | sí | sí |
| panel rápido con gráfico de 12 meses | sí | sí |

---

## K · Diferencias obligatorias con el backend nuevo

### K.1 · Faltan tres columnas que el legacy sí usa

| dato legacy | en `customers` | qué hacer |
|---|---|---|
| `emails[]` (877 clientes) | **no hay columna de email** | decidir: `emails text[]`, o volcarlos a `customer_contacts` |
| `rubro` | **no hay columna** | decidir: columna, o tabla de rubros |
| `pais` | está en `customer_addresses.country_code` | el país es del domicilio, no del cliente: hay que crear la dirección |

Hay `email_domains` (para reconocer de qué cliente viene un mail) pero no la
dirección de correo en sí.

### K.2 · La memoria de precios no tiene dónde ir

Ver H. Requiere una tabla nueva o queda fuera. **No se inventa una tabla sin
que se decida.**

### K.3 · La referencia `CLI00001`

Sale de `MAX+1` local — el mismo mecanismo que produjo los 9 `PDV11xxx`. En la
base hay `customers.legacy_ref` (3 de 60) para conservar la del legacy; para
clientes nuevos habría que sembrar una secuencia `customer` en
`document_sequences`, o aceptar que el identificador es el uuid y la
referencia es sólo histórica. **Es una decisión.**

### K.4 · 942 clientes que no están en la base

Migrar el maestro completo es una decisión de alcance, no un detalle. Ver el
plan.

### K.5 · Los totales del cliente suman monedas distintas

Ver I. Se muestran **por moneda**, como en Ventas.

### K.6 · Un cliente no se borra si tiene documentos

El legacy no borra clientes en absoluto. En la base hay FK desde
`sales_quotes`, `sales_orders`, `deliveries` y `company_memberships`: hay que
decidir entre no borrar nunca, soft delete (`customers.deleted_at` ya existe)
o borrado sólo sin documentos.

---

## L · Plan por entregas

| # | entrega | qué incluye | escribe |
|---|---|---|---|
| **1** | **Leer** | `#/clientes` con listado server-side, filtros, orden, paginado y CSV; ficha en sólo lectura con Información, Contactos, Historial y Relacionados | **no** |
| **2** | **Enriquecer el maestro** | cruzar los 988 del legacy contra los 60 y completar CUIT, nombre comercial, dominios, emails y referencia en los **46** que corresponden. Idempotente, con reporte de lo que no cruza | sí, controlado |
| **3** | **Editar** | alta y edición del cliente, contactos y direcciones. Numeración y reglas de borrado según K.3 y K.6 | sí |
| **4** | **Memoria de productos** | la pestaña sobre `customer_product_aliases`, que ya tiene 14 filas | sí |
| **5** | **Cierre** | panel rápido, acciones desde la ficha, mobile, RLS, revisión visual | sí |

Las entregas 1 y 4 no dependen de ninguna decisión. **La 2 y la 3 sí**: hay que
cerrar antes K.1, K.3, K.4 y K.6.

### El alcance de la entrega 2, para decidir

- **(a)** sólo los 46 que ya están → el maestro sigue teniendo 60
- **(b)** los 46 más los ~942 restantes → el maestro pasa a ~1.002
- **(c)** los 46 más los que tengan CUIT (592 en total) → un punto medio

No hay una respuesta técnica: depende de si el maestro de clientes tiene que
ser la agenda comercial completa o sólo quién compró.

---

## M · Riesgos

| # | riesgo | por qué | mitigación |
|---|---|---|---|
| 1 | **unir dos clientes por parecido de nombre** | es exactamente lo que Stage 2 no hizo, a propósito | cruce por nombre normalizado y **reporte de lo dudoso**, sin unir nada sin evidencia |
| 2 | **pisar un dato bueno con uno viejo** | el legacy tiene el array embebido Y el parche de localStorage, y pueden discrepar | completar **sólo campos vacíos**; nunca sobrescribir lo que ya tiene valor |
| 3 | **la memoria de precios puede no existir** | es local de cada navegador, como las facturas | auditar la máquina antes de prometer nada |
| 4 | **inventar rubro o país** | no están en el array, sólo en el parche | si el parche no los tiene, quedan nulos |
| 5 | **traer 988 clientes al navegador** | es lo que hace el legacy hoy | server-side desde la entrega 1 |
| 6 | **borrar un cliente con documentos** | rompería la trazabilidad de 636 documentos | la decisión de K.6, y un trigger, no un botón |
| 7 | **exponer datos de clientes a un externo** | un cliente no puede ver el maestro | RLS: un externo ve **su** ficha y nada más |
| 8 | **los 32 contactos sin migrar** | nombran clientes que no están | se resuelven con la decisión de alcance de K.4 |

---

## N · Tests

**Unitarios** (lógica pura)

- normalización de nombres para el cruce: `S.A.`, `S.R.L.`, tildes, espacios
- el cruce **no** une dos clientes distintos con nombres parecidos
- totales por moneda: nunca se suman entre sí
- filtros ↔ URL, ida y vuelta

**Contra los datos reales**

| test | esperado |
|---|---|
| abrir el listado | 60 clientes |
| buscar por CUIT / dominio / nombre | acota |
| ficha de un cliente del histórico | sus documentos aparecen |
| totales de la ficha | **por moneda**, sin sumar |
| cruce del maestro (dry run) | **46** cruzan, 14 no, ~942 fuera |
| enriquecer, segunda corrida | **0 cambios** |
| ningún nombre se modifica | huella de los 60 estable |
| alta de cliente | referencia del servidor |
| contacto con FK real | no por texto |
| borrar un cliente con documentos | **rechazado** |
| RLS × 5 roles | un externo ve **sólo su ficha** |
| mobile 390 / 430 / 768 | listado en tarjetas, ficha legible |

**De regresión, obligatorio:** las siete suites de Ventas siguen en verde y los
636 documentos conservan su huella. Tocar `customers` toca el módulo que
acabamos de cerrar.
