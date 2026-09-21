import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { formatearFecha } from '../lib/formato'
import type { ActivoDetalle } from '../types'
import styles from './CabeceraActivo.module.css'

export interface CabeceraActivoProps {
  activo: ActivoDetalle
}

/** Dónde está la garantía hoy. `null` = no hay fechas cargadas. */
function estadoDeGarantia(
  desde: string | null,
  hasta: string | null,
  hoy = new Date(),
): { texto: string; tono: 'success' | 'warning' | 'neutral' } | null {
  if (!desde && !hasta) return null
  const dia = hoy.toISOString().slice(0, 10)
  if (hasta && hasta < dia) return { texto: 'Garantía vencida', tono: 'warning' }
  if (desde && desde > dia) return { texto: 'Garantía por empezar', tono: 'neutral' }
  return { texto: 'En garantía', tono: 'success' }
}

/**
 * La cabecera de la ficha del equipo: lo que se mira antes de leer nada.
 *
 * Es la lectura del sistema anterior —la foto grande a un costado, los datos
 * del equipo a la izquierda, los del cliente a la derecha y el estado de la
 * garantía cantado en un badge— con la tipografía y las cajas de la web nueva.
 *
 * La garantía **se calcula, no se guarda**: con las dos fechas cargadas, decir
 * si está vigente es una comparación, y un campo guardado se desactualiza solo
 * el día que vence.
 */
export function CabeceraActivo({ activo }: CabeceraActivoProps) {
  const garantia = estadoDeGarantia(activo.garantiaDesde, activo.garantiaHasta)
  const foto = activo.imagenes[0] ?? null

  return (
    <section className={styles.cabecera} aria-label="Resumen del equipo">
      <dl className={styles.datos}>
        <div>
          <dt>Nombre</dt>
          <dd>{activo.nombre ?? <span className={styles.vacio}>Sin nombre</span>}</dd>
        </div>
        <div>
          <dt>Cliente</dt>
          <dd>{activo.dueno ?? <span className={styles.vacio}>Sin cliente vinculado</span>}</dd>
        </div>
        <div>
          <dt>Identificador</dt>
          <dd>{activo.identificador ?? <span className={styles.vacio}>Sin identificador</span>}</dd>
        </div>
        <div>
          <dt>Calle / Dirección</dt>
          <dd>{activo.direccion ?? <span className={styles.vacio}>Sin dirección</span>}</dd>
        </div>
        <div>
          <dt>Nº de serie</dt>
          <dd className={styles.serie}>
            {activo.serie ?? <span className={styles.vacio}>Sin número de serie</span>}
          </dd>
        </div>
        <div>
          <dt>Sujeto a mantenimiento</dt>
          <dd>{activo.bajoContrato ? 'Sí' : 'No'}</dd>
        </div>
        <div>
          <dt>Marca</dt>
          <dd>{activo.marca ?? <span className={styles.vacio}>Sin marca</span>}</dd>
        </div>
        <div>
          <dt>Garantía</dt>
          <dd>
            {garantia ? (
              <>
                <span className={styles.fechas}>
                  {formatearFecha(activo.garantiaDesde)} — {formatearFecha(activo.garantiaHasta)}
                </span>
                <Badge tone={garantia.tono}>{garantia.texto}</Badge>
              </>
            ) : (
              <span className={styles.vacio}>Sin garantía cargada</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Modelo</dt>
          <dd>{activo.modelo ?? <span className={styles.vacio}>Sin modelo</span>}</dd>
        </div>
        <div>
          <dt>Servicios</dt>
          <dd>
            {activo.ordenes === 0 ? (
              <span className={styles.vacio}>Sin servicios registrados</span>
            ) : (
              `${activo.ordenes} ${activo.ordenes === 1 ? 'orden' : 'órdenes'}`
            )}
          </dd>
        </div>
      </dl>

      <figure className={styles.figura}>
        <figcaption className={styles.pieFoto}>Imagen principal</figcaption>
        <span className={styles.marco}>
          {foto ? (
            <img src={foto.url} alt={`Equipo ${activo.referencia}`} className={styles.foto} />
          ) : (
            <span className={styles.sinFoto}>
              <Icon name="image" size={24} />
              Sin imagen
            </span>
          )}
        </span>
        {activo.imagenes.length > 1 ? (
          <p className={styles.masFotos}>
            {activo.imagenes.length} imágenes · ver la pestaña
          </p>
        ) : null}
      </figure>
    </section>
  )
}
