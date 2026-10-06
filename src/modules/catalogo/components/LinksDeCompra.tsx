import { Icon } from '@/components/icons/Icon'
import { Missing } from '@/components/document/DocSection'
import { dominioDeUrl } from '../lib/edicionProducto'
import type { LinkDeCompra } from '../types'
import styles from './LinksDeCompra.module.css'

export interface LinksDeCompraProps {
  links: readonly LinkDeCompra[]
}

/**
 * De dónde compramos este producto (Fase 40).
 *
 * Sólo lo ve un rol interno, y no por elección de esta pantalla: los links
 * viven en una tabla cuya policy exige `current_internal_company_ids`. Si
 * alguien llegara acá sin ser interno, la consulta no traería nada.
 *
 * El `rel="noopener noreferrer"` no es ceremonia: son URLs que escribe
 * cualquiera dentro de la empresa, y sin `noopener` la página que se abre
 * puede manipular la pestaña desde la que salió.
 */
export function LinksDeCompra({ links }: LinksDeCompraProps) {
  if (links.length === 0) {
    return <Missing>Sin links cargados. Se agregan con «Editar producto».</Missing>
  }

  return (
    <ul className={styles.lista}>
      {links.map((l) => (
        <li key={l.id} className={styles.item}>
          <a
            className={styles.enlace}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={l.url}
          >
            <Icon name="external-link" size={16} />
            {l.label || dominioDeUrl(l.url)}
          </a>
          {l.notas ? <span className={styles.notas}>{l.notas}</span> : null}
        </li>
      ))}
    </ul>
  )
}
