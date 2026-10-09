import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ATRIBUTO_HUECO, prepararMarco } from '../lib/htmlSeguro'
import styles from './Composer.module.css'

export interface PapelDeCartaProps {
  /** El envoltorio de la empresa, con su `{{cuerpo}}` sin rellenar. */
  envoltorio: string
  /** El cuadro de texto, que se monta en el hueco del envoltorio. */
  children: ReactNode
  /** Qué dibujar si no hay envoltorio utilizable: el cuadro pelado. */
  sinMarco: ReactNode
}

/**
 * La hoja con el membrete puesto, para escribir ENCIMA (Fase 59 · E2).
 *
 * EL PEDIDO. «No quiero escribir en una caja vacía y después tener que ver el
 * formato, ni que haya un botón que diga ver cómo se vería. Yo quiero escribir
 * directamente así, con este rectángulo blanco, e ir escribiendo sobre esto, y
 * que siempre esté la plantilla puesta».
 *
 * CÓMO. El envoltorio sale de `plantillas_para_enviar`, la MISMA RPC que usa
 * el envío, así que el membrete que se ve es el que va a salir: no hay una
 * segunda implementación que pueda divergir. `prepararMarco` le cambia el
 * `{{cuerpo}}` por un ancla vacía, y el cuadro de texto se monta ahí con un
 * portal de React.
 *
 * POR QUÉ UN PORTAL Y NO PARTIR EL HTML EN DOS. El envoltorio es una tabla y
 * el hueco vive dentro de un `<td>`. Cortar el string dejaría la primera mitad
 * con etiquetas abiertas, el navegador las cerraría solo, y el cuadro
 * terminaría fuera de la celda —sin el ancho, sin la tipografía y sin el
 * color que le da la plantilla—.
 *
 * LO QUE NO ES. No es un editor de texto enriquecido: lo que se escribe sigue
 * siendo texto plano y el HTML lo arma el servidor escapándolo, igual que
 * antes. Lo único que cambió es que ahora se ve el papel mientras se escribe.
 *
 * SIN ENVOLTORIO, el cuadro pelado. Una empresa sin plantilla tiene que poder
 * mandar un mail igual.
 */
export function PapelDeCarta({ envoltorio, children, sinMarco }: PapelDeCartaProps) {
  const marco = useMemo(() => prepararMarco(envoltorio), [envoltorio])
  const [hueco, setHueco] = useState<HTMLElement | null>(null)

  /*
   * El HTML del marco se escribe A MANO en el nodo, no con
   * `dangerouslySetInnerHTML`.
   *
   * Con el atributo de React el portal se monta —se vio en el DOM— y después
   * React vuelve a aplicar el `innerHTML` al confirmar el render siguiente y
   * se lleva puesto el cuadro de texto: quedaba la hoja perfecta y sin dónde
   * escribir. Poniéndolo nosotros, React no tiene hijos declarados para ese
   * div y no lo toca nunca más, así que lo único que vive ahí adentro es el
   * portal.
   *
   * Y un ref de callback y no un efecto: el nodo del hueco no existe hasta que
   * el div está en el DOM, y hacerlo desde un efecto pediría un `setState`
   * adentro de un efecto —lo que el lint del proyecto marca, con razón—.
   */
  const montar = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        setHueco(null)
        return
      }
      el.innerHTML = marco.html
      setHueco(el.querySelector<HTMLElement>(`[${ATRIBUTO_HUECO}]`))
    },
    [marco.html],
  )

  if (!marco.tieneHueco) return <>{sinMarco}</>

  return (
    <div className={styles.papel}>
      {/*
        `key` con el HTML del marco: si la plantilla cambia, React reusaría el
        mismo div y el ref de callback no se volvería a ejecutar, con lo cual
        quedaría el membrete viejo y el portal apuntando a un nodo que ya no
        está en el documento. Con el key, el div se remonta.
      */}
      <div key={marco.html} ref={montar} className={styles.hoja} />
      {hueco ? createPortal(children, hueco) : null}
    </div>
  )
}
