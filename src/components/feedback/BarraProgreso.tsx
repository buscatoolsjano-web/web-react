import { useEffect, useRef, useState } from 'react'
import { suscribirProgresoRuta } from '@/app/progresoRuta'
import styles from './BarraProgreso.module.css'

/**
 * Barra de progreso de arriba, para los cambios de pantalla que tardan (Fase 124).
 *
 * Mientras un chunk de pantalla no está listo, la barra avanza sola hacia el 90 %
 * —un «trickle», nunca llega al final porque no sabemos cuánto falta— y al
 * terminar salta al 100 % y se desvanece. Da señal inmediata de que algo está
 * pasando, que es justo lo que falta cuando la pantalla sigue en blanco.
 *
 * Si el chunk venía precargado el fallback no se monta, así que la barra ni
 * aparece: no molesta en la navegación rápida. Ver `progresoRuta.ts`.
 *
 * Respeta `prefers-reduced-motion` (en el CSS): sin animación, sólo aparece y
 * desaparece.
 */
export function BarraProgreso() {
  // `progreso` es el ancho en %. `visible` controla si se dibuja (para poder
  // desvanecerla y recién después sacarla del DOM).
  const [progreso, setProgreso] = useState(0)
  const [visible, setVisible] = useState(false)
  const trickle = useRef<number | null>(null)
  const ocultar = useRef<number | null>(null)

  useEffect(() => {
    const limpiarTrickle = () => {
      if (trickle.current !== null) {
        window.clearInterval(trickle.current)
        trickle.current = null
      }
    }

    return suscribirProgresoRuta((cargando) => {
      if (cargando) {
        // Arranca: cancela cualquier ocultamiento pendiente, se hace visible y
        // sube a los tirones hacia el 90 %, cada vez un poco menos (se frena
        // sola cerca del tope).
        if (ocultar.current !== null) {
          window.clearTimeout(ocultar.current)
          ocultar.current = null
        }
        limpiarTrickle()
        setVisible(true)
        setProgreso(8)
        trickle.current = window.setInterval(() => {
          setProgreso((p) => (p >= 90 ? p : p + Math.max(1, (90 - p) * 0.12)))
        }, 220)
      } else {
        // Terminó: al 100 % y, pasada la transición, se desvanece y se resetea.
        limpiarTrickle()
        setProgreso(100)
        ocultar.current = window.setTimeout(() => {
          setVisible(false)
          setProgreso(0)
        }, 280)
      }
    })
  }, [])

  if (!visible) return null

  return (
    <div className={styles.pista} role="progressbar" aria-label="Cargando la pantalla" aria-hidden="true">
      <div className={styles.barra} style={{ width: `${progreso}%` }} />
    </div>
  )
}
