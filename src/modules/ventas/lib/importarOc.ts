/**
 * Importar la OC del cliente: las decisiones de la pantalla (Fase 30 · E6).
 *
 * Las RPC de la base emparejan y devuelven candidatos con su confianza y su
 * método. Lo que se decide acá es **qué hace la pantalla con eso**: cuándo
 * puede elegir sola y cuándo tiene que preguntar.
 *
 * El criterio, en una línea: se elige solo cuando el dato es DURO —un CUIT,
 * nuestra referencia, un alias que alguien confirmó— y se pregunta cuando es
 * un parecido, por bueno que sea. Un parecido de 0,97 sigue siendo un parecido.
 */

/** Cómo se encontró. Viene de las RPC; el orden es de más a menos confiable. */
export type MetodoLinea =
  /** Lo eligio una persona en la pantalla. La fuente mas confiable que hay. */
  | 'manual'
  | 'alias'
  | 'sku'
  | 'alias_sin_cantidad'
  | 'modelo'
  | 'referencia_vieja'
  | 'parecido'
  | 'sin_match'

export type MetodoCliente =
  /**
   * Alguien ya dijo, en una OC anterior, que este texto es este cliente.
   *
   * Va PRIMERO —antes que el CUIT— porque es lo único que puede aportar algo
   * que el documento no dice. El caso que lo motivó: la OC de Mabe trae el
   * logo como imagen y, en texto, la razón social de otra sociedad del grupo.
   */
  | 'memoria'
  | 'cuit'
  | 'nombre_exacto'
  | 'parecido'
  /**
   * No lo eligió el emparejador: lo acaba de crear una persona desde el
   * importador (Fase 40).
   *
   * No sale de la base como los otros cuatro —el emparejador nunca lo
   * devuelve—; lo pone la pantalla cuando el alta rápida termina bien. Está
   * acá y no como un caso aparte para que el cartel de «por qué este cliente»
   * tenga una respuesta también en ese camino, en vez de quedar mudo justo
   * cuando el vínculo es más nuevo y menos comprobado.
   */
  | 'creado'

export interface CandidatoCliente {
  customerId: string
  nombre: string | null
  cuit: string | null
  metodo: MetodoCliente
  confianza: number
}

export interface LineaEmparejada {
  n: number
  codigo: string | null
  descripcion: string | null
  cantidad: number
  precio: number | null
  productId: string | null
  sku: string | null
  nombre: string | null
  metodo: MetodoLinea
  confianza: number
}

export interface CandidataCotizacion {
  quoteId: string
  numero: string
  fecha: string
  estado: string
  total: number
  moneda: string | null
  lineasEnComun: number
  lineasOc: number
  cobertura: number
}

/**
 * Los métodos que se consideran un dato duro.
 *
 * `parecido` queda afuera a propósito, y es la decisión central de todo esto:
 * los trigramas devuelven el más parecido que encontraron, no el correcto. Con
 * 21.775 productos siempre hay algo que se parece.
 */
const DUROS_LINEA: readonly MetodoLinea[] = [
  'manual',
  'alias',
  'sku',
  'alias_sin_cantidad',
  'modelo',
  'referencia_vieja',
]
const DUROS_CLIENTE: readonly MetodoCliente[] = ['memoria', 'cuit', 'nombre_exacto']

/**
 * A qué cliente se importa, si se puede saber sin preguntar.
 *
 * Hacen falta dos cosas: que haya **uno solo** y que el método sea duro. Dos
 * candidatos con el mismo nombre exacto son dos empresas distintas con el
 * mismo nombre, y elegir una por orden alfabético es peor que preguntar:
 * equivocarse de cliente manda la mercadería a otra empresa.
 */
export function clienteAutomatico(candidatos: readonly CandidatoCliente[]): CandidatoCliente | null {
  if (candidatos.length !== 1) return null
  const c = candidatos[0]!
  return DUROS_CLIENTE.includes(c.metodo) ? c : null
}

/** Una línea que alguien tiene que mirar antes de importar. */
export function necesitaRevision(l: LineaEmparejada): boolean {
  return l.productId === null || !DUROS_LINEA.includes(l.metodo)
}

export function lineasARevisar(lineas: readonly LineaEmparejada[]): LineaEmparejada[] {
  return lineas.filter(necesitaRevision)
}

/**
 * El resumen que se muestra arriba de la tabla.
 *
 * `sinProducto` y `aConfirmar` se cuentan separados porque son dos problemas
 * distintos: uno es «no sé qué es esto» y el otro «creo que es esto, miralo».
 * Juntarlos en un solo número escondería cuál de los dos hay.
 */
export interface ResumenLineas {
  total: number
  resueltas: number
  aConfirmar: number
  sinProducto: number
}

export function resumirLineas(lineas: readonly LineaEmparejada[]): ResumenLineas {
  let resueltas = 0
  let aConfirmar = 0
  let sinProducto = 0
  for (const l of lineas) {
    if (l.productId === null) sinProducto += 1
    else if (DUROS_LINEA.includes(l.metodo)) resueltas += 1
    else aConfirmar += 1
  }
  return { total: lineas.length, resueltas, aConfirmar, sinProducto }
}

/**
 * Si falta algo para poder importar, devuelve QUÉ falta.
 *
 * Las líneas sin producto NO frenan: entran a la cotización con el texto del
 * cliente y se completan después. Lo que frena es lo que dejaría un registro
 * sin sentido —sin cliente no se sabe a quién, sin número no se puede
 * reconocer después, sin líneas no es una orden de compra—.
 */
export function faltaParaImportar(estado: {
  clienteId: string | null
  numero: string
  /** Las que LEYÓ la IA, no las emparejadas. Ver abajo. */
  lineasLeidas: number
}): string[] {
  const falta: string[] = []
  if (estado.clienteId === null) falta.push('Elegí a qué cliente corresponde la orden.')
  if (estado.numero.trim() === '') falta.push('Escribí el número de la orden de compra.')
  /**
   * Se cuentan las líneas LEÍDAS y no las emparejadas.
   *
   * El emparejado necesita saber el cliente —los alias son por cliente—, así
   * que antes de elegirlo no hay líneas emparejadas. Mirando ésas, la pantalla
   * decía «La orden no tiene ninguna línea» sobre una orden con cinco líneas
   * perfectamente leídas. Era mentira y mandaba a buscar el problema al PDF.
   */
  if (estado.lineasLeidas === 0) falta.push('No se leyó ninguna línea en el documento.')
  return falta
}

/**
 * Cómo presentar cada método, para que el que revisa sepa de qué fiarse.
 *
 * El texto importa más que el número: «lo emparejó una persona» y «se parece
 * al nombre» se revisan distinto, aunque la confianza sea parecida.
 */
export const EXPLICACION_LINEA: Record<MetodoLinea, string> = {
  manual: 'Lo elegiste vos',
  alias: 'Ya se había emparejado antes para este cliente',
  sku: 'El código es nuestra referencia',
  alias_sin_cantidad: 'Se había emparejado antes, con otra cantidad',
  modelo: 'El código es el modelo del fabricante',
  referencia_vieja: 'El código es una referencia nuestra anterior',
  parecido: 'Se parece al nombre: conviene confirmarlo',
  sin_match: 'No se encontró en el catálogo',
}

export const EXPLICACION_CLIENTE: Record<MetodoCliente, string> = {
  memoria: 'Ya lo habías corregido para este mismo documento',
  cuit: 'Coincide el CUIT',
  nombre_exacto: 'Coincide el nombre',
  parecido: 'Se parece al nombre: conviene confirmarlo',
  creado: 'Lo creaste recién, desde esta misma orden',
}
