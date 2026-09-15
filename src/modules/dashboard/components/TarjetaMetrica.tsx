import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/icons/Icon'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { SIN_MONEDA } from '@/modules/informes/types'
import { formatearImporte } from '@/modules/informes/lib/actividad'
import type { ImporteMoneda } from '../lib/inicio'
import styles from './Inicio.module.css'

export interface TarjetaMetricaProps {
  titulo: string
  icono: IconName
  /** `null` mientras carga o si falló. */
  valor: number | null
  /** Qué cuenta el número («cotizaciones», «órdenes»), ya en singular o plural. */
  unidad?: string | undefined
  cargando: boolean
  error: boolean
  onReintentar?: (() => void) | undefined
  enlace: { to: string; label: string }
  children?: ReactNode
}

/**
 * Una métrica del Inicio: el número domina, el detalle acompaña y el enlace
 * lleva al listado donde está el dato completo. Nunca muestra un 0 inventado:
 * cargando es un skeleton y un error se dice como error.
 */
export function TarjetaMetrica({ titulo, icono, valor, unidad, cargando, error, onReintentar, enlace, children }: TarjetaMetricaProps) {
  const id = useId()
  return (
    <article className={styles.metrica} aria-labelledby={id} aria-busy={cargando || undefined}>
      <header className={styles.metricaCabecera}>
        <span className={styles.metricaIcono} aria-hidden="true">
          <Icon name={icono} size={20} />
        </span>
        <h3 id={id} className={styles.metricaTitulo}>
          {titulo}
        </h3>
      </header>

      {cargando ? (
        <div className={styles.metricaCarga} role="status" aria-label={`Cargando ${titulo.toLowerCase()}…`}>
          <Skeleton width="4rem" height="2rem" />
          <Skeleton width="70%" />
        </div>
      ) : error || valor === null ? (
        <div className={styles.metricaError} role="alert">
          <p>
            <Icon name="alert-triangle" size={16} /> No se pudo leer este dato.
          </p>
          {onReintentar ? (
            <Button variant="ghost" size="sm" onClick={onReintentar}>
              Reintentar
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <p className={styles.metricaValor}>
            {new Intl.NumberFormat('es-AR').format(valor)}
            {unidad ? <span className={styles.metricaUnidad}> {unidad}</span> : null}
          </p>
          {children}
        </>
      )}

      <Link to={enlace.to} className={styles.metricaEnlace}>
        {enlace.label}
        <Icon name="chevron-right" size={16} />
      </Link>
    </article>
  )
}

/**
 * Importes por moneda, una línea cada una. SIN MONEDA se muestra como tal y
 * al final: no se le asigna una, no se convierte y no hay total general.
 */
export function ListaMonedas({ filas, etiqueta }: { filas: readonly ImporteMoneda[]; etiqueta: string }) {
  if (filas.length === 0) return null
  return (
    <ul className={styles.monedas} aria-label={etiqueta}>
      {filas.map((f) => (
        <li key={f.moneda} className={f.moneda === SIN_MONEDA ? styles.monedaSin : styles.moneda}>
          <span className={styles.monedaCodigo}>{f.moneda}</span>
          <span className={styles.monedaImporte}>{formatearImporte(f.importe)}</span>
        </li>
      ))}
    </ul>
  )
}
