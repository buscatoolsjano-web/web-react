import { useId, useState } from 'react'
import {
  etiquetaDeMes,
  mesesHasta,
  monedasDe,
  serieDe,
  type Medida,
} from '../lib/actividad'
import { formatearImporte } from '../lib/formato'
import type { ActividadMensual, TipoDeDocumento } from '../types'
import styles from './GraficoActividad.module.css'

export interface GraficoActividadProps {
  filas: readonly ActividadMensual[]
  cargando: boolean
}

const TIPOS: { valor: TipoDeDocumento; etiqueta: string }[] = [
  { valor: 'cotizacion', etiqueta: 'Cotizado' },
  { valor: 'pedido', etiqueta: 'Pedido' },
  { valor: 'entrega', etiqueta: 'Entregado' },
]

const MEDIDAS: { valor: Medida; etiqueta: string }[] = [
  { valor: 'documentos', etiqueta: 'Documentos' },
  { valor: 'importe', etiqueta: 'Importe' },
]

/**
 * Actividad de los últimos doce meses.
 *
 * SVG a mano y sin librería: son doce barras. Traer una librería de gráficos
 * para esto sumaría cientos de kB al bundle de un módulo que ya carga por
 * separado.
 *
 * Lo importante no es el dibujo sino **qué dice que está mostrando**. El
 * gráfico del legacy era una sola serie de «ventas» que no aclaraba si eran
 * cotizaciones, pedidos o entregas, y sumaba las monedas. Acá se elige el tipo
 * de documento y la moneda, y el título dice las dos cosas.
 */
export function GraficoActividad({ filas, cargando }: GraficoActividadProps) {
  const id = useId()
  const [tipo, setTipo] = useState<TipoDeDocumento>('cotizacion')
  const [medida, setMedida] = useState<Medida>('documentos')

  const monedas = monedasDe(filas)
  const [moneda, setMoneda] = useState<string | null | undefined>(undefined)
  // La moneda por defecto es la que más documentos tiene. Se elige al primer
  // render con datos y después manda lo que la persona haya tocado.
  const monedaActiva = moneda === undefined ? (monedas[0] ?? null) : moneda

  if (cargando) return <p className={styles.nota}>Cargando la actividad…</p>
  if (filas.length === 0) {
    return <p className={styles.nota}>Sin documentos en los últimos doce meses.</p>
  }

  const meses = mesesHasta(new Date(), 12)
  const serie = serieDe(filas, { tipo, moneda: monedaActiva, medida, meses })
  const maximo = Math.max(...serie.map((p) => p.valor), 0)

  // Coordenadas del SVG. Se dibuja en un espacio fijo y el `viewBox` lo escala
  // al ancho que haya: así funciona igual en 390px y en 1440px.
  const ANCHO = 720
  const ALTO = 200
  const PIE = 28
  const util = ALTO - PIE
  const paso = ANCHO / serie.length
  const ancho = Math.min(paso * 0.6, 44)

  const etiquetaTipo = TIPOS.find((t) => t.valor === tipo)?.etiqueta ?? tipo
  const etiquetaMoneda = monedaActiva ?? 'sin moneda'
  const titulo =
    medida === 'documentos'
      ? `${etiquetaTipo}: documentos por mes (${etiquetaMoneda})`
      : `${etiquetaTipo}: importe por mes en ${etiquetaMoneda}`

  const valorLegible = (v: number) =>
    medida === 'documentos'
      ? `${v} documento${v === 1 ? '' : 's'}`
      : formatearImporte(v, monedaActiva)

  return (
    <div className={styles.wrap}>
      <div className={styles.controles}>
        <div className={styles.grupo} role="group" aria-label="Tipo de documento">
          {TIPOS.map((t) => (
            <button
              key={t.valor}
              type="button"
              className={t.valor === tipo ? styles.chipActivo : styles.chip}
              aria-pressed={t.valor === tipo}
              onClick={() => setTipo(t.valor)}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>

        <div className={styles.grupo} role="group" aria-label="Qué se mide">
          {MEDIDAS.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={m.valor === medida ? styles.chipActivo : styles.chip}
              aria-pressed={m.valor === medida}
              onClick={() => setMedida(m.valor)}
            >
              {m.etiqueta}
            </button>
          ))}
        </div>

        {monedas.length > 1 ? (
          <label className={styles.selector}>
            <span className={styles.selectorLabel}>Moneda</span>
            <select
              className={styles.select}
              value={monedaActiva ?? ''}
              onChange={(e) => setMoneda(e.target.value === '' ? null : e.target.value)}
            >
              {monedas.map((m) => (
                <option key={m ?? ''} value={m ?? ''}>
                  {m ?? 'Sin moneda'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <p className={styles.titulo} id={`${id}-titulo`}>
        {titulo}
      </p>

      {maximo === 0 ? (
        <p className={styles.nota}>
          No hay {etiquetaTipo.toLowerCase()} en {etiquetaMoneda} en estos doce meses.
        </p>
      ) : (
        <svg
          className={styles.grafico}
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          role="img"
          aria-labelledby={`${id}-titulo`}
          preserveAspectRatio="none"
        >
          <line x1="0" y1={util} x2={ANCHO} y2={util} className={styles.eje} />
          {serie.map((p, i) => {
            const alto = maximo === 0 ? 0 : (p.valor / maximo) * (util - 8)
            const x = i * paso + (paso - ancho) / 2
            return (
              <g key={p.mes}>
                {p.valor > 0 ? (
                  <rect
                    x={x}
                    y={util - alto}
                    width={ancho}
                    height={alto}
                    className={styles.barra}
                  >
                    <title>
                      {etiquetaDeMes(p.mes)} · {valorLegible(p.valor)}
                    </title>
                  </rect>
                ) : null}
                <text
                  x={i * paso + paso / 2}
                  y={ALTO - 8}
                  className={styles.etiquetaMes}
                  textAnchor="middle"
                >
                  {etiquetaDeMes(p.mes)}
                </text>
              </g>
            )
          })}
        </svg>
      )}

      <p className={styles.pie}>
        Máximo del período: <strong>{valorLegible(maximo)}</strong>. Cada barra es un mes de
        un solo tipo de documento y una sola moneda — no se suman entre sí.
      </p>

      {/* El mismo dato en texto: un gráfico no es accesible por sí solo, y en
          390px la tabla se lee mejor que doce barras finitas. */}
      <details className={styles.detalle}>
        <summary className={styles.summary}>Ver los números</summary>
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                <th scope="col" className={styles.derecha}>
                  {medida === 'documentos' ? 'Documentos' : `Importe (${etiquetaMoneda})`}
                </th>
              </tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.mes}>
                  <td>{etiquetaDeMes(p.mes)}</td>
                  <td className={styles.derecha}>
                    {medida === 'documentos' ? p.valor : formatearImporte(p.valor, monedaActiva)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
