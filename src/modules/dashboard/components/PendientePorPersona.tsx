import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/icons/Icon'
import { ErrorState } from '@/components/feedback/ErrorState'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { totalDe, type PendienteDePersona } from '../services/pendientePorPersona'
import styles from './Panel.module.css'

export interface PendientePorPersonaProps {
  /** Ya SIN mi fila: la mía va arriba, en «Lo tuyo». */
  filas: readonly PendienteDePersona[] | undefined
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

const TITULO = 'Pendiente del resto'

/** Los mismos íconos que «Lo tuyo», para que las dos mitades se lean igual. */
const COLUMNAS: readonly { clave: string; icono: IconName; titulo: string }[] = [
  { clave: 'correos', icono: 'mail', titulo: 'Correo' },
  { clave: 'cotizaciones', icono: 'cart', titulo: 'Cotizaciones' },
  { clave: 'pedidos', icono: 'truck', titulo: 'Pedidos' },
]

/**
 * Lo pendiente, persona por persona (Fase 40).
 *
 * El panel ya decía cuánto hay pendiente; esto dice DE QUIÉN, que es lo que
 * hace falta para repartir trabajo o para ver si alguien quedó tapado.
 *
 * HOY VA A ESTAR CASI TODO EN «SIN ASIGNAR», y está bien que se vea así. El
 * panel no reparte lo que nadie repartió: ponerle nombre a eso sería
 * inventarlo, y que la última fila esté enorme ES el dato.
 *
 * Lo que sí cambió en la Fase 72 es que ya no está TODO ahí. Las cotizaciones
 * y los pedidos se reparten por el vendedor y, cuando no hay, por quien los
 * creó —la misma regla que la columna Vendedor del listado—, así que los que
 * nacieron en el ERP aparecen a nombre de alguien. Medido con ese criterio:
 * de 159 cotizaciones enviadas, 4 tienen dueño y 155 vinieron de STEL; de 32
 * pedidos sin entregar, 1 y 31. El correo sigue repartiéndose por
 * `assigned_to`, y ahí sí está casi todo sin asignar: 1.038 hilos.
 *
 * SÓLO EL CORREO SE PUEDE ABRIR FILTRADO POR PERSONA. La bandeja tiene el
 * filtro `asignado` —y `asignado=nadie` para la fila de abajo—, así que esos
 * números son links. Cotizaciones y pedidos NO tienen filtro por vendedor en
 * el listado, así que van como número y no como enlace: un link que lleva al
 * listado completo le hace buscar a la persona lo que el panel ya encontró.
 */
export function PendientePorPersona({ filas, cargando, error, onReintentar }: PendientePorPersonaProps) {
  const id = useId()

  if (error) {
    return (
      <section className={styles.seccion} aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className={styles.seccionTitulo}>
          {TITULO}
        </h2>
        <ErrorState title="No se pudo leer el pendiente por persona." onRetry={onReintentar} />
      </section>
    )
  }

  if (cargando) {
    return (
      <section className={styles.seccion} aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className={styles.seccionTitulo}>
          {TITULO}
        </h2>
        <SkeletonRows rows={4} columns={4} label="Cargando el pendiente por persona…" />
      </section>
    )
  }

  const hay = (filas ?? []).some((f) => totalDe(f) > 0)
  if (!hay) {
    return (
      <section className={styles.seccion} aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className={styles.seccionTitulo}>
          {TITULO}
        </h2>
        <p className={styles.vacio}>Nadie más tiene trabajo pendiente: sin correo sin responder, sin cotizaciones esperando y sin pedidos por entregar.</p>
      </section>
    )
  }

  return (
    <section className={styles.seccion} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className={styles.seccionTitulo}>
        {TITULO}
      </h2>

      <table className={styles.tablaPendiente}>
        <caption className="sr-only">
          Correo sin responder, cotizaciones enviadas y pedidos sin entregar, por cada una de las demás personas
        </caption>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            {COLUMNAS.map((c) => (
              <th key={c.clave} scope="col" className={styles.numCol}>
                {/* El ícono repite el de «Lo tuyo»: las dos mitades del panel
                    hablan de lo mismo y conviene que se vea de un saque. */}
                <span className={styles.colTitulo}>
                  <Icon name={c.icono} size={16} />
                  {c.titulo}
                </span>
              </th>
            ))}
            <th scope="col" className={styles.numCol}>Total</th>
          </tr>
        </thead>
        <tbody>
          {(filas ?? []).map((f) => {
            const sinAsignar = f.userId === null
            return (
              <tr
                key={f.userId ?? 'sin-asignar'}
                className={sinAsignar ? styles.filaSinAsignar : undefined}
              >
                <th scope="row" className={styles.persona}>
                  {f.nombre}
                  {f.rol ? <span className={styles.rol}>{etiquetaRol(f.rol)}</span> : null}
                </th>
                <td className={styles.numCol}>
                  {f.correos > 0 ? (
                    <Link
                      to={`/emails?sinresponder=1&asignado=${sinAsignar ? 'nadie' : f.userId}`}
                      aria-label={`Ver los ${f.correos} correos sin responder de ${f.nombre}`}
                    >
                      {f.correos}
                    </Link>
                  ) : (
                    <span className={styles.cero}>0</span>
                  )}
                </td>
                {/* Sin link: el listado de Ventas no filtra por vendedor. */}
                <td className={styles.numCol}>
                  {f.cotizaciones > 0 ? f.cotizaciones : <span className={styles.cero}>0</span>}
                </td>
                <td className={styles.numCol}>
                  {f.pedidos > 0 ? f.pedidos : <span className={styles.cero}>0</span>}
                </td>
                {/* El total es lo que se compara entre filas: quién está más
                    tapado. Las tres columnas de al lado dicen de qué. */}
                <td className={`${styles.numCol} ${styles.totalCol}`}>
                  {totalDe(f) > 0 ? totalDe(f) : <span className={styles.cero}>0</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
