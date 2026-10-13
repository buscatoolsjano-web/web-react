import { Link } from 'react-router-dom'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { IconButton } from '@/components/ui/IconButton'
import { formatearImporte } from '@/modules/ventas/lib/formato'
import type { Moneda, TipoActividad } from '@/modules/informes/types'
import { ETIQUETA_SERIE, mesLargo } from '../lib/panel'
import { rangoDelMes, SERIES } from '../lib/evolucion'
import { TOPE_POR_TIPO, useDesgloseDelMes } from '../hooks/useDesgloseDelMes'
import styles from './Evolucion.module.css'

export interface DesgloseDelMesProps {
  /** `YYYY-MM-01`. */
  mes: string
  moneda: Moneda | null
  /** Cuántos documentos tiene cada tipo ese mes, según el gráfico. */
  cuentas: Partial<Record<TipoActividad, number>>
  onCerrar: () => void
}

/** A qué listado va «ver los N»: el de cada tipo, acotado a ese mes. */
const RUTA: Record<TipoActividad, string> = {
  cotizaciones: '/ventas/cotizaciones',
  pedidos: '/ventas/pedidos',
  entregas: '/ventas/entregas',
}

/**
 * Qué hay adentro de un mes (Fase 63).
 *
 * «Toco octubre y abajo del gráfico se me desglosa qué es lo que hay, así
 * puedo ver qué se cotizó, qué se pidió, qué se entregó».
 *
 * VA DEBAJO DEL GRÁFICO, no en un modal: el pedido fue poder mirar las dos
 * cosas a la vez. Un modal taparía justamente la barra que se acaba de tocar.
 *
 * LAS CUENTAS SALEN DEL GRÁFICO, no de esta consulta. Se listan los primeros
 * cinco de cada tipo, pero el «y 33 más» usa el número que ya mide la barra:
 * así el desglose no puede decir un total distinto del que muestra el
 * gráfico, que es el error que volvería inútil a los dos.
 *
 * CADA DOCUMENTO LLEVA A SU FICHA, y cada grupo al listado del mes. El
 * desglose es para entender el mes y saltar a lo que importa, no un informe:
 * para eso está Informes.
 */
export function DesgloseDelMes({ mes, moneda, cuentas, onCerrar }: DesgloseDelMesProps) {
  const q = useDesgloseDelMes(mes, moneda)
  const rango = rangoDelMes(mes)

  return (
    <section className={styles.desglose} aria-label={`Detalle de ${mesLargo(mes)}`}>
      <div className={styles.desgloseCabecera}>
        <h3 className={styles.desgloseTitulo}>
          {mesLargo(mes)}
          {moneda ? <span className={styles.desgloseMoneda}> · {moneda}</span> : null}
        </h3>
        <IconButton icon="x" size="sm" aria-label="Cerrar el detalle del mes" onClick={onCerrar} />
      </div>

      {q.isPending ? (
        <SkeletonRows rows={3} columns={3} label="Cargando el detalle del mes…" />
      ) : q.isError ? (
        <ErrorState compact title="No se pudo leer el detalle del mes." onRetry={() => void q.refetch()} />
      ) : (
        <div className={styles.columnas}>
          {SERIES.map(({ tipo, slot }) => {
            const grupo = q.data?.find((g) => g.tipo === tipo)
            const docs = grupo?.documentos ?? []
            const total = cuentas[tipo] ?? 0
            const etiqueta = ETIQUETA_SERIE[tipo]
            return (
              <div key={tipo} className={styles.columna}>
                <h4 className={styles.columnaTitulo}>
                  {/* La misma muestra de color que la leyenda: es lo que ata
                      cada columna a su barra sin tener que decirlo. */}
                  <span className={styles.muestra} data-slot={slot} aria-hidden="true" />
                  {etiqueta.titulo}
                  <span className={styles.columnaCuenta}>
                    {total} {total === 1 ? etiqueta.singular : etiqueta.plural}
                  </span>
                </h4>

                {total === 0 ? (
                  <p className={styles.columnaVacia}>Sin movimientos.</p>
                ) : (
                  <>
                    <ul className={styles.docs}>
                      {docs.map((d) => (
                        <li key={d.id}>
                          <Link to={`${RUTA[tipo]}/${d.id}`} className={styles.doc}>
                            <span className={styles.docNumero}>{d.numero}</span>
                            <span className={styles.docCliente}>{d.cliente ?? 'Sin cliente'}</span>
                            <span className={styles.docImporte}>{formatearImporte(d.importe, d.moneda)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {/* Sólo si hay más de los que se listan: un enlace que
                        lleva a la misma lista que ya se ve no sirve de nada. */}
                    {total > TOPE_POR_TIPO && rango ? (
                      <Link
                        to={`${RUTA[tipo]}?desde=${rango.desde}&hasta=${rango.hasta}`}
                        className={styles.verTodos}
                      >
                        Ver {total} {etiqueta.plural} de {mesLargo(mes).split(' ')[0]?.toLowerCase()}
                      </Link>
                    ) : null}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
