/**
 * Configuración → Auditoría (Entrega 4). Presentación de los eventos que
 * devuelve `config_auditoria_listar`: etiquetas, resumen y detalle seguro.
 *
 * La base ya arma los detalles con lista blanca; acá se vuelve a filtrar por las
 * dudas (un campo desconocido no se muestra) y nunca se inventa un actor.
 */
import { etiquetaCampo } from './empresa'
import { etiquetaTipo } from './numeracion'
import { etiquetaRol } from './usuarios'

export type Modulo = 'usuarios' | 'empresa' | 'catalogo' | 'numeracion'

export interface PersonaAuditoria {
  id: string
  nombre: string | null
  email: string | null
  miembro: boolean
}

export interface EventoAuditoria {
  clave: string
  origen: string
  id: number
  /** Uno de `Modulo`; se deja abierto para no romper con un módulo nuevo. */
  modulo: string
  evento: string
  fecha: string
  actor: PersonaAuditoria | null
  entidadTipo: string
  entidadId: string | null
  entidadNombre: string | null
  entidadExiste: boolean
  detalles: Record<string, unknown>
}

export const MODULOS: Record<Modulo, string> = {
  usuarios: 'Usuarios',
  empresa: 'Empresa',
  catalogo: 'Marcas y categorías',
  numeracion: 'Numeración',
}

export const EVENTOS: Record<string, { etiqueta: string; modulo: Modulo }> = {
  USER_INVITED: { etiqueta: 'Usuario invitado', modulo: 'usuarios' },
  MEMBERSHIP_ADDED: { etiqueta: 'Acceso agregado a cuenta existente', modulo: 'usuarios' },
  INVITATION_RESENT: { etiqueta: 'Invitación reenviada', modulo: 'usuarios' },
  MEMBERSHIP_ROLE_CHANGED: { etiqueta: 'Rol cambiado', modulo: 'usuarios' },
  MEMBERSHIP_SUSPENDED: { etiqueta: 'Acceso suspendido', modulo: 'usuarios' },
  MEMBERSHIP_REACTIVATED: { etiqueta: 'Acceso reactivado', modulo: 'usuarios' },
  COMPANY_UPDATED: { etiqueta: 'Empresa actualizada', modulo: 'empresa' },
  COMPANY_LOGO_UPDATED: { etiqueta: 'Logo actualizado', modulo: 'empresa' },
  COMPANY_LOGO_REMOVED: { etiqueta: 'Logo quitado', modulo: 'empresa' },
  BRAND_CREATED: { etiqueta: 'Marca creada', modulo: 'catalogo' },
  BRAND_DISABLED: { etiqueta: 'Marca desactivada', modulo: 'catalogo' },
  BRAND_ENABLED: { etiqueta: 'Marca reactivada', modulo: 'catalogo' },
  BRAND_DELETED: { etiqueta: 'Marca eliminada', modulo: 'catalogo' },
  CATEGORY_CREATED: { etiqueta: 'Categoría creada', modulo: 'catalogo' },
  CATEGORY_UPDATED: { etiqueta: 'Categoría renombrada', modulo: 'catalogo' },
  CATEGORY_DELETED: { etiqueta: 'Categoría eliminada', modulo: 'catalogo' },
  NUMBERING_AUTHORITY_INSERT: { etiqueta: 'Autoridad de numeración asignada', modulo: 'numeracion' },
  NUMBERING_AUTHORITY_UPDATE: { etiqueta: 'Autoridad de numeración cambiada', modulo: 'numeracion' },
  NUMBERING_AUTHORITY_DELETE: { etiqueta: 'Autoridad de numeración quitada', modulo: 'numeracion' },
}

export function etiquetaEvento(codigo: string): string {
  return EVENTOS[codigo]?.etiqueta ?? `Evento desconocido (${codigo})`
}

export function etiquetaModulo(m: string): string {
  return (MODULOS as Record<string, string>)[m] ?? m
}

export function eventosDeModulo(m: Modulo | ''): { codigo: string; etiqueta: string }[] {
  return Object.entries(EVENTOS)
    .filter(([, v]) => !m || v.modulo === m)
    .map(([codigo, v]) => ({ codigo, etiqueta: v.etiqueta }))
}

/** Quién lo hizo. Sin actor registrado no se inventa uno. */
export function etiquetaActor(e: Pick<EventoAuditoria, 'actor' | 'detalles'>): string {
  if (e.actor) return e.actor.nombre || e.actor.email || 'Usuario sin nombre'
  return typeof e.detalles.origen_tecnico === 'string' ? 'Proceso del sistema (sin usuario)' : 'Sin actor registrado'
}

const ESTADOS: Record<string, string> = { active: 'Activo', suspended: 'Suspendido' }
const AUTORIDADES: Record<string, string> = { STEL: 'STEL', ERP: 'ERP' }
const TIPOS_ENTIDAD: Record<string, string> = { usuario: 'Usuario', empresa: 'Empresa', marca: 'Marca', categoria: 'Categoría', tipo_documento: 'Tipo de documento' }

export function etiquetaEntidad(e: Pick<EventoAuditoria, 'entidadTipo' | 'entidadNombre' | 'entidadExiste' | 'entidadId'>): string {
  const tipo = TIPOS_ENTIDAD[e.entidadTipo] ?? e.entidadTipo
  if (e.entidadTipo === 'tipo_documento') return `${tipo}: ${etiquetaTipo(e.entidadNombre ?? e.entidadId ?? '')}`
  const nombre = e.entidadNombre ?? (e.entidadId ? `id ${e.entidadId.slice(0, 8)}` : '—')
  return `${tipo}: ${nombre}${e.entidadExiste ? '' : ' (ya no existe)'}`
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Una línea legible de qué cambió, sólo con datos que el evento trae. */
export function resumenEvento(e: Pick<EventoAuditoria, 'evento' | 'detalles' | 'entidadNombre'>): string {
  const d = e.detalles
  switch (e.evento) {
    case 'MEMBERSHIP_ROLE_CHANGED':
      return `${etiquetaRol(texto(d.rol_anterior) ?? '?')} → ${etiquetaRol(texto(d.rol_nuevo) ?? '?')}`
    case 'USER_INVITED':
    case 'MEMBERSHIP_ADDED':
    case 'INVITATION_RESENT':
      return texto(d.rol_nuevo) ? `Como ${etiquetaRol(texto(d.rol_nuevo)!)}` : ''
    case 'MEMBERSHIP_SUSPENDED':
    case 'MEMBERSHIP_REACTIVATED':
      return `${ESTADOS[texto(d.estado_anterior) ?? ''] ?? '?'} → ${ESTADOS[texto(d.estado_nuevo) ?? ''] ?? '?'}`
    case 'COMPANY_UPDATED': {
      const campos = lista(d.campos)
      return campos.length ? `Campos: ${campos.map((c) => etiquetaCampo(c)).join(', ')}` : ''
    }
    case 'CATEGORY_UPDATED':
      return texto(d.nombre_registrado) ? `Nuevo nombre: ${texto(d.nombre_registrado)}` : ''
    // El nombre ya está en la columna Entidad: el resumen dice qué pasó.
    case 'BRAND_CREATED':
    case 'CATEGORY_CREATED':
      return 'Alta'
    case 'BRAND_DISABLED':
      return 'Activa → Inactiva'
    case 'BRAND_ENABLED':
      return 'Inactiva → Activa'
    case 'BRAND_DELETED':
    case 'CATEGORY_DELETED':
      return 'Eliminada (sin productos ni otros usos)'
    case 'NUMBERING_AUTHORITY_INSERT':
    case 'NUMBERING_AUTHORITY_UPDATE':
    case 'NUMBERING_AUTHORITY_DELETE': {
      const tipo = etiquetaTipo(texto(d.tipo_documento) ?? '')
      const antes = AUTORIDADES[texto(d.autoridad_anterior) ?? '']
      const despues = AUTORIDADES[texto(d.autoridad_nueva) ?? '']
      if (antes && despues) return `${tipo}: ${antes} → ${despues}`
      return `${tipo}: ${despues ?? antes ?? '?'}`
    }
    default:
      return ''
  }
}

/** Campos del detalle que se pueden mostrar, con su etiqueta. El resto se ignora. */
const CAMPOS_SEGUROS: Record<string, string> = {
  email_afectado: 'Email de la persona',
  rol_anterior: 'Rol anterior',
  rol_nuevo: 'Rol nuevo',
  estado_anterior: 'Estado anterior',
  estado_nuevo: 'Estado nuevo',
  campos: 'Campos modificados',
  nombre_registrado: 'Nombre registrado en el evento',
  tipo_documento: 'Tipo de documento',
  autoridad_anterior: 'Autoridad anterior',
  autoridad_nueva: 'Autoridad nueva',
  motivo: 'Motivo',
  origen_tecnico: 'Origen técnico',
}

const PROHIBIDO = /token|password|contrase|secret|link|enlace|authorization|header|smtp|otp|hash/i

export function detallesSeguros(e: Pick<EventoAuditoria, 'evento' | 'detalles'>): { etiqueta: string; valor: string }[] {
  const out: { etiqueta: string; valor: string }[] = []
  for (const [clave, valor] of Object.entries(e.detalles)) {
    const etiqueta = CAMPOS_SEGUROS[clave]
    if (!etiqueta || PROHIBIDO.test(clave)) continue
    let v: string | null
    if (clave === 'rol_anterior' || clave === 'rol_nuevo') v = texto(valor) && etiquetaRol(texto(valor)!)
    else if (clave === 'estado_anterior' || clave === 'estado_nuevo') v = ESTADOS[texto(valor) ?? ''] ?? texto(valor)
    else if (clave === 'campos') {
      const c = lista(valor)
      v = c.length ? c.map((x) => (e.evento === 'COMPANY_UPDATED' ? etiquetaCampo(x) : x)).join(', ') : null
    } else if (clave === 'tipo_documento') v = texto(valor) && etiquetaTipo(texto(valor)!)
    else v = texto(valor)
    if (v) out.push({ etiqueta, valor: v })
  }
  return out
}

export function formatearFechaHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const POR_PAGINA_AUDITORIA = 50

export interface FiltrosAuditoria {
  desde: string
  hasta: string
  modulo: Modulo | ''
  evento: string
  actor: string
  texto: string
}

export const FILTROS_VACIOS: FiltrosAuditoria = { desde: '', hasta: '', modulo: '', evento: '', actor: '', texto: '' }

export function hayFiltros(f: FiltrosAuditoria): boolean {
  return Object.values(f).some((v) => v !== '')
}

/** Error de fechas antes de pedir al servidor (la base igual lo valida). */
export function errorFechas(f: Pick<FiltrosAuditoria, 'desde' | 'hasta'>): string | null {
  return f.desde && f.hasta && f.hasta < f.desde ? '«Hasta» no puede ser anterior a «Desde».' : null
}
