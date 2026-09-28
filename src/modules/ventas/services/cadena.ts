import { supabase } from '@/services/supabase/client'
import type { TipoDocumento } from '../types'
import { PASOS_CADENA, type CadenaDocumento, type EslabonCadena, type PasoCadena } from '../lib/cadena'

// Se re-exportan para que quien ya los tomaba de acá siga andando.
export { PASOS_CADENA }
export type { CadenaDocumento, EslabonCadena, PasoCadena }

/**
 * La cadena de un documento (Fase 29 · E6).
 *
 * Una sola llamada, no cuatro: desde Argentina cada viaje a la base cuesta
 * ~220 ms, así que encadenar consultas para dibujar una barra costaría casi
 * un segundo. La RPC resuelve hacia arriba y hacia abajo de una.
 */
export async function cadenaDeDocumento(
  tipo: TipoDocumento,
  documentoId: string,
): Promise<CadenaDocumento> {
  const { data, error } = await supabase.rpc('cadena_de_documento', {
    p_tipo: tipo,
    p_id: documentoId,
  })
  if (error) throw new Error(`No se pudo leer la cadena del documento: ${error.message}`)

  const c = (data ?? {}) as Record<string, unknown>
  const leer = (k: PasoCadena): EslabonCadena | null => {
    const v = c[k] as Record<string, unknown> | null | undefined
    if (!v || typeof v.id !== 'string') return null
    return {
      id: v.id,
      numero: typeof v.numero === 'string' ? v.numero : '',
      estado: typeof v.estado === 'string' ? v.estado : '',
      cuantos: typeof v.cuantos === 'number' ? v.cuantos : 1,
    }
  }

  return {
    cotizacion: leer('cotizacion'),
    pedido: leer('pedido'),
    entrega: leer('entrega'),
    factura: leer('factura'),
  }
}
