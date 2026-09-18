# Fase 17 · Clientes · Entrega 3 — Contactos, direcciones y a dónde se entrega

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: [`docs/database/PHASE_17_CLIENTES_ENTREGA_3.sql`](database/PHASE_17_CLIENTES_ENTREGA_3.sql),
con su ROLLBACK.

E3 cierra las decisiones 3 y 4 que E1 dejó anotadas: el vendedor administra la agenda de sus
clientes, y el pedido elige a qué domicilio se entrega. Con eso, la agenda del cliente deja de ser
un dato suelto de la ficha y pasa a ser parte del documento:

> **El cliente sugiere, el documento congela** (E2), y ahora eso también vale para **a quién se le
> escribe** y **a dónde se entrega**. Como consecuencia, un contacto o una dirección que ya figura
> en un documento **no se borra: se desactiva.**

No se tocaron WhatsApp, OpenAI, workers, cron, STEL, Compras, Stock ni Mantenimiento.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CONTACTS_STATE | 87 contactos productivos, **0 marcados como principal** y sin forma de desactivar uno. El alta y la edición eran **dos escrituras desde el navegador**: bajar el principal anterior y después guardar. |
| ADDRESSES_STATE | `customer_addresses` **vacía**: el legacy guardaba la dirección como texto libre dentro del documento. |
| ORDER_SHIPPING | `sales_orders.shipping_address_id` **ya existía** desde Stage 3, en NULL en los 172 pedidos: nunca hubo UI que la escribiera ni validación que la cuidara. Una FK sola deja mandar la mercadería al domicilio de otro cliente. |
| DELIVERY_SNAPSHOT | E6 ya congelaba el domicilio al emitir el remito (`app.domicilio_para_remito`), leyendo primero `sales_orders.shipping_address_id` —que siempre era NULL— y cayendo en la principal del cliente. |
| PERMISSIONS | `contacts_write` y `addresses_write` usaban `app.current_writer_company_ids()`: admin y employee. Un vendedor podía cambiarle la razón social a su cliente pero no cargarle un teléfono. |

## 2 · Lo que cambió en la base

**0 tablas nuevas. 2 columnas.** `customer_contacts.active` y `customer_addresses.active`, las dos
`not null default true`: **sin backfill**, lo que ya estaba queda activo.

| Pieza | Qué hace |
|---|---|
| `app.puede_administrar_cliente(customer)` | Admin, employee, o el vendedor **de ese cliente**. Es la regla de la decisión 3, escrita una sola vez: la usan las dos policies y las cuatro RPC. |
| `guardar_contacto` / `guardar_direccion` | Alta y edición en **UNA** transacción, con whitelist, testigo de concurrencia, contrato de `sin_cambios` y auditoría del antes/después. El principal se resuelve adentro. |
| `borrar_contacto` / `borrar_direccion` | Borran **sólo** si ningún documento los nombra. Si no, `CONTACTO_REFERENCIADO` / `DIRECCION_REFERENCIADA`. |
| `app.validar_direccion_envio` | La dirección de entrega de un pedido tiene que ser **activa, de ese cliente y de tipo entrega** (o los dos). Se llama desde `crear_pedido` y `guardar_pedido`. |
| `uq_customer_contact_default` / `uq_customer_addr_default` | Rehechos con `where is_default and active`: un contacto desactivado no puede ser el principal. |
| `app.domicilio_para_remito` | Ahora ignora las direcciones desactivadas al buscar la principal. |

### El principal, resuelto adentro

El problema viejo no era teórico: entre «bajo el principal anterior» y «guardo el nuevo», si la
segunda escritura fallaba el cliente quedaba **sin ningún principal**; si dos personas marcaban a la
vez, el índice único rechazaba el insert y la persona veía un error de base. Ahora las dos cosas
pasan en la misma transacción, y la prueba lo mide por el efecto: dos contactos, **un** principal, y
es el último marcado.

### Desactivar en vez de borrar

`borrar_contacto` mira seis tablas —cotizaciones, pedidos, remitos, órdenes de compra del cliente,
conversaciones de WhatsApp e hilos de email—. WhatsApp y email están ahí **aunque no se toquen**:
borrar el contacto les rompería el hilo.

Cuando el servidor dice que está referenciado, la pantalla **no repite el error**: el mismo diálogo
cambia de oferta y pasa a «Desactivarlo». Desactivar deja de ofrecerlo en los documentos nuevos y
los viejos lo siguen nombrando igual.

## 3 · La dirección de entrega del pedido

`ORDER_SHIPPING_FIELD`: el pedido tiene un campo **«Entregar en»** con los domicilios de entrega del
cliente. Tres reglas:

- **Sin elegir es una elección.** La opción se llama «Domicilio principal del cliente» y viaja como
  `null`: el remito usará la principal **en el momento de emitirlo**. No se autocompleta con la
  principal de hoy para que después parezca congelada.
- **Se valida en el servidor.** Una dirección de otro cliente, una de facturación o una desactivada
  cortan con `DIRECCION_INVALIDA`. La FK sola no alcanzaba.
- **El remito la congela.** Probado de punta a punta: pedido con dirección → remito → el snapshot
  dice `Av. Siempreviva 742`; después el cliente **se muda** y el remito **sigue diciendo lo mismo**.

En la ficha del pedido en modo lectura se lee «Entregar en»; sin elegir dice, literalmente, *«Sin
elegir: el remito usará el domicilio principal del cliente»*, que es lo que efectivamente va a pasar.

`DOCUMENT_CONTACT`: el contacto principal **sugiere** el contacto de la cotización y del pedido
nuevos, con la regla más conservadora del módulo (`sugerirDeLaAgenda`, 11 pruebas): llena lo que está
**vacío** y nadie tocó, no elige «el primero que haya» si el cliente no marcó ninguno, y **no
sugiere un principal desactivado**. Cambiar de cliente se lleva el contacto y el domicilio del
anterior: eran de otro.

`PERFORMANCE`: **cero consultas nuevas por documento**. Los contactos ya se pedían para el
desplegable y los domicilios son una consulta acotada del mismo tipo; la sugerencia se calcula sobre
esas listas, no pregunta de nuevo.

## 4 · Permisos

`SALESPERSON_SCOPE`: el vendedor administra contactos y direcciones **de los clientes que tiene
asignados**. Lo decide `app.puede_administrar_cliente` en las policies y en las RPC; los botones lo
acompañan. Probado con usuarios reales de cada rol contra la base: el vendedor **sí** en su cliente,
**no** en uno ajeno; el técnico en ninguno; el admin de otra empresa tampoco; anónimo rebota en el
`revoke execute`.

Del lado de la pantalla, `permisosDe` pasó a recibir el cliente y el usuario. **Sin** esos dos datos
un vendedor no ve los botones: es el lado seguro del error —la policy lo dejaría, y lo peor que pasa
es que no se muestre un botón que sí podía usar—.

## 5 · Lo que NO cambia

| Clave | Estado |
|---|---|
| HISTORICAL_DATA | **Cero backfill.** Los 87 contactos quedaron activos y sin principal, como estaban. `customer_addresses` sigue vacía. Los 172 pedidos siguen con `shipping_address_id` en NULL. |
| EXISTING_DOCUMENTS | Desactivar un contacto **no toca** los documentos que lo nombran. Mudar al cliente **no toca** el snapshot de un remito emitido. |
| QUOTE_SHIPPING | La cotización **no** tiene dirección de entrega: es la promesa de un precio, no de una entrega. |
| WHATSAPP / EMAIL | Sólo se leen para saber si un contacto está referenciado. Ni una escritura. |

## 6 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase17-e3-contactos-direcciones-tests.mjs` (base real) | **49 PASS · 0 fallos** |
| `scripts/fase17-e1-clientes-tests.mjs`, `fase17-e2-defaults-tests.mjs` (regresión) | 0 fallos |
| `scripts/fase15-e4-pedidos-tests.mjs`, `e5-remitos`, `e6-adjuntos` (regresión) | 0 fallos |
| `npm test` / `npm run test:isolated` | **1.525 tests**, 130 archivos |
| `npx tsc -b`, `npm run lint`, `npm run build` | limpio |

De la base, lo que vale la pena nombrar: `un contacto desactivado deja de ser principal` y `el
cliente queda sin principal, no con uno inventado`; `borrar un contacto que figura en un documento —
CONTACTO_REFERENCIADO` seguido de `pero se puede desactivar` y `la cotización lo sigue nombrando`;
`una dirección de facturación como dirección de entrega — DIRECCION_INVALIDA`; `el remito congela la
dirección del pedido` y `mudarse no cambia el remito`; `producción idéntica al baseline`.

Del frontend: 11 pruebas de `sugerirDeLaAgenda`, 12 del editor de contactos y 10 del de direcciones
—todas midiendo **qué se le manda al servidor**, no qué campos se ven—, 5 en «Nuevo pedido» y 3 en
la ficha del pedido, más 5 nuevas de permisos.

Un caso que merece su línea: **un contacto o una dirección desactivados que el documento YA nombra
se siguen mostrando en el desplegable, marcados**. Esconderlos dejaría el control en blanco y
guardar borraría el dato sin que nadie lo hubiera pedido.

## 7 · Verificación en el navegador

Con datos reales y **sin escribir nada**: la ficha de un cliente con 22 contactos los muestra con
Editar / Desactivar / Borrar; la pestaña de direcciones explica por qué está vacía y que la de
entrega se elige en el pedido; la ficha de un pedido productivo lee «Entregar en — *Sin elegir: el
remito usará el domicilio principal del cliente*»; y en «Nuevo pedido», al elegir un cliente real, el
campo aparece con el aviso de que ese cliente todavía no tiene domicilios cargados. Sin desborde
horizontal a 375 px. Consola limpia en una pestaña nueva.

## 8 · Qué queda para E4

- **`discount_pct` y `credit_limit`**: siguen sin decisión de negocio (vienen de E2).
- **Alta de cliente atómica** con su primer contacto: hoy el alta sigue siendo un `insert` y el
  contacto se carga después.
- **Marcar principales en producción**: hay 87 contactos y ninguno principal. Es un trabajo de datos
  que ahora **se puede hacer desde la pantalla**, cliente por cliente, y a propósito no se hizo por
  script: quién atiende a cada cliente no lo sabe una migración.
