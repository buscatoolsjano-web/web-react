import { documentosDe, porMoneda } from '../lib/kpis'
import { formatearFecha, formatearImporte, haceCuanto } from '../lib/formato'
import type { Cliente360 } from '../types'
import styles from './TarjetasDelCliente.module.css'

export interface TarjetasDelClienteProps {
  data: Cliente360
}

/**
 * Las cuatro tarjetas que se leen en el segundo y tercero: qué hay abierto,
 * qué falta entregar, qué tan variado es lo que compra y hace cuánto que no
 * aparece.
 *
 * Son números de documentos, no de plata, y por eso se pueden mostrar solos:
 * **contar documentos sí se puede aunque estén en monedas distintas**. El
 * importe va abajo, desglosado por moneda, cuando aporta.
 *
 * No están todas las que había en el legacy. «Facturado» no está porque no
 * tenemos una fuente fiscal productiva, y una tarjeta con un número inventado
 * se ve igual de bien que una con un número real.
 */
export function TarjetasDelCliente({ data }: TarjetasDelClienteProps) {
  const { kpis, totales, recientes } = data
  const abiertas = documentosDe(kpis.valores, 'cotizaciones_abiertas')
  const porEntregar = documentosDe(kpis.valores, 'pedidos_por_entregar')
  const ultimo = recientes[0] ?? null
  const desde = haceCuanto(totales.ultimaActividad)

  return (
    <div className={styles.grilla}>
      <Tarjeta
        titulo="Cotizaciones abiertas"
        ayuda="Enviadas o en borrador, de cualquier fecha: todavía puede pasar algo con ellas."
        valor={abiertas}
        importes={porMoneda(kpis.valores, 'cotizaciones_abiertas')}
      />
      <Tarjeta
        titulo="Pedidos por entregar"
        ayuda="Confirmados y todavía no entregados del todo."
        valor={porEntregar}
        importes={porMoneda(kpis.valores, 'pedidos_por_entregar')}
      />
      <Tarjeta
        titulo="Productos distintos"
        ayuda="Cotizados o pedidos alguna vez, sin repetir."
        valor={totales.productosDistintos}
        importes={[]}
      />
      <div className={styles.tarjeta}>
        <p className={styles.titulo} title="El documento más reciente, de cualquier tipo">
          Última actividad
          <span className="sr-only">. El documento más reciente, de cualquier tipo</span>
        </p>
        <p className={desde ? styles.valorTexto : styles.valorVacio}>
          {desde ?? 'Sin actividad'}
        </p>
        {ultimo ? (
          <p className={styles.detalle}>
            {NOMBRE_TIPO[ultimo.tipo]} {ultimo.numero ?? 'sin número'} ·{' '}
            {formatearFecha(ultimo.fecha)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

const NOMBRE_TIPO = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Entrega',
} as const

interface TarjetaProps {
  titulo: string
  ayuda: string
  valor: number
  importes: { moneda: string | null; importe: number }[]
}

function Tarjeta({ titulo, ayuda, valor, importes }: TarjetaProps) {
  return (
    <div className={styles.tarjeta}>
      <p className={styles.titulo} title={ayuda}>
        {titulo}
        <span className="sr-only">. {ayuda}</span>
      </p>
      <p className={valor === 0 ? styles.valorCero : styles.valor}>{valor}</p>
      {/* Una línea por moneda. Nunca una suma. */}
      {importes.map((f) => (
        <p key={f.moneda ?? 'sin'} className={styles.detalle}>
          {formatearImporte(f.importe, f.moneda)}
        </p>
      ))}
    </div>
  )
}
