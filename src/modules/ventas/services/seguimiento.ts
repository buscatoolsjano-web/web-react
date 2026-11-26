import { supabase } from '@/services/supabase/client'
import type { MotivoPerdida } from '../lib/seguimiento'
import { registrarEvento } from './auditoria'

export interface SeguimientoCotizacion {
  estado: string
  motivoPerdida: string | null
  notaPerdida: string | null
  perdidaEn: string | null
  proximoContacto: string | null
  notaContacto: string | null
}

/** Lo del seguimiento de una cotización, aparte del detalle: es otra cosa. */
export async function leerSeguimiento(quoteId: string): Promise<SeguimientoCotizacion> {
  const { data, error } = await supabase
    .from('sales_quotes')
    .select('status, lost_reason, lost_note, lost_at, next_follow_up, follow_up_note')
    .eq('id', quoteId)
    .single()
  if (error) throw new Error(`No se pudo leer el seguimiento: ${error.message}`)
  return {
    estado: data.status,
    motivoPerdida: data.lost_reason,
    notaPerdida: data.lost_note,
    perdidaEn: data.lost_at,
    proximoContacto: data.next_follow_up,
    notaContacto: data.follow_up_note,
  }
}

/** Cuándo volver a llamar. `null` lo borra. */
export async function guardarProximoContacto(quoteId: string, fecha: string | null, nota: string | null): Promise<void> {
  const { error } = await supabase
    .from('sales_quotes')
    .update({ next_follow_up: fecha, follow_up_note: nota && nota.trim() !== '' ? nota.trim() : null })
    .eq('id', quoteId)
  if (error) throw new Error(`No se pudo guardar el próximo contacto: ${error.message}`)
}

/**
 * Marcar perdida, con el motivo. La base no deja perder una cotización que ya
 * es un pedido (`bloquear_cotizacion_cerrada`): si el cliente se echó atrás,
 * lo que se cancela es el pedido.
 */
export async function marcarPerdida(quoteId: string, motivo: MotivoPerdida, nota: string | null): Promise<void> {
  const { error } = await supabase
    .from('sales_quotes')
    .update({
      status: 'rejected',
      lost_reason: motivo,
      lost_note: nota && nota.trim() !== '' ? nota.trim() : null,
      lost_at: new Date().toISOString(),
      // Perdida no se persigue más.
      next_follow_up: null,
    })
    .eq('id', quoteId)
  if (error) throw new Error(`No se pudo marcar perdida: ${error.message}`)
  await registrarEvento('sales_quote', quoteId, 'rejected', 'sent', 'rejected', null)
}

/** Reabrir una perdida marcada por error: vuelve a pendiente, sin motivo. */
export async function reabrirCotizacion(quoteId: string): Promise<void> {
  const { error } = await supabase
    .from('sales_quotes')
    .update({ status: 'sent', lost_reason: null, lost_note: null, lost_at: null })
    .eq('id', quoteId)
  if (error) throw new Error(`No se pudo reabrir: ${error.message}`)
  await registrarEvento('sales_quote', quoteId, 'sent', 'rejected', 'sent', null)
}
