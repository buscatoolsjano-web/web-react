# Fase 17 · Clientes · Entrega 4 — La ficha operativa, cerrada

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: [`docs/database/PHASE_17_CLIENTES_ENTREGA_4.sql`](database/PHASE_17_CLIENTES_ENTREGA_4.sql),
con su ROLLBACK.

E4 cierra la ficha: adjuntos reales, trazabilidad real, «qué compra este cliente», y un historial
que dejó de traer todo para no mostrarlo. **0 tablas nuevas, 0 columnas nuevas, 0 buckets nuevos**:
todo se apoya en `attachments`, el bucket `ventas` de Ventas · E6 y `sales_audit`.

No se tocaron WhatsApp, OpenAI, workers, cron, STEL ni la lógica de Ventas —sólo se consumen sus
interfaces—. `needs_review`, `discount_pct` y `credit_limit` siguen fuera, por decisión pendiente.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CURRENT_CUSTOMER_SHELL | Encabezado + dos secciones fijas (Contacto, Actividad). **El vendedor no aparecía** fuera de la pestaña de datos. |
| CURRENT_TABS | 7, **ninguna lazy**: las cuatro consultas de la página y el resumen salían al abrir, se mirara lo que se mirara. |
| CURRENT_ATTACHMENTS | **No había UI.** `attachments.entity_type` ya aceptaba `customer` por CHECK, pero `app.validar_adjunto` **no validaba nada** para ese tipo, y la visibilidad estaba mal (§ 5). |
| CURRENT_ACTIVITY | Sólo métricas y documentos. Nada de `sales_audit`: 2 filas en producción, las dos de Ventas, **0 de `customer`**. |
| CURRENT_PRODUCT_MEMORY | El editor de **alias** (14 filas). No respondía «qué compra»: sin cantidades, sin última compra, sin precio. |
| CURRENT_PRICE_HISTORY | La mejor de las siete: RPC, paginada, por moneda, cotización vs pedido. Dos gaps: el filtro por producto **existía en el hook y estaba cableado a `null`**, y el enlace de «último precio» iba al listado porque la función devolvía el número y no el id. |
| CURRENT_DOCUMENT_HISTORY | Tres consultas con `limit 200` **cada una**, unidas y ordenadas en el navegador, **sin paginar**. Con Grupo Mirgor, 258 documentos al abrir la ficha. |
| CURRENT_RELATED | Una sola cosa: candidatos de OC. 134 filas en **19 clientes de 1.010** — una pestaña vacía para el 98%. |
| CURRENT_ACTIONS | Editar, Dar de baja / Reactivar. **Sin «Nueva cotización» ni «Nuevo pedido»**. |

## 2 · Lo que se encontró y no se sabía

**`attachments_select` se apoyaba en la empresa; `customers_select`, en el cliente.** Un vendedor ve
**sólo sus clientes** y un técnico **ninguno**, pero la policy de adjuntos miraba
`current_internal_company_ids()`. El día que existiera el primer adjunto de cliente, se habría visto
desde donde el cliente no se ve. Es el § 29 del pedido, y era un agujero real esperando el primer
archivo.

Ahora la policy es literal: `exists (select 1 from customers c where c.id = entity_id)`. Corre con
los permisos de quien llama, así que **hereda `customers_select`**; no hay una segunda copia de la
regla que pueda desincronizarse. Escribir es `app.puede_administrar_cliente` (E3), y sobre un cliente
dado de baja se lee pero no se sube ni se borra.

Y una que apareció probando: las policies de Storage llaman funciones que corren con los permisos de
quien sube. Faltaba el `grant execute ... to authenticated` sobre `app.uuid_o_nulo`, y subir fallaba
con *permission denied for function*. La suite lo encontró antes que una persona.

## 3 · Adjuntos del cliente

`ATTACHMENTS` / `STORAGE`: misma tabla, mismo bucket privado, mismo flujo de E6 —URL firmada de 5
minutos, 20 MB, primero el archivo y después la fila al subir; primero la fila y después el archivo
al borrar—.

`TIPOS`: se reutiliza el CHECK de `kind`, que ya existía. De sus siete valores se ofrecen cinco
—General, Orden de compra, Fiscal, Comprobante, Foto—; `quote_pdf` y `remito` quedan afuera porque son
adjuntos de un documento y su lugar es ese documento. **No se inventó una taxonomía nueva.**

`ATTACHMENT_SECURITY`: `app.validar_adjunto` ahora comprueba, para `customer`, que el cliente exista
en esa empresa y que la ruta sea `<empresa>/customer/<cliente>/…`, sin saltos de carpeta. Un adjunto
de cliente no puede escribirse dentro de la carpeta de un documento, ni al revés.

## 4 · Trazabilidad

`TRACEABILITY`: pestaña nueva sobre `sales_audit`. Los eventos ya los escribían E1 (alta, edición,
baja, reactivación) y E3 (contactos y direcciones); E4 sumó los adjuntos y **no inventó ninguno más**.
**No se audita leer**: abrir la ficha o descargar un archivo no deja rastro.

La regla del módulo de presentación es una sola: **nunca sale un UUID a pantalla**. Un id no le dice
nada a nadie, y el día que la fila que nombra se borre, tampoco se puede resolver. Por eso E4 agregó
la etiqueta humana —el nombre del contacto, la calle de la dirección— también al diff de las
**ediciones**; las altas y las bajas ya la traían. Se lee así:

- «Se editó un contacto: Ana Pérez» → *Cambió el teléfono: de nada a 11 5555*
- «Se agregó una dirección: Av. Siempreviva 742 (entrega)» → *Quedó marcado como principal*
- «Se editaron los datos del cliente» → *Se asignó el vendedor* (no su id)

`ACTIVITY`: **Actividad** (arriba, siempre visible) es el negocio —cuántas cotizaciones, cuánto se
pidió, cuándo fue lo último—. **Trazabilidad** es quién tocó la ficha y qué cambió. No se pisan: la
primera nunca mezcló eventos de cambio y la segunda no muestra documentos.

## 5 · Tabs

`TABS`: de 7 a 9, sin ninguna vacía por costumbre.

| Antes | Ahora |
|---|---|
| Datos comerciales, Contactos, Direcciones | igual |
| Memoria de productos | **Productos** (qué compra) + **Cómo los llama** (los alias, que es lo que esa pestaña era) |
| Precios, Historial | igual, con filtro por producto y paginación real |
| **Relacionados** | **se fue**: sus candidatos de OC son papeles del cliente que aparecieron en sus documentos, así que pasaron a ser una sección del Historial, y sólo se muestra cuando hay alguno |
| — | **Adjuntos**, **Trazabilidad** |

## 6 · Productos y precios

`PRODUCT_MEMORY`: una fila por producto **y por moneda**, con lo **pedido** y lo **cotizado** en
columnas separadas, la última vez —con enlace al documento y una etiqueta que dice si fue cotización
o pedido—, la última cantidad y el último precio. Búsqueda y paginación del lado del servidor.

Tres cosas que esta tabla **no** hace, a propósito:

- **no suma** lo cotizado con lo pedido: una cotización es una pregunta que el cliente hizo y un
  pedido es una compra; llamar «vendido» a lo primero sería inventar una venta;
- **no mezcla monedas**: sumar 100 USD y 100 ARS da 200 de nada;
- **no dice «habitual» ni «preferido»**: con un pedido no alcanza para afirmarlo y con veinte no hace
  falta decirlo, porque el número está a la vista.

El SKU y el nombre salen del **catálogo**, no del snapshot de la línea: la respuesta se usa para ir a
buscar ese producto, así que sirve el nombre que tiene hoy. El snapshot sigue mandando dentro de cada
documento, donde está congelado a propósito, y queda de reserva para los productos que ya no existen.
Esto además arregló la búsqueda, que miraba el snapshot y no encontraba por el nombre actual.

`PRICE_HISTORY`: se conectó el filtro por producto que el hook ya sabía hacer y la pantalla le pasaba
`null` —con 772 líneas en el cliente más grande, buscar un precio era paginar— y el «último precio»
enlaza por fin al documento, no al listado.

## 7 · Rendimiento

`PERFORMANCE` / `LAZY_LOADING`: **abrir la ficha son cuatro consultas** —el cliente, sus contactos,
sus direcciones y el resumen—, medidas en el navegador instrumentando `fetch`:

```
alAbrir: ["customers", "customer_contacts", "customer_addresses", "resumen_cliente"]
```

Cada pestaña pide lo suyo al abrirse, y nada más: Productos → `productos_del_cliente`; Adjuntos →
`attachments`; Trazabilidad → `sales_audit`; Historial → totales, actividad, documentos y candidatos
de OC. Cambiar de página del historial es **una** consulta.

El contador de la pestaña Historial sale del **resumen**, que ya estaba cargado: pedir 258 documentos
para poder decir que son 258 era exactamente el problema.

`NO_N_PLUS_ONE`: el historial pasó de tres consultas a una (`documentos_del_cliente`, un UNION del
lado del servidor con `count(*) over ()`); el nombre de quien hizo cada cambio viaja en la misma
consulta que los eventos, con el join embebido de PostgREST; los adjuntos son una consulta con su
autor incluido.

`CACHÉ`: subir o borrar un adjunto invalida **sólo** la lista de adjuntos y la trazabilidad. La
memoria de productos, los precios y el historial no cambiaron porque alguien adjuntó un PDF.

## 8 · Cabecera y documento nuevo

`HEADER_ACTIONS`: Nueva cotización · Nuevo pedido · Dar de baja / Reactivar · Editar. Las dos
primeras no aparecen en un cliente dado de baja.

`NEW_DOCUMENT_FROM_CUSTOMER`: lo único que viaja es `?cliente=<id>`. Los defaults comerciales los
aplica **Ventas** con el mecanismo de E2, y el contacto y el domicilio con el de E3: entra en el
borrador inicial y dispara el mismo camino que si alguien hubiera buscado el cliente a mano. Copiar
los defaults desde Clientes habría sido tener dos lugares donde vive la misma regla, y el día que
cambie uno, el otro miente. **No promete que se vaya a poder crear**: si la numeración de ese tipo la
administra STEL, la pantalla de Ventas lo dice y bloquea; esto lleva hasta ahí con el cliente puesto,
que es todo lo que puede saber.

`CONTACT_PRIMARY` / `ADDRESS_PRIMARY`: si nadie marcó un principal, la ficha dice **«Sin contacto
principal»** y **«Ninguna marcada como principal»**. No se elige uno cualquiera entre los que haya
—la dirección caía en `direcciones[0]`, y desde E3 además puede estar desactivada—. El vendedor se
sumó al resumen.

## 9 · Permisos y seguridad

| Rol | Ficha | Agenda | Adjuntos |
|---|---|---|---|
| admin / employee | todo | todo | leer y escribir |
| salesperson | **sólo sus clientes** (RLS) | los suyos (E3) | los suyos |
| technician | ningún cliente | — | — |
| portal / otra empresa | lo suyo | — | — |

`RED_TEAM`, probado contra la base con usuarios reales de cada rol: el vendedor **no** ve los
adjuntos, los documentos, los productos ni la trazabilidad de un cliente ajeno; el técnico no ve
ninguno; el admin de otra empresa tampoco; anónimo rebota. Un adjunto con la ruta de **otro** cliente
→ `RUTA_INVALIDA`; con salto de carpeta → `RUTA_INVALIDA`; de un cliente inexistente →
`DOCUMENTO_INEXISTENTE`; de más de 20 MB → `ARCHIVO_DEMASIADO_GRANDE`. Y no alcanza con la fila: el
vendedor **tampoco puede subir el archivo** a la carpeta de un cliente ajeno ni listar lo que hay
adentro.

`DEACTIVATED`: en un cliente dado de baja los adjuntos **se leen** y **no** se suben ni se borran, la
ficha y el historial siguen visibles, y las acciones de documento nuevo no se ofrecen.

## 10 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase17-e4-ficha-tests.mjs` (base real) | **61 PASS · 0 fallos** |
| `fase17-e1`, `e2`, `e3` y `fase15-e4`, `e5`, `e6` (regresión) | 0 fallos |
| `npm test` / `npm run test:isolated` | **1.543 tests**, 131 archivos |
| `npx tsc -b`, `npm run lint`, `npm run build` | limpio |

De la base, lo que vale la pena nombrar: `el vendedor ve los adjuntos de SU cliente` / `pero NO los
del cliente de otro vendedor`; `el técnico no ve ninguno: tampoco ve los clientes`; `en un cliente
dado de baja NO se adjunta` pero `sus adjuntos se siguen leyendo`; `el vendedor no sube a la carpeta
de un cliente ajeno` y `ni ve lo que hay adentro`; `sin repetir ni saltear documentos`; `la cantidad
cotizada NO incluye la pedida`; `el nombre sale del catálogo, no del snapshot de la línea`; `la
edición de un contacto trae su NOMBRE, no sólo el id`; `leer NO deja rastro`; `producción idéntica al
baseline`.

Del frontend, 18 pruebas de `presentarEvento` —la mitad son formas distintas de comprobar que **no
sale un UUID**— más las de la ficha, actualizadas.

Lint encontró dos errores reales míos que no eran de estilo: dos hooks llamados **después** de los
`return` tempranos —un hook condicional— y un `setState` síncrono dentro de un efecto. Los dos están
arreglados en el código, no silenciados.

## 11 · Verificación en el navegador

Con datos reales y **sin escribir nada**, sobre dos clientes productivos:

- **Grupo Mirgor** (22 contactos, 258 documentos, 397 productos): las nueve pestañas, el contador
  del historial en 258 sin traer los documentos, la cabecera con vendedor y las dos acciones nuevas.
- **Whirlpool Argentina** (sin contactos, sin emails, sin direcciones): los vacíos se dicen —«Sin
  contacto principal», «Sin vendedor asignado»— y ninguna sección queda en blanco. En Productos, «1.227
  en 11 pedidos» y «1.116 en 16 cotizaciones» en columnas separadas; el historial en `1–25 de 74` y la
  página siguiente en una consulta; el filtro por producto de Precios bajando a `1–25 de 27 líneas`;
  Trazabilidad vacía con su explicación —un cliente migrado no trae historial de cambios—.

Sin desborde horizontal a 375 px. Consola limpia en una pestaña nueva.

`ACCESSIBILITY`: la trazabilidad es una `<ol>` semántica, no una tabla; las tablas nuevas llevan
`<caption>` y `<th scope="col">`; el input de archivo conserva su etiqueta y se dispara desde un botón
real; los diálogos de borrado son `alertdialog` con foco en «Volver».

## 12 · Qué queda para E5 (`E5_GAPS`)

- **Cola de revisión y duplicados** (`needs_review`, `review_reason`, `resolver_revision_cliente`):
  intacta, es el tema de E5.
- **Alta de cliente atómica** con su primer contacto: sigue siendo un `insert` y el contacto se carga
  después.
- **`discount_pct` y `credit_limit`**: sin decisión de negocio desde E2.
- **Marcar los contactos principales en producción**: 87 contactos y ninguno principal. Se puede
  hacer desde la pantalla, cliente por cliente; a propósito no se hizo por script.
- **Cuatro `PanelAdjuntos`**: Ventas, Compras, Mantenimiento y ahora Clientes tienen cada uno el suyo
  sobre la misma tabla y el mismo bucket. Es el patrón de la casa y E4 lo siguió en vez de inventar
  un cuarto camino, pero unificarlos es una limpieza que en algún momento conviene hacer.
