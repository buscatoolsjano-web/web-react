import { supabase } from '@/services/supabase/client'
import { pedir } from './contenido'

/**
 * Conectar y desconectar casillas de Gmail por "Iniciar sesión con Google".
 *
 * `iniciarConexionGmail` le pide al backend la URL de consentimiento (con el JWT
 * del usuario, que valida que sea admin de la empresa) y redirige a Google. Al
 * volver, el backend trae a `/emails?correo_conectado=…` o `?correo_error=…`.
 *
 * `desconectarCasilla` corre la RPC `email_desvincular_oauth` (sólo admin, por
 * la RLS/definer): marca la cuenta inactiva y revoca la credencial.
 */
export async function iniciarConexionGmail(companyId: string): Promise<void> {
  const r = await pedir('/oauth/google/start', { company: companyId })
  const { url } = (await r.json()) as { url?: string }
  if (!url) throw new Error('No se pudo iniciar la conexión con Google.')
  window.location.href = url
}

export async function desconectarCasilla(accountId: string): Promise<void> {
  const { error } = await supabase.rpc('email_desvincular_oauth', { p_account: accountId })
  if (error) throw new Error(`No se pudo desconectar la casilla: ${error.message}`)
}
