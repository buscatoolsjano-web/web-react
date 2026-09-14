import { Spinner } from '@/components/ui/Spinner'
import styles from './CargandoRuta.module.css'

/** Mientras llega el chunk de una pantalla: un estado anunciado, no una página en blanco. */
export function CargandoRuta() {
  return (
    <div className={styles.cargando} role="status">
      <Spinner size={20} />
      <span>Cargando…</span>
    </div>
  )
}
