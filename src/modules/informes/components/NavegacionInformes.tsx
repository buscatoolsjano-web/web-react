import { Link, useSearchParams } from 'react-router-dom'
import { leerMes } from '../lib/actividad'
import type { VistaInformes } from '../lib/vista'
import styles from './Informes.module.css'


/**
 * Pestañas de Informes. La ruta sigue siendo `/informes`: la vista va en la
 * URL para que «atrás» y los enlaces funcionen, y el `?mes=` se conserva.
 */
export function NavegacionInformes({ vista }: { vista: VistaInformes }) {
  const [params] = useSearchParams()
  const mes = leerMes(params.get('mes'))
  const href = (v: VistaInformes) => {
    const n = new URLSearchParams()
    if (mes) n.set('mes', mes)
    if (v === 'stock') n.set('vista', 'stock')
    const q = n.toString()
    return q ? `?${q}` : '?'
  }
  return (
    <nav className={styles.pestanas} aria-label="Informes">
      {(['comercial', 'stock'] as const).map((v) => (
        <Link
          key={v}
          to={{ search: href(v) }}
          className={v === vista ? styles.pestanaActiva : styles.pestana}
          aria-current={v === vista ? 'page' : undefined}
        >
          {v === 'comercial' ? 'Comercial' : 'Stock'}
        </Link>
      ))}
    </nav>
  )
}
