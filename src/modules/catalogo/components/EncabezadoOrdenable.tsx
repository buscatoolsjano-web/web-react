import type { ReactNode } from 'react'
import styles from './ListadoProductos.module.css'

/** El estado del orden y cómo pedirle otro. */
export interface OrdenDeColumna {
  campo: string
  direccion: 'asc' | 'desc'
  ordenar: (campo: string) => void
}

/**
 * Un encabezado que ordena (Fase 22 · paridad, #13).
 *
 * El legacy (`app.js:17366`) hace exactamente dos cosas: si ya se está
 * ordenando por ese campo, da vuelta la dirección; si no, ordena por ese
 * campo ascendente. **No hay tercer click que saque el orden** — lo verifiqué
 * en el código antes de escribir esto, porque era la duda razonable.
 *
 * Si la columna no se puede ordenar, sigue siendo un `th` normal: no hay un
 * botón que no hace nada.
 *
 * Vive en su propio archivo y no adentro de `ListadoProductos` (Fase 28 · E8):
 * ese módulo arrastra los servicios del catálogo, y con ellos el cliente de
 * Supabase, que exige entorno al importarse. Un test de otro módulo que
 * quisiera este encabezado se caía en `test:isolated` —el que corre CI antes
 * de desplegar— aunque no tocara la base.
 */
export function EncabezadoOrdenable({
  campo,
  orden,
  className,
  children,
}: {
  campo: string
  orden: OrdenDeColumna | undefined
  className?: string | undefined
  children: ReactNode
}) {
  const clase = className ? `${styles.th} ${className}` : styles.th
  if (!orden) {
    return (
      <th scope="col" className={className}>
        {children}
      </th>
    )
  }
  const activo = orden.campo === campo
  const asc = activo && orden.direccion === 'asc'
  return (
    <th scope="col" className={clase} aria-sort={activo ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={styles.ordenar} onClick={() => orden.ordenar(campo)}>
        {children}
        {/* El indicador va marcado como decorativo: la dirección ya la dice
            `aria-sort`, y leerla dos veces molesta más de lo que ayuda. */}
        <span className={activo ? styles.flecha : styles.flechaInactiva} aria-hidden="true">
          {activo ? (asc ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  )
}
