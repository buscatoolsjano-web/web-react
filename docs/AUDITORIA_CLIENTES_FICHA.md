# Auditoría de la ficha de cliente — antes de tocarla (F19 · E3)

Fecha: 2026-09-20. Proyecto: `uaxcfufvapzulqvynanp`. Sólo lecturas; ninguna fila se modificó.

> El orden es el de siempre: **primero medir con los datos reales, después decidir**. Lo que
> sigue es lo que encontré, incluido lo que me hizo *no* hacer cambios que parecían obvios.

---

## 1 · Qué tienen realmente los 1.010 clientes

| Dato | Clientes que lo tienen |
|---|---|
| Emails | **877** |
| Documentos (cotización, pedido o entrega) | **58** |
| Contactos cargados | 30 |
| Órdenes de compra detectadas | 19 |
| Alias de producto («cómo los llama») | 3 |
| Teléfono · tarifa · condición de pago · moneda | 3 cada uno |
| Vendedor asignado · rubro | 1 cada uno |
| **Direcciones** | **0** |
| **Notas · descuento · límite de crédito** | **0** |
| **Adjuntos** (tabla `attachments`, cualquier entidad) | **0 filas** |
| **Trazabilidad** (`sales_audit` de clientes) | **0 filas** |

La ficha tiene **nueve pestañas**. Tres están vacías para *todos* los clientes y otras cuatro
para más del 94 %.

## 2 · Lo que NO hice, y por qué

**No saqué ninguna pestaña.** Que estén vacías no las vuelve inútiles: Contactos, Direcciones
y Adjuntos son las pantallas donde esos datos **se cargan**, y Trazabilidad se va a llenar el
día que alguien edite una ficha. Una pestaña vacía hoy no es una pestaña de más; es trabajo
pendiente. Sacarlas sería confundir «no hay datos» con «no hace falta».

**No puse un contador en cada pestaña.** La idea era buena —hoy un contador aparece en
Contactos, Direcciones e Historial y en las otras seis no, así que «sin número» tanto puede
significar «no hay nada» como «no se contó»— pero el arreglo sale mal:

- El panel de Productos cuenta **producto × moneda, sólo con `product_id`**; el 360 cuenta
  claves distintas incluyendo líneas sin producto. En Grupo Mirgor los dos dan 397 **por
  casualidad**; sobre los 58 clientes con documentos ya hay **1 que difiere**. Un número en la
  pestaña que no coincide con lo que la pestaña muestra es peor que no tener número.
- Contarlos bien exigiría repetir cada definición en un segundo lugar, que es exactamente el
  problema que resolvió E2 («una sola verdad por pregunta»).

Queda anotado como deuda con su causa, no como tarea pendiente disfrazada.

**No toqué `clientes_similares`** (la detección de duplicados del alta), aunque venía anotada
como deuda por comparar nombres **con tildes**. La medí:

- De los 1.010 clientes, el peor caso al escribir el nombre sin tildes es *Matías García* →
  *Matias Garcia*, con similitud **0,400**, justo por encima del umbral de 0,4. **Ninguno de
  los 1.010 se pierde hoy** por las tildes.
- Y al revés: los pares que una comparación sin tildes *agregaría* son todos falsos positivos
  —«Ferretería 482» contra «FERRETERIA VAZQUEZ», «Metalúrgica Roma» contra «Metalurgica Santa
  Ana»—. Normalizar acá **sumaría ruido, no duplicados**.

La deuda estaba mal enunciada y queda cerrada: medida, no es un defecto.

**Corrijo otra deuda mal escrita.** Había anotado que `rubrosUsados` «pierde rubros pasados
los 1.000 clientes». No: la consulta pide `industry is not null`, así que el tope de 1.000
aplica a los clientes **que tienen rubro**, y hoy es **uno**. El riesgo es real pero mucho más
lejano de lo que había escrito.

## 3 · El defecto que sí encontré (y arreglé)

**«Nueva cotización» y «Nuevo pedido» en la ficha completa eran dos links sin control de
autoridad ni de permiso.** En esta empresa STEL numera cotizaciones y pedidos, así que
llevaban a la pantalla de alta, donde se podía elegir cliente, cargar líneas y precios… para
encontrarse al final con «Crear cotización» **deshabilitado**.

Lo verifiqué contra producción: el botón de alta llega deshabilitado y con el motivo
«Emisión desde el ERP bloqueada: STEL numera las cotizaciones de esta empresa».

La misma acción ya estaba bien resuelta **en los otros dos lugares** donde existe:

| Dónde | ¿Permiso? | ¿Autoridad STEL? |
|---|---|---|
| Listado de Ventas (`ListadoPage`) | sí | sí, deshabilita y explica |
| Ficha rápida (`FichaRapidaCliente`) | sí | sí, deshabilita y explica |
| **Ficha completa (`ClienteDetallePage`)** | **no** | **no** |

La ficha completa era la única que había quedado afuera. Ahora usa la misma regla:
`escribeVentas(rol)` y `useAutoridadNumeracion()`, un solo motivo para los dos botones, y
mientras la autoridad no se leyó se deshabilita **sin** inventar un motivo.

Revisado además que no quedara la misma trampa en otro lado: fuera de Ventas, los únicos dos
enlaces al alta de documentos eran estos dos.

## 4 · Lo que está bloqueado y no depende de mí

La cola de revisión tiene **40 clientes**. El caso dominante son **31** con
`CUIT_REPETIDO_EN_LEGACY`: el sistema anterior usaba el mismo CUIT en más de una ficha, así
que la migración **no asignó ninguno**.

La tarjeta dice «El sistema anterior usaba este CUIT en más de una ficha de cliente» y arriba
muestra «sin CUIT». **No dice cuál CUIT ni con qué otro cliente**, y no puede: el número
quedó en el sistema anterior y en la base nueva no hay ninguna columna que lo guarde
(`legacy_ref`, `legacy_name` y `legacy_source` no lo traen).

Probé si se podía deducir el gemelo desde adentro comparando nombres: de los 31, sólo **4**
tienen un cliente parecido que además tenga CUIT. **En 27 de 31 casos no alcanza.**

Para desbloquearlo hay exactamente dos caminos, y los dos necesitan tu autorización:

1. **Guardar el CUIT del sistema anterior** en el cliente (una columna nueva, poblada desde la
   misma fuente de la migración). Es un cambio de datos en producción.
2. Resolverlos a mano contra el sistema anterior, fuera del ERP.

Hasta que decidas, la pantalla promete una comparación que no puede mostrar.
