import { useId } from 'react'
import { formatearImporte } from '../lib/actividad'
import { ticketsPorMoneda } from '../lib/pipeline'
import { PERIODOS_COHORTE, SIN_MONEDA, type ActividadComercial, type PeriodoCohorte } from '../types'
import styles from './Informes.module.css'

interface Props {
  actividad: ActividadComercial
  etiquetas: Record<PeriodoCohorte, string>
}

const TIPOS = [
  { tipo: 'pedidos', titulo: 'Pedido confirmado', documento: ['pedido', 'pedidos'] },
  { tipo: 'entregas', titulo: 'Entregado', documento: ['remito', 'remitos'] },
] as const

/**
 * Ticket promedio = Σ total / cantidad de documentos, por moneda. Nunca un
 * promedio que mezcle monedas.
 */
export function TicketPromedio({ actividad, etiquetas }: Props) {
  const idTitulo = useId()

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Ticket promedio</h2>
        <p className={styles.nota}>Total del documento (con impuestos) dividido la cantidad de documentos, en cada moneda.</p>
      </header>

      <div className={styles.tarjetas}>
        {TIPOS.map(({ tipo, titulo, documento }) => {
          const filas = ticketsPorMoneda(actividad, tipo)
          return (
            <article key={tipo} className={`${styles.tarjeta} ${styles.tarjetaPeriodos}`} aria-labelledby={`${idTitulo}-${tipo}`}>
              <h3 id={`${idTitulo}-${tipo}`} className={styles.tarjetaTitulo}>{titulo}</h3>
              {filas.length === 0 ? (
                <p className={styles.vacio}>Sin {documento[1]} en los últimos 12 meses.</p>
              ) : (
                <div className={styles.tablaScroll}>
                  <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
                    <caption className={styles.oculto}>Ticket promedio de {titulo.toLowerCase()} por moneda</caption>
                    <thead>
                      <tr>
                        <th scope="col">Moneda</th>
                        {PERIODOS_COHORTE.map((p) => (
                          <th key={p} scope="col" className={styles.num}>{etiquetas[p]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f) => (
                        <tr key={f.moneda} className={f.moneda === SIN_MONEDA ? styles.filaSinMoneda : undefined}>
                          <th scope="row" className={styles.moneda}>{f.moneda}</th>
                          {PERIODOS_COHORTE.map((p) => {
                            const c = f.porPeriodo[p]
                            return (
                              <td key={p} className={styles.num} data-etiqueta={etiquetas[p]}>
                                <span className={styles.importe}>{c.promedio === null ? '—' : formatearImporte(c.promedio)}</span>
                                <span className={styles.docs}>{c.documentos} {c.documentos === 1 ? documento[0] : documento[1]}</span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
