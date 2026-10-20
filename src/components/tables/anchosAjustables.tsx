import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  anchosDe,
  aplicarArrastre,
  encogerParaQueEntre,
  guardarAnchos,
  leerAnchos,
  MIN_PX,
} from './anchoDeColumnas'
import { anchoNecesario, anchosQueSoloCrecen, mismasColumnas } from './anchoPorContenido'
import { medidorDe } from './medirTexto'
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
 * Una columna que además se puede medir por su contenido (Fase 66).
 *
 * `valores` son los textos que se ven AHORA en esa columna. Si vienen, el
 * ancho de arranque sale de medirlos en vez del valor por omisión del tipo,
 * que era 220 px para toda columna de texto y dejaba a «Serie» —tres letras—
 * tan ancha como «Modelo».
 */
export interface ColumnaMedible extends Column<unknown> {
  valores?: readonly string[]
  /** Las opciones del filtro de la columna, si tiene uno en el encabezado. */
  opcionesDeFiltro?: readonly string[]
}

/**
 * @param id      Con qué nombre se recuerdan en este navegador. `undefined`
 *                desactiva todo y deja la tabla como estaba.
 * @param columnas Las columnas ajustables, para saber su ancho de arranque.
 * @param refTabla La tabla, para leer de ahí la tipografía con la que medir.
 *                 Sin esto no se mide y valen los anchos de siempre.
 */
export function useAnchosAjustables(
  id: string | undefined,
  columnas: readonly ColumnaMedible[],
  refTabla?: RefObject<HTMLTableElement | null>,
): AnchosAjustables | null {
  /* Lo guardado se lee UNA vez, en el inicializador del estado. Leerlo en un
     efecto agregaría un render con los anchos iniciales y la tabla pegaría un
     salto visible al montarse. */
  const [guardados, setGuardados] = useState<Record<string, number>>(() => (id ? leerAnchos(id) : {}))

  // Las columnas aparecen y desaparecen (atributos por categoría, columnas
  // condicionales), así que los anchos se recalculan desde ellas.
  const claves = columnas.map((c) => c.key).join('|')

  /**
   * LO QUE MIDE EL CONTENIDO (Fase 66).
   *
   * En `useLayoutEffect` y no en `useEffect`: para medir hace falta que la
   * tabla exista, así que hay un segundo render sí o sí. `useLayoutEffect`
   * corre ANTES de que el navegador pinte, y entonces ese segundo render no
   * se ve. Con `useEffect` la tabla aparecía con los anchos viejos y pegaba
   * un salto.
   */
  const [medidos, setMedidos] = useState<Record<string, number>>({})
  const clavesMedidas = useRef<string[]>([])
  // Las celdas cambian de contenido sin cambiar de columna —paginar, filtrar—
  // y entonces hay que volver a medir.
  const huella = columnas.map((c) => `${c.key}:${(c.valores ?? []).join('\u0001')}`).join('\u0002')

  useLayoutEffect(() => {
    const tabla = refTabla?.current
    if (!id || !tabla) return
    // El encabezado y las celdas tienen tipografías distintas —el `th` es más
    // chico—, así que se mide cada uno con la suya.
    const medirCabecera = medidorDe(tabla.querySelector('thead th'))
    const medirCelda = medidorDe(tabla.querySelector('tbody td') ?? tabla.querySelector('thead th'))
    if (!medirCabecera || !medirCelda) return

    const nuevos: Record<string, number> = {}
    for (const c of columnas) {
      if (!c.valores) continue
      const opciones = c.opcionesDeFiltro ?? []
      nuevos[c.key] = anchoNecesario({
        cabecera: medirCabecera(c.header ?? c.key),
        valores: c.valores.map(medirCelda),
        ...(opciones.length > 0 ? { filtro: Math.max(...opciones.map(medirCelda)) } : {}),
      })
    }

    setMedidos((prev) => {
      const ahora = columnas.map((c) => c.key)
      // Si cambió el juego de columnas se arranca de cero: arrastrar el ancho
      // de unas columnas que ya no están no tiene sentido.
      const base = mismasColumnas(clavesMedidas.current, ahora) ? prev : {}
      clavesMedidas.current = ahora
      const siguiente = anchosQueSoloCrecen(base, nuevos)
      // Sin esto el `setState` dispara un render por cada medición aunque no
      // haya cambiado nada, y medir en layout haría un bucle.
      const igual =
        Object.keys(siguiente).length === Object.keys(prev).length &&
        Object.entries(siguiente).every(([k, v]) => prev[k] === v)
      return igual ? prev : siguiente
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `huella` representa a `columnas` con sus valores.
  }, [id, huella, refTabla])

  /**
   * CUÁNTO LUGAR HAY PARA LAS COLUMNAS AJUSTABLES (Fase 86).
   *
   * «Necesito poder ver todas las columnas de una, no tener que ir achicando.»
   *
   * El ancho de cada columna sale de medir su contenido, y eso está bien
   * mirado columna por columna. Pero nadie miraba la SUMA: con
   * `table-layout: fixed`, cuando los anchos declarados suman más que la
   * tabla, el navegador no los reparte —hace la tabla más ancha y aparece el
   * scroll—. En «Puntas y tubos» son cuatro columnas de atributos arriba de
   * las cinco de siempre, y nueve columnas midiendo bien no entran.
   *
   * El presupuesto es lo que queda después de las columnas que NO son
   * ajustables —casillero, miniatura, referencia, stock, precio, carrito—,
   * que declaran su ancho en el CSS. No hace falta saber cuáles son: lo que
   * la tabla ocupa menos lo que estamos pidiendo nosotros ES lo que ocupan
   * ellas. Y se mide con `fixed` puesto, así que ese número es exacto aunque
   * la tabla esté desbordando en ese momento.
   */
  /** Lo que cada columna PIDE: lo guardado si lo hay, y si no lo medido. */
  const pedidos = useMemo(
    () => (id ? anchosDe(columnas, { ...medidos, ...guardados }) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `claves` representa a `columnas`: el array es nuevo en cada render.
    [id, guardados, medidos, claves],
  )
  const [presupuesto, setPresupuesto] = useState(0)

  useLayoutEffect(() => {
    const tabla = refTabla?.current
    const caja = tabla?.parentElement
    if (!id || !tabla || !caja) return

    const medir = () => {
      /*
       * Las fijas se miden UNA POR UNA, y no restando lo nuestro del total.
       *
       * Restar era lo primero que salía —«lo que ocupa la tabla menos lo que
       * pedimos»— y se muerde la cola: en cuanto el encogido se aplica, la
       * tabla ya no ocupa lo pedido sino lo encogido, así que la resta da de
       * menos, el presupuesto sube, las columnas se estiran, vuelven a no
       * entrar, y la tabla late.
       *
       * Acá el presupuesto no depende de nuestros anchos en absoluto: se
       * suman las columnas que NO controlamos. Se reconocen porque las
       * nuestras —y sólo las nuestras— llevan el ancho en el `style` de la
       * etiqueta; las otras lo declaran en el CSS. Con `table-layout: fixed`
       * esas se cobran su ancho exacto aunque la tabla esté desbordando, así
       * que el número vale incluso mientras el problema está pasando.
       */
      const encabezados = tabla.querySelectorAll<HTMLTableCellElement>('thead tr:first-child th')
      let fijas = 0
      for (const th of encabezados) if (th.style.width === '') fijas += th.offsetWidth

      setPresupuesto((prev) => {
        // `clientWidth` y no `offsetWidth`: la caja es la que scrollea, y lo
        // que importa es su interior visible, sin la barra si la hay.
        const siguiente = Math.max(0, Math.round(caja.clientWidth - fijas))
        // Un píxel de diferencia no justifica repintar la tabla entera, y sin
        // este corte el observador y el layout se persiguen.
        return Math.abs(siguiente - prev) <= 1 ? prev : siguiente
      })
    }

    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(caja)
    return () => observador.disconnect()
  // `claves` entra porque un juego de columnas distinto puede traer otras
  // columnas fijas —el stock sólo se ve para roles internos— y entonces el
  // presupuesto cambia sin que la caja haya cambiado de tamaño.
  }, [id, claves, refTabla])

  const valores = useMemo(() => {
    if (!id) return {}
    /*
     * Y encima de todo eso, que entre. Se encoge lo PEDIDO y no lo ya
     * encogido: si la ventana se agranda, las columnas vuelven solas a su
     * ancho medido en vez de quedarse chicas para siempre.
     *
     * Encoger no deshace el arrastre: reparte a prorrata, así que una columna
     * que alguien ensanchó sigue teniendo más que las demás. Lo que no puede
     * es sacar la última columna de la pantalla, que es lo que se pidió.
     */
    return encogerParaQueEntre(pedidos, presupuesto)
  }, [id, pedidos, presupuesto])

  const arrastrar = useCallback(
    (clave: string, anchoAlEmpezar: number, deltaPx: number, final: boolean) => {
      if (!id) return
      setGuardados((prev) => {
        /*
         * Se guarda SÓLO la columna que se arrastró.
         *
         * Antes esto era `aplicarArrastre(anchosDe(columnas, prev), ...)`, que
         * expande el mapa a TODAS las columnas con su ancho por omisión. Daba
         * igual mientras el ancho por omisión fuera el único que había; desde
         * que el ancho sale de medir el contenido (Fase 66) sería un
         * desastre: arrastrar una sola columna guardaba 220 px para las
         * demás y pisaba la medición para siempre, en este navegador, sin que
         * nadie hubiera tocado esas columnas.
         */
        const siguiente = aplicarArrastre(prev, clave, anchoAlEmpezar, deltaPx)
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

