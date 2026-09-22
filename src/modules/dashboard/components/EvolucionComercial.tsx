import { useId, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { formatearImporte } from '@/modules/ventas/lib/formato'
import type { ActividadComercial, Moneda, TipoActividad } from '@/modules/informes/types'
import { ETIQUETA_SERIE, mesLargo, monedaPorDefecto, serieDeMoneda } from '../lib/panel'
import styles from './Evolucion.module.css'

export interface EvolucionComercialProps {
  actividad: ActividadComercial | undefined
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

const TIPOS: readonly TipoActividad[] = ['cotizaciones', 'pedidos', 'entregas']

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const etiquetaCorta = (iso: string) => MES_CORTO[Number(iso.split('-')[1]) - 1] ?? ''

/**
 * Doce meses, UNA métrica y UNA moneda (Fase 21 · E2).
 *
 * SVG a mano, doce barras: traer una librería de gráficos suma cientos de kB
 * para resolver lo fácil. Lo difícil no es dibujar, es no mezclar: **nunca hay
 * dos monedas en el mismo gráfico**, porque una barra que sume ARS con USD no
 * es más alta, es falsa.
 *
 * El color se gasta una sola vez, en el mes en curso. Doce barras de colores
 * serían un semáforo del que no se lee nada.
 *
 * Y los números se pueden consultar: la escala está escrita y «Ver los
 * números» abre la tabla, que además es la alternativa accesible al SVG.
 */
export function EvolucionComercial({ actividad, cargando, error, onReintentar }: EvolucionComercialProps) {
  const id = useId()
  const [tipo, setTipo] = useState<TipoActividad>('cotizaciones')
  const [monedaElegida, setMonedaElegida] = useState<Moneda | null | undefined>(undefined)
  const [verNumeros, setVerNumeros] = useState(false)

  const serie = actividad?.series.find((s) => s.tipo === tipo)
  const monedas = serie?.monedas ?? []
  const moneda = monedaElegida === undefined ? monedaPorDefecto(serie) : monedaElegida
  const etiqueta = ETIQUETA_SERIE[tipo]
  const puntos = serieDeMoneda(serie, moneda)
  const maximo = Math.max(...puntos.map((p) => p.importe), 0)
  const ultimo = puntos.length - 1

  const detalle = (i: number) => {
    const p = puntos[i]
    if (!p) return ''
    if (p.documentos === 0) return `${mesLargo(p.mes)} · sin movimientos`
    return `${mesLargo(p.mes)} · ${formatearImporte(p.importe, moneda)} · ${p.documentos} ${p.documentos === 1 ? etiqueta.singular : etiqueta.plural}`
  }

  const ANCHO = 720
  const ALTO = 190
  const PIE = 26
  const util = ALTO - PIE
  const paso = puntos.length > 0 ? ANCHO / puntos.length : ANCHO
  const ancho = Math.min(paso - 10, 34)

  return (
    <section className={styles.bloque} aria-labelledby={`${id}-t`}>
      <div className={styles.cabecera}>
        <h2 id={`${id}-t`} className={styles.titulo}>
          Evolución · últimos 12 meses
        </h2>
        <div className={styles.controles}>
          <div className={styles.grupo} role="group" aria-label="Qué se mira">
            {TIPOS.map((t) => (
              <button
                key={t}
                type="button"
                className={t === tipo ? styles.chipActivo : styles.chip}
                aria-pressed={t === tipo}
                onClick={() => {
                  setTipo(t)
                  // La moneda vuelve a elegirse sola: la que más documentos
                  // tiene en cotizado puede no tener ninguno en entregado.
                  setMonedaElegida(undefined)
                }}
              >
                {ETIQUETA_SERIE[t].titulo}
              </button>
            ))}
          </div>
          {monedas.length > 1 ? (
            <label className={styles.selector}>
              <span className={styles.selectorLabel}>Moneda</span>
              <select className={styles.select} value={moneda ?? ''} onChange={(e) => setMonedaElegida(e.target.value || null)}>
                {monedas.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {cargando ? (
        <SkeletonRows rows={3} columns={4} label="Cargando la evolución…" />
      ) : error ? (
        <ErrorState compact title="No se pudo leer la evolución." onRetry={onReintentar} />
      ) : puntos.length === 0 || maximo === 0 ? (
        <p className={styles.vacio}>
          Sin {etiqueta.plural} {moneda ? `en ${moneda} ` : ''}en los últimos 12 meses.
        </p>
      ) : (
        <>
          <p className={styles.escala} id={`${id}-esc`}>
            {etiqueta.titulo} en {moneda} · escala 0 — {formatearImporte(maximo, moneda)}
          </p>
          <svg className={styles.grafico} viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-labelledby={`${id}-esc`} preserveAspectRatio="none">
            <line x1="0" y1={util} x2={ANCHO} y2={util} className={styles.eje} />
            {puntos.map((p, i) => {
              const alto = (p.importe / maximo) * (util - 10)
              return (
                <g key={p.mes}>
                  <rect x={i * paso} y={0} width={paso} height={util} className={styles.zona}>
                    <title>{detalle(i)}</title>
                  </rect>
                  {p.importe > 0 ? (
                    <rect
                      x={i * paso + (paso - ancho) / 2}
                      y={util - Math.max(alto, 2)}
                      width={ancho}
                      height={Math.max(alto, 2)}
                      rx="2"
                      className={i === ultimo ? styles.barraActual : styles.barra}
                    />
                  ) : null}
                  <text x={i * paso + paso / 2} y={ALTO - 8} textAnchor="middle" className={styles.mes}>
                    {etiquetaCorta(p.mes)}
                  </text>
                </g>
              )
            })}
          </svg>

          <button type="button" className={styles.verNumeros} onClick={() => setVerNumeros((v) => !v)} aria-expanded={verNumeros}>
            {verNumeros ? 'Ocultar los números' : 'Ver los números'}
          </button>
          {verNumeros ? (
            <table className={styles.tabla}>
              <caption className="sr-only">
                {etiqueta.titulo} por mes en {moneda}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Mes</th>
                  <th scope="col">Importe</th>
                  <th scope="col">Documentos</th>
                </tr>
              </thead>
              <tbody>
                {puntos.map((p) => (
                  <tr key={p.mes}>
                    <th scope="row">{mesLargo(p.mes)}</th>
                    <td>{p.documentos === 0 ? '—' : formatearImporte(p.importe, moneda)}</td>
                    <td>{p.documentos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  )
}
