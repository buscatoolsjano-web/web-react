import { supabase } from '@/services/supabase/client'
import type { ClasePlantilla, Plantilla } from '../lib/plantillas'

/**
 * Configuración → Plantillas de correo (Fase 41 · E2).
 *
 * Las plantillas se leen y escriben por REST con la RLS de siempre: las de la
 * empresa sólo las toca un admin, la propia su dueño, y el portón de lectura es
 * el mismo que el del módulo de Emails. Acá no se repite ninguna de esas
 * reglas: si alguien intenta lo que no puede, la base lo rechaza.
 *
 * La vista previa es la excepción y va por RPC: resuelve los marcadores con la
 * MISMA función que usa el envío (`app.plantilla_resolver`). Previsualizar con
 * una copia de las reglas en el navegador sería dibujar una pantalla que
 * promete algo que después no sale igual.
 */

export class ErrorPlantilla extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorPlantilla'
  }
}

function deError(e: { message: string }): ErrorPlantilla {
  const m = e.message
  if (/sin_permiso|permission denied|row-level/i.test(m)) return new ErrorPlantilla('sin_permiso')
  if (/sin_sesion/i.test(m)) return new ErrorPlantilla('sin_sesion')
  // El índice único de «una sola por defecto». No es un choque de nombres.
  if (/email_templates_default/i.test(m)) return new ErrorPlantilla('ya_hay_una_por_defecto')
  if (/failed to fetch|network/i.test(m)) return new ErrorPlantilla('sin_red')
  return new ErrorPlantilla('desconocido')
}

export const MENSAJES: Record<string, string> = {
  sin_permiso: 'No tenés permiso para tocar esta plantilla.',
  sin_sesion: 'Tu sesión venció. Volvé a iniciar sesión.',
  ya_hay_una_por_defecto: 'Ya hay otra marcada por defecto. Sacale la marca a esa primero.',
  sin_red: 'No se pudo contactar al servidor. Revisá la conexión.',
  desconocido: 'No se pudo guardar la plantilla.',
}

export const mensajeDePlantilla = (e: unknown): string =>
  MENSAJES[e instanceof ErrorPlantilla ? e.codigo : 'desconocido'] ?? MENSAJES['desconocido']!

interface FilaPlantilla {
  id: string
  user_id: string | null
  clase: string
  nombre: string
  contenido: string
  es_default: boolean
  activa: boolean
}

const aPlantilla = (f: FilaPlantilla): Plantilla => ({
  id: f.id,
  usuarioId: f.user_id,
  clase: f.clase as ClasePlantilla,
  nombre: f.nombre,
  contenido: f.contenido,
  esDefault: f.es_default,
  activa: f.activa,
})

export async function listarPlantillas(companyId: string): Promise<Plantilla[]> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, user_id, clase, nombre, contenido, es_default, activa')
    .eq('company_id', companyId)
    .order('clase')
    .order('user_id', { nullsFirst: true })
    .order('nombre')
  if (error) throw deError(error)
  return (data ?? []).map((f) => aPlantilla(f))
}

export interface DatosPlantilla {
  nombre: string
  contenido: string
  clase: ClasePlantilla
  /** `null` = de la empresa. Con valor = de esa persona. */
  usuarioId: string | null
  esDefault: boolean
}

export async function crearPlantilla(companyId: string, d: DatosPlantilla): Promise<Plantilla> {
  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      company_id: companyId,
      user_id: d.usuarioId,
      clase: d.clase,
      nombre: d.nombre.trim(),
      contenido: d.contenido,
      es_default: d.esDefault,
    })
    .select('id, user_id, clase, nombre, contenido, es_default, activa')
    .single()
  if (error) throw deError(error)
  return aPlantilla(data)
}

export async function guardarPlantilla(id: string, d: Pick<DatosPlantilla, 'nombre' | 'contenido'>): Promise<void> {
  const { error } = await supabase
    .from('email_templates')
    .update({ nombre: d.nombre.trim(), contenido: d.contenido, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw deError(error)
}

/**
 * Marcar una por defecto es DOS escrituras: sacarle la marca a la que la tenía
 * y ponérsela a ésta. El índice único no deja que haya dos, así que el orden
 * importa — al revés, la segunda escritura choca.
 */
export async function marcarPorDefecto(companyId: string, p: Plantilla): Promise<void> {
  const previas = supabase
    .from('email_templates')
    .update({ es_default: false })
    .eq('company_id', companyId)
    .eq('clase', p.clase)
    .neq('id', p.id)
  const { error: e1 } = p.usuarioId === null ? await previas.is('user_id', null) : await previas.eq('user_id', p.usuarioId)
  if (e1) throw deError(e1)

  const { error: e2 } = await supabase.from('email_templates').update({ es_default: true }).eq('id', p.id)
  if (e2) throw deError(e2)
}

/**
 * No se borra: se desactiva.
 *
 * Una plantilla borrada se lleva puesto el rastro de con qué salió un mail que
 * ya se mandó, y además la de por defecto se puede desactivar sin querer y
 * dejar a todo el mundo sin firma. Desactivada deja de ofrecerse y se puede
 * volver.
 */
export async function desactivarPlantilla(id: string): Promise<void> {
  const { error } = await supabase
    .from('email_templates')
    .update({ activa: false, es_default: false })
    .eq('id', id)
  if (error) throw deError(error)
}

/** Resuelve los marcadores con los datos de quien está mirando. */
export async function previsualizar(companyId: string, contenido: string, html: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('previsualizar_plantilla', {
    p_company: companyId,
    p_contenido: contenido,
    p_html: html,
  })
  if (error) throw deError(error)
  return (data) ?? ''
}

export interface MisDatosDeFirma {
  nombre: string
  puesto: string
  telefono: string
}

/** Quién está mirando. Acá y no en el hook: los componentes no tocan supabase (ADR-003). */
export async function miUsuarioId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export async function misDatosDeFirma(): Promise<MisDatosDeFirma> {
  const id = await miUsuarioId()
  if (!id) throw new ErrorPlantilla('sin_sesion')
  const { data, error } = await supabase.from('profiles').select('full_name, job_title, phone').eq('id', id).single()
  if (error) throw deError(error)
  return {
    nombre: data.full_name ?? '',
    puesto: data.job_title ?? '',
    telefono: data.phone ?? '',
  }
}

export async function guardarMisDatosDeFirma(d: MisDatosDeFirma): Promise<MisDatosDeFirma> {
  const { data, error } = await supabase.rpc('guardar_mi_firma', {
    p_nombre: d.nombre,
    p_puesto: d.puesto,
    p_telefono: d.telefono,
  })
  if (error) throw deError(error)
  const r = (data ?? {}) as { nombre?: string; puesto?: string | null; telefono?: string | null }
  return { nombre: r.nombre ?? '', puesto: r.puesto ?? '', telefono: r.telefono ?? '' }
}
