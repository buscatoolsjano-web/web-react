import type { Borrador } from './borrador'

/**
 * El alta de un documento a medio armar, guardada en el navegador.
 *
 * Armar una cotización suele obligar a ir a crear algo que falta (una
 * categoría, un proveedor) en otra pestaña o a recargar; antes eso tiraba todo
 * lo escrito. Se guarda en `localStorage`, por empresa y por tipo, y se borra
 * al crear el documento o al descartarlo. Es una comodidad de este navegador:
 * si el almacenamiento no está (modo privado, bloqueado), no pasa nada.
 */

export type TipoAlta = 'cotizacion' | 'pedido'

interface Guardado {
  version: 1
  guardadoEn: string
  borrador: Borrador
}

/** Más viejo que esto ya no se ofrece: es un borrador abandonado. */
const VIGENCIA_MS = 7 * 24 * 60 * 60_000

const clave = (companyId: string, tipo: TipoAlta) => `erp:alta-en-curso:${companyId}:${tipo}`

export function leerBorradorGuardado(
  companyId: string | null,
  tipo: TipoAlta,
  ahora: number = Date.now(),
): { borrador: Borrador; guardadoEn: string } | null {
  if (!companyId) return null
  try {
    const crudo = window.localStorage.getItem(clave(companyId, tipo))
    if (!crudo) return null
    const g = JSON.parse(crudo) as Guardado
    if (g?.version !== 1 || !g.borrador?.cabecera || !Array.isArray(g.borrador.lineas)) return null
    if (ahora - new Date(g.guardadoEn).getTime() > VIGENCIA_MS) return null
    return { borrador: g.borrador, guardadoEn: g.guardadoEn }
  } catch {
    return null
  }
}

export function guardarBorrador(companyId: string | null, tipo: TipoAlta, borrador: Borrador): void {
  if (!companyId) return
  try {
    const g: Guardado = { version: 1, guardadoEn: new Date().toISOString(), borrador }
    window.localStorage.setItem(clave(companyId, tipo), JSON.stringify(g))
  } catch {
    // Sin almacenamiento: el alta sigue andando, sólo no se recupera.
  }
}

export function borrarBorradorGuardado(companyId: string | null, tipo: TipoAlta): void {
  if (!companyId) return
  try {
    window.localStorage.removeItem(clave(companyId, tipo))
  } catch {
    // Idem.
  }
}
