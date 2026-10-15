import { supabase } from '@/services/supabase/client'
import type { Accion, Condicion, ReglaCorreo } from '../lib/reglasCorreo'

/**
 * Configuración → Reglas de correo (Fase 70 · E2).
 *
 * Se LEEN por REST con la RLS de siempre —la misma que decide quién ve el
 * correo— y se ESCRIBEN por RPC, igual que las etiquetas. La RPC no es un
 * capricho: valida la forma de las condiciones y las acciones, que es algo que
 * una política de seguridad no puede hacer.
 *
 * LA CONVERSIÓN DE NOMBRES VIVE ACÁ. En la base las acciones viajan como
 * `label_id` y `user_id`, porque son columnas de la base; en el resto del
 * frontend son `labelId` y `userId`. Traducir en un solo lugar es lo que evita
 * que la pantalla termine hablando mitad y mitad.
 */

export class ErrorRegla extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorRegla'
  }
}

function deError(e: { message: string }): ErrorRegla {
  const m = e.message
  if (/permiso|permission denied|row-level/i.test(m)) return new ErrorRegla('sin_permiso')
  if (/no existe/i.test(m)) return new ErrorRegla('no_existe')
  if (/failed to fetch|network/i.test(m)) return new ErrorRegla('sin_red')
  /* El resto son los mensajes de `app.validar_regla_email`, que están escritos
     para que los lea una persona: se muestran tal cual en vez de taparlos con
     un «no se pudo guardar». */
  return new ErrorRegla(m)
}

export const mensajeDeRegla = (e: unknown): string => {
  const c = e instanceof ErrorRegla ? e.codigo : 'desconocido'
  const fijos: Record<string, string> = {
    sin_permiso: 'No tenés permiso para tocar las reglas de correo.',
    no_existe: 'Esa regla ya no existe. Actualizá la lista.',
    sin_red: 'No se pudo contactar al servidor. Revisá la conexión.',
    desconocido: 'No se pudo guardar la regla.',
  }
  return fijos[c] ?? c
}

interface FilaRegla {
  id: string
  nombre: string
  activa: boolean
  orden: number
  condiciones: unknown
  acciones: unknown
}

/** Lo que no viene como texto no es texto: no se lo fuerza a «[object Object]». */
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Lo que vuelve de la base, comprobado en vez de confiado. */
function aRegla(f: FilaRegla): ReglaCorreo {
  const condiciones: Condicion[] = (Array.isArray(f.condiciones) ? f.condiciones : []).flatMap(
    (c: Record<string, unknown>): Condicion[] => {
      if (c['campo'] === 'es_cliente') return [{ campo: 'es_cliente' as const, valor: c['valor'] === true }]
      const campo = c['campo']
      if (campo !== 'de' && campo !== 'para' && campo !== 'asunto' && campo !== 'texto') return []
      const op = c['op']
      if (op !== 'contiene' && op !== 'no_contiene' && op !== 'es') return []
      return [{ campo, op, valor: texto(c['valor']) }]
    },
  )
  const acciones: Accion[] = (Array.isArray(f.acciones) ? f.acciones : []).flatMap(
    (a: Record<string, unknown>): Accion[] => {
      switch (a['tipo']) {
        case 'etiquetar':
          return [{ tipo: 'etiquetar' as const, labelId: texto(a['label_id']) }]
        case 'asignar':
          return [{ tipo: 'asignar' as const, userId: texto(a['user_id']) }]
        case 'estado': {
          const v = a['valor']
          return v === 'pendiente' || v === 'en_proceso' || v === 'resuelto'
            ? [{ tipo: 'estado' as const, valor: v }]
            : []
        }
        case 'sacar_de_bandeja':
          return [{ tipo: 'sacar_de_bandeja' as const }]
        default:
          return []
      }
    },
  )
  return { id: f.id, nombre: f.nombre, activa: f.activa, orden: f.orden, condiciones, acciones }
}

const aJsonAccion = (a: Accion): Record<string, unknown> => {
  switch (a.tipo) {
    case 'etiquetar':
      return { tipo: 'etiquetar', label_id: a.labelId }
    case 'asignar':
      return { tipo: 'asignar', user_id: a.userId }
    case 'estado':
      return { tipo: 'estado', valor: a.valor }
    case 'sacar_de_bandeja':
      return { tipo: 'sacar_de_bandeja' }
  }
}

export async function listarReglas(companyId: string): Promise<ReglaCorreo[]> {
  const { data, error } = await supabase
    .from('email_rules')
    .select('id, nombre, activa, orden, condiciones, acciones')
    .eq('company_id', companyId)
    .order('orden')
    .order('created_at')
  if (error) throw deError(error)
  return (data ?? []).map((f) => aRegla(f as unknown as FilaRegla))
}

export async function guardarRegla(params: {
  companyId: string
  id?: string | null
  nombre: string
  activa: boolean
  orden: number
  condiciones: readonly Condicion[]
  acciones: readonly Accion[]
}): Promise<ReglaCorreo> {
  const { data, error } = await supabase.rpc('guardar_regla_email', {
    p_company: params.companyId,
    p_nombre: params.nombre.trim(),
    p_condiciones: params.condiciones as unknown as never,
    p_acciones: params.acciones.map(aJsonAccion) as unknown as never,
    p_activa: params.activa,
    p_orden: params.orden,
    p_id: params.id ?? null,
  })
  if (error) throw deError(error)
  return aRegla(data)
}

export async function borrarRegla(id: string): Promise<void> {
  const { error } = await supabase.rpc('borrar_regla_email', { p_regla: id })
  if (error) throw deError(error)
}

/**
 * Lo que devuelve recorrer los hilos que ya están, mirando o aplicando.
 *
 * `simulado` viaja en la respuesta a propósito: es el servidor diciendo qué
 * hizo, y no la pantalla acordándose de qué pidió. Si alguna vez se cruzan los
 * cables, el cartel dice la verdad.
 */
export interface PasadaDeRegla {
  regla: string
  simulado: boolean
  total: number
  desde: number
  mirados: number
  quedan: number
  coinciden: number
  acciones: Record<string, number>
  ejemplos: {
    asunto: string | null
    de: string | null
    fecha: string | null
    que: { tipo: string; detalle: string | null }[]
  }[]
}

const aPasada = (d: unknown): PasadaDeRegla => {
  const o = (d ?? {}) as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' ? x : 0)
  return {
    regla: texto(o['regla']),
    simulado: o['simulado'] === true,
    total: num(o['total']),
    desde: num(o['desde']),
    mirados: num(o['mirados']),
    quedan: num(o['quedan']),
    coinciden: num(o['coinciden']),
    acciones: (o['acciones'] ?? {}) as Record<string, number>,
    ejemplos: (Array.isArray(o['ejemplos']) ? o['ejemplos'] : []) as PasadaDeRegla['ejemplos'],
  }
}

/** Cuántos hilos se miran por vez. Ver el porqué en el script de la Fase 70. */
export const POR_TANDA = 200

export async function previsualizarRegla(id: string, desde = 0): Promise<PasadaDeRegla> {
  const { data, error } = await supabase.rpc('previsualizar_regla_email', {
    p_regla: id,
    p_desde: desde,
    p_limite: POR_TANDA,
  })
  if (error) throw deError(error)
  return aPasada(data)
}

export async function aplicarReglaAhora(id: string, desde = 0): Promise<PasadaDeRegla> {
  const { data, error } = await supabase.rpc('aplicar_regla_email_ahora', {
    p_regla: id,
    p_desde: desde,
    p_limite: POR_TANDA,
  })
  if (error) throw deError(error)
  return aPasada(data)
}

/** Las etiquetas de la empresa, para elegir en la acción «etiquetar». */
export async function listarEtiquetas(
  companyId: string,
): Promise<{ id: string; nombre: string; color: string }[]> {
  const { data, error } = await supabase
    .from('email_labels')
    .select('id, nombre, color')
    .eq('company_id', companyId)
    .order('nombre')
  if (error) throw deError(error)
  return data ?? []
}

/** Crear una etiqueta sin irse de la pantalla: la regla es su primer uso. */
export async function crearEtiqueta(
  companyId: string,
  nombre: string,
): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabase.rpc('guardar_etiqueta_email', {
    p_company: companyId,
    p_nombre: nombre.trim(),
    p_color: 'neutral',
  })
  if (error) throw deError(error)
  const o = data as unknown as { id: string; nombre: string }
  return { id: o.id, nombre: o.nombre }
}

/** A quién se le puede asignar un hilo. La misma RPC que usa la bandeja. */
export async function listarAsignables(companyId: string): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase.rpc('usuarios_asignables_email', { p_company: companyId })
  if (error) throw deError(error)
  /* La RPC devuelve `user_id` y `full_name`, que son los nombres de la base.
     Se traducen acá, como las acciones: la pantalla habla un solo idioma. */
  return (data ?? []).map((u) => ({ id: u.user_id, nombre: u.full_name || 'Sin nombre' }))
}
