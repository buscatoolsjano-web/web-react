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
  | 'alias'
  | 'sku'
  | 'alias_sin_cantidad'
  | 'modelo'
  | 'referencia_vieja'
  | 'parecido'
  | 'sin_match'

export type MetodoCliente = 'cuit' | 'nombre_exacto' | 'parecido'

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
  'alias',
  'sku',
  'alias_sin_cantidad',
  'modelo',
  'referencia_vieja',
]
const DUROS_CLIENTE: readonly MetodoCliente[] = ['cuit', 'nombre_exacto']

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
  lineas: readonly LineaEmparejada[]
}): string[] {
  const falta: string[] = []
  if (estado.clienteId === null) falta.push('Elegí a qué cliente corresponde la orden.')
  if (estado.numero.trim() === '') falta.push('Escribí el número de la orden de compra.')
  if (estado.lineas.length === 0) falta.push('La orden no tiene ninguna línea.')
  return falta
}

/**
 * Cómo presentar cada método, para que el que revisa sepa de qué fiarse.
 *
 * El texto importa más que el número: «lo emparejó una persona» y «se parece
 * al nombre» se revisan distinto, aunque la confianza sea parecida.
 */
export const EXPLICACION_LINEA: Record<MetodoLinea, string> = {
  alias: 'Ya se había emparejado antes para este cliente',
  sku: 'El código es nuestra referencia',
  alias_sin_cantidad: 'Se había emparejado antes, con otra cantidad',
  modelo: 'El código es el modelo del fabricante',
  referencia_vieja: 'El código es una referencia nuestra anterior',
  parecido: 'Se parece al nombre: conviene confirmarlo',
  sin_match: 'No se encontró en el catálogo',
}

export const EXPLICACION_CLIENTE: Record<MetodoCliente, string> = {
  cuit: 'Coincide el CUIT',
  nombre_exacto: 'Coincide el nombre',
  parecido: 'Se parece al nombre: conviene confirmarlo',
}
