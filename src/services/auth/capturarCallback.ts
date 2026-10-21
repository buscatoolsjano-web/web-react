import { leerCallbackAuth, RUTA_DEFINIR_CONTRASENA, type CallbackAuth } from './callbackUrl'

/**
 * Se ejecuta al importarse, y `main.tsx` lo importa PRIMERO: antes que el
 * cliente de Supabase y antes que el router.
 *
 * Si la URL trae un callback de Auth:
 *   1. lo guarda en MEMORIA (nunca en localStorage ni sessionStorage);
 *   2. reemplaza la URL por la ruta de «definir contraseña», sin tokens, con
 *      replaceState: el token no queda en el historial ni en la barra.
 *
 * No importa el cliente de Supabase a propósito.
 */
let pendiente: CallbackAuth | null = null

if (typeof window !== 'undefined') {
  const cb = leerCallbackAuth(window.location.href)
  if (cb) {
    pendiente = cb
    // La ruta va en el PATH, no en el hash: desde la Fase 88 el router es de
    // browser. El token venía en el fragmento (`#access_token=…`); al poner
    // acá el path sin hash, el fragmento con el token desaparece de la barra
    // y del historial, que es justo lo que se busca.
    window.history.replaceState(null, '', RUTA_DEFINIR_CONTRASENA)
  }
}

export function callbackPendiente(): CallbackAuth | null {
  return pendiente
}

/** Se llama una vez procesado, para que el token no siga en memoria. */
export function olvidarCallback(): void {
  pendiente = null
}
