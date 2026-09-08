import { supabase } from './client'

export type EstadoConexion =
  | { estado: 'verificando' }
  | { estado: 'ok'; conSesion: boolean }
  | { estado: 'error'; mensaje: string }

/**
 * Verificación de conectividad de FASE 1.
 *
 * Solo LEE: `getSession()` no crea ni modifica nada. Un resultado sin
 * sesión (null) es el esperado en un proyecto nuevo y confirma que la URL
 * y la clave son válidas y que el cliente se inicializó bien.
 */
export async function verificarConexion(): Promise<EstadoConexion> {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) return { estado: 'error', mensaje: error.message }
    return { estado: 'ok', conSesion: data.session !== null }
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) }
  }
}
