import { supabase } from '@/services/supabase/client'
import type { ClienteSimilar } from '../types'

/**
 * «¿Este cliente ya existe?» (Fase 17 · E5).
 *
 * La consulta **propone**: devuelve candidatos con el motivo por el que se
 * parecen y decide una persona. No fusiona, no bloquea y no borra. El único
 * bloqueo duro sigue siendo el índice único del CUIT normalizado, que es un
 * hecho del negocio —dos clientes no tienen el mismo CUIT— y no una heurística.
 *
 * `clientes_similares` es `security invoker`: hereda `customers_select`, así
 * que un vendedor no puede descubrir clientes que no ve preguntando por un
 * email. Del lado del servidor se apoya en los índices que ya existían —el
 * único de CUIT, los GIN de emails y los trigram de nombre— más uno nuevo para
 * el teléfono: nunca recorre el maestro entero en el navegador.
 */

interface Fila {
  id: string
  legal_name: string
  trade_name: string | null
  tax_id: string | null
  legacy_ref: string | null
  emails: string[] | null
  phone: string | null
  deleted_at: string | null
  needs_review: boolean
  motivo: string
  fuerza: string
  parecido: number | string | null
}

export interface EntradaDeBusqueda {
  nombre?: string | null
  cuit?: string | null
  email?: string | null
  telefono?: string | null
  /** El cliente que se está editando: no es candidato a duplicado de sí mismo. */
  excluir?: string | null
}

/** ¿Hay algo que buscar? Sin esto la consulta sale por cada tecla y vuelve vacía. */
export function valeLaPenaBuscar(e: EntradaDeBusqueda): boolean {
  const cuit = (e.cuit ?? '').replace(/\D/g, '')
  const tel = (e.telefono ?? '').replace(/\D/g, '')
  return (
    cuit.length === 11 ||
    (e.email ?? '').trim().includes('@') ||
    tel.length >= 6 ||
    (e.nombre ?? '').trim().length >= 4
  )
}

export async function clientesSimilares(
  companyId: string,
  entrada: EntradaDeBusqueda,
): Promise<ClienteSimilar[]> {
  const { data, error } = await supabase.rpc('clientes_similares', {
    p_company: companyId,
    p_nombre: entrada.nombre?.trim() || null,
    p_cuit: entrada.cuit?.trim() || null,
    p_email: entrada.email?.trim() || null,
    p_telefono: entrada.telefono?.trim() || null,
    p_excluir: entrada.excluir ?? null,
    p_limite: 10,
  })
  if (error) throw new Error(`No se pudo buscar clientes parecidos: ${error.message}`)

  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id,
    razonSocial: f.legal_name,
    nombreComercial: f.trade_name,
    cuit: f.tax_id,
    referencia: f.legacy_ref,
    emails: f.emails ?? [],
    telefono: f.phone,
    dadoDeBaja: f.deleted_at !== null,
    necesitaRevision: f.needs_review,
    motivo: f.motivo as ClienteSimilar['motivo'],
    fuerza: f.fuerza as ClienteSimilar['fuerza'],
    parecido: typeof f.parecido === 'number' ? f.parecido : Number(f.parecido ?? 0),
  }))
}
