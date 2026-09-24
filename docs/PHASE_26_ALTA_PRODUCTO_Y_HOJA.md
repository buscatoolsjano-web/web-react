# Fase 26 · Alta de producto, la hoja en todos los documentos, y la vista previa en grande

Tres pedidos. Este documento dice qué quedó hecho, qué no se puede hacer
todavía y por qué, y qué falta aplicar en la base.

> Las migraciones de la Fase 25 ya están aplicadas (23/09/2026), así que el
> Catálogo vuelve a cargar y el alta de producto se puede usar.

---

## E1 · La vista previa del PDF, lo más grande posible

**Lo que pasaba:** la hoja se escalaba para que **la página entera** entrara en
la pantalla. Se medía el ancho y el alto, y ganaba el alto: con una ventana de
900 px eso da la hoja al 55 %, o sea un A4 de 440 px en una columna de 1.000, con
dos franjas grises de 280 px a los costados. El documento quedaba ilegible para
que se viera el final.

**Lo que hace ahora:** la escala sale **sólo del ancho** y lo que no entra a lo
alto se desplaza. El marco quedó con 1 px de padding, así que no hay gris al
costado. En una pantalla ancha la hoja se puede agrandar por encima de su tamaño
real hasta el 160 % —el texto es HTML y escala nítido— y ahí se corta, porque un
A4 de 1.270 px ya no se lee mejor por ser más grande.

Es la decisión contraria a la de la Fase 22 · A2, que buscaba que se viera el
final del documento. La cambió el pedido, textual: «no pasa nada si no veo el
largo total de la hoja, pero necesito poder verlo bien en grande».

Detalle chico que evita un parpadeo: la canaleta del scroll se reserva siempre
(`scrollbar-gutter: stable`). Si apareciera recién cuando la hoja no entra, el
ancho del marco cambiaría, la escala se recalcularía y la hoja cambiaría de
tamaño en cada medición.

## E2 · La hoja del documento, en todas las pantallas de Ventas

**Lo que pasaba:** el alta de cotización tenía el editor a la izquierda y la hoja
a la derecha. Ninguna otra pantalla la tenía. Abrir una cotización, un pedido o
un remito ya guardados mostraba pestañas y tablas, y para ver cómo salía el
documento había que abrir el modal de impresión —donde no se puede editar—.

**Lo que hace ahora:** las cinco pantallas muestran la hoja al lado del editor.

| Pantalla | Antes | Ahora |
|---|---|---|
| Nueva cotización | hoja editable | igual, con la escala nueva |
| **Nuevo pedido** | sin hoja | hoja editable |
| **Cotización guardada** | sin hoja | hoja, editable si el documento se puede editar |
| **Pedido guardado** | sin hoja | hoja, editable si el documento se puede editar |
| **Remito guardado** | sin hoja | hoja de sólo lectura (ver abajo) |

Con 1280 px o más aparece sola; abajo de eso hay un botón. En los detalles el
botón es «Ver documento» / «Ocultar documento», en las altas «Vista previa»,
que es el que ya existía.

Cuando la hoja es editable, **edita el mismo borrador** que el panel de la
izquierda: no hay dos documentos que sincronizar. Se puede cambiar cantidad,
precio y descuento, quitar una línea, y «+ Agregar producto» abre el buscador
del panel izquierdo y lo trae a la vista.

**Una sola implementación.** Antes de tocar nada se extrajo `PanelHoja`, que
tiene los controles (formato, precios con impuestos), los datos de la empresa y
la escala. `VistaPreviaBorrador` (el borrador) y `VistaPreviaDocumento` (el
documento guardado) son dos envoltorios de diez líneas encima. Tener dos
implementaciones era la forma segura de que la previa del alta y la del detalle
se vieran distintas.

**El remito es distinto, y no por comodidad.** Su hoja no se edita: lo único
editable de un remito es la cantidad entregada, y tiene tope contra lo pendiente
del pedido. Ese tope y la columna «pendiente después» viven en la tabla de la
izquierda; dejar escribir cantidades en la hoja sería saltear la única pantalla
que muestra contra qué se compara. Además, el borrador del remito no lleva
precio —el editor lo aclara: «el precio viene del pedido y no se edita acá»—, así
que la hoja recupera el precio de la línea guardada que corresponde a la misma
línea de pedido. Una línea recién agregada todavía no tiene guardada y va sin
importe: la hoja muestra un guión, que es la verdad.

## E3 · Crear productos

**El botón «Nuevo producto»** está en el encabezado del Catálogo, para quien
puede escribir. Abre un formulario con las mismas secciones que el del sistema
anterior (`app.js:14085`), en el mismo orden.

### Cómo se guarda, y en qué se diferencia del legacy

El legacy llamaba a `erp_create_product`, una función **`security definer` que
se saltea RLS**, con el token público de la página. Por eso cualquiera que
abriera la web podía crear productos (ver
[PHASE_24_0_SEGURIDAD_LEGACY.md](PHASE_24_0_SEGURIDAD_LEGACY.md)).

Acá es un `insert` con el JWT de la persona, y quién puede escribir lo decide la
policy que ya existía: `products_write`, o sea **admin y employee** de la
empresa (`app.current_writer_company_ids()`). **No se agregó ninguna función
`security definer`**: el alta funciona con los permisos que la base ya tenía.
La única policy que se tocó fue la de lectura de productos borrados, y no por el
alta sino por lo que apareció probándola (ver más abajo).

La pantalla sólo evita ofrecer una acción que va a fallar. Si alguien manda otra
empresa, el `with check` de la policy rechaza la fila.

### Los campos, y las tres diferencias con el legacy

Se guardan: referencia, nombre, modelo, descripción, descripción larga, estado,
marca, categoría, subtipo, serie, «es un kit», los atributos técnicos de la
categoría elegida, código de barras, origen, NCM, peso, volumen y la imagen
principal por URL.

| Diferencia | Por qué |
|---|---|
| **La categoría es obligatoria** | `products.category_id` es NOT NULL. Pedirla en el formulario es mejor que recibir el error de la base. |
| **El estado tiene tres opciones, no cuatro** | `products_status_check` acepta `active`, `draft` y `discontinued`. El «inactivo» del legacy no existe como estado. |
| **El peso se pide en gramos** | `weight_g` es la columna. El legacy pide kilos, así que hay un conversor al lado en vez de convertir en silencio. |

Dos cosas se replicaron tal cual, porque son del legacy y no invenciones:

* **La referencia sugerida** (`app.js:13653`): las dos primeras **letras** de la
  marca, un punto y el modelo en mayúsculas. Sin modelo, la hora en base 36.
  Sin marca, el prefijo es `PRO`.
* **El código de barras va adentro de `attributes`** (`app.js:14486`), porque
  tampoco hay columna.

Los atributos que se ofrecen son los de la categoría elegida, y a diferencia del
filtro del catálogo se ofrecen **todos** y no sólo los filtrables: al cargar un
producto se quiere poder escribir cualquier dato que la categoría tenga
definido.

### Lo que el formulario del legacy pide y todavía NO se puede guardar

Está **a la vista dentro del propio formulario**, con el motivo. No está
escondido a propósito: si la pantalla pidiera un precio que `product_prices` no
acepta escribir, el dato se perdería en silencio.

| Campo | Por qué no |
|---|---|
| **Precio de venta y tarifa** | `product_prices` no tiene policy de escritura. Y no es un olvido: `AUTORIDAD.listas` dice que no está decidido si el maestro de precios es STEL o el ERP. |
| **Precio de costo** | no hay tabla de costos en la base. |
| **Stock inicial, mínimo y máximo** | `stock_balances` es de sólo lectura: el saldo lo mueve un movimiento de stock, nunca una carga a mano. |
| **Subir un archivo de imagen** | falta el bucket de Storage para fotos de producto. La imagen **por URL sí se guarda**. |
| **Componentes del kit** | no hay tabla de componentes. El legacy tampoco los guardaba en la base: los dejaba en el navegador (`localStorage`), así que no hay nada que migrar. |

Para las tres primeras hay SQL escrito y **no aplicado** en
[`scripts/fase26-e3-alta-producto-PREPARADO.sql`](../scripts/fase26-e3-alta-producto-PREPARADO.sql):
una función `catalogo_precio_inicial` que pone el precio inicial y sólo el
inicial, la propuesta para el stock (que pasa por un movimiento
`opening_balance`, no por escribir el saldo) y el bucket con sus policies,
comentado.

### Dos escrituras, sin transacción

Primero el producto, después la imagen. PostgREST no ofrece transacción, así que
el orden está elegido: si la imagen falla, el producto queda creado y se avisa,
en vez de perder toda la carga por una URL.

Al crear, se abre el producto: es la forma de ver que quedó como se quería sin
ir a buscarlo. Y se invalida `['catalogo']` entero, no sólo el listado: las
facetas cuentan productos por marca y por categoría, y dejarlas viejas haría que
el filtro diga 38 y el listado muestre 39.

---

## Hallazgo al probarlo: un producto dado de baja seguía viéndose

Probando el alta se creó un producto de prueba, se le puso `deleted_at` y
**siguió apareciendo en el catálogo**. No es del alta ni del catálogo: son las
policies de `products`, que son de la Fase 3.

```
products_select  FOR SELECT  using (… AND deleted_at is null AND (interno OR status='active'))
products_write   FOR ALL     using (empresa donde el usuario escribe)   ← sin deleted_at
```

`FOR ALL` **incluye SELECT**, y dos policies permisivas se combinan con OR: a un
admin o employee le alcanza con pasar la segunda, que no mira `deleted_at` ni
`status`. Un rol interno ve todos los productos de su empresa, incluidos los
dados de baja.

Nunca se había notado porque **no había ningún producto dado de baja**: en el
momento de encontrarlo había exactamente uno, y era el de prueba. El comentario
dentro de `search_products` —«deleted_at y status los decide RLS»— es cierto
para un rol externo y falso para uno interno.

**El arreglo está aplicado** (24/09/2026,
[`scripts/fase26-rls-productos-borrados.sql`](../scripts/fase26-rls-productos-borrados.sql)):
se le agregó `deleted_at is null` al `using` de `products_write`. El
`with check` no lleva la condición —es el del INSERT, y un producto nuevo nunca
nace borrado—.

Tiene una consecuencia que hay que querer: **deja de poder actualizarse una fila
dada de baja**, así que restaurar un producto necesita `service_role`. Para el
modelo de hoy es correcto: lo único que la app escribe en `products` es el
insert del alta, no hay ningún update ni delete. El día que exista «archivar /
restaurar», hay que partir la policy por comando.

Verificado consultando con la sesión de un admin desde la propia app, no con
`service_role`: el producto vivo se ve, el mismo con `deleted_at` devuelve
`[]`, un producto normal se sigue viendo y el total visible queda en 21.828.

**El producto de prueba se eliminó**, no quedó dado de baja: no tenía imágenes ni
precios, y dejarlo visible en el catálogo era peor que sacarlo. `products` quedó
en 21.828 filas, ninguna dada de baja, y el catálogo en 17.996.

## Un test que decía lo contrario

`CatalogoPage.test.tsx` tenía un caso llamado «0 productos en la empresa: vacío
sin CTA de crear (React no tiene ABM de productos)», que afirmaba que no existía
el alta. Dejó de ser verdad. Se reescribió para fijar lo que sigue valiendo: que
el vacío no ofrezca «Limpiar filtros» cuando no hay filtros que limpiar.

## Lo que NO se hizo

* **Editar un producto existente.** El legacy usa el mismo formulario para
  crear y para editar (`_npEditSku`). Acá el alta crea; la edición es otra
  pantalla y otra discusión —qué se puede cambiar de un producto que ya está en
  documentos emitidos—.
* **Crear la marca o la categoría desde el formulario.** El legacy lo ofrece.
  Acá se eligen de las que existen y se crean en Configuración, que es donde
  están los RPC con permiso de admin y bitácora.
* **Ordenar por precio.** Sigue afuera por lo mismo que en la Fase 25: el precio
  depende de qué lista se esté mirando, y la RPC no la recibe.
