/**
 * El ancho de una columna según LO QUE TIENE ADENTRO (Fase 66).
 *
 * ── El pedido ───────────────────────────────────────────────────────────────
 *
 * «Lo que es torque mínimo siempre van a ser un número y Nm, entonces la
 * columna no puede ser así de grande. Lo mismo con la serie: hay tres series
 * de tres letras nada más. Si no, no se ven las otras columnas».
 *
 * Tenía razón y la causa era boba: toda columna de texto arrancaba en 220 px
 * fijos, mirara lo que mirara. «Serie» con tres letras ocupaba exactamente lo
 * mismo que «Modelo», y entre las dos empujaban el precio fuera de la
 * pantalla.
 *
 * ── Por qué no alcanza con medir los valores ────────────────────────────────
 *
 * La regla literal —«si el dato más largo tiene tres caracteres, que se vean
 * tres caracteres»— deja la columna inusable, y hay dos motivos concretos:
 *
 *   1. EL ENCABEZADO suele ser más largo que el dato. «Torque mín. Nm» mide
 *      bastante más que «13 Nm». Una columna del ancho del dato mostraría
 *      «Torq…» y nadie sabría de qué columna se trata.
 *   2. EL FILTRO vive en la segunda fila del encabezado y es un `<select>`.
 *      Uno de 40 px no se puede ni abrir, y además tiene que entrar su opción
 *      más larga más la flecha.
 *
 * Así que el ancho es el MAYOR de los tres —dato, encabezado y filtro— y no
 * sólo el del dato. Que es lo que el pedido quiere decir en la práctica:
 * ninguna columna más ancha de lo que necesita.
 */

/*
 * Los tres números de abajo están MEDIDOS en la tabla real, no supuestos.
 *
 * La primera versión los supuso —24 de padding, 22 de flecha— y daba la
 * respuesta correcta por compensación: sobraban 8 de padding y faltaban 5 de
 * flecha. Andaba, y se habría roto el día que alguien corrigiera uno solo de
 * los dos. Con los valores de verdad, cada uno se puede ajustar sin tener que
 * descubrir que el otro lo estaba tapando.
 */

/** Padding de la celda y del encabezado: 8 px de cada lado. */
const PADDING_PX = 16

/**
 * La flecha de ordenar y su hueco, al lado del título. Medida: 27 px; va uno
 * más para que un redondeo a subpíxel no corte la última letra.
 */
const CABECERA_EXTRA_PX = 28

/**
 * Lo que un `<select>` de filtro le suma a su opción más larga: su propio
 * padding y la flecha del desplegable.
 */
const FILTRO_EXTRA_PX = 30

/** Lo más angosto que puede quedar una columna sin dejar de ser legible. */
export const MIN_CONTENIDO_PX = 56

/**
 * Lo más ancho que se le permite a una columna por su contenido.
 *
 * Es MÁS BAJO que el tope del arrastre a propósito. Un nombre larguísimo en
 * una sola fila no puede decidir el ancho de la columna para las otras
 * cuarenta y nueve: a partir de acá se corta con puntos suspensivos, que es lo
 * que ya hacía. Quien necesite verlo entero puede arrastrar el borde, y el
 * valor completo sigue en el `title` de la celda.
 */
export const MAX_CONTENIDO_PX = 320

export interface MedidasDeColumna {
  /** Lo que mide el texto del encabezado. */
  cabecera: number
  /** Lo que mide cada valor visible de la columna. */
  valores: readonly number[]
  /** Lo que mide la opción más larga del filtro, si la columna tiene filtro. */
  filtro?: number | undefined
}

/**
 * El ancho que necesita una columna, en píxeles.
 *
 * Es PURA y recibe las medidas ya tomadas: medir texto necesita un canvas y la
 * tipografía real, y eso no se puede probar. Separado así, lo que se verifica
 * acá es la decisión —a quién le gana quién, qué pasa sin datos, dónde se
 * corta— que es donde están los errores que importan.
 */
export function anchoNecesario(m: MedidasDeColumna): number {
  const dato = m.valores.length > 0 ? Math.max(...m.valores) : 0
  const necesario = Math.max(
    dato + PADDING_PX,
    m.cabecera + PADDING_PX + CABECERA_EXTRA_PX,
    m.filtro !== undefined ? m.filtro + PADDING_PX + FILTRO_EXTRA_PX : 0,
  )
  return Math.min(MAX_CONTENIDO_PX, Math.max(MIN_CONTENIDO_PX, Math.ceil(necesario)))
}

/**
 * Los anchos de todas las columnas, sin que se achiquen al pasar de página.
 *
 * SE MIDE LO QUE SE VE, que son las cincuenta filas de la página. Eso solo
 * haría que las columnas bailaran al paginar: un modelo largo en la página 5
 * ensancharía la columna, y volver a la 4 la angostaría de nuevo. Moverse por
 * un listado no puede reacomodar la tabla en cada paso.
 *
 * Por eso el ancho sólo CRECE mientras las columnas sean las mismas. Cuando
 * cambia el juego de columnas —otra categoría, otros atributos— se arranca de
 * cero, que es cuando de verdad corresponde volver a medir.
 */
export function anchosQueSoloCrecen(
  previos: Readonly<Record<string, number>>,
  medidos: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [clave, px] of Object.entries(medidos)) {
    const antes = previos[clave]
    out[clave] = antes !== undefined && antes > px ? antes : px
  }
  return out
}

/** Si cambió el juego de columnas, lo medido antes ya no corresponde. */
export function mismasColumnas(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
