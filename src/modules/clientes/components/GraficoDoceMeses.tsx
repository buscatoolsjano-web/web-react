import { useId, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { etiquetaDeMes, mesesHasta, monedasDe, serieDe } from '../lib/actividad'
import { variacion } from '../lib/kpis'
import { formatearImporte } from '../lib/formato'
import type { ActividadMensual, TipoDeDocumento } from '../types'
import styles from './GraficoDoceMeses.module.css'

export interface GraficoDoceMesesProps {
  filas: readonly ActividadMensual[]
  cargando: boolean
  meses?: number
}

interface Serie {
  tipo: TipoDeDocumento
  etiqueta: string
  /** Cómo se cuentan los documentos de esta serie en el tooltip. */
  unidad: [string, string]
}

/**
 * Las tres series, y qué significa cada una.
 *
 * Se mira **una por vez**. El gráfico anterior dibujaba las tres juntas, con
 * tres colores y treinta y seis barras de 4 px en un panel de 520: se veía
 * movimiento, no se leía una tendencia. Y lo que se quiere contestar en un
 * segundo —«¿subió o bajó lo que le cotizamos?»— es de una sola serie.
 *
 * Cotizado es la que viene elegida: es la que tiene datos en todos los
 * clientes y la que mide el esfuerzo comercial. Un pedido depende de que el
 * cliente acepte; una cotización, de nosotros.
 */
const SERIES: Serie[] = [
  { tipo: 'cotizacion', etiqueta: 'Cotizado', unidad: ['cotización', 'cotizaciones'] },
  { tipo: 'pedido', etiqueta: 'Pedidos', unidad: ['pedido', 'pedidos'] },
  { tipo: 'entrega', etiqueta: 'Entregas', unidad: ['entrega', 'entregas'] },
]

const MESES_LARGOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** `2026-09-01` → `Septiembre 2026`, para el tooltip, que tiene lugar. */
function mesLargo(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${MESES_LARGOS[(m ?? 1) - 1] ?? mes} ${a ?? ''}`.trim()
}

/**
 * Doce meses, UNA serie y UNA moneda.
 *
 * SVG a mano, sin librería de gráficos: son doce barras. Traer Recharts suma
 * cientos de kB a un módulo que ya se carga aparte, y habría que resolver
 * igual lo difícil, que no es dibujar: es no mezclar monedas ni conceptos.
 *
 * El eje de las monedas no se negocia: **nunca hay dos monedas en el mismo
 * gráfico**. Si el cliente compra en pesos y en dólares se elige cuál se
 * mira. Una barra que sume ARS con USD no es un número más grande: es un
 * número que no existe.
 *
 * El color se usa una sola vez, en el mes en curso, y dice si viene arriba o
 * abajo del mes anterior. Pintar las doce barras de verde y rojo haría un
 * semáforo del que no se lee nada.
 */
export function GraficoDoceMeses({ filas, cargando, meses = 12 }: GraficoDoceMesesProps) {
  const id = useId()
  const [tipo, setTipo] = useState<TipoDeDocumento>('cotizacion')
  const [moneda, setMoneda] = useState<string | null | undefined>(undefined)

  const monedas = monedasDe(filas)
  // Por defecto, la moneda con más documentos; después manda lo que se eligió.
  const monedaActiva = moneda === undefined ? (monedas[0] ?? null) : moneda
  const serie = SERIES.find((s) => s.tipo === tipo)!

  if (cargando) return <SkeletonRows rows={3} columns={4} label="Cargando la actividad…" />
  if (filas.length === 0) {
    return (
      <p className={styles.nota}>
        Sin documentos en los últimos {meses} meses. El gráfico aparece con el primero.
      </p>
    )
  }

  const clavesDeMes = mesesHasta(new Date(), meses)
  const importes = serieDe(filas, { tipo, moneda: monedaActiva, medida: 'importe', meses: clavesDeMes })
  const documentos = serieDe(filas, { tipo, moneda: monedaActiva, medida: 'documentos', meses: clavesDeMes })
  const maximo = Math.max(...importes.map((p) => p.valor), 0)
  const ultimo = importes.length - 1
  const actual = importes[ultimo]?.valor ?? 0
  const previo = importes[ultimo - 1]?.valor ?? 0
  const direccion = variacion(actual, previo).clase

  const etiquetaMoneda = monedaActiva ?? 'sin moneda'
  const titulo = `${serie.etiqueta} por mes en ${etiquetaMoneda}`

  const cuantos = (n: number) => `${n} ${n === 1 ? serie.unidad[0] : serie.unidad[1]}`
  const detalle = (i: number) => {
    const imp = importes[i]?.valor ?? 0
    const docs = documentos[i]?.valor ?? 0
    if (docs === 0) return `${mesLargo(clavesDeMes[i]!)} · sin movimientos`
    return `${mesLargo(clavesDeMes[i]!)} · ${formatearImporte(imp, monedaActiva)} · ${cuantos(docs)}`
  }

  const ANCHO = 720
  const ALTO = 200
  const PIE = 26
  const util = ALTO - PIE
  const paso = ANCHO / clavesDeMes.length
  const ancho = Math.min(paso - 10, 34)

  return (
    <div className={styles.wrap}>
      <div className={styles.controles}>
        <div className={styles.grupo} role="group" aria-label="Qué se mira">
          {SERIES.map((s) => (
            <button
              key={s.tipo}
              type="button"
              className={s.tipo === tipo ? styles.chipActivo : styles.chip}
              aria-pressed={s.tipo === tipo}
              onClick={() => setTipo(s.tipo)}
            >
              {s.etiqueta}
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
          No hay {serie.etiqueta.toLowerCase()} en {etiquetaMoneda} en este período.
        </p>
      ) : (
        <>
          {/* La escala, dicha. Un mes enorme achata a los otros once y eso no
              se puede esconder normalizando en silencio: se muestra cuánto
              vale el techo del gráfico. */}
          <p className={styles.escala}>
            Escala: 0 — {formatearImporte(maximo, monedaActiva)}
          </p>

          <svg
            className={styles.grafico}
            viewBox={`0 0 ${ANCHO} ${ALTO}`}
            role="img"
            aria-labelledby={`${id}-titulo`}
            preserveAspectRatio="none"
          >
            <line x1="0" y1={util} x2={ANCHO} y2={util} className={styles.eje} />
            {clavesDeMes.map((mes, i) => {
              const valor = importes[i]?.valor ?? 0
              const alto = (valor / maximo) * (util - 10)
              const esActual = i === ultimo
              const clase = esActual ? `${styles.barra} ${claseDireccion(direccion)}` : styles.barra
              return (
                <g key={mes}>
                  <rect x={i * paso} y={0} width={paso} height={util} className={styles.zona}>
                    <title>{detalle(i)}</title>
                  </rect>
                  {valor > 0 ? (
                    <rect
                      x={i * paso + (paso - ancho) / 2}
                      y={util - Math.max(alto, 2)}
                      width={ancho}
                      height={Math.max(alto, 2)}
                      rx="2"
                      className={clase}
                    >
                      <title>{detalle(i)}</title>
                    </rect>
                  ) : (
                    // Un mes sin movimientos no se dibuja vacío: se marca con
                    // un resto sobre el eje. «No hubo nada» y «no hay dato»
                    // se ven igual si no se dice cuál es cuál.
                    <rect
                      x={i * paso + (paso - ancho) / 2}
                      y={util - 2}
                      width={ancho}
                      height="2"
                      className={styles.vacia}
                    >
                      <title>{detalle(i)}</title>
                    </rect>
                  )}
                  <text
                    x={i * paso + paso / 2}
                    y={ALTO - 8}
                    className={esActual ? styles.etiquetaActual : styles.etiquetaMes}
                    textAnchor="middle"
                  >
                    {etiquetaDeMes(mes)}
                  </text>
                </g>
              )
            })}
          </svg>
        </>
      )}

      {/* El mismo dato en texto. Un gráfico no es accesible por sí solo, y en
          375 px una tabla se lee mejor que doce barras finitas. */}
      <details className={styles.detalle}>
        <summary className={styles.summary}>Ver los números</summary>
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <caption className="sr-only">{titulo}</caption>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                <th scope="col" className={styles.derecha}>
                  Importe
                </th>
                <th scope="col" className={styles.derecha}>
                  Documentos
                </th>
              </tr>
            </thead>
            <tbody>
              {clavesDeMes.map((mes, i) => (
                <tr key={mes}>
                  <th scope="row" className={styles.mes}>
                    {etiquetaDeMes(mes)}
                  </th>
                  <td className={styles.derecha}>
                    {formatearImporte(importes[i]?.valor ?? 0, monedaActiva)}
                  </td>
                  <td className={styles.derecha}>{documentos[i]?.valor ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className={styles.pie}>
        Cada barra es un mes de <strong>{serie.etiqueta.toLowerCase()}</strong> en{' '}
        <strong>{etiquetaMoneda}</strong>. Las monedas no se suman entre sí.
      </p>
    </div>
  )
}

function claseDireccion(clase: string): string {
  if (clase === 'sube') return styles.sube!
  if (clase === 'baja') return styles.baja!
  return styles.neutra!
}
