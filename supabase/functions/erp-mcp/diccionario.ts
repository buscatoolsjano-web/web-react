/**
 * El diccionario de datos del ERP, para los asistentes de IA. PURO.
 *
 * Las herramientas devuelven JSON con los códigos de la base: `draft`,
 * `partially_delivered`, `issued`. Un modelo los adivina casi siempre, y el
 * «casi» es el problema: «pending» en un pedido de venta es «sin entregar»,
 * pero en una orden de mantenimiento es «presupuesto sin aprobar». Esto lo
 * dice una vez, en un lugar, con las palabras que usa la gente en la empresa.
 *
 * Se sirve como recurso MCP (`resources/list` + `resources/read`). A
 * diferencia de la skill, que ChatGPT importa como foto y hay que volver a
 * escanear, un recurso se lee en vivo: cambiar este archivo y desplegar
 * alcanza.
 *
 * Los estados salen de los CHECK de la base y de las etiquetas de la web
 * (`src/modules/{ventas,compras}/lib/estados.ts`). Si se agrega un estado,
 * va acá también.
 */

export const DICCIONARIO_URI = 'erp://buscatools/diccionario.md'
export const DICCIONARIO_NOMBRE = 'Diccionario de datos del ERP'
export const DICCIONARIO_DESCRIPCION =
  'Qué significa cada documento, campo y código de estado que devuelven las herramientas, ' +
  'y cómo se relacionan (cotización → pedido → remito → factura; pedido de compra → recepción → factura de proveedor).'

export const DICCIONARIO_MD = `# Diccionario de datos del ERP de BuscaTools

Las herramientas devuelven JSON con los nombres y códigos de la base. Esta guía
dice qué significa cada uno. Al contestarle a una persona, usá las palabras de
la columna «Se dice», nunca el código.

## Empresas

El ERP tiene varias empresas (Buscatools, Torquetools, Torquear, …) que **no
se mezclan nunca**: cada dato pertenece a una sola. Todo lo que devuelve una
herramienta es de la empresa activa de la persona conectada. No compares ni
sumes datos de dos empresas como si fueran una.

## Circuito de venta

1. **Cotización** (presupuesto que se le manda al cliente).
2. **Pedido de venta** (el cliente aceptó; se reserva y se entrega).
3. **Remito / nota de entrega** (la mercadería que sale; mueve stock).
4. **Factura de venta**.

Cada documento puede venir del anterior. Un documento «histórico» viene de
STEL Order (el sistema anterior) y se consulta, pero no se modifica desde acá.

### Estados de una cotización (\`sales_quotes.status\`)

| Código | Se dice | Qué significa |
|---|---|---|
| draft | Borrador | Todavía no se le mandó al cliente |
| sent | Pendiente | Enviada, esperando respuesta |
| accepted | Cerrada | El cliente aceptó (normalmente ya tiene pedido) |
| rejected | Rechazada | El cliente dijo que no |
| expired | Vencida | Pasó la validez sin respuesta |

### Estados de un pedido de venta

Dos estados a la vez: el del documento y el de cumplimiento.

| Código (documento) | Se dice |
|---|---|
| draft | Borrador |
| confirmed | Confirmado |
| cancelled | Cancelado |

| Código (cumplimiento) | Se dice | Qué significa |
|---|---|---|
| pending | Sin entregar | No salió nada |
| partially_reserved | Reserva parcial | Parte del stock ya está apartado |
| reserved | Reservado | Todo apartado, falta despachar |
| partially_delivered | Entrega parcial | Salió una parte |
| delivered | Entregado | Salió todo |

**Pendiente de entregar** = lo pedido menos lo entregado, en pedidos de venta
desde que se generan (también en borrador).

### Estados de un remito (\`deliveries.status\`)

| Código | Se dice |
|---|---|
| draft | Borrador (no movió stock) |
| shipped | Despachado (el stock ya salió) |
| delivered | Entregado al cliente |
| cancelled | Cancelado / anulado (el stock volvió) |

### Estados de una factura de venta (\`sales_invoices.status\`)

| Código | Se dice |
|---|---|
| draft | Borrador |
| issued | Emitida |
| paid | Cobrada |
| cancelled | Anulada |

## Circuito de compra

1. **Pedido de compra** (orden al proveedor). No mueve stock.
2. **Recepción / nota de entrada de proveedor** (la mercadería que llega; al
   confirmarla suma stock).
3. **Factura de proveedor** (se factura lo recibido, no lo pedido).

### Estados de un pedido de compra (\`purchase_orders.status\`)

| Código | Se dice |
|---|---|
| draft | Borrador |
| confirmed | Confirmado (enviado al proveedor) |
| cancelled | Cancelado |

| Código (recepción, \`receipt_status\`) | Se dice |
|---|---|
| pending | Sin recibir |
| partially_received | Recibido en parte |
| received | Recibido |

**Pendiente de recibir** = lo pedido al proveedor menos lo recibido, desde que
el pedido de compra se genera.

### Recepción (\`goods_receipts.status\`)

| Código | Se dice |
|---|---|
| draft | Borrador (no movió stock) |
| confirmed | Confirmada (sumó stock) |

### Factura de proveedor (\`supplier_invoices.status\`)

| Código | Se dice |
|---|---|
| draft | Borrador |
| registered | Registrada |
| cancelled | Anulada |

## Mantenimiento (\`maintenance_orders\`)

| Campo | Código | Se dice |
|---|---|---|
| status | open / closed / cancelled | Abierta / Cerrada / Cancelada |
| quote_status | pending / approved / rejected | Presupuesto sin aprobar / Aprobado / Rechazado |

## Productos, precios y stock

- **SKU**: el código del producto. Citalo exacto, sin cambiar mayúsculas ni guiones.
- **Costo**: lo que se paga al proveedor. **Precio / PVP**: lo que se le cobra
  al cliente; sale de la lista de precios. No confundas uno con otro, y no le
  muestres el costo a un cliente.
- **Stock físico** (\`on_hand\`): lo que hay en el depósito. **Reservado**
  (\`reserved\`): apartado para pedidos de venta. **Disponible**: físico menos
  reservado; es el que importa para prometer una entrega. Hay stock por
  depósito (\`warehouse\`).
- Un producto puede estar en el catálogo y no tener stock: eso no es «no existe».

## Importes y monedas

- Cada importe viene con su moneda (\`currency_code\`: USD, ARS, EUR).
  **Nunca sumes monedas distintas.** Si hay que comparar, decí cada total con
  su moneda.
- La moneda en la que se opera es USD salvo que el documento diga otra.
- Formato al contestar: argentino, con punto de miles y coma decimal
  (USD 10.811,48).
- \`subtotal\` es sin impuestos; \`total\` incluye impuestos (IVA). Si preguntan
  «cuánto vendimos», aclará si es con o sin IVA.

## Fechas y números

- Las fechas vienen en ISO (2026-11-13). Al contestar, en formato día/mes/año.
- Cada documento tiene un número legible y un \`id\` interno (UUID). A la
  persona se le dice el número; el \`id\` es para pasarlo a otra herramienta.
- Los prefijos de número más comunes: cotización COT / COV; pedido de venta
  PDV; remito RT, PL (packing list) o NRV; factura de venta FAC (ABO es un
  abono, una nota de crédito); pedido de compra PA o PC; recepción de
  proveedor ABP. Cada empresa tiene sus series.

## Vacío no es cero

- Una búsqueda vacía suele ser una búsqueda con demasiadas palabras: probá con
  menos antes de decir que no existe.
- Un período sin datos no es lo mismo que un total de cero: decí que no hay datos.
`
