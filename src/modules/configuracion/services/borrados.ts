import { supabase } from '@/services/supabase/client'

/**
 * Lo que se borró, para poder mirarlo después (Fase 40).
 *
 * Sólo lectura. `deletion_log` no tiene policy de insert, update ni delete: el
 * registro entra por `registrar_borrado` y después nadie lo toca. Un historial
 * que se puede editar no es un historial.
 */

export interface Borrado {
  id: number
  /* El nombre crudo de la base. Se traduce al mostrarlo, y si aparece uno
   * nuevo que nadie tradujo todavía se muestra tal cual: un borrado sin
   * nombre lindo sigue siendo un borrado que hay que poder ver. */
  entidad: string
  entidadId: string
  /** El número o el nombre de lo que ya no está. */
  etiqueta: string | null
  accion: 'delete' | 'deactivate'
  motivo: string
  /** La fila entera, tal como estaba. Es lo que permite rehacerla a mano. */
  copia: Record<string, unknown>
  quien: string | null
  cuando: string
}

export interface PaginaDeBorrados {
  filas: Borrado[]
  total: number
}

export interface FiltrosBorrados {
  /** Busca en la etiqueta y en el motivo. */
  q: string
  entidad: string | null
  pagina: number
  porPagina: number
}

export const FILTROS_BORRADOS_VACIOS: FiltrosBorrados = {
  q: '',
  entidad: null,
  pagina: 1,
  porPagina: 25,
}

export async function listarBorrados(
  companyId: string,
  f: FiltrosBorrados,
): Promise<PaginaDeBorrados> {
  let q = supabase
    .from('deletion_log')
    .select('id, entity_type, entity_id, label, action, reason, snapshot, deleted_at, deleted_by, profiles:deleted_by(full_name)', {
      count: 'exact',
    })
    .eq('company_id', companyId)
    .order('deleted_at', { ascending: false })

  if (f.entidad) q = q.eq('entity_type', f.entidad)

  const texto = f.q.trim().replace(/[,()*]/g, '')
  if (texto.length >= 2) {
    const patron = `%${texto}%`
    q = q.or(`label.ilike.${patron},reason.ilike.${patron}`)
  }

  const desde = (f.pagina - 1) * f.porPagina
  const { data, error, count } = await q.range(desde, desde + f.porPagina - 1)
  if (error) throw new Error(`No se pudo leer el registro de borrados: ${error.message}`)

  const filas = (data ?? []).map((r) => {
    const fila = r as unknown as {
      id: number
      entity_type: string
      entity_id: string
      label: string | null
      action: 'delete' | 'deactivate'
      reason: string
      snapshot: Record<string, unknown>
      deleted_at: string
      profiles: { full_name: string | null } | null
    }
    return {
      id: fila.id,
      entidad: fila.entity_type,
      entidadId: fila.entity_id,
      etiqueta: fila.label,
      accion: fila.action,
      motivo: fila.reason,
      copia: fila.snapshot ?? {},
      quien: fila.profiles?.full_name ?? null,
      cuando: fila.deleted_at,
    }
  })

  return { filas, total: count ?? filas.length }
}
