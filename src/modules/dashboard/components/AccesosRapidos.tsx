import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { AccesoRapido } from '../lib/inicio'
import styles from './Inicio.module.css'

/** Accesos a los módulos que el rol ya ve en el menú. Sin atajos a acciones que el rol no puede hacer. */
export function AccesosRapidos({ accesos }: { accesos: readonly AccesoRapido[] }) {
  const id = useId()
  return (
    <section className={styles.seccion} aria-labelledby={id}>
      <h2 id={id} className={styles.seccionTitulo}>
        Accesos rápidos
      </h2>
      {accesos.length === 0 ? (
        <EmptyState compact icon="inbox" title="Tu rol no tiene módulos habilitados en esta empresa" description="Si necesitás acceso, pedíselo a un administrador." />
      ) : (
        <ul className={styles.accesos}>
          {accesos.map((a) => (
            <li key={a.to}>
              <Link to={a.to} className={styles.acceso}>
                <span className={styles.accesoIcono} aria-hidden="true">
                  <Icon name={a.icon} size={20} />
                </span>
                <span className={styles.accesoTexto}>
                  <span className={styles.accesoLabel}>{a.label}</span>
                  {a.modulo ? <span className={styles.accesoModulo}>{a.modulo}</span> : null}
                </span>
                <Icon name="chevron-right" size={16} className={styles.accesoFlecha} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
