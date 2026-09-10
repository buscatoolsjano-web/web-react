import type { DocumentoDeCliente } from '../types'

/**
 * La etiqueta del estado de un documento en el historial del cliente.
 *
 * Es la MISMA traducción que usa Ventas. Está repetida a propósito: la ficha
 * del cliente sólo necesita el texto —no el color, ni el filtro, ni los
 * estados de cumplimiento— y importarla desde Ventas ataría dos secciones que
 * no tienen por qué moverse juntas. Si alguna vez se agrega un estado, hay
 * que tocar los dos lados; por eso un estado desconocido se muestra crudo en
 * vez de desaparecer.
 */
const ETIQUETAS: Record<DocumentoDeCliente['tipo'], Record<string, string>> = {
  cotizacion: {
    draft: 'Borrador',
    sent: 'Pendiente',
    accepted: 'Cerrada',
    rejected: 'Rechazada',
    expired: 'Vencida',
  },
  pedido: {
    draft: 'Borrador',
    confirmed: 'Confirmado',
    cancelled: 'Cancelado',
  },
  entrega: {
    draft: 'Borrador',
    shipped: 'Despachada',
    delivered: 'Entregada',
    cancelled: 'Cancelada',
  },
}

export function etiquetaDeEstado(tipo: DocumentoDeCliente['tipo'], estado: string): string {
  if (!estado) return '—'
  return ETIQUETAS[tipo][estado] ?? estado
}
