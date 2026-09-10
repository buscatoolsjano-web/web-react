# Backlog post-migración

Cosas detectadas durante la migración que **no la bloquean**. Se anotan acá y se
sigue: el objetivo de la Fase 4 es migración funcional 1:1, no rediseñar Ventas.

Sólo se frena la migración por pérdida de datos, seguridad, integridad, RLS o un
bug crítico.

---

## Producto / proceso comercial

### Política de stock negativo

Hoy **se permite**: emitir un remito por más de lo que hay en stock deja el
saldo en negativo. No es una decisión nueva, es la del sistema anterior
—`applyStockDeductions` descontaba sin mirar el saldo— y migrar el circuito no
era el momento de cambiarla. La pantalla avisa cuándo va a pasar.

Queda para evaluar más adelante:

- bloquear
- pedir autorización
- permitirlo sólo a ciertos roles
- permitirlo cuando haya un pedido de compra pendiente de ingreso

**No cambiarlo ahora.**

### El remito: ¿valorizado o exclusivamente logístico?

Hoy es **valorizado**, por decisión explícita (Fase 4 · Stage 3 · G.1 opción A):
la nota de entrega del legacy se edita con precios y las 182 migradas traen
moneda, subtotal, impuesto y total en la cabecera, así que `delivery_lines`
recibió `unit_price`, `discount_pct`, `tax_treatment` y `tax_rate_snapshot`.

Vale la pena evaluar más adelante si el remito debería llevar sólo **qué y
cuánto** se entregó, dejando el importe en la factura. Es más limpio
conceptualmente y evita tener el precio en tres documentos. **No se cambia
ahora**: cambiaría el proceso comercial, no sólo el modelo.

### `salesperson_id` vacío en todo el histórico

Los 166 pedidos migrados lo tienen en `NULL` — el legacy no guardaba el vendedor
por documento. La columna «vendedor» de los listados va a estar vacía para el
histórico. Para documentos nuevos se completa con quien lo crea. Evaluar si vale
la pena reconstruir algo del histórico a partir de otra fuente.

### Direcciones de cliente

`customer_addresses` está vacía: el legacy no guardaba direcciones
estructuradas y no se deduce una a partir de un texto libre o de un dominio.
Desde la entrega 3 se cargan a mano desde la ficha, con cuatro tipos
—entrega, facturación, ambas y otra—. El selector de dirección de envío de
Ventas no tiene de dónde elegir hasta que alguien las cargue.

### Rubros y catálogos — auditado en la entrega 4

`RUBROS_SEED` son cuatro nombres, cada uno con marcas y una plantilla de mail.
La versión editable (`buscatools_rubros_config`) y los PDFs por marca
(`buscatools_catalogo_links`) viven en `localStorage` y **no existen en el
perfil real**: lo que hay es el seed, que es código.

Y sirven para **componer un mail** con catálogos adjuntos (`app.js:37354`), no
para segmentar clientes. **No hay relación cliente ↔ catálogo**: es cliente →
rubro → marcas → PDFs de marca, los mismos para todos.

Así que el rubro quedó como `customers.industry`, texto nullable, y de los
rubros se migró lo único que la ficha legacy hace con ellos: ofrecer los cuatro
nombres al cargarlo. **No se creó `industries`.** La configuración de rubros se
define cuando exista el envío de mails, no antes.

### Memoria de precios del cliente — resuelto en la entrega 4

`bterp_price_memory` era un caché en `localStorage` por nombre de cliente y
SKU, **sin moneda**, con nueve registros: las nueve líneas de COTI02530 (Grupo
Mirgor). Se verificó que la cotización está migrada entera, con precio y con
moneda. **No se migró y no se creó ninguna tabla**: los precios se derivan de
`sales_quote_lines` / `sales_order_lines` con dos funciones SQL.

Salvedad: el contenido del caché no está en el backup —vive en el navegador del
perfil legacy—, así que lo verificado es que el documento que cacheaba está
completo, no un cotejo valor por valor.

### `customer_product_aliases.times_used` no se incrementa solo

La columna existe y está en 0 en las 14 equivalencias migradas. Se va a llenar
cuando la importación de órdenes de compra use los alias para reconocer
productos — que es la función que hoy no está migrada (ver «Importar OC con
IA»).

### La equivalencia de «gmra s a u»

De las 15 equivalencias del legacy se migraron 14. La restante pertenece a un
cliente que no existe ni en el maestro de 988 ni en el histórico de ventas. El
producto (`SP.2520/8B`) sí existe. No se inventa el cliente.

### `database.types.ts` está parcheado a mano

Las seis columnas que la Fase 5 agregó a `customers` —`emails`, `industry`,
`needs_review`, `review_reason`, `imported_at`, `legacy_source`— y la función
`resolver_revision_cliente` se agregaron **a mano** al archivo generado:
regenerarlo necesita un access token de Supabase que no está en esta máquina.

Cuando el token esté disponible:

1. regenerar con `npx supabase gen types typescript --project-id uaxcfufvapzulqvynanp`
2. comparar el diff
3. verificar que coincida con las columnas reales
4. correr la regresión completa

**No bloquea Clientes.** El archivo compila y refleja el schema real.

### Contactos y direcciones para el vendedor

`contacts_write` y `addresses_write` son de admin y employee. Un vendedor puede
crear y editar sus clientes, pero no cargarles un contacto ni una dirección,
así que hoy depende de alguien más para completar la ficha.

No se amplió: ampliar un permiso es una decisión, y el legacy no demuestra que
haga falta. **Se revisa en la entrega 5** si el flujo real lo pide.

### Clientes potenciales

`NOT_MIGRATED_BY_DESIGN`. En el legacy es un placeholder; construirlo sería un
CRM de leads, no la migración de un maestro de clientes.

---

## Funciones legacy no migradas

### Importar OC con IA

El legacy sube un PDF de orden de compra, lo manda a un worker externo con IA y
propone las líneas. **No se migra ahora**: la API key viaja del lado del cliente.
Para migrarlo hay que mover la llamada al servidor (Edge Function) con la key
como secreto. Los 134 candidatos de OC ya detectados en la migración siguen
disponibles en `customer_po_candidates`.

### Nota de entrega → Factura

`sales_invoices` y `payments` están vacías y la numeración fiscal puede venir de
STEL. Se migra cuando esté definida la integración.

### Vista previa en vivo del documento

El editor legacy muestra el documento renderizado en un `iframe` con zoom y panel
redimensionable. Es cómodo pero no es funcionalidad: se evalúa después de que la
edición funcione.

### Pestaña «Firma»

**No hay nada que migrar**: en el legacy es un placeholder que dice
«Sin firma cargada (próximamente)». Si alguna vez se necesita firma del remito,
es una función nueva, no una migración.

---

## Datos históricos pendientes de decisión

- **Los clientes nombrados sólo en contactos**: resuelto en la Fase 5. Con el
  maestro completo migrado quedaron 7 —Selplast, Herrajes Roma, Alutek,
  ECOWAY, Mafersa, CIAL DNB y MACSI—; los siete tenían nombre y dominio propio,
  así que se crearon marcados `SOLO_EN_CONTACTOS` y sus 8 contactos quedaron
  enganchados. Falta que alguien confirme quiénes son.
- **40 clientes con `needs_review`**: 31 por CUIT repetido en el legacy, 27 sin
  CUIT asignado por ese motivo, 7 sólo en contactos y 3 reclamados por más de
  una ficha del legacy. Se trabajan a mano desde `#/clientes` con el filtro de
  revisión; el CSV los exporta con su motivo.
- **Serie `RT-ML`**: existe, es concurrente con `RT` y tiene contador propio,
  pero no sabemos qué significa `ML`, qué significa el `2025` embebido (los
  cuatro documentos son de 2026) ni cuál sería el próximo número. El schema la
  soporta y el histórico la conserva; la web **no la emite**.
- **Los 9 `PDV11xxx`**: conservan su número literal con la sospecha registrada
  aparte. Nadie los corrigió y nadie debería hacerlo automáticamente.
- **Los 21 pedidos sin entrega enlazada pero con remito huérfano del mismo
  cliente**: si alguna vez se revisan a mano, 28 remitos podrían encontrar su
  pedido.
- **Los 14 enlaces `AMBIGUOUS` / `UNRESOLVED`** de `delivery_lines`: sólo se
  resuelven con criterio humano. No aplicar fuzzy matching sin revisión
  explícita.

---

## UI

- **Capítulos**: `line_type = 'chapter'` está soportado, pero ninguna línea
  histórica lo usa, así que no hay con qué probarlo contra datos reales.
- **Listados mobile**: el legacy sólo tiene tarjetas en notas de entrega; los
  otros dos son tablas anchas. La versión React usa tarjetas en los tres.
- **Un tablero de Ventas** (`#/ventas` con su propia pantalla) sería una idea
  nueva. Hoy redirige a cotizaciones.

---

## Abierto al cerrar Ventas (entrega 6)

### Adjuntos: los roles externos no ven ninguno

La policy `attachments_select` es **sólo para roles internos**, tal como quedó
en Stage 1. Un cliente o un distribuidor no ve ningún adjunto, ni siquiera de
sus propios documentos.

Eso cumple de sobra con «sólo los adjuntos de documentos que pueden leer»,
pero si en algún momento se quiere que el cliente descargue su propia OC o su
remito firmado, hay que **ampliar la policy**, y ampliar acceso es una
decisión, no un detalle de implementación. No se hizo por las dudas.

### `entity_type` no se llama igual en las dos tablas

`attachments` usa `quote` / `order` / `delivery` y `sales_audit` usa
`sales_quote` / `sales_order` / `delivery`. Viene del schema de Stage 1. Cada
tabla se respeta como está: unificarlo obliga a migrar datos y no arregla
nada que hoy moleste.

### Impresión: no genera PDF por su cuenta

Se imprime con el diálogo del navegador, y desde ahí se elige «Guardar como
PDF». El legacy usaba `html2pdf` para generar el archivo y adjuntarlo a un
mail. Cuando exista el envío de mail desde la web, hay que decidir si el PDF
se genera en el cliente o en el servidor.

### Puerta de mantenimiento en el borrado

`service_role` puede borrar un documento **no histórico** aunque esté enviado
o cancelado. Es la misma clave que corre las migraciones, nunca sale del
servidor y la aplicación no la usa; existe para que los scripts de prueba
puedan limpiar lo que crean. Los 636 históricos están protegidos para todos,
incluida esa puerta, y ningún documento con derivados se borra nunca.

### Selección múltiple: sólo exportar

De las siete acciones de lote del legacy se migró **exportar**. Eliminar y
duplicar en lote son operaciones masivas peligrosas sobre documentos
comerciales y no se agregaron «por comodidad»; imprimir en lote necesita
resolver antes cómo se concatenan varias hojas.

---

## Compras (Fase 6)

### Pagos a proveedor

`supplier_payments`, asignaciones y tesorería quedan **fuera de la primera
pasada**. El legacy no tiene un módulo real de pagos: sólo un `estado: 'pagada'`
en la factura, y en el perfil real **no hay ninguna factura de proveedor**, así
que tampoco hay estado histórico que preservar.

### Compras ↔ Ventas: `procurement_allocations`

Prioritaria, pero **segunda pasada**. Tiene que ser **N:N a nivel de línea**
—`purchase_order_line_id`, `sales_order_line_id`, `quantity_allocated`— porque
una compra puede abastecer varios pedidos de venta y un pedido de venta puede
necesitar varias compras.

El legacy **no guarda esa relación** y no se reconstruye por intuición: nada de
unir por fecha parecida, mismo SKU, mismo cliente ni cantidades parecidas. Y
ahora sabemos que además no habría con qué: hay un solo pedido de compra, de
prueba.

El schema de Compras se diseña para no impedirlo: **no** lleva una FK
simplista `purchase_orders.sales_order_id`.

### Tolerancia de recepción

La primera versión **bloquea** recibir más de lo pendiente. Queda para evaluar
una política de tolerancia:

- por porcentaje o por cantidad
- por proveedor o por producto
- con autorización de admin

**No implementarla ahora.**

### Cancelar una recepción confirmada

No se puede en la primera versión: habría que revertir el movimiento de stock y
eso es una decisión propia (¿movimiento inverso?, ¿anulación?, ¿quién puede?).

### Recibos de proveedor, tickets y libro de facturas recibidas

`NOT_MIGRATED_BY_DESIGN` · `LEGACY_PLACEHOLDER`. En el legacy las tres
subsecciones muestran «🚧 Próximamente».

### Importador de PDF de Compras

No se construye: el legacy no tiene uno. El que existe lee la **OC del
cliente** y pertenece a Ventas (ver «Importar OC con IA»).

### Los 22 emails dentro de las notas de proveedores

18 de los 142 proveedores tienen al menos un email escrito dentro de `notas`,
y 43 notas parecen fichas de contacto completas. **No se extraen
automáticamente**: una regex puede encontrar algo que no sea el email principal.
Si alguna vez se quieren como contactos, con revisión humana.

### El pedido de compra `PC00001`

Único documento de Compras del legacy: sin proveedor, una línea a precio 0,
nunca recibido ni facturado. Clasificado `TEST` / `NON_PRODUCTION`, **no se
migra**. Queda en el backup del 2026-09-10 (`sha256 81a02598…`).

### Protección de contraseñas filtradas (Auth)

El advisor de Supabase marca `auth_leaked_password_protection` como deshabilitado.
Es una opción de configuración de Auth, no de la base. Nada de lo migrado depende
de ella. Habilitarla cuando se revise la configuración de Auth completa.

### Índices de cobertura sobre FKs poco usadas

El advisor de performance marca 125 FKs sin índice de cobertura en toda la base,
39 de ellas en las tablas de Compras. Casi todas son `created_by`, `updated_by`
y `currency_code`, que nunca se usan como filtro. Se agregó sólo el que sí está
en un camino de consulta real (`idx_sil_order_line`). Revisar el resto cuando haya
volumen y plan de ejecución reales, no antes.

### Los 19 proveedores con un email escrito dentro de las notas

22 apariciones, 21 direcciones distintas, en 19 de los 142 proveedores. **No se
extrajeron automáticamente**: una regex puede encontrar algo que no sea el
email principal. Quedaron marcados con `needs_review = true` y
`review_reason = 'LEGACY_EMAIL_EN_NOTAS'`, y se filtran desde el listado de
proveedores con «Sólo los marcados para revisión». Revisión humana: mirar la
nota y, si corresponde, cargar el email en su campo y dar por revisado.

(La entrega 0 decía 18 proveedores y 22 direcciones. Son 19 proveedores, 22
apariciones y 21 direcciones distintas.)

### `suppliers.country_code`

Se sembró una vez en la migración desde el último segmento de la dirección
legacy —142 de 142 exactos, con una regla estricta de dos letras mayúsculas— y
desde entonces es un campo editable más: **no se vuelve a derivar de
`address_text`**. Si algún día se quiere estructurar el resto de la dirección
(calle, localidad, provincia, CP), eso NO se puede parsear del legacy sin
adivinar: hay que cargarlo a mano o pedirlo al proveedor.

### `database.types.ts`

Las ocho tablas de Compras ya no están escritas a mano: las genera
`scripts/fase6-generar-tipos-compras.mjs` desde el esquema OpenAPI de
PostgREST. Lo que sigue a mano son las seis columnas que la Fase 5 agregó a
`customers` y sus funciones, verificadas con `scripts/fase5-verificar-tipos.mjs`.
Regenerar el archivo entero con `npx supabase gen types` sigue necesitando un
access token que no está en esta máquina.

### El employee de prueba

`scripts/fase6-proveedores-tests.mjs` crea un usuario `employee` temporal y lo
borra al terminar, porque no hay credenciales del employee real. Si alguna vez
se guarda una contraseña de prueba para ese rol, el script puede dejar de crear
usuarios.
