import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { LinkButton } from '@/components/ui/LinkButton'
import styles from './Document.module.css'

export interface ActionBarProps {
  /** Vuelta al listado. Sólo tiene sentido en una barra pegada: el enlace del encabezado se va con el scroll. */
  volver?: { to: string; label: string } | undefined
  /**
   * El h1 de la página, invisible (Fase 28 · E12).
   *
   * Para pantallas que ya no dibujan encabezado: el título no se ve —no dice
   * nada que no esté abajo— pero tiene que existir, o la página se queda sin
   * encabezado para quien navega saltando por títulos.
   */
  titulo?: string | undefined
  /** La acción principal del estado actual (una). */
  primary?: ReactNode | undefined
  /** Acciones normales: editar, imprimir, enviar… */
  secondary?: ReactNode | undefined
  /** Acciones poco frecuentes, dentro de «Más ▾». Nunca la principal del workflow. */
  more?: ReactNode | undefined
  /** Acciones destructivas, separadas a la derecha. */
  danger?: ReactNode | undefined
  /**
   * La trazabilidad del documento, a la derecha y en la MISMA fila (Fase 29 · E16).
   *
   * Entra en la barra en vez de ser un bloque propio arriba del documento: la
   * fila ya mide lo que miden los botones, así que cuatro círculos de 32 no
   * agregan alto y el documento sube una franja entera.
   *
   * Va última en el DOM y se corre sola con `margin-left: auto`. Si alguna
   * pantalla llegara a pasar `danger` y `pasos` a la vez, los dos se reparten
   * el espacio libre en vez de irse al extremo; hoy ninguna lo hace, porque
   * las acciones destructivas viven dentro de «Más ▾».
   */
  pasos?: ReactNode | undefined
  /** Motivos de bloqueo, avisos o resultado (texto visible, no tooltip). */
  note?: ReactNode | undefined
  /**
   * La barra queda a la vista al bajar por el documento (Fase 28 · E3).
   *
   * No es `fixed` ni flota sobre el contenido: es `sticky` justo debajo del
   * header, con fondo propio. El bug viejo era una barra que tapaba las
   * líneas; ésta ocupa su lugar en el flujo y ahí se queda.
   */
  pegajosa?: boolean | undefined
  label?: string | undefined
  className?: string | undefined
}

/**
 * Barra de acciones de un documento.
 *
 * Va en el flujo de la página, debajo del encabezado. Con `pegajosa` se pega
 * abajo del header al bajar por el documento: en una cotización de treinta
 * líneas, «Guardar» estaba a dos pantallas de la línea que se acababa de
 * tocar.
 */
export function ActionBar({
  volver,
  titulo,
  primary,
  secondary,
  more,
  danger,
  note,
  pasos,
  pegajosa,
  label = 'Acciones del documento',
  className,
}: ActionBarProps) {
  // Desestructurado y no `pegada.activa`: el objeto lleva el ref adentro, y
  // leer una propiedad suya en el render dispara `react-hooks/refs` aunque lo
  // que se lea sea un booleano.
  const { centinela, activa: pegada } = useBarraPegada(pegajosa === true)

  if (!titulo && !volver && !primary && !secondary && !more && !danger && !note && !pasos) return null
  return (
    <>
      {/* El centinela: un píxel justo arriba de la barra. Mientras se ve, la
          barra está en su sitio; cuando se va de pantalla, está pegada. Es la
          única forma de saberlo, porque CSS no expone el estado de un
          `position: sticky`. */}
      {pegajosa ? <div ref={centinela} aria-hidden="true" className={styles.centinela} /> : null}
    <div
      className={cx(styles.actionBar, pegajosa && styles.actionBarPegajosa, className)}
      data-pegada={pegada ? 'true' : undefined}
      role="group"
      aria-label={label}
    >
      {titulo ? <h1 className="sr-only">{titulo}</h1> : null}
      {(volver || primary || secondary || more || danger || pasos) && (
        <div className={styles.actionFila}>
          {volver && (
            <LinkButton to={volver.to} variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
              {volver.label}
            </LinkButton>
          )}
          {primary && <div className={styles.actionPrimaria}>{primary}</div>}
          {secondary && <div className={styles.actionGrupo}>{secondary}</div>}
          {more && <div className={styles.actionGrupo}>{more}</div>}
          {danger && <div className={cx(styles.actionGrupo, styles.actionPeligro)}>{danger}</div>}
          {pasos && <div className={styles.actionPasos}>{pasos}</div>}
        </div>
      )}
      {note && <div className={styles.actionNota}>{note}</div>}
    </div>
    </>
  )
}

/**
 * Saber si la barra está pegada arriba (Fase 29 · E5).
 *
 * Pegada, la barra ocupa alto fijo sobre el documento, y con la nota de «qué
 * falta» adentro ese alto tapaba media columna del formulario al bajar. La
 * nota no se puede sacar —es la guía de por qué el botón está deshabilitado—,
 * así que se compacta, y para eso hay que saber cuándo está pegada.
 *
 * `position: sticky` no avisa de nada, así que se mira un centinela de un
 * píxel puesto justo arriba: si salió de pantalla, la barra está pegada.
 *
 * Sin `IntersectionObserver` —jsdom en los tests, algún navegador viejo— no
 * se rompe nada: la barra simplemente se queda siempre en su versión alta,
 * que es como venía funcionando.
 */
function useBarraPegada(activo: boolean): { centinela: React.RefObject<HTMLDivElement | null>; activa: boolean } {
  const centinela = useRef<HTMLDivElement>(null)
  const [activa, setActiva] = useState(false)

  useEffect(() => {
    // Sin `setActiva(false)` acá: poner estado dentro del efecto es lo que
    // marca `react-hooks/set-state-in-effect`, y además sobra — cuando la
    // barra no es pegajosa, lo que se devuelve abajo ya es false.
    if (!activo) return
    const el = centinela.current
    if (!el || typeof IntersectionObserver !== 'function') return
    const observador = new IntersectionObserver(
      (entradas) => {
        const e = entradas[0]
        if (e) setActiva(!e.isIntersecting)
      },
      { threshold: 1 },
    )
    observador.observe(el)
    return () => observador.disconnect()
  }, [activo])

  // `activo &&` para que apagar la barra pegajosa la devuelva suelta sin
  // tener que tocar el estado desde el efecto.
  return { centinela, activa: activo && activa }
}
