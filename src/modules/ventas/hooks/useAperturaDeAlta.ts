import { DOC_TYPE_DE } from '../lib/autoridad'
import type { TipoDocumento } from '../types'
import { useAutoridadNumeracion } from './useAutoridadNumeracion'
import { useSeries } from './useDocumentos'

/**
 * Los tipos cuya pantalla de alta sabe elegir serie.
 *
 * Abrir el alta de un tipo que NO tiene selector sería llevar a alguien a un
 * formulario que nunca va a poder guardar: ahí la autoridad general sigue
 * siendo la puerta.
 *
 * El alta de pedidos ganó su selector en la Fase 19 · E4. El remito no: no
 * tiene serie del ERP ni selector, así que sigue afuera.
 */
const ALTA_CON_SELECTOR: TipoDocumento[] = ['cotizacion', 'pedido']

export interface AperturaDeAlta {
  /** Se puede ABRIR el formulario: navegar hasta él no emite nada. */
  abierta: boolean
  /** Todavía no se sabe: la acción se muestra deshabilitada y sin motivo. */
  cargando: boolean
}

/**
 * ¿Se puede abrir el alta de este tipo de documento?
 *
 * Fase 19 · E3. La autoridad decide si se puede **crear**, no si se puede
 * **abrir el formulario**. Desde que existe una serie que el ERP numera
 * —`COT-ERP`—, cerrar la puerta con la autoridad general del tipo esconde un
 * camino que funciona: adentro la serie por defecto (`COTI`) sigue dejando
 * «Crear» bloqueado con su explicación, y sólo elegir a propósito una serie
 * del ERP habilita.
 *
 * Si NINGUNA serie del tipo la numera el ERP, no hay nada que elegir y la
 * puerta sigue cerrada: es el caso de pedidos y remitos hoy.
 */
export function useAperturaDeAlta(tipo: TipoDocumento, habilitado: boolean): AperturaDeAlta {
  const autoridad = useAutoridadNumeracion()
  const conSelector = ALTA_CON_SELECTOR.includes(tipo)
  const series = useSeries(tipo, habilitado && conSelector)

  // Sin bloqueo general no hay nada que averiguar: se abre como siempre.
  if (!autoridad.stel(DOC_TYPE_DE[tipo])) return { abierta: true, cargando: autoridad.cargando }
  if (!conSelector) return { abierta: false, cargando: autoridad.cargando }

  const hayErp = (series.data ?? []).some((s) => s.autoridad === 'ERP')
  return { abierta: hayErp, cargando: autoridad.cargando || (habilitado && series.isPending) }
}
