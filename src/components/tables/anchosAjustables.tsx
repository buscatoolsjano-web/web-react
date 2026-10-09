import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { anchosDe, aplicarArrastre, guardarAnchos, leerAnchos, MIN_PX } from './anchoDeColumnas'
import { TiradorDeAncho } from './TiradorDeAncho'
import type { Column } from './types'

/**
 * Columnas que se agarran del borde y se ensanchan (Fase 58 · E6).
 *
 * «También quiero yo poder ir modificando el tamaño de las columnas, tipo ir
 * agarrando y ampliarlo, achicarlo».
 *
 * Vive acá y no dentro de una tabla porque hay DOS clases de tabla en la app y
 * las dos lo necesitan: la `ResponsiveTable` común, que recorre un array de
 * columnas, y las tablas escritas a mano con `Tabla.module.css` —el catálogo y
 * los precios—, donde cada `th` está puesto a mano en el JSX.
 *
 * Para esas, el ancho va en el `style` de cada `th` y NO en un `colgroup`: un
 * colgroup tendría que mantenerse en el mismo orden y la misma cantidad que
 * una docena de `th` condicionales, y el día que alguien agregue una columna y
 * se olvide del colgroup la tabla entera se desalinea sin avisar. En el `th`
 * no hay nada que mantener sincronizado.
 *
 * REQUISITO: la tabla tiene que estar en `table-layout: fixed`. Con el `auto`
 * del navegador, el ancho de un `th` es una sugerencia que se ignora en cuanto
 * el contenido es más ancho. El catálogo ya está en `fixed` desde la Fase 39.
 */
export interface AnchosAjustables {
  /** El ancho actual de una columna, en píxeles. */
  ancho: (clave: string) => number
  /** Para el `style` del `th`. */
  estilo: (clave: string) => CSSProperties
  /** El borde que se agarra. Va dentro del `th`, que tiene que ser `position: relative`. */
  tirador: (clave: string, etiqueta: string) => ReactNode
}

/**
 * @param id      Con qué nombre se recuerdan en este navegador. `undefined`
 *                desactiva todo y deja la tabla como estaba.
 * @param columnas Las columnas ajustables, para saber su ancho de arranque.
 */
export function useAnchosAjustables(
  id: string | undefined,
  columnas: readonly Column<unknown>[],
): AnchosAjustables | null {
  /* Lo guardado se lee UNA vez, en el inicializador del estado. Leerlo en un
     efecto agregaría un render con los anchos iniciales y la tabla pegaría un
     salto visible al montarse. */
  const [guardados, setGuardados] = useState<Record<string, number>>(() => (id ? leerAnchos(id) : {}))

  // Las columnas aparecen y desaparecen (atributos por categoría, columnas
  // condicionales), así que los anchos se recalculan desde ellas.
  const claves = columnas.map((c) => c.key).join('|')
  const valores = useMemo(
    () => (id ? anchosDe(columnas, guardados) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `claves` representa a `columnas`: el array es nuevo en cada render.
    [id, guardados, claves],
  )

  const arrastrar = useCallback(
    (clave: string, anchoAlEmpezar: number, deltaPx: number, final: boolean) => {
      if (!id) return
      setGuardados((prev) => {
        const siguiente = aplicarArrastre(anchosDe(columnas, prev), clave, anchoAlEmpezar, deltaPx)
        // Se guarda sólo al soltar: escribir en cada píxel del arrastre
        // golpearía localStorage cientos de veces por gesto.
        if (final) guardarAnchos(id, siguiente)
        return siguiente
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ídem.
    [id, claves],
  )

  return useMemo(() => {
    if (!id) return null
    const ancho = (clave: string) => valores[clave] ?? MIN_PX
    return {
      ancho,
      estilo: (clave) => ({ width: `${ancho(clave)}px` }),
      tirador: (clave, etiqueta) => (
        <TiradorDeAncho key={`tirador-${clave}`} clave={clave} etiqueta={etiqueta} ancho={ancho(clave)} onArrastrar={arrastrar} />
      ),
    }
  }, [id, valores, arrastrar])
}

