import { useId } from 'react'
import { ETIQUETA_CATEGORIA, formatearTasa } from '../lib/pipeline'
import {
  CATEGORIAS_DETERMINABLES,
  CATEGORIAS_NO_DETERMINABLES,
  PERIODOS_COHORTE,
  type PeriodoCohorte,
  type PipelineComercial,
} from '../types'
import styles from './Informes.module.css'

interface Props {
  pipeline: PipelineComercial
  etiquetas: Record<PeriodoCohorte, string>
}

/**
 * Cumplimiento de pedidos confirmados contra remitos reales, por categoría.
 *
 * Los casos sin evidencia (Stage 2.5) se cuentan aparte y NO entran al
 * porcentaje: tratarlos como «0 % entregado» afirmaría algo que el dato no
 * prueba.
 */
export function CumplimientoPedidos({ pipeline, etiquetas }: Props) {
  const idTitulo = useId()
  const sinLineas = PERIODOS_COHORTE.some((p) => pipeline.cumplimiento[p].porCategoria.sin_lineas > 0)
  const noDeterminables = CATEGORIAS_NO_DETERMINABLES.filter((c) => c !== 'sin_lineas' || sinLineas)

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Cumplimiento de pedidos</h2>
        <p className={styles.nota}>
          Pedidos <b>confirmados con fecha en el período</b>, según lo entregado <b>hoy</b> en remitos confirmados, línea
          por línea.
        </p>
      </header>

      <div className={`${styles.tarjeta} ${styles.tarjetaPeriodos}`}>
        <div className={styles.tablaScroll}>
          <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
            <caption className={styles.oculto}>Pedidos por estado de cumplimiento y período</caption>
            <thead>
              <tr>
                <th scope="col">Estado</th>
                {PERIODOS_COHORTE.map((p) => (
                  <th key={p} scope="col" className={styles.num}>{etiquetas[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className={styles.filaGrupo}>
                <th scope="rowgroup" colSpan={4}>Con evidencia</th>
              </tr>
              {CATEGORIAS_DETERMINABLES.map((c) => (
                <tr key={c}>
                  <th scope="row" className={styles.categoria}>
                    {ETIQUETA_CATEGORIA[c].titulo}
                    <span className={styles.docs}>{ETIQUETA_CATEGORIA[c].detalle}</span>
                  </th>
                  {PERIODOS_COHORTE.map((p) => (
                    <td key={p} className={styles.num} data-etiqueta={etiquetas[p]}>
                      <span className={styles.importe}>{pipeline.cumplimiento[p].porCategoria[c]}</span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr className={styles.filaTotal}>
                <th scope="row" className={styles.categoria}>
                  Completos sobre los que tienen evidencia
                  <span className={styles.docs}>completos y sobreentregados</span>
                </th>
                {PERIODOS_COHORTE.map((p) => {
                  const c = pipeline.cumplimiento[p]
                  return (
                    <td key={p} className={styles.num} data-etiqueta={etiquetas[p]}>
                      <span className={styles.importe}>{formatearTasa(c.tasaCompletos)}</span>
                      <span className={styles.docs}>
                        {c.porCategoria.completo + c.porCategoria.sobreentregado} de {c.determinables}
                      </span>
                    </td>
                  )
                })}
              </tr>
            </tbody>
            <tbody>
              <tr className={styles.filaGrupo}>
                <th scope="rowgroup" colSpan={4}>Sin evidencia · no determinable</th>
              </tr>
              {noDeterminables.map((c) => (
                <tr key={c} className={styles.filaSinMoneda}>
                  <th scope="row" className={styles.categoria}>
                    {ETIQUETA_CATEGORIA[c].titulo}
                    <span className={styles.docs}>{ETIQUETA_CATEGORIA[c].detalle}</span>
                  </th>
                  {PERIODOS_COHORTE.map((p) => (
                    <td key={p} className={styles.num} data-etiqueta={etiquetas[p]}>
                      <span className={styles.importe}>{pipeline.cumplimiento[p].porCategoria[c]}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.nota}>
          Sin porcentaje por unidades: sumaría unidades de productos distintos, y en el histórico una sola línea es casi
          todo lo pedido.
        </p>
      </div>
    </section>
  )
}
