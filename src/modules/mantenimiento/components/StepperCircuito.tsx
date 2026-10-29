import { Fragment } from 'react'
import { cx } from '@/utils/cx'
import { ETAPAS } from '../lib/estados'
import type { EtapaOrden } from '../types'
import styles from './StepperCircuito.module.css'

export interface StepperCircuitoProps {
  /** La etapa actual, resaltada. Al crear una orden es siempre `diagnosis`. */
  actual?: EtapaOrden
}

/**
 * La trazabilidad del circuito (Fase 220), como el stepper del app FEIN AccuTec:
 * Diagnóstico → Cotización → Reparación → Torque → Cierre, numerados, con la
 * etapa actual resaltada y las anteriores marcadas como hechas.
 *
 * Es sólo informativo: muestra el recorrido que va a tener la orden. Al crear
 * una orden va con `actual='diagnosis'` (todo lo demás, por delante); en la
 * ficha, el circuito que SÍ se opera está en `PanelEtapas`.
 *
 * Compacto a propósito (Fase 221): una sola línea de número + etiqueta por
 * paso, unidos por un conector que crece. Ocupa la mitad de alto que la versión
 * en columnas y no deja aire muerto entre los círculos.
 */
export function StepperCircuito({ actual = 'diagnosis' }: StepperCircuitoProps) {
  const indiceActual = ETAPAS.findIndex((e) => e.valor === actual)

  return (
    <ol className={styles.circuito} aria-label="Etapas del servicio">
      {ETAPAS.map((e, i) => {
        const estado = i < indiceActual ? 'hecho' : i === indiceActual ? 'actual' : 'pendiente'
        return (
          <Fragment key={e.valor}>
            {i > 0 ? (
              <li
                className={cx(styles.conector, i <= indiceActual && styles.conectorHecho)}
                aria-hidden="true"
              />
            ) : null}
            <li
              className={cx(
                styles.paso,
                estado === 'actual' && styles.actual,
                estado === 'hecho' && styles.hecho,
              )}
              aria-current={estado === 'actual' ? 'step' : undefined}
            >
              <span className={styles.num} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.etiqueta}>{e.etiqueta}</span>
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
