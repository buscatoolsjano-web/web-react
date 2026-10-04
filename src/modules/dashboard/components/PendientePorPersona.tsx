import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '@/components/feedback/ErrorState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { totalDe, type PendienteDePersona } from '../services/pendientePorPersona'
import styles from './Panel.module.css'

export interface PendientePorPersonaProps {
  filas: readonly PendienteDePersona[] | undefined
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

/**
 * Lo pendiente, persona por persona (Fase 40).
 *
 * El panel ya decía cuánto hay pendiente; esto dice DE QUIÉN, que es lo que
 * hace falta para repartir trabajo o para ver si alguien quedó tapado.
 *
 * HOY VA A ESTAR CASI TODO EN «SIN ASIGNAR», y está bien que se vea así.
 * Medido: 718 de los 719 correos sin responder no tienen a nadie asignado, y
 * las 143 cotizaciones enviadas y los 28 pedidos abiertos no tienen vendedor
 * —`salesperson_id` es null en los 308 documentos—. El panel no reparte lo que
 * nadie repartió: poner esos 718 a nombre de alguien sería inventarlo. Que la
 * última fila esté enorme y las demás en cero ES el dato.
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
          Pendiente por persona
        </h2>
        <ErrorState title="No se pudo leer el pendiente por persona." onRetry={onReintentar} />
      </section>
    )
  }

  if (cargando) {
    return (
      <section className={styles.seccion} aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className={styles.seccionTitulo}>
          Pendiente por persona
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
          Pendiente por persona
        </h2>
        <p className={styles.vacio}>Nadie tiene trabajo pendiente: sin correo sin responder, sin cotizaciones esperando y sin pedidos por entregar.</p>
      </section>
    )
  }

  return (
    <section className={styles.seccion} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className={styles.seccionTitulo}>
        Pendiente por persona
      </h2>

      <table className={styles.tablaPendiente}>
        <caption className="sr-only">
          Correo sin responder, cotizaciones enviadas y pedidos sin entregar, por persona
        </caption>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col" className={styles.numCol}>Correo</th>
            <th scope="col" className={styles.numCol}>Cotizaciones</th>
            <th scope="col" className={styles.numCol}>Pedidos</th>
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
                  {f.rol ? <span className={styles.rol}>{f.rol}</span> : null}
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
