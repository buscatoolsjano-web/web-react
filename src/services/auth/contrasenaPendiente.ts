import type { MotivoEnlace } from './callbackUrl'

/**
 * «Esta sesión entró por un enlace y todavía no eligió contraseña».
 *
 * Es una comodidad de navegación, no seguridad: la sesión del enlace ya es
 * válida para Supabase. Sirve para que quien acepta una invitación no se vaya
 * al sistema sin fijar su contraseña (y no dependa de una que otro haya puesto
 * antes). Guarda sólo el motivo; nunca un token.
 */
const CLAVE = 'bt-contrasena-pendiente'

export function marcarContrasenaPendiente(motivo: MotivoEnlace): void {
  try {
    sessionStorage.setItem(CLAVE, motivo)
  } catch {
    /* sin storage: la página igual muestra el formulario en esta carga */
  }
}

export function contrasenaPendiente(): MotivoEnlace | null {
  try {
    return sessionStorage.getItem(CLAVE) as MotivoEnlace | null
  } catch {
    return null
  }
}

export function limpiarContrasenaPendiente(): void {
  try {
    sessionStorage.removeItem(CLAVE)
  } catch {
    /* nada que limpiar */
  }
}
