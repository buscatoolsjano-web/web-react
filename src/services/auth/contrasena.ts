/**
 * Reglas de la contraseña nueva, del lado del navegador. Son una ayuda: la
 * política real la aplica Supabase Auth y su error se traduce igual.
 *
 * 72 bytes es el tope de bcrypt; más larga, lo que sobra se ignora.
 */
export const LARGO_MINIMO = 8
export const LARGO_MAXIMO = 72

export function validarContrasenaNueva(contrasena: string, confirmacion: string): string | null {
  if (contrasena.length < LARGO_MINIMO) return `Usá al menos ${LARGO_MINIMO} caracteres.`
  if (new TextEncoder().encode(contrasena).length > LARGO_MAXIMO) return `Usá como máximo ${LARGO_MAXIMO} caracteres.`
  if (contrasena.trim() !== contrasena) return 'La contraseña no puede empezar ni terminar con espacios.'
  if (contrasena !== confirmacion) return 'Las dos contraseñas no coinciden.'
  return null
}

/** Error de `updateUser({ password })` en palabras. Nunca el texto crudo. */
export function traducirErrorContrasena(e: { code?: string | undefined; name?: string | undefined; message?: string | undefined; status?: number | undefined }): string {
  const code = e.code ?? ''
  const msg = (e.message ?? '').toLowerCase()
  if (code === 'weak_password' || msg.includes('weak'))
    return 'La contraseña es demasiado débil. Usá una más larga, combinando letras, números y símbolos.'
  if (code === 'same_password' || msg.includes('different from the old'))
    return 'La contraseña nueva tiene que ser distinta de la anterior.'
  if (e.name === 'AuthSessionMissingError' || code === 'session_not_found' || code === 'session_expired' || e.status === 401 || msg.includes('session'))
    return 'El enlace venció o ya se usó. Pedí uno nuevo.'
  if (e.status === 429 || msg.includes('rate limit')) return 'Demasiados intentos. Esperá unos minutos.'
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'No se pudo contactar al servidor. Revisá la conexión.'
  return 'No se pudo guardar la contraseña. Intentá de nuevo.'
}
