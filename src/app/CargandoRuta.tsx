import { useEffect } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { iniciarCargaDeRuta, terminarCargaDeRuta } from './progresoRuta'
import styles from './CargandoRuta.module.css'

/** Mientras llega el chunk de una pantalla: un estado anunciado, no una página en blanco. */
export function CargandoRuta() {
  // Mientras este fallback esté montado hay una pantalla cargando: enciende la
  // barra de progreso de arriba. Al desmontarse (la pantalla ya puede pintar)
  // la apaga. Ver progresoRuta.ts y BarraProgreso.tsx.
  useEffect(() => {
    iniciarCargaDeRuta()
    return terminarCargaDeRuta
  }, [])

  return (
    <div className={styles.cargando} role="status">
      <Spinner size={20} />
      <span>Cargando…</span>
    </div>
  )
}
