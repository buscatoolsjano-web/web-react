import { useId } from 'react'
import { formatearImporte } from '../lib/actividad'
import { formatearTasa } from '../lib/pipeline'
import { PERIODOS_COHORTE, SIN_MONEDA, type ConversionFila, type PeriodoCohorte, type PipelineComercial } from '../types'
import styles from './Informes.module.css'

interface Props {
  pipeline: PipelineComercial
  etiquetas: Record<PeriodoCohorte, string>
}

/**
 * Conversión real: cotizaciones que tienen un pedido confirmado enlazado
 * (`sales_orders.quote_id`), sobre las emitidas en el período. Siempre con el
 * denominador escrito: «132 de 288», no sólo «46 %».
 */
export function ConversionCotizaciones({ pipeline, etiquetas }: Props) {
  const idTitulo = useId()
  const monedas = [...new Set(PERIODOS_COHORTE.flatMap((p) => pipeline.conversion[p].monedas.map((m) => m.moneda)))]
  const orden = pipeline.conversion['12m'].monedas.map((m) => m.moneda)
  monedas.sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
  const doce = pipeline.conversion['12m'].todas

  const celda = (f: ConversionFila | undefined, esTodas: boolean, periodo: PeriodoCohorte) => {
    const c = f ?? { elegibles: 0, convertidas: 0, abiertas: 0, tasa: null, importeElegible: 0, importeConvertido: 0 }
    return (
      <td key={periodo} className={styles.num} data-etiqueta={etiquetas[periodo]}>
        <span className={styles.importe}>
          {c.convertidas} de {c.elegibles} · {formatearTasa(c.tasa)}
        </span>
        <span className={styles.docs}>{c.abiertas} {c.abiertas === 1 ? 'abierta' : 'abiertas'}</span>
        {!esTodas && c.elegibles > 0 ? (
          <span className={styles.docs}>
            {formatearImporte(c.importeConvertido ?? 0)} de {formatearImporte(c.importeElegible ?? 0)}
          </span>
        ) : null}
      </td>
    )
  }

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Conversión cotización → pedido</h2>
        <p className={styles.nota}>
          <b>Cotizaciones emitidas en el período que generaron un pedido confirmado</b> (por el vínculo del pedido, no por el
          estado «aceptada»). Las abiertas todavía pueden convertirse.
        </p>
      </header>

      <div className={`${styles.tarjeta} ${styles.tarjetaPeriodos}`}>
        <div className={styles.tablaScroll}>
          <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
            <caption className={styles.oculto}>Conversión por moneda de la cotización</caption>
            <thead>
              <tr>
                <th scope="col">Moneda</th>
                {PERIODOS_COHORTE.map((p) => (
                  <th key={p} scope="col" className={styles.num}>{etiquetas[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className={styles.filaTotal}>
                <th scope="row" className={styles.moneda}>Todas <span className={styles.docs}>(sólo cantidades)</span></th>
                {PERIODOS_COHORTE.map((p) => celda(pipeline.conversion[p].todas, true, p))}
              </tr>
              {monedas.map((m) => (
                <tr key={m} className={m === SIN_MONEDA ? styles.filaSinMoneda : undefined}>
                  <th scope="row" className={styles.moneda}>{m}</th>
                  {PERIODOS_COHORTE.map((p) => celda(pipeline.conversion[p].monedas.find((x) => x.moneda === m), false, p))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.nota}>
          En {etiquetas['12m']}: {doce.aceptadas} con estado «aceptada» y {doce.convertidas} con pedido. El importe es el
          de la cotización, en su moneda.
        </p>
        {pipeline.inconsistencias.monedaDistinta > 0 || pipeline.inconsistencias.convertidaDesdeBorrador > 0 ? (
          <p className={styles.notaAviso} role="status">
            {pipeline.inconsistencias.monedaDistinta > 0
              ? `${pipeline.inconsistencias.monedaDistinta} ${pipeline.inconsistencias.monedaDistinta === 1 ? 'conversión tiene' : 'conversiones tienen'} un pedido en otra moneda que su cotización: cuenta en la moneda de la cotización, sin convertir. `
              : ''}
            {pipeline.inconsistencias.convertidaDesdeBorrador > 0
              ? `${pipeline.inconsistencias.convertidaDesdeBorrador} pedido(s) salieron de una cotización en borrador: no entran al denominador.`
              : ''}
          </p>
        ) : null}
      </div>
    </section>
  )
}
