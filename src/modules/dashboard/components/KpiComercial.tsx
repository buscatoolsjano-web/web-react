import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { formatearImporte } from '@/modules/ventas/lib/formato'
import type { ActividadComercial, TipoActividad } from '@/modules/informes/types'
import { ETIQUETA_SERIE, FLECHA, direccionDe, etiquetaDeTramo, kpiDe, monedasActivas, textoDeVariacion } from '../lib/panel'
import styles from './Panel.module.css'

export interface KpiComercialProps {
  actividad: ActividadComercial | undefined
  tipo: TipoActividad
  /** El protagonista se ve más grande y va primero. */
  protagonista?: boolean
  destino: string
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

/**
 * Lo cotizado, pedido o entregado del período, por moneda (Fase 21 · E2).
 *
 * Tres cosas que no se negocian:
 *
 *   · **una línea por moneda y ningún total.** ARS + USD no es un número más
 *     grande, es un número que no existe;
 *   · **sólo las monedas con movimiento en el período.** El EUR existe en
 *     cotizaciones viejas; poner «EUR 0» sería llenar la tarjeta de nada;
 *   · **la comparación es contra la ventana equivalente.** El servidor recorta
 *     los dos tramos al mismo largo —1–22 de septiembre contra 1–22 de
 *     agosto— así que nunca se compara un mes a medias contra uno entero.
 *
 * El color dice dirección, no juicio, y nunca viaja solo: flecha y texto.
 */
export function KpiComercial({ actividad, tipo, protagonista = false, destino, cargando, error, onReintentar }: KpiComercialProps) {
  const etiqueta = ETIQUETA_SERIE[tipo]
  const kpi = kpiDe(actividad, tipo)
  const monedas = monedasActivas(kpi)

  return (
    <section className={protagonista ? styles.kpiProtagonista : styles.kpiSecundario} aria-label={etiqueta.titulo}>
      <div className={styles.kpiCabecera}>
        <h2 className={styles.kpiTitulo}>{etiqueta.titulo}</h2>
        <Link to={destino} className={styles.kpiEnlace}>
          Ver {etiqueta.plural}
        </Link>
      </div>

      {cargando ? (
        <div className={styles.kpiCuerpo}>
          <Skeleton width="60%" height={protagonista ? '2.5rem' : '1.75rem'} />
          <Skeleton width="40%" />
        </div>
      ) : error ? (
        <ErrorState compact title={`No se pudo leer ${etiqueta.titulo.toLowerCase()}.`} onRetry={onReintentar} />
      ) : monedas.length === 0 ? (
        <p className={styles.kpiVacio}>
          Sin {etiqueta.plural} en este período.
        </p>
      ) : (
        <ul className={styles.kpiMonedas}>
          {monedas.map((m) => {
            const dir = direccionDe(m)
            const texto = actividad ? textoDeVariacion(m, actividad.anterior) : ''
            return (
              <li key={m.moneda} className={styles.kpiMoneda}>
                <p className={styles.kpiImporte}>{formatearImporte(m.actual.importe, m.moneda)}</p>
                <p className={styles.kpiDocumentos}>
                  {m.actual.documentos} {m.actual.documentos === 1 ? etiqueta.singular : etiqueta.plural}
                </p>
                <p className={styles.kpiVariacion} data-direccion={dir}>
                  {FLECHA[dir] ? (
                    <span aria-hidden="true" className={styles.kpiFlecha}>
                      {FLECHA[dir]}
                    </span>
                  ) : null}
                  {texto}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {actividad && !cargando && !error ? (
        <p className={styles.kpiPeriodo}>{etiquetaDeTramo(actividad.actual)}</p>
      ) : null}
    </section>
  )
}
