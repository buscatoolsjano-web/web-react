import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import type { ContactoCliente } from '../types'
import styles from './EditorContactos.module.css'

export interface TablaContactosProps {
  contactos: readonly ContactoCliente[]
  puedeEditar: boolean
  /** El id que se está editando, `'nuevo'` para el alta, o `null`. */
  editandoId: string | null
  guardando: boolean
  /** El MISMO formulario de las tarjetas, inyectado para no tener dos. */
  formulario: (textoBoton: string) => ReactNode
  onEditar: (c: ContactoCliente) => void
  onCambiarActivo: (c: ContactoCliente, activo: boolean) => void
  onBorrar: (c: ContactoCliente) => void
}

/**
 * Los contactos del cliente, en lista (Fase 40).
 *
 * Una fila por persona y las columnas alineadas, para cuando hay muchos: el
 * cliente más poblado del maestro tiene 22 contactos y en tarjetas ocupan tres
 * pantallas. Las tarjetas siguen estando porque son mejores para leer una
 * ficha —el mail grande, las notas enteras—; esto es para encontrar a alguien.
 *
 * El formulario de edición es el MISMO que el de las tarjetas, recibido por
 * prop: tener dos formularios para el mismo contacto terminaría en dos
 * validaciones distintas y en un campo que existe en una vista y no en la
 * otra. Acá se abre en una fila que ocupa todo el ancho.
 *
 * Las notas no tienen columna. En una tabla serían un párrafo aplastado en una
 * celda angosta que empuja todas las filas; quien las necesita abre la ficha
 * en tarjetas o entra a editar.
 */
export function TablaContactos({
  contactos,
  puedeEditar,
  editandoId,
  guardando,
  formulario,
  onEditar,
  onCambiarActivo,
  onBorrar,
}: TablaContactosProps) {
  const columnas = puedeEditar ? 5 : 4

  return (
    <div className={styles.tablaScroll}>
      <table className={styles.tabla}>
        <caption className="sr-only">Contactos del cliente</caption>
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Cargo</th>
            <th scope="col">Email</th>
            <th scope="col">Teléfono</th>
            {puedeEditar ? (
              <th scope="col">
                <span className="sr-only">Acciones</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {contactos.map((c) =>
            editandoId === c.id ? (
              <tr key={c.id}>
                <td colSpan={columnas} className={styles.celdaForm}>
                  {formulario('Guardar')}
                </td>
              </tr>
            ) : (
              <tr key={c.id} className={c.activo ? undefined : styles.filaInactiva}>
                <th scope="row" className={styles.celdaNombre}>
                  {c.nombre}
                  {c.esPrincipal ? <Badge tone="brand">Principal</Badge> : null}
                  {c.activo ? null : <Badge tone="neutral">Desactivado</Badge>}
                </th>
                <td>{c.cargo ?? '—'}</td>
                <td>
                  {c.email ? (
                    <a className={styles.enlace} href={`mailto:${c.email}`}>
                      {c.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={styles.celdaTelefono}>{c.telefono ?? '—'}</td>
                {puedeEditar ? (
                  <td className={styles.celdaAcciones}>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icon name="edit" size={16} />}
                      aria-label={`Editar ${c.nombre}`}
                      onClick={() => onEditar(c)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={guardando}
                      onClick={() => onCambiarActivo(c, !c.activo)}
                    >
                      {c.activo ? 'Desactivar' : 'Reactivar'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.peligro}
                      icon={<Icon name="trash" size={16} />}
                      aria-label={`Borrar ${c.nombre}`}
                      onClick={() => onBorrar(c)}
                    />
                  </td>
                ) : null}
              </tr>
            ),
          )}

          {editandoId === 'nuevo' ? (
            <tr>
              <td colSpan={columnas} className={styles.celdaForm}>
                {formulario('Agregar contacto')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
