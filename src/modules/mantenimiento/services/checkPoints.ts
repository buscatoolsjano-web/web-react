import { supabase } from '@/services/supabase/client'
import type { PuntoDeRevision } from '../types'

/**
 * Los puntos de revisión de la empresa.
 *
 * Son configurables y no un CHECK fijo, y la razón está medida: las ocho
 * partes que revisa el legacy —carcasa, tornillos, conectores, reversa,
 * software, embrague, cabezal, rotor— son de un atornillador FEIN. El schema
 * es multiempresa desde el día uno, así que si otra empresa revisa otra cosa
 * no debería hacer falta una migración.
 *
 * Están sembradas en las dos empresas desde la entrega 1. Son reales, no
 * placeholders: salen de `MANT_PARTS` (`app.js:28804`) y aparecen con datos en
 * las tres fichas del histórico del legacy.
 */

export async function listarPuntos(
  companyId: string,
  soloActivos = false,
): Promise<PuntoDeRevision[]> {
  let q = supabase
    .from('maintenance_check_points')
    .select('id, key, label, sort_order, active')
    .eq('company_id', companyId)
  if (soloActivos) q = q.eq('active', true)

  const { data, error } = await q.order('sort_order', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los puntos de revisión: ${error.message}`)

  return (data ?? []).map((p) => ({
    id: p.id,
    clave: p.key,
    etiqueta: p.label,
    posicion: p.sort_order,
    activo: p.active,
  }))
}

export interface DatosPunto {
  clave: string
  etiqueta: string
  posicion: number
  activo: boolean
}

export async function crearPunto(companyId: string, d: DatosPunto): Promise<void> {
  const { error } = await supabase.from('maintenance_check_points').insert({
    company_id: companyId,
    key: d.clave.trim(),
    label: d.etiqueta.trim(),
    sort_order: d.posicion,
    active: d.activo,
  })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function actualizarPunto(
  companyId: string,
  id: string,
  d: Partial<DatosPunto>,
): Promise<void> {
  const fila: {
    key?: string
    label?: string
    sort_order?: number
    active?: boolean
  } = {}
  if (d.clave !== undefined) fila.key = d.clave.trim()
  if (d.etiqueta !== undefined) fila.label = d.etiqueta.trim()
  if (d.posicion !== undefined) fila.sort_order = d.posicion
  if (d.activo !== undefined) fila.active = d.activo
  if (Object.keys(fila).length === 0) return

  const { error } = await supabase
    .from('maintenance_check_points')
    .update(fila)
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Borrar un punto.
 *
 * Si ya se usó en alguna orden, la FK lo impide — y está bien: borrarlo
 * dejaría revisiones apuntando a la nada. Para sacarlo de circulación está
 * «activo», que es lo que hay que usar.
 */
export async function borrarPunto(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('maintenance_check_points')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Este punto ya se usó en una orden y no se puede borrar. Desactivalo para que deje de ofrecerse.',
      )
    }
    throw new Error(traducir(error.message, error.code))
  }
}

function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23505') return 'Ya existe un punto con esa clave en esta empresa.'
  if (codigo === '42501') {
    return 'No tenés permiso para configurar Mantenimiento. Es de administradores y empleados.'
  }
  return mensaje
}
