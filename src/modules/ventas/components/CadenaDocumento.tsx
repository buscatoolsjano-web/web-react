import { Link } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { RUTA_DE } from '../types'
import { PASOS_CADENA, type CadenaDocumento as Cadena, type PasoCadena } from '../lib/cadena'
import styles from './CadenaDocumento.module.css'

const ETIQUETA: Record<PasoCadena, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Entrega',
  factura: 'Factura',
}

/** Factura todavía no tiene pantalla propia, así que tampoco tiene ruta. */
const RUTA: Record<PasoCadena, string | null> = {
  cotizacion: RUTA_DE.cotizacion,
  pedido: RUTA_DE.pedido,
  entrega: RUTA_DE.entrega,
  factura: null,
}

export interface CadenaDocumentoProps {
  cadena: Cadena
  /** En qué paso está parado el usuario ahora. */
  actual: PasoCadena
  /**
   * Qué puede generar la pantalla, y cómo.
   *
   * Lo pone la página y no este componente a propósito: crear un pedido o un
   * remito tiene sus confirmaciones —el remito abre el modal de cantidades—,
   * y esa lógica ya vive en las páginas de detalle. Acá sólo se dibuja el
   * botón y se avisa; duplicarla sería tener dos caminos para lo mismo, y uno
   * de los dos se iba a quedar viejo.
   */
  generar?: Partial<Record<PasoCadena, { onGenerar: () => void; cargando?: boolean; motivo?: string }>>
}

/**
 * La cadena del documento: cotización → pedido → entrega → factura (Fase 29 · E6).
 *
 * Reemplaza tener que adivinar en qué punto del circuito está una venta. El
 * paso donde estás parado va marcado; los que ya existen son enlaces; el
 * siguiente, si se puede, tiene el botón para generarlo.
 *
 * Va en pantalla y NO en la hoja: es una herramienta de trabajo, no parte del
 * documento que se le manda al cliente.
 */
export function CadenaDocumento({ cadena, actual, generar }: CadenaDocumentoProps) {
  return (
    <nav className={styles.cadena} aria-label="Circuito de la venta">
      <ol className={styles.pasos}>
        {PASOS_CADENA.map((paso, i) => {
          const eslabon = cadena[paso]
          const esActual = paso === actual
          const accion = generar?.[paso]
          const ruta = RUTA[paso]

          return (
            <li key={paso} className={styles.paso}>
              {i > 0 && <span className={cx(styles.union, eslabon && styles.unionHecha)} aria-hidden="true" />}

              <div
                className={cx(
                  styles.caja,
                  eslabon && styles.cajaHecha,
                  esActual && styles.cajaActual,
                  !eslabon && !accion && styles.cajaPendiente,
                )}
                aria-current={esActual ? 'step' : undefined}
              >
                <span className={styles.etiqueta}>{ETIQUETA[paso]}</span>

                {eslabon ? (
                  <>
                    {/* El paso actual no se enlaza a sí mismo: sería un enlace
                        a la página en la que ya estás. */}
                    {esActual || !ruta ? (
                      <span className={styles.numero}>{eslabon.numero}</span>
                    ) : (
                      <Link to={`${ruta}/${eslabon.id}`} className={styles.numeroEnlace}>
                        {eslabon.numero}
                      </Link>
                    )}
                    {eslabon.cuantos > 1 && (
                      <span className={styles.varios}>y {eslabon.cuantos - 1} más</span>
                    )}
                  </>
                ) : accion ? (
                  <button
                    type="button"
                    className={styles.generar}
                    onClick={accion.onGenerar}
                    disabled={accion.cargando === true || accion.motivo !== undefined}
                    title={accion.motivo}
                  >
                    <Icon name="plus" size={16} />
                    {accion.cargando === true ? 'Generando…' : 'Generar'}
                  </button>
                ) : (
                  <span className={styles.sinDocumento}>—</span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
