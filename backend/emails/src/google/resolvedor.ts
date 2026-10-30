/**
 * El callback de token de `ClienteGmailReal`, bifurcado por `auth_mode`.
 *
 * `ClienteGmailReal` pide el token con `(buzon) => Promise<string>` y no sabe
 * nada de cómo se obtiene. Acá se decide, por casilla:
 *   · `dwd`        → el proveedor de Domain-Wide Delegation (impersona el buzón).
 *   · `oauth_user` → el proveedor OAuth (cambia el refresh token de la casilla).
 *
 * Es la MISMA función para los dos servicios; lo que cambia es con qué se la
 * arma. En el privado, `refPorBuzon` sale de la base (service key) y `oauth`
 * lee el refresh de Vault; en el público, `refPorBuzon` sale del mapa que ceba
 * el autorizador y `oauth` le pide el token al servicio privado.
 *
 * `oauth.para` recibe el `accountId` y no el buzón: dos casillas de dos empresas
 * no comparten token aunque tuvieran la misma dirección.
 */

export interface RefCuenta {
  authMode: 'dwd' | 'oauth_user'
  accountId: string
}

export interface FuenteDwd {
  para(buzon: string): Promise<string>
}

export interface FuenteOAuth {
  para(accountId: string): Promise<string>
}

export function resolvedorDeToken(
  refPorBuzon: (buzon: string) => Promise<RefCuenta | null>,
  dwd: FuenteDwd,
  oauth: FuenteOAuth,
): (buzon: string) => Promise<string> {
  return async (buzon) => {
    const ref = await refPorBuzon(buzon)
    if (ref?.authMode === 'oauth_user') return oauth.para(ref.accountId)
    return dwd.para(buzon)
  }
}

/**
 * Cachea en memoria la resolución `buzon → RefCuenta` por un rato.
 *
 * El callback se invoca en CADA request a Gmail; sin esto, un sync con muchos
 * hilos haría una consulta a la base por cada llamada sólo para saber el
 * `auth_mode`, que casi nunca cambia. El token en sí lo cachea cada proveedor.
 */
export function cacheRef(
  cargar: (buzon: string) => Promise<RefCuenta | null>,
  ttlMs = 5 * 60_000,
  ahora: () => number = () => Date.now(),
): (buzon: string) => Promise<RefCuenta | null> {
  const cache = new Map<string, { ref: RefCuenta | null; vence: number }>()
  return async (buzon) => {
    const guardado = cache.get(buzon)
    if (guardado && guardado.vence > ahora()) return guardado.ref
    const ref = await cargar(buzon)
    cache.set(buzon, { ref, vence: ahora() + ttlMs })
    return ref
  }
}
