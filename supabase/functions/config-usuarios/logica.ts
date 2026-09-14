/**
 * Lógica pura de `config-usuarios`: validación del pedido y decisión de qué
 * hacer con una invitación. Sin Deno ni red, para testearla desde Node.
 */

export const ROLES_ASIGNABLES = ['admin', 'employee', 'salesperson', 'technician'] as const
export type RolAsignable = (typeof ROLES_ASIGNABLES)[number]

export const ORIGENES_PERMITIDOS = [
  'https://app.buscatools.com',
  'http://localhost:5173',
  'http://localhost:3000',
] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// El mismo patrón que valida la base (config_validar_invitacion).
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

export type Pedido =
  | { accion: 'invitar'; companyId: string; email: string; nombre: string | null; rol: RolAsignable }
  | { accion: 'reenviar'; membershipId: string }

export type ErrorPedido = { error: 'datos_invalidos' | 'campos_no_permitidos' | 'email_invalido' | 'rol_invalido'; campo?: string }

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

const CAMPOS: Record<Pedido['accion'], readonly string[]> = {
  invitar: ['accion', 'company_id', 'email', 'nombre', 'rol'],
  reenviar: ['accion', 'membership_id'],
}

/** Valida el cuerpo tal como llega. Cualquier campo extra se rechaza. */
export function validarPedido(cuerpo: unknown): Pedido | ErrorPedido {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { error: 'datos_invalidos' }
  const c = cuerpo as Record<string, unknown>
  const accion = c.accion
  if (accion !== 'invitar' && accion !== 'reenviar') return { error: 'datos_invalidos', campo: 'accion' }

  const extra = Object.keys(c).find((k) => !CAMPOS[accion].includes(k))
  if (extra) return { error: 'campos_no_permitidos', campo: extra }

  if (accion === 'reenviar') {
    if (typeof c.membership_id !== 'string' || !UUID.test(c.membership_id))
      return { error: 'datos_invalidos', campo: 'membership_id' }
    return { accion, membershipId: c.membership_id }
  }

  if (typeof c.company_id !== 'string' || !UUID.test(c.company_id))
    return { error: 'datos_invalidos', campo: 'company_id' }
  if (typeof c.email !== 'string') return { error: 'email_invalido', campo: 'email' }
  const email = normalizarEmail(c.email)
  if (email.length > 254 || !EMAIL.test(email)) return { error: 'email_invalido', campo: 'email' }
  if (typeof c.rol !== 'string' || !(ROLES_ASIGNABLES as readonly string[]).includes(c.rol))
    return { error: 'rol_invalido', campo: 'rol' }
  let nombre: string | null = null
  if (c.nombre !== undefined && c.nombre !== null) {
    if (typeof c.nombre !== 'string' || c.nombre.trim().length > 120) return { error: 'datos_invalidos', campo: 'nombre' }
    nombre = c.nombre.trim() || null
  }
  return { accion, companyId: c.company_id, email, nombre, rol: c.rol as RolAsignable }
}

/** Lo que devuelve `config_validar_invitacion`: una fila por cuenta con ese email (0 o 1). */
export interface EstadoIdentidad {
  user_id: string | null
  email_confirmado: boolean | null
  invitacion_pendiente: boolean | null
  bloqueada: boolean | null
  membership_id: string | null
  membership_estado: string | null
}

export type Decision =
  | { tipo: 'crear_e_invitar' }
  | { tipo: 'agregar'; userId: string; enviarInvitacion: boolean }
  | { tipo: 'conflicto'; error: 'ya_es_miembro' | 'membresia_suspendida' | 'cuenta_bloqueada' | 'identidad_ambigua' }

/**
 * Qué hacer con un email:
 *   · sin cuenta                      → crear la cuenta con la invitación oficial
 *   · con cuenta y ya miembro         → conflicto (activo o suspendido: no se reactiva solo)
 *   · con cuenta bloqueada            → conflicto
 *   · con cuenta confirmada           → sólo la membresía; ya tiene credenciales
 *   · con cuenta SIN confirmar        → membresía + invitación, para que defina su contraseña
 *
 * Nunca se crea una segunda identidad para el mismo email.
 */
export function decidirInvitacion(filas: EstadoIdentidad[]): Decision {
  const cuentas = filas.filter((f) => f.user_id)
  if (cuentas.length === 0) return { tipo: 'crear_e_invitar' }
  if (cuentas.length > 1) return { tipo: 'conflicto', error: 'identidad_ambigua' }
  const f = cuentas[0]!
  if (f.membership_id) {
    return { tipo: 'conflicto', error: f.membership_estado === 'suspended' ? 'membresia_suspendida' : 'ya_es_miembro' }
  }
  if (f.bloqueada) return { tipo: 'conflicto', error: 'cuenta_bloqueada' }
  return { tipo: 'agregar', userId: f.user_id!, enviarInvitacion: !f.email_confirmado }
}

/** El destino del enlace. Sólo orígenes conocidos; cualquier otro, producción. */
export function destinoEnlace(origen: string | null): string {
  const o = origen && (ORIGENES_PERMITIDOS as readonly string[]).includes(origen) ? origen : ORIGENES_PERMITIDOS[0]
  return `${o}/`
}

/** Errores de la base (`raise exception '<codigo>'`) que se le pueden contar al admin. */
export const ERRORES_BASE = [
  'sin_permiso',
  'rol_invalido',
  'email_invalido',
  'ya_es_miembro',
  'membresia_suspendida',
  'invitacion_no_pendiente',
  'cuenta_bloqueada',
  'nombre_invalido',
] as const

export function codigoDeErrorBase(mensaje: string | undefined): string | null {
  const m = (mensaje ?? '').trim()
  return (ERRORES_BASE as readonly string[]).includes(m) ? m : null
}

export function statusDe(codigo: string): number {
  switch (codigo) {
    case 'sin_permiso':
      return 403
    case 'ya_es_miembro':
    case 'membresia_suspendida':
    case 'invitacion_no_pendiente':
    case 'cuenta_bloqueada':
    case 'identidad_ambigua':
      return 409
    case 'rol_invalido':
    case 'email_invalido':
    case 'nombre_invalido':
      return 422
    default:
      return 400
  }
}

/**
 * Error del servidor de Auth al mandar la invitación. El texto crudo no sale:
 * sólo un código. `email_address_not_authorized` es el mailer por defecto de
 * Supabase negándose a enviar a una dirección fuera del equipo del proyecto.
 */
export function clasificarErrorAuth(e: { status?: number; code?: string; message?: string } | null): {
  status: number
  error: string
} {
  const code = e?.code ?? ''
  const msg = (e?.message ?? '').toLowerCase()
  if (e?.status === 429 || code === 'over_email_send_rate_limit' || msg.includes('rate limit'))
    return { status: 429, error: 'demasiados_envios' }
  if (code === 'email_address_invalid') return { status: 422, error: 'email_rechazado' }
  if (code === 'email_address_not_authorized' || msg.includes('not authorized'))
    return { status: 502, error: 'correo_no_autorizado' }
  if (code === 'email_exists' || msg.includes('already been registered'))
    return { status: 409, error: 'ya_registrado' }
  return { status: 502, error: 'correo_no_enviado' }
}
