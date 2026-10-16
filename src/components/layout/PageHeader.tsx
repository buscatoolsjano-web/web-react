import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import styles from './PageHeader.module.css'

export interface Miga {
  label: string
  /** Sin `to`: es la página actual. */
  to?: string | undefined
}

export interface PageHeaderProps {
  /** Único h1 de la página. */
  title: ReactNode
  /**
   * El h1 sigue existiendo pero no se ve (Fase 28 · E5).
   *
   * Para pantallas donde el título no dice nada que no esté a la vista —el
   * alta de un documento, que ya se anuncia en la hoja y en «Crear
   * cotización»— y ese renglón es alto que se le saca al formulario. No se
   * borra: sin h1 la página se queda sin encabezado para quien navega con
   * lector de pantalla o saltando por títulos.
   */
  hideTitle?: boolean | undefined
  subtitle?: ReactNode | undefined
  /**
   * El subtítulo al LADO del título y no abajo (Fase 77).
   *
   * Para pantallas donde ese renglón es contexto y no información nueva —el
   * inicio dice «Resumen operativo y comercial de Buscatools · Administrador»,
   * que no cambia nunca— y ocupa un renglón entero arriba de todo. Al lado
   * dice lo mismo y devuelve ese alto al contenido, que es lo que se vino a
   * ver.
   *
   * No es el caso general: en un listado o en un documento el subtítulo SÍ
   * trae información propia —cuántos hay, de qué cliente— y ahí merece su
   * renglón.
   */
  subtitleInline?: boolean | undefined
  /** Enlace de vuelta («← Pedidos»). Excluyente con `breadcrumbs`. */
  back?: { to: string; label: string } | undefined
  /**
   * La vuelta en la MISMA línea que el título (Fase 83).
   *
   * Para los documentos: «← Cotizaciones» ocupaba un renglón entero arriba
   * del número, y los dos juntos entran en uno. Son dos renglones de alto que
   * le saca a lo que se vino a mirar.
   *
   * No es el caso general: en un listado el enlace de vuelta es el único
   * elemento de contexto y no compite con nada.
   */
  backInline?: boolean | undefined
  /**
   * Sin el margen de abajo (Fase 83).
   *
   * Para cuando lo que sigue es una barra pegada al encabezado —el documento:
   * título y barra de acciones son una sola cosa—. Los 24 px del margen más
   * los 16 del hueco de la página los separaban como si fueran dos bloques
   * distintos, y eran 24 px que el documento miraba vacíos.
   */
  pegado?: boolean | undefined
  breadcrumbs?: Miga[] | undefined
  /** Estado junto al título (p. ej. un `Badge`). */
  status?: ReactNode | undefined
  /** Acciones: como máximo una primaria y dos secundarias visibles. */
  actions?: ReactNode | undefined
  className?: string | undefined
}

/**
 * Encabezado de página del sistema: contexto (volver o migas), título, estado,
 * subtítulo y acciones. En mobile las acciones bajan debajo del título.
 */
export function PageHeader({
  title,
  hideTitle,
  subtitle,
  subtitleInline = false,
  back,
  backInline = false,
  pegado = false,
  breadcrumbs,
  status,
  actions,
  className,
}: PageHeaderProps) {
  // Con el título oculto y sin estado ni acciones, la fila no dibuja nada:
  // dejarla puesta sería un renglón vacío, que es justo lo que se quería sacar.
  const filaVacia = hideTitle && !status && !subtitle && !actions && !(back && backInline)

  return (
    <header className={cx(styles.header, (hideTitle || pegado) && styles.sinMargen, className)}>
      {back && !backInline ? (
        <Link to={back.to} className={styles.volver}>
          <Icon name="arrow-left" size={16} />
          {back.label}
        </Link>
      ) : back && backInline ? null : (
        breadcrumbs &&
        breadcrumbs.length > 0 && (
          <nav aria-label="Ruta" className={styles.migas}>
            <ol>
              {breadcrumbs.map((m, i) => (
                <li key={`${m.label}-${i}`}>
                  {i > 0 && <Icon name="chevron-right" size={16} className={styles.separador} />}
                  {m.to ? (
                    <Link to={m.to}>{m.label}</Link>
                  ) : (
                    <span aria-current="page">{m.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )
      )}
      {filaVacia ? (
        <h1 className="sr-only">{title}</h1>
      ) : (
        <div className={styles.fila}>
          <div className={styles.titulos}>
            <div className={styles.tituloLinea}>
              {back && backInline ? (
                <Link to={back.to} className={styles.volverEnLinea}>
                  <Icon name="arrow-left" size={16} />
                  {back.label}
                </Link>
              ) : null}
              <h1 className={hideTitle ? 'sr-only' : styles.titulo}>{title}</h1>
              {status}
              {/* Al lado: el `<p>` es el mismo, cambia dónde se cuelga. Así el
                  subtítulo sigue siendo un párrafo —y no parte del h1— para
                  quien escucha la página. */}
              {subtitle && subtitleInline ? <p className={styles.subtituloAlLado}>{subtitle}</p> : null}
            </div>
            {subtitle && !subtitleInline && <p className={styles.subtitulo}>{subtitle}</p>}
          </div>
          {actions && <div className={styles.acciones}>{actions}</div>}
        </div>
      )}
    </header>
  )
}
