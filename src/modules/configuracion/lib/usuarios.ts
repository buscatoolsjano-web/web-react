import type { EstadoVisible, UsuarioEmpresa } from '../types'

/**
 * Reglas de la pantalla de usuarios. Todas son AYUDAS de interfaz: la base las
 * vuelve a aplicar (rol válido, último admin, auto-suspensión) y es la que
 * decide. Acá sólo se evita ofrecer un botón que va a fallar.
 */

/** Roles que se asignan desde la UI: los internos del CHECK de company_memberships. */
export const ROLES_ASIGNABLES = ['admin', 'employee', 'salesperson', 'technician'] as const

const ETIQUETAS_ROL: Record<string, string> = {
  admin: 'Administrador',
  employee: 'Empleado',
  salesperson: 'Vendedor',
  technician: 'Técnico',
  customer: 'Cliente',
  distributor: 'Distribuidor',
  supplier: 'Proveedor',
}

export function etiquetaRol(rol: string): string {
  return ETIQUETAS_ROL[rol] ?? rol
}

export function esRolAsignable(rol: string): boolean {
  return (ROLES_ASIGNABLES as readonly string[]).includes(rol)
}

/**
 * Estado a mostrar. Sólo lo que se sabe con certeza:
 *   · suspendido        la membresía de ESTA empresa está suspendida;
 *   · bloqueada         la cuenta de Auth está baneada (global);
 *   · invitación pend.  Auth registró una invitación y el email nunca se
 *                       confirmó (no se infiere de «nunca inició sesión»);
 *   · sin confirmar     cuenta creada sin invitación y sin confirmar;
 *   · activo            el resto.
 */
export function estadoVisible(u: Pick<UsuarioEmpresa, 'estado' | 'bloqueada' | 'emailConfirmado' | 'invitadoEl'>): EstadoVisible {
  if (u.estado === 'suspended') return 'suspendido'
  if (u.bloqueada) return 'bloqueada'
  if (!u.emailConfirmado) return u.invitadoEl ? 'invitacion_pendiente' : 'sin_confirmar'
  return 'activo'
}

export const ETIQUETA_ESTADO: Record<EstadoVisible, string> = {
  activo: 'Activo',
  invitacion_pendiente: 'Invitación pendiente',
  sin_confirmar: 'Sin confirmar',
  suspendido: 'Suspendido',
  bloqueada: 'Cuenta bloqueada',
}

export function adminsActivos(lista: readonly UsuarioEmpresa[]): number {
  return lista.filter((u) => u.rol === 'admin' && u.estado === 'active').length
}

export interface Permitido {
  ok: boolean
  motivo: string | null
}

const SI: Permitido = { ok: true, motivo: null }
const no = (motivo: string): Permitido => ({ ok: false, motivo })

function esUnicoAdmin(u: UsuarioEmpresa, lista: readonly UsuarioEmpresa[]): boolean {
  return u.rol === 'admin' && u.estado === 'active' && adminsActivos(lista) <= 1
}

export function puedeCambiarRol(u: UsuarioEmpresa, lista: readonly UsuarioEmpresa[]): Permitido {
  if (!esRolAsignable(u.rol)) return no('El rol de clientes y distribuidores no se cambia desde acá.')
  if (esUnicoAdmin(u, lista)) return no('Es el único administrador activo: primero hacé administrador a otra persona.')
  return SI
}

/** Opciones de rol para una fila: sin degradar al único admin. */
export function rolesPermitidos(u: UsuarioEmpresa, lista: readonly UsuarioEmpresa[]): string[] {
  if (!esRolAsignable(u.rol)) return []
  if (esUnicoAdmin(u, lista)) return ['admin']
  return [...ROLES_ASIGNABLES]
}

export function puedeSuspender(u: UsuarioEmpresa, lista: readonly UsuarioEmpresa[]): Permitido {
  if (u.estado !== 'active') return no('Ya está suspendido.')
  if (u.esPropia) return no('No podés suspender tu propio acceso.')
  if (esUnicoAdmin(u, lista)) return no('Es el único administrador activo.')
  return SI
}

export function puedeReenviar(u: UsuarioEmpresa): Permitido {
  if (u.estado !== 'active') return no('Reactivá el acceso antes de reenviar la invitación.')
  if (u.bloqueada) return no('La cuenta está bloqueada.')
  if (u.emailConfirmado) return no('La cuenta ya está confirmada: puede usar «¿Olvidaste tu contraseña?».')
  return SI
}

/** ¿Este cambio saca a quien lo hace de administrador? Pide confirmación extra. */
export function esAutoDegradacion(u: UsuarioEmpresa, rolNuevo: string): boolean {
  return u.esPropia && u.rol === 'admin' && rolNuevo !== 'admin'
}

// ── Invitación ──────────────────────────────────────────────────────────────

// El mismo patrón que la base y la Edge Function.
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

export interface FormularioInvitacion {
  email: string
  nombre: string
  rol: string
}

export type ErroresInvitacion = Partial<Record<keyof FormularioInvitacion, string>>

export function validarInvitacion(f: FormularioInvitacion):
  | { ok: true; email: string; nombre: string | null; rol: string }
  | { ok: false; errores: ErroresInvitacion } {
  const errores: ErroresInvitacion = {}
  const email = f.email.trim().toLowerCase()
  if (!email) errores.email = 'Ingresá el email.'
  else if (email.length > 254 || !EMAIL.test(email)) errores.email = 'El email no parece válido.'
  if (!esRolAsignable(f.rol)) errores.rol = 'Elegí un rol.'
  const nombre = f.nombre.trim()
  if (nombre.length > 120) errores.nombre = 'Máximo 120 caracteres.'
  if (Object.keys(errores).length) return { ok: false, errores }
  return { ok: true, email, nombre: nombre || null, rol: f.rol }
}

/** Texto para cada código que devuelven la base y la Edge Function. */
export function mensajeError(codigo: string): string {
  switch (codigo) {
    case 'sin_permiso':
      return 'No tenés permiso para administrar usuarios en esta empresa.'
    case 'ultimo_admin':
      return 'La empresa tiene que conservar al menos un administrador activo.'
    case 'no_auto_suspension':
      return 'No podés suspender tu propio acceso.'
    case 'rol_invalido':
      return 'Ese rol no se puede asignar.'
    case 'rol_externo':
      return 'El rol de clientes y distribuidores no se cambia desde acá.'
    case 'estado_invalido':
      return 'Estado inválido.'
    case 'email_invalido':
      return 'El email no parece válido.'
    case 'email_rechazado':
      return 'Supabase rechazó esa dirección de email.'
    case 'ya_es_miembro':
      return 'Esa persona ya tiene acceso a esta empresa.'
    case 'membresia_suspendida':
      return 'Esa persona ya pertenece a esta empresa pero está suspendida: reactivala desde la lista.'
    case 'cuenta_bloqueada':
      return 'La cuenta de esa persona está bloqueada.'
    case 'identidad_ambigua':
      return 'Hay más de una cuenta con ese email. Hace falta revisarlo antes de invitar.'
    case 'invitacion_no_pendiente':
      return 'Esa cuenta ya está confirmada: no hay invitación pendiente.'
    case 'demasiados_envios':
      return 'Se alcanzó el límite de correos de Supabase. Esperá y volvé a intentar.'
    case 'correo_no_autorizado':
      return 'El servidor de correo de Supabase no permite enviar a esa dirección (falta configurar SMTP propio).'
    case 'correo_no_enviado':
      return 'No se pudo enviar el correo de invitación.'
    case 'sesion_invalida':
      return 'Tu sesión venció. Volvé a iniciar sesión.'
    case 'campos_no_permitidos':
    case 'datos_invalidos':
      return 'Los datos enviados no son válidos.'
    case 'sin_red':
      return 'No se pudo contactar al servidor. Revisá la conexión.'
    default:
      return 'Ocurrió un error inesperado. Intentá de nuevo.'
  }
}

export function textoResultadoInvitacion(r: { resultado: string; emailEnviado: boolean; errorEnvio: string | null }, email: string): { tono: 'ok' | 'pending'; titulo: string; detalle: string } {
  switch (r.resultado) {
    case 'invitado':
      return { tono: 'ok', titulo: `Invitación enviada a ${email}.`, detalle: 'Cuando abra el enlace va a elegir su contraseña.' }
    case 'agregado_existente':
      return { tono: 'ok', titulo: `${email} ya tenía cuenta: ahora tiene acceso a esta empresa.`, detalle: 'No se envió ningún correo; entra con su contraseña de siempre.' }
    case 'agregado_pendiente':
      return r.emailEnviado
        ? { tono: 'ok', titulo: `Acceso agregado e invitación enviada a ${email}.`, detalle: 'Su cuenta todavía no estaba confirmada.' }
        : { tono: 'pending', titulo: `Acceso agregado a ${email}, pero el correo no salió.`, detalle: `${mensajeError(r.errorEnvio ?? 'correo_no_enviado')} Podés reenviarla desde la lista.` }
    default:
      return { tono: 'ok', titulo: `Invitación reenviada a ${email}.`, detalle: 'El enlace anterior deja de servir.' }
  }
}

export function filtrarUsuarios(lista: readonly UsuarioEmpresa[], texto: string): UsuarioEmpresa[] {
  const t = texto.trim().toLowerCase()
  if (!t) return [...lista]
  return lista.filter((u) => `${u.nombre ?? ''} ${u.email} ${etiquetaRol(u.rol)}`.toLowerCase().includes(t))
}

const FECHA = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })

export function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : FECHA.format(d)
}
