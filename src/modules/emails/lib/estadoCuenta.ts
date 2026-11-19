/**
 * ¿La cuenta perdió el acceso a Gmail?
 *
 * Cuando Google revoca o vence el permiso, el refresco del token devuelve
 * `invalid_grant` (o `unauthorized_client`) y ya no se puede ni sincronizar ni
 * mandar nada hasta reconectarla. Es distinto de un error pasajero de
 * sincronización, que se recupera solo: éste no se arregla sin que alguien
 * vuelva a dar el permiso. Torquetools estuvo así desde el 2 de noviembre sin
 * que nadie se enterara, con la cuenta marcada como activa.
 */
export function perdioElAcceso(errorSync: string | null | undefined): boolean {
  if (!errorSync) return false
  return /invalid_grant|unauthorized_client|invalid_client|token has been (expired|revoked)|revoked/i.test(errorSync)
}
