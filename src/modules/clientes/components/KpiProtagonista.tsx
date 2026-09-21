import { comparar, formatearVariacion, nombreDelMes, type Comparado } from '../lib/kpis'
import { formatearImporte } from '../lib/formato'
import type { ValorKpi } from '../types'
import styles from './KpiProtagonista.module.css'

export interface KpiProtagonistaProps {
  valores: readonly ValorKpi[]
  /** Primer día del mes en curso, `YYYY-MM-DD`. */
  mes: string
  /** Primer día del mes anterior, para nombrarlo en la comparación. */
  mesAnterior: string
}

/**
 * El número que se mira primero: **cuánto le cotizamos este mes**.
 *
 * Es cotizado y no «vendido» ni «facturado» a propósito. No tenemos una fuente
 * fiscal productiva, y un KPI que diga «facturado» sobre datos que no son
 * facturas es peor que no tener el KPI: se toman decisiones con él. Cotizado
 * es lo que realmente mide el dato —ofertas emitidas en el mes, aceptadas o
 * no— y se llama por su nombre.
 *
 * **Nunca se suman monedas.** Un cliente que cotiza en dólares y en pesos
 * tiene dos importes, uno debajo del otro, cada uno con su comparación. La
 * primera fila es la de mayor importe y se muestra grande; las demás quedan
 * abajo, más chicas pero completas. Sumarlas daría un número que no existe.
 */
export function KpiProtagonista({ valores, mes, mesAnterior }: KpiProtagonistaProps) {
  const filas = comparar(valores, 'cotizado_mes', 'cotizado_mes_anterior')
  // Las monedas en las que este mes no pasó nada pero el anterior sí valen la
  // pena —«dejó de comprar en pesos» es información— pero no pueden quedar
  // arriba: la fila protagonista es la que tiene plata este mes.
  const conMovimiento = filas.filter((f) => f.actual > 0)
  const sinMovimiento = filas.filter((f) => f.actual === 0 && f.anterior > 0)
  const principal = conMovimiento[0]

  return (
    <section className={styles.bloque} aria-labelledby="ficha-kpi-cotizado">
      <h3 className={styles.titulo} id="ficha-kpi-cotizado">
        Cotizado en {nombreDelMes(mes)}
      </h3>

      {principal === undefined ? (
        <p className={styles.sinMovimiento}>Sin cotizaciones este mes</p>
      ) : (
        <p className={styles.importe}>{formatearImporte(principal.actual, principal.moneda)}</p>
      )}

      {principal ? <Comparacion fila={principal} mesAnterior={mesAnterior} /> : null}

      {conMovimiento.slice(1).map((f) => (
        <div key={f.moneda ?? 'sin'} className={styles.otraMoneda}>
          <span className={styles.otroImporte}>{formatearImporte(f.actual, f.moneda)}</span>
          <Comparacion fila={f} mesAnterior={mesAnterior} compacta />
        </div>
      ))}

      {sinMovimiento.map((f) => (
        <p key={f.moneda ?? 'sin'} className={styles.dejoDeComprar}>
          Sin cotizaciones en {f.moneda ?? 'documentos sin moneda'} este mes ·{' '}
          {formatearImporte(f.anterior, f.moneda)} en {nombreDelMes(mesAnterior)}
        </p>
      ))}
    </section>
  )
}

/**
 * La comparación contra el mes anterior.
 *
 * El color dice la DIRECCIÓN de la métrica, no si el cliente es bueno: verde
 * es que cotizamos más que el mes pasado, rojo que menos. Y nunca va solo —
 * flecha, porcentaje y texto dicen lo mismo, porque un 8 % de las personas no
 * distingue el verde del rojo y porque en una impresión no queda ninguno.
 */
function Comparacion({
  fila,
  mesAnterior,
  compacta = false,
}: {
  fila: Comparado
  mesAnterior: string
  compacta?: boolean
}) {
  const { clase } = fila.variacion
  const flecha = clase === 'sube' ? '↑' : clase === 'baja' ? '↓' : '—'
  const texto = formatearVariacion(fila.variacion)
  const conMes = clase === 'sube' || clase === 'baja'

  return (
    <p className={`${compacta ? styles.comparacionCompacta : styles.comparacion} ${tono(clase)}`}>
      <span aria-hidden="true">{flecha} </span>
      {texto}
      {conMes ? ` vs. ${nombreDelMes(mesAnterior)}` : ''}
    </p>
  )
}

function tono(clase: string): string {
  if (clase === 'sube') return styles.sube!
  if (clase === 'baja') return styles.baja!
  return styles.neutra!
}
