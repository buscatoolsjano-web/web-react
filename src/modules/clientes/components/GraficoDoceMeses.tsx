import { useId, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { etiquetaDeMes, mesesHasta, monedasDe, serieDe, type Medida } from '../lib/actividad'
import { formatearImporte } from '../lib/formato'
import type { ActividadMensual, TipoDeDocumento } from '../types'
import styles from './GraficoDoceMeses.module.css'

export interface GraficoDoceMesesProps {
  filas: readonly ActividadMensual[]
  cargando: boolean
  /** Para que dos gráficos en la misma pantalla no compartan estado. */
  meses?: number
}

interface Serie {
  tipo: TipoDeDocumento
  etiqueta: string
  clase: string
}

/**
 * Las tres series, y qué significa cada una.
 *
 * Esto es lo que el gráfico de la web anterior no decía: mostraba una sola
 * línea de «ventas» sin aclarar si eran cotizaciones, pedidos o entregas, y
 * sumaba las monedas. Una cotización no es una venta —es una oferta que el
 * cliente todavía no aceptó— y llamarle venta infla el número sin que nadie
 * mienta a propósito.
 */
const SERIES: Serie[] = [
  { tipo: 'cotizacion', etiqueta: 'Cotizado', clase: styles.cotizado! },
  { tipo: 'pedido', etiqueta: 'Pedido', clase: styles.pedido! },
  { tipo: 'entrega', etiqueta: 'Entregado', clase: styles.entregado! },
]

const MEDIDAS: { valor: Medida; etiqueta: string }[] = [
  { valor: 'importe', etiqueta: 'Importe' },
  { valor: 'documentos', etiqueta: 'Documentos' },
]

/**
 * Doce meses, las tres series juntas y UNA moneda por vez.
 *
 * SVG a mano, sin librería de gráficos: son treinta y seis barras. Traer
 * Recharts o similar para esto suma cientos de kB al bundle de un módulo que
 * ya se carga aparte, y habría que volver a resolver igual el tema difícil,
 * que no es dibujar: es no mezclar monedas ni conceptos.
 *
 * El eje de las monedas no se negocia: **nunca hay dos monedas en el mismo
 * gráfico**. Si el cliente compra en pesos y en dólares, se elige cuál se
 * mira. Una barra que sume ARS con USD no es un número más grande: es un
 * número que no existe.
 */
export function GraficoDoceMeses({ filas, cargando, meses = 12 }: GraficoDoceMesesProps) {
  const id = useId()
  const [medida, setMedida] = useState<Medida>('importe')
  const [moneda, setMoneda] = useState<string | null | undefined>(undefined)

  const monedas = monedasDe(filas)
  // La moneda por defecto es la que más documentos tiene; después manda lo
  // que la persona haya elegido.
  const monedaActiva = moneda === undefined ? (monedas[0] ?? null) : moneda

  if (cargando) return <SkeletonRows rows={3} columns={4} label="Cargando la actividad…" />
  if (filas.length === 0) {
    return <p className={styles.nota}>Sin documentos en los últimos {meses} meses.</p>
  }

  const clavesDeMes = mesesHasta(new Date(), meses)
  const series = SERIES.map((s) => ({
    ...s,
    puntos: serieDe(filas, { tipo: s.tipo, moneda: monedaActiva, medida, meses: clavesDeMes }),
  }))
  const maximo = Math.max(...series.flatMap((s) => s.puntos.map((p) => p.valor)), 0)

  const ANCHO = 720
  const ALTO = 210
  const PIE = 26
  const util = ALTO - PIE
  const paso = ANCHO / clavesDeMes.length
  const ancho = Math.min((paso - 8) / SERIES.length, 14)

  const etiquetaMoneda = monedaActiva ?? 'sin moneda'
  const titulo =
    medida === 'documentos'
      ? `Documentos por mes (${etiquetaMoneda})`
      : `Importe por mes en ${etiquetaMoneda}`

  const legible = (v: number) =>
    medida === 'documentos'
      ? `${v} documento${v === 1 ? '' : 's'}`
      : formatearImporte(v, monedaActiva)

  /** El texto del tooltip de un mes: las tres series juntas. */
  const detalleDelMes = (i: number) =>
    [
      etiquetaDeMes(clavesDeMes[i]!),
      ...series.map((s) => `${s.etiqueta}: ${legible(s.puntos[i]?.valor ?? 0)}`),
    ].join(' · ')

  return (
    <div className={styles.wrap}>
      <div className={styles.controles}>
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

      {/* La leyenda va SIEMPRE con dos o más series: el color solo no alcanza
          para saber qué es cada barra, y en impresión o con daltonismo no
          queda nada. */}
      <ul className={styles.leyenda}>
        {series.map((s) => (
          <li key={s.tipo} className={styles.leyendaItem}>
            <span className={`${styles.muestra} ${s.clase}`} aria-hidden="true" />
            {s.etiqueta}
          </li>
        ))}
      </ul>

      {maximo === 0 ? (
        <p className={styles.nota}>No hay movimientos en {etiquetaMoneda} en este período.</p>
      ) : (
        <svg
          className={styles.grafico}
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          role="img"
          aria-labelledby={`${id}-titulo`}
          preserveAspectRatio="none"
        >
          <line x1="0" y1={util} x2={ANCHO} y2={util} className={styles.eje} />
          {clavesDeMes.map((mes, i) => {
            const base = i * paso + (paso - ancho * SERIES.length) / 2
            return (
              <g key={mes}>
                {/* Una zona de hover por MES, no por barra: el tooltip cuenta
                    las tres series de ese mes, que es la pregunta real. */}
                <rect
                  x={i * paso}
                  y={0}
                  width={paso}
                  height={util}
                  className={styles.zona}
                >
                  <title>{detalleDelMes(i)}</title>
                </rect>
                {series.map((s, j) => {
                  const valor = s.puntos[i]?.valor ?? 0
                  const alto = maximo === 0 ? 0 : (valor / maximo) * (util - 8)
                  if (valor <= 0) return null
                  return (
                    <rect
                      key={s.tipo}
                      x={base + j * ancho}
                      y={util - alto}
                      width={Math.max(ancho - 2, 2)}
                      height={alto}
                      className={s.clase}
                    >
                      <title>
                        {etiquetaDeMes(mes)} · {s.etiqueta}: {legible(valor)}
                      </title>
                    </rect>
                  )
                })}
                <text
                  x={i * paso + paso / 2}
                  y={ALTO - 8}
                  className={styles.etiquetaMes}
                  textAnchor="middle"
                >
                  {etiquetaDeMes(mes)}
                </text>
              </g>
            )
          })}
        </svg>
      )}

      {/* El mismo dato en texto. Un gráfico no es accesible por sí solo, y en
          375 px una tabla se lee mejor que treinta y seis barras finitas. */}
      <details className={styles.detalle}>
        <summary className={styles.summary}>Ver los números</summary>
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <caption className="sr-only">{titulo}</caption>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                {series.map((s) => (
                  <th key={s.tipo} scope="col" className={styles.derecha}>
                    {s.etiqueta}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clavesDeMes.map((mes, i) => (
                <tr key={mes}>
                  <th scope="row" className={styles.mes}>
                    {etiquetaDeMes(mes)}
                  </th>
                  {series.map((s) => (
                    <td key={s.tipo} className={styles.derecha}>
                      {legible(s.puntos[i]?.valor ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className={styles.pie}>
        Cada barra es un mes, un tipo de documento y <strong>una sola moneda</strong>. No se suman
        entre sí.
      </p>
    </div>
  )
}
