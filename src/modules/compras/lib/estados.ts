import type { EstadoPedido, EstadoRecepcion } from '../types'

/**
 * Los dos estados del pedido de compra, en castellano.
 *
 * Son dos cosas distintas y se muestran por separado a propósito:
 *
 *   · `status` es el estado **comercial**: lo decide una persona.
 *   · `receipt_status` es el estado **logístico**: lo deriva la base mirando
 *     todas las líneas contra lo recibido. La aplicación no lo escribe nunca,
 *     y si lo intenta el trigger la ignora.
 *
 * Un estado que no esté en la tabla se muestra crudo en vez de desaparecer.
 */

const ESTADOS: Record<EstadoPedido, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
}

const RECEPCIONES: Record<EstadoRecepcion, string> = {
  pending: 'Sin recibir',
  partially_received: 'Recibido en parte',
  received: 'Recibido',
}

export function etiquetaDeEstadoPedido(estado: string): string {
  return ESTADOS[estado as EstadoPedido] ?? estado
}

export function etiquetaDeRecepcion(estado: string): string {
  return RECEPCIONES[estado as EstadoRecepcion] ?? estado
}

export const OPCIONES_ESTADO = (Object.keys(ESTADOS) as EstadoPedido[]).map((v) => ({
  valor: v,
  etiqueta: ESTADOS[v],
}))

export const OPCIONES_RECEPCION = (Object.keys(RECEPCIONES) as EstadoRecepcion[]).map((v) => ({
  valor: v,
  etiqueta: RECEPCIONES[v],
}))

/**
 * Qué se puede tocar en cada estado.
 *
 * Esto NO es el control: lo que impide editar son los triggers
 * `app.proteger_estado_pedido_compra()` y
 * `app.proteger_lineas_pedido_compra()`, que corren aunque la escritura venga
 * de un script con la clave de servicio. Acá sólo se decide qué controles
 * tiene sentido dejar habilitados.
 *
 * La matriz es la misma que la del servidor:
 *
 *                    draft   confirmed   confirmed+recepción   cancelled
 *   proveedor          sí       no             no                 no
 *   moneda / TC        sí       no             no                 no
 *   fecha del pedido   sí       no             no                 no
 *   ETA / cond. pago   sí       sí             sí                 no
 *   notas              sí       sí             sí                 no
 *   líneas             sí       sí             NO                 no
 */
export interface Editabilidad {
  cabecera: boolean
  /** Proveedor, moneda, tipo de cambio y fecha del pedido. */
  identidad: boolean
  /** ETA, condición de pago y notas: se pueden ajustar después de confirmar. */
  logistica: boolean
  lineas: boolean
  confirmar: boolean
  cancelar: boolean
  duplicar: boolean
}

export function editabilidadDe(
  estado: EstadoPedido,
  conRecepcion: boolean,
): Editabilidad {
  const borrador = estado === 'draft'
  const confirmado = estado === 'confirmed'
  const cancelado = estado === 'cancelled'
  return {
    cabecera: !cancelado,
    identidad: borrador,
    logistica: !cancelado,
    lineas: !cancelado && !conRecepcion,
    confirmar: borrador,
    // Un pedido con mercadería recibida no se cancela: ya hubo impacto
    // operativo. Lo rechaza el servidor con `restrict_violation`.
    cancelar: (borrador || confirmado) && !conRecepcion,
    duplicar: true,
  }
}

// ── Facturas de proveedor ──────────────────────────────────────────────────

/**
 * Los tres estados del CHECK de `supplier_invoices.status`.
 *
 * Ojo con el nombre: el schema dice **`registered`**, no `confirmed`. Se usa
 * el que está, no se agrega uno por simetría con los otros documentos.
 */
const FACTURAS: Record<string, string> = {
  draft: 'Borrador',
  registered: 'Registrada',
  cancelled: 'Anulada',
}

export function etiquetaDeEstadoFactura(estado: string): string {
  return FACTURAS[estado] ?? estado
}

export const OPCIONES_ESTADO_FACTURA = Object.keys(FACTURAS).map((v) => ({
  valor: v,
  etiqueta: FACTURAS[v]!,
}))

/**
 * Qué se puede hacer con una factura en cada estado.
 *
 * Lo que lo impide de verdad son `app.proteger_factura_registrada()` y
 * `app.proteger_lineas_factura()`. Esto decide qué botones mostrar.
 *
 * Una factura **no mueve stock**, así que anularla no deshace nada físico:
 * libera lo facturado, porque lo pendiente cuenta sólo las registradas.
 */
export interface EditabilidadFactura {
  cabecera: boolean
  lineas: boolean
  registrar: boolean
  anular: boolean
  borrar: boolean
}

export function editabilidadDeFactura(estado: string): EditabilidadFactura {
  const borrador = estado === 'draft'
  const registrada = estado === 'registered'
  return {
    cabecera: borrador,
    lineas: borrador,
    registrar: borrador,
    anular: borrador || registrada,
    // Un borrador se descarta; una registrada o anulada es un documento con
    // historia y se anula, no se borra.
    borrar: borrador,
  }
}
