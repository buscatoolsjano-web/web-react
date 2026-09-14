import { supabase } from '@/services/supabase/client'
import type { EventoAuditoria, FiltrosAuditoria, PersonaAuditoria } from '../lib/auditoria'

/**
 * Configuración → Auditoría. Sólo lectura, sólo admin de la empresa: lo decide
 * `config_auditoria_listar`, que une users_audit, company_audit, catalog_audit y
 * la bitácora de autoridad de numeración, con filtros y paginación en la base.
 * No existe (ni se usa) ninguna función para borrar o editar auditoría.
 */

export class ErrorAuditoria extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorAuditoria'
  }
}

function deError(e: { message: string }): ErrorAuditoria {
  if (e.message.includes('sin_permiso') || /permission denied/i.test(e.message)) return new ErrorAuditoria('sin_permiso')
  if (e.message.includes('datos_invalidos')) return new ErrorAuditoria('datos_invalidos')
  if (/failed to fetch|network/i.test(e.message)) return new ErrorAuditoria('sin_red')
  return new ErrorAuditoria('desconocido')
}

function persona(v: unknown): PersonaAuditoria | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string') return null
  return {
    id: o.id,
    nombre: typeof o.nombre === 'string' ? o.nombre : null,
    email: typeof o.email === 'string' ? o.email : null,
    miembro: o.miembro === true,
  }
}

export async function listarAuditoria(
  companyId: string,
  f: FiltrosAuditoria,
  desplazamiento: number,
  limite: number,
): Promise<{ filas: EventoAuditoria[]; total: number }> {
  const { data, error } = await supabase.rpc('config_auditoria_listar', {
    p_company: companyId,
    p_desde: f.desde || null,
    p_hasta: f.hasta || null,
    p_modulo: f.modulo || null,
    p_evento: f.evento || null,
    p_actor: f.actor || null,
    p_texto: f.texto.trim() || null,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  })
  if (error) throw deError(error)
  const filas = data ?? []
  return {
    total: Number(filas[0]?.total ?? 0),
    filas: filas.map((r) => ({
      clave: `${r.origen}:${r.evento_id}`,
      origen: r.origen,
      id: Number(r.evento_id),
      modulo: r.modulo,
      evento: r.evento,
      fecha: r.fecha,
      actor: persona(r.actor),
      entidadTipo: r.entidad_tipo,
      entidadId: r.entidad_id,
      entidadNombre: r.entidad_nombre,
      entidadExiste: r.entidad_existe,
      detalles: r.detalles && typeof r.detalles === 'object' && !Array.isArray(r.detalles) ? (r.detalles as Record<string, unknown>) : {},
    })),
  }
}

export async function listarActoresAuditoria(companyId: string): Promise<{ id: string; etiqueta: string; eventos: number }[]> {
  const { data, error } = await supabase.rpc('config_auditoria_actores', { p_company: companyId })
  if (error) throw deError(error)
  return (data ?? []).map((a) => ({ id: a.actor_id, etiqueta: a.nombre || a.email || 'Usuario sin nombre', eventos: Number(a.eventos) }))
}
