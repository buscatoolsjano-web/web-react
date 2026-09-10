import type { ContactoCliente } from '../types'
import styles from './PanelContactos.module.css'

export interface PanelContactosProps {
  contactos: readonly ContactoCliente[]
  cargando: boolean
}

/**
 * Los contactos del cliente.
 *
 * Se leen por `customer_id`, que es una FK real. En el legacy un contacto
 * guardaba el NOMBRE del cliente en un campo de texto: renombrar el cliente
 * dejaba a sus contactos colgando.
 */
export function PanelContactos({ contactos, cargando }: PanelContactosProps) {
  if (cargando) return <p className={styles.nota}>Cargando contactos…</p>

  if (contactos.length === 0) {
    return <p className={styles.nota}>Este cliente no tiene contactos cargados.</p>
  }

  return (
    <ul className={styles.lista}>
      {contactos.map((c) => (
        <li key={c.id} className={styles.item}>
          <div className={styles.cabecera}>
            <span className={styles.nombre}>{c.nombre}</span>
            {c.esPrincipal ? <span className={styles.principal}>Principal</span> : null}
          </div>
          {c.cargo ? <span className={styles.cargo}>{c.cargo}</span> : null}
          <div className={styles.datos}>
            {c.email ? (
              <a className={styles.enlace} href={`mailto:${c.email}`}>
                {c.email}
              </a>
            ) : null}
            {c.telefono ? <span className={styles.dato}>{c.telefono}</span> : null}
            {c.fax ? <span className={styles.dato}>fax {c.fax}</span> : null}
          </div>
          {c.notas ? <p className={styles.notas}>{c.notas}</p> : null}
        </li>
      ))}
    </ul>
  )
}
