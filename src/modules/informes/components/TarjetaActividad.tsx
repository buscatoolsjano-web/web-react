import { ETIQUETA_TIPO, formatearImporte, formatearVariacion } from '../lib/actividad'
import { SIN_MONEDA, type KpiActividad } from '../types'
import styles from './Informes.module.css'

interface Props {
  kpi: KpiActividad
  etiquetaActual: string
  etiquetaAnterior: string
}

const plural = (n: number, [uno, varios]: [string, string]) => `${n} ${n === 1 ? uno : varios}`

/**
 * Una tarjeta por tipo de documento: el importe de cada moneda por separado,
 * contra el mismo tramo del período anterior. No hay un «total»: sumar ARS con
 * USD sería inventar un número.
 */
export function TarjetaActividad({ kpi, etiquetaActual, etiquetaAnterior }: Props) {
  const { titulo, documento } = ETIQUETA_TIPO[kpi.tipo]
  const idTitulo = `kpi-${kpi.tipo}`
  return (
    <section className={styles.tarjeta} aria-labelledby={idTitulo}>
      <header className={styles.tarjetaCabecera}>
        <h2 id={idTitulo} className={styles.tarjetaTitulo}>{titulo}</h2>
        <p className={styles.tarjetaSub}>
          {plural(kpi.documentosActual, documento)} · {etiquetaActual}
        </p>
      </header>

      {kpi.monedas.length === 0 ? (
        <p className={styles.vacio}>Sin documentos en {etiquetaActual} ni en {etiquetaAnterior}.</p>
      ) : (
        <div className={styles.tablaScroll}>
          <table className={styles.tablaKpi}>
            <caption className={styles.oculto}>{titulo} por moneda, {etiquetaActual} contra {etiquetaAnterior}</caption>
            <thead>
              <tr>
                <th scope="col">Moneda</th>
                <th scope="col" className={styles.num}>{etiquetaActual}</th>
                <th scope="col" className={styles.num}>{etiquetaAnterior}</th>
                <th scope="col" className={styles.num}>Variación</th>
              </tr>
            </thead>
            <tbody>
              {kpi.monedas.map((m) => {
                const sinMoneda = m.moneda === SIN_MONEDA
                const sube = m.variacion !== null && m.variacion > 0.05
                const baja = m.variacion !== null && m.variacion < -0.05
                return (
                  <tr key={m.moneda} className={sinMoneda ? styles.filaSinMoneda : undefined}>
                    <th scope="row" className={styles.moneda}>{m.moneda}</th>
                    <td className={styles.num} data-etiqueta={etiquetaActual}>
                      <span className={styles.importe}>{formatearImporte(m.actual.importe)}</span>
                      <span className={styles.docs}>{plural(m.actual.documentos, documento)}</span>
                    </td>
                    <td className={styles.num} data-etiqueta={etiquetaAnterior}>
                      <span className={styles.importeSecundario}>{formatearImporte(m.anterior.importe)}</span>
                      <span className={styles.docs}>{plural(m.anterior.documentos, documento)}</span>
                    </td>
                    <td
                      className={`${styles.num} ${sube ? styles.sube : baja ? styles.baja : styles.neutro}`}
                      data-etiqueta="Variación"
                    >
                      {formatearVariacion(m.variacion)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
