import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'
import { normalizarConfig, type ConfigPlantilla } from '../lib/plantillas'

/**
 * Las plantillas de impresión, contra `print_templates` (Fase 152).
 *
 * El RLS decide quién lee y quién escribe (interno lee, admin/employee escribe),
 * así que acá no hay chequeo de permisos: si no corresponde, la base lo rechaza.
 */

export interface PlantillaImpresion {
  id: string
  nombre: string
  config: ConfigPlantilla
}

function fallo(que: string, error: { message: string }): never {
  throw new Error(`${que}: ${error.message}`)
}

export async function listarPlantillas(companyId: string): Promise<PlantillaImpresion[]> {
  const { data, error } = await supabase
    .from('print_templates')
    .select('id, name, config')
    .eq('company_id', companyId)
    .order('name')
  if (error) fallo('No se pudieron leer las plantillas', error)
  return (data ?? []).map((p) => ({ id: p.id, nombre: p.name, config: normalizarConfig(p.config) }))
}

export async function crearPlantilla(
  companyId: string,
  nombre: string,
  config: ConfigPlantilla,
): Promise<PlantillaImpresion> {
  const { data, error } = await supabase
    .from('print_templates')
    .insert({ company_id: companyId, name: nombre.trim(), config: config as unknown as Json })
    .select('id, name, config')
    .single()
  if (error) fallo('No se pudo crear la plantilla', error)
  if (!data) throw new Error('No se pudo crear la plantilla.')
  return { id: data.id, nombre: data.name, config: normalizarConfig(data.config) }
}

export async function actualizarPlantilla(
  id: string,
  nombre: string,
  config: ConfigPlantilla,
): Promise<void> {
  const { error } = await supabase
    .from('print_templates')
    .update({ name: nombre.trim(), config: config as unknown as Json, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) fallo('No se pudo guardar la plantilla', error)
}

export async function borrarPlantilla(id: string): Promise<void> {
  const { error } = await supabase.from('print_templates').delete().eq('id', id)
  if (error) fallo('No se pudo borrar la plantilla', error)
}
