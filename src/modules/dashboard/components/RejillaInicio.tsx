import type { ReactNode } from 'react'
import { Icon } from '@/components/icons/Icon'
import {
  ETIQUETA_TAMANO,
  ETIQUETA_WIDGET,
  sePuedeAchicar,
  sePuedeAgrandar,
  sePuedeBajar,
  sePuedeSubir,
  type ClaveWidget,
  type Widget,
} from '../lib/widgets'
import styles from './Rejilla.module.css'

export interface RejillaInicioProps {
  widgets: readonly Widget[]
  /** Qué dibuja cada clave. Lo arma la vista, que es la que tiene los datos. */
  contenido: Partial<Record<ClaveWidget, ReactNode>>
  /** En modo acomodar cada bloque muestra su barra de controles. */
  acomodando: boolean
  onSubir: (c: ClaveWidget) => void
  onBajar: (c: ClaveWidget) => void
  onAgrandar: (c: ClaveWidget) => void
  onAchicar: (c: ClaveWidget) => void
}

/**
 * El inicio, puesto en una rejilla que cada uno acomoda (Fase 76).
 *
 * ── Qué significa el tamaño ─────────────────────────────────────────────────
 *
 * `chico` ocupa media pantalla y los otros dos la ancha entera; lo que cambia
 * entre `normal` y `grande` es el ALTO, y sólo donde el alto quiere decir algo
 * —el gráfico—. No es una inconsistencia: «agrandar» un listado de documentos
 * a lo alto sería dejarlo con aire abajo, y angostarlo a la mitad sí lo hace
 * más chico de verdad.
 *
 * El tamaño viaja como `data-tamano` y lo resuelve el CSS. Así el componente
 * no sabe de píxeles y la misma rejilla sirve en una pantalla angosta, donde
 * todo pasa a una columna.
 *
 * ── Por qué flechas y no arrastrar ──────────────────────────────────────────
 *
 * Arrastrar y soltar pide una biblioteca, no se puede hacer con el teclado sin
 * escribir el doble, y en un celular pelea con el scroll de la página. Cuatro
 * botones —subir, bajar, achicar, agrandar— hacen exactamente lo que se pidió,
 * funcionan con el teclado sin nada extra y se entienden sin que nadie las
 * explique. Si alguna vez el inicio tiene veinte bloques, arrastrar va a valer
 * la pena; con siete, no.
 *
 * ── Sin modo acomodar no hay nada de esto ───────────────────────────────────
 *
 * Fuera de ese modo la rejilla dibuja los bloques y punto: ni marcos, ni
 * títulos repetidos, ni botones. El inicio es para mirarlo, no para acomodarlo
 * todos los días.
 */
export function RejillaInicio({
  widgets,
  contenido,
  acomodando,
  onSubir,
  onBajar,
  onAgrandar,
  onAchicar,
}: RejillaInicioProps) {
  return (
    <div className={styles.rejilla}>
      {widgets.map((w) => {
        const dentro = contenido[w.clave]
        if (!dentro) return null
        const nombre = ETIQUETA_WIDGET[w.clave]
        return (
          <section
            key={w.clave}
            className={acomodando ? `${styles.celda} ${styles.celdaAcomodando}` : styles.celda}
            data-tamano={w.tamano}
            aria-label={acomodando ? nombre : undefined}
          >
            {acomodando ? (
              <div className={styles.barra}>
                <span className={styles.nombre}>{nombre}</span>
                {/* Cuánto ocupa, en palabras: con cuatro escalones, dos
                    flechas apagadas o encendidas no alcanzan para saber
                    dónde está uno parado. */}
                <span className={styles.tamano}>{ETIQUETA_TAMANO[w.tamano]}</span>
                <span className={styles.botones}>
                  <Boton
                    icono="arrow-up"
                    titulo={`Subir ${nombre}`}
                    activo={sePuedeSubir(widgets, w.clave)}
                    onClick={() => onSubir(w.clave)}
                  />
                  <Boton
                    icono="arrow-down"
                    titulo={`Bajar ${nombre}`}
                    activo={sePuedeBajar(widgets, w.clave)}
                    onClick={() => onBajar(w.clave)}
                  />
                  <Boton
                    icono="minus"
                    titulo={`Achicar ${nombre}`}
                    activo={sePuedeAchicar(w)}
                    onClick={() => onAchicar(w.clave)}
                  />
                  <Boton
                    icono="plus"
                    titulo={`Agrandar ${nombre}`}
                    activo={sePuedeAgrandar(w)}
                    onClick={() => onAgrandar(w.clave)}
                  />
                </span>
              </div>
            ) : null}
            {/* El bloque se dibuja SIEMPRE, también mientras se acomoda: mover
                una caja vacía con el nombre adentro no deja ver si el tamaño
                nuevo le queda bien, que es justo lo que uno está decidiendo. */}
            {dentro}
          </section>
        )
      })}
    </div>
  )
}

function Boton({
  icono,
  titulo,
  activo,
  onClick,
}: {
  icono: 'arrow-up' | 'arrow-down' | 'minus' | 'plus'
  titulo: string
  activo: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={styles.boton}
      title={titulo}
      aria-label={titulo}
      disabled={!activo}
      onClick={onClick}
    >
      <Icon name={icono} size={16} />
    </button>
  )
}
