import { useId, useState } from 'react'
import { ETIQUETA_TIPO, etiquetaMesCorta, etiquetaMesLarga, formatearImporte } from '../lib/actividad'
import type { Moneda, SerieActividad, TipoActividad } from '../types'
import styles from './Informes.module.css'

interface Props {
  series: SerieActividad[]
}

/**
 * Los últimos 12 meses de un tipo de documento, en UNA moneda a la vez: cada
 * moneda tiene su propia escala. Las barras son decorativas; los números
 * están escritos al lado de cada una, así se leen en un teléfono y con lector
 * de pantalla.
 */
export function SerieMensual({ series }: Props) {
  const [tipo, setTipo] = useState<TipoActividad>('entregas')
  const serie = series.find((s) => s.tipo === tipo) ?? series[0]
  const [monedaElegida, setMoneda] = useState<Moneda | null>(null)
  const idTitulo = useId()
  if (!serie) return null

  const moneda = monedaElegida && serie.monedas.includes(monedaElegida) ? monedaElegida : serie.monedas[0] ?? null
  const valores = moneda ? serie.meses.map((m) => m.porMoneda[moneda]?.importe ?? 0) : []
  const maximo = Math.max(0, ...valores)
  const { titulo, documento } = ETIQUETA_TIPO[tipo]

  return (
    <section className={styles.panel} aria-labelledby={idTitulo}>
      <header className={styles.panelCabecera}>
        <h2 id={idTitulo} className={styles.panelTitulo}>Últimos 12 meses</h2>
        <div className={styles.controles}>
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Documento</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoActividad)} className={styles.select}>
              {series.map((s) => (
                <option key={s.tipo} value={s.tipo}>{ETIQUETA_TIPO[s.tipo].titulo}</option>
              ))}
            </select>
          </label>
          {serie.monedas.length > 0 ? (
            <div className={styles.monedas} role="group" aria-label="Moneda">
              {serie.monedas.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={m === moneda ? styles.chipActivo : styles.chip}
                  aria-pressed={m === moneda}
                  onClick={() => setMoneda(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {!moneda ? (
        <p className={styles.vacio}>Sin {documento[1]} en los últimos 12 meses.</p>
      ) : (
        <ol className={styles.barras} aria-label={`${titulo} por mes, en ${moneda}`}>
          {serie.meses.map((m) => {
            const c = m.porMoneda[moneda] ?? { documentos: 0, importe: 0, enRevision: 0 }
            const ancho = maximo > 0 ? Math.max(c.importe > 0 ? 1.5 : 0, (c.importe / maximo) * 100) : 0
            return (
              <li key={m.mes} className={styles.barraFila}>
                <span className={styles.barraMes} title={etiquetaMesLarga(m.mes)}>{etiquetaMesCorta(m.mes)}</span>
                <span className={styles.barraPista} aria-hidden="true">
                  <span className={styles.barraRelleno} style={{ width: `${ancho}%` }} />
                </span>
                <span className={styles.barraValor}>
                  <span className={styles.importe}>{moneda} {formatearImporte(c.importe)}</span>
                  <span className={styles.docs}>
                    {c.documentos} {c.documentos === 1 ? documento[0] : documento[1]}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
