import { comparar, documentosDe, formatearVariacion, nombreDelMes, porMoneda } from '../lib/kpis'
import { formatearImporte } from '../lib/formato'
import type { ValorKpi } from '../types'
import styles from './KpisComerciales.module.css'

export interface KpisComercialesProps {
  valores: readonly ValorKpi[]
  /** Primer día del mes en curso, `YYYY-MM-DD`. Da el título. */
  mes: string
}

/**
 * Los cuatro números comerciales del cliente.
 *
 * Vive aparte porque lo usan **la ficha rápida y la ficha completa**. Hasta la
 * Fase 19 · E2 cada una contestaba «cuánto compra este cliente» por su lado: el
 * panel de la ficha mostraba seis contadores sin un solo importe, y la ficha
 * rápida mostraba los importes por moneda. Dos respuestas distintas a la misma
 * pregunta, en la misma pantalla, a un click de distancia.
 *
 * La regla que ordena todo lo de acá: **no se suman monedas**. Cada KPI es una
 * lista de importes, uno por moneda. Con una sola —el caso normal— se ve un
 * solo número y no parece un informe.
 */
export function KpisComerciales({ valores, mes }: KpisComercialesProps) {
  const vendido = comparar(valores, 'vendido_mes', 'vendido_mes_anterior')
  const cotizado = comparar(valores, 'cotizado_mes', 'cotizado_mes_anterior')
  const abiertas = porMoneda(valores, 'cotizaciones_abiertas')
  const porEntregar = porMoneda(valores, 'pedidos_por_entregar')

  return (
    <section className={styles.seccion} aria-label={`Números comerciales de ${nombreDelMes(mes)}`}>
      <div className={styles.tarjetas}>
        <Kpi
          titulo="Pedidos confirmados"
          ayuda="Pedidos con estado confirmado en el mes. No incluye cotizaciones ni facturas."
          filas={vendido}
        />
        <Kpi
          titulo="Cotizado"
          ayuda="Cotizaciones emitidas en el mes, aceptadas o no."
          filas={cotizado}
        />
        <Pendiente
          titulo="Cotizaciones abiertas"
          ayuda="Enviadas o en borrador, de cualquier fecha: todavía puede pasar algo con ellas."
          documentos={documentosDe(valores, 'cotizaciones_abiertas')}
          filas={abiertas}
        />
        <Pendiente
          titulo="Pedidos por entregar"
          ayuda="Confirmados y todavía no entregados del todo."
          documentos={documentosDe(valores, 'pedidos_por_entregar')}
          filas={porEntregar}
        />
      </div>
    </section>
  )
}

interface KpiProps {
  titulo: string
  ayuda: string
  filas: ReturnType<typeof comparar>
}

/**
 * Una tarjeta con su comparación contra el mes anterior.
 *
 * Una fila por moneda. Si el mes anterior fue cero no hay porcentaje: lo dice
 * con palabras, porque pasar de nada a algo no tiene porcentaje y `+∞ %` o
 * `+100 %` serían dos formas distintas de inventar un dato.
 */
function Kpi({ titulo, ayuda, filas }: KpiProps) {
  return (
    <div className={styles.tarjeta}>
      <p className={styles.tarjetaTitulo} title={ayuda}>
        {titulo}
        <span className="sr-only">. {ayuda}</span>
      </p>
      {filas.length === 0 ? (
        <p className={styles.tarjetaVacio}>Sin movimientos</p>
      ) : (
        filas.map((f) => (
          <div key={f.moneda ?? 'sin'} className={styles.tarjetaFila}>
            <span className={styles.tarjetaValor}>{formatearImporte(f.actual, f.moneda)}</span>
            <span className={claseVariacion(f.variacion.clase)}>
              {/* La flecha es decorativa: el texto ya dice si subió o bajó. */}
              {f.variacion.clase === 'sube' ? <span aria-hidden="true">▲ </span> : null}
              {f.variacion.clase === 'baja' ? <span aria-hidden="true">▼ </span> : null}
              {formatearVariacion(f.variacion)}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function claseVariacion(clase: string): string {
  if (clase === 'sube') return styles.sube!
  if (clase === 'baja') return styles.baja!
  return styles.neutra!
}

interface PendienteProps {
  titulo: string
  ayuda: string
  documentos: number
  filas: { moneda: string | null; documentos: number; importe: number }[]
}

function Pendiente({ titulo, ayuda, documentos, filas }: PendienteProps) {
  return (
    <div className={styles.tarjeta}>
      <p className={styles.tarjetaTitulo} title={ayuda}>
        {titulo}
        <span className="sr-only">. {ayuda}</span>
      </p>
      <p className={styles.tarjetaValor}>{documentos}</p>
      {filas.map((f) => (
        <p key={f.moneda ?? 'sin'} className={styles.tarjetaSecundario}>
          {formatearImporte(f.importe, f.moneda)}
        </p>
      ))}
    </div>
  )
}
