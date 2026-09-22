import type { DocumentoListado, TipoDocumento } from '@/modules/ventas/types'

/**
 * Los últimos documentos del Dashboard (Fase 21 · E2).
 *
 * Se ordenan por la **fecha del documento**, no por `created_at`. El motivo
 * está medido: 305 de 307 cotizaciones, 171 de 173 pedidos y 193 de 194
 * remitos son migrados, y su `created_at` es la hora en que corrió la
 * importación. Un «último movimiento» hecho con eso mostraría 669 documentos
 * creados el mismo día: un feed inventado.
 *
 * Por eso tampoco se muestra la hora. La granularidad real es el día.
 */

/** Cuando dos documentos son del mismo día, desempata el tipo y después el número. */
const PESO_TIPO: Record<TipoDocumento, number> = { entrega: 0, pedido: 1, cotizacion: 2 }

/**
 * Los N más recientes de las tres listas, mezclados.
 *
 * El orden secundario es determinista a propósito: con granularidad de día hay
 * empates todo el tiempo, y una lista que cambie de orden entre dos cargas por
 * el capricho del `Array.sort` se lee como si hubiera pasado algo. Primero la
 * fecha, después el tipo, después el número y al final el id, que no repite.
 */
export function ultimosDocumentos(listas: readonly (readonly DocumentoListado[])[], limite: number): DocumentoListado[] {
  return listas
    .flat()
    .slice()
    .sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1
      if (a.tipo !== b.tipo) return PESO_TIPO[a.tipo] - PESO_TIPO[b.tipo]
      if (a.numero !== b.numero) return b.numero.localeCompare(a.numero, 'es')
      return a.id.localeCompare(b.id)
    })
    .slice(0, limite)
}

const RUTA: Record<TipoDocumento, string> = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
  entrega: '/ventas/entregas',
}

/** El detalle real del documento, el mismo al que llega el listado de Ventas. */
export const rutaDelDocumento = (d: Pick<DocumentoListado, 'tipo' | 'id'>): string => `${RUTA[d.tipo]}/${d.id}`

export const ETIQUETA_DOCUMENTO: Record<TipoDocumento, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Remito',
}
