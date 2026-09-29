/**
 * Importar la orden de compra del cliente (Fase 30 · E2). Lógica PURA.
 *
 * Este archivo no importa nada de Deno a propósito: es lo que hace que lo
 * pueda correr vitest. La frontera con el mundo —HTTP, secrets, el PDF— vive
 * en `index.ts`.
 *
 * Lo que se juega acá es una sola cosa: **que un PDF mal leído no se convierta
 * en una cotización mal hecha**. La IA devuelve texto; el esquema garantiza la
 * FORMA, no el contenido. Un modelo puede devolver una cantidad negativa, un
 * precio como `"1.234,56"`, cuarenta líneas vacías o un número de OC de mil
 * caracteres, y todo eso pasa el `json_schema` sin despeinarse.
 *
 * Por eso `validarOcExtraida` desconfía de todo y prefiere rechazar antes que
 * dejar pasar algo raro: lo que sigue después es plata.
 */

/** Lo que se le pide a la IA que saque del PDF. */
export interface LineaOc {
  /** El código del producto tal como lo escribió el cliente, si lo puso. */
  codigo: string | null
  /** La descripción, tal cual. Es lo que más sirve para emparejar. */
  descripcion: string | null
  cantidad: number
  /** Unitario, sin impuestos. `null` cuando la OC no lo dice. */
  precio: number | null
}

export interface OcExtraida {
  /** El cliente según el PDF. No es nuestro id: eso se resuelve después. */
  cliente: { nombre: string | null; cuit: string | null }
  numero: string
  /** ISO `YYYY-MM-DD`, o null si no se pudo leer. */
  fecha: string | null
  /** ISO 4217, o null. */
  moneda: string | null
  lineas: LineaOc[]
}

/** Por qué no se pudo leer la OC. El motivo se le muestra a la persona. */
export type MotivoRechazo =
  | 'json_invalido'
  | 'sin_numero'
  | 'sin_lineas'
  | 'demasiadas_lineas'
  | 'cantidad_invalida'
  | 'linea_vacia'

export class OcInvalida extends Error {
  constructor(
    readonly motivo: MotivoRechazo,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'OcInvalida'
  }
}

/**
 * Tope de líneas. Una OC de más de 200 renglones existe, pero a esa altura
 * conviene que alguien la mire antes de que la IA invente doscientos matches.
 */
export const MAX_LINEAS = 200
/** Un número de OC más largo que esto es que la IA leyó un párrafo. */
export const MAX_LARGO_NUMERO = 60
const MAX_LARGO_TEXTO = 400

const MONEDAS = ['ARS', 'USD', 'EUR', 'BRL'] as const

/**
 * El esquema que se le exige al proveedor.
 *
 * Todo es nullable menos `numero` y `lineas`: es preferible que el modelo diga
 * «no estaba» a que invente una fecha o un CUIT. Un dato inventado en una OC
 * es peor que un dato faltante, porque nadie lo va a salir a verificar.
 */
export const ESQUEMA_OC = {
  type: 'object',
  additionalProperties: false,
  required: ['cliente', 'numero', 'fecha', 'moneda', 'lineas'],
  properties: {
    cliente: {
      type: 'object',
      additionalProperties: false,
      required: ['nombre', 'cuit'],
      properties: {
        nombre: { type: ['string', 'null'] },
        cuit: { type: ['string', 'null'] },
      },
    },
    numero: { type: 'string' },
    fecha: { type: ['string', 'null'] },
    moneda: { type: ['string', 'null'] },
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'descripcion', 'cantidad', 'precio'],
        properties: {
          codigo: { type: ['string', 'null'] },
          descripcion: { type: ['string', 'null'] },
          cantidad: { type: 'number' },
          precio: { type: ['number', 'null'] },
        },
      },
    },
  },
} as const

export const INSTRUCCIONES_OC = [
  'Sos un asistente que lee órdenes de compra de clientes industriales argentinos',
  'y devuelve sus datos en JSON. Trabajás sobre el texto plano de un PDF.',
  '',
  'Reglas:',
  '- Copiá los valores TAL COMO ESTÁN en el documento. No corrijas, no completes,',
  '  no traduzcas y no infieras nada que no esté escrito.',
  '- Si un dato no está, poné null. Nunca lo inventes ni lo deduzcas de otro.',
  '- `numero` es el número de la orden de compra del CLIENTE, no el de ninguna',
  '  cotización nuestra ni el de un remito.',
  '- `fecha` en formato YYYY-MM-DD. Ojo con el formato argentino: 03/07/2026 es',
  '  el 3 de julio, no el 7 de marzo. Si hay ambigüedad real, poné null.',
  '- `cantidad` es un número. Si la OC dice "10 un." o "10,00", devolvé 10.',
  '- `precio` es el UNITARIO sin impuestos. Si la OC sólo trae el total de la',
  '  línea, dividilo por la cantidad. Si no hay precio, null.',
  '- Los números van en formato JSON: punto decimal y sin separador de miles.',
  '  "1.234,56" se devuelve como 1234.56.',
  '- No incluyas como líneas los subtotales, el IVA, los totales, los textos',
  '  legales ni las condiciones de entrega.',
  '- Si el texto no parece una orden de compra, devolvé `lineas` vacío.',
].join('\n')

/** Lo que se le manda al modelo: el texto del PDF y nada más. */
export function construirEntradaOc(textoPdf: string): string {
  return ['Texto de la orden de compra:', '', textoPdf.trim()].join('\n')
}

const texto = (v: unknown, max = MAX_LARGO_TEXTO): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t === '' ? null : t
}

/**
 * Un número que vino como número, o como texto en formato argentino.
 *
 * El esquema pide `number`, pero los modelos devuelven `"1.234,56"` cada
 * tanto, y en JSON eso no falla: llega como string. Antes que rechazar la OC
 * entera por una coma, se intenta leerlo.
 *
 * El criterio para decidir qué es cada separador: **el último que aparece es
 * el decimal**. `1.234,56` → coma; `1,234.56` → punto. Con un solo separador y
 * exactamente tres dígitos detrás se lo trata como miles (`1.234` = 1234),
 * que es lo que casi siempre significa en una OC.
 */
export function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null

  const limpio = v.trim().replace(/\s/g, '')
  if (limpio === '') return null

  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let normalizado = limpio

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const decimal = ultimaComa > ultimoPunto ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    normalizado = limpio.split(miles).join('').replace(decimal, '.')
  } else if (ultimaComa >= 0) {
    const decimales = limpio.length - ultimaComa - 1
    normalizado = decimales === 3 ? limpio.split(',').join('') : limpio.replace(',', '.')
  } else if (ultimoPunto >= 0) {
    const decimales = limpio.length - ultimoPunto - 1
    if (decimales === 3) normalizado = limpio.split('.').join('')
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Sólo los dígitos: un CUIT llega con guiones, puntos o espacios. */
export function normalizarCuit(v: unknown): string | null {
  const t = texto(v, 40)
  if (t === null) return null
  const digitos = t.replace(/\D/g, '')
  return digitos.length === 11 ? digitos : null
}

/** `YYYY-MM-DD` y que además exista: el 31 de febrero no. */
export function normalizarFecha(v: unknown): string | null {
  const t = texto(v, 40)
  if (t === null) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) return null
  const [, a, mes, d] = m
  const fecha = new Date(`${a}-${mes}-${d}T00:00:00Z`)
  if (Number.isNaN(fecha.getTime())) return null
  // `new Date('2026-02-31')` no falla: rueda al 3 de marzo. Se compara de
  // vuelta para atrapar justamente eso.
  return fecha.toISOString().slice(0, 10) === t ? t : null
}

/**
 * Validar lo que devolvió la IA.
 *
 * Rechaza en vez de arreglar cuando el problema es de fondo —sin número, sin
 * líneas, una cantidad que no es un número— y limpia cuando es de forma —un
 * precio con coma, un texto con espacios de más—.
 *
 * Las líneas sin código NI descripción se descartan en silencio: son los
 * renglones en blanco que la IA a veces arrastra de la grilla del PDF. Pero si
 * después de descartarlas no queda ninguna, eso sí es un rechazo.
 */
export function validarOcExtraida(crudo: string): OcExtraida {
  let json: unknown
  try {
    json = JSON.parse(crudo)
  } catch {
    throw new OcInvalida('json_invalido', 'la respuesta no es JSON')
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new OcInvalida('json_invalido', 'la respuesta no es un objeto')
  }

  const o = json as Record<string, unknown>

  /**
   * Sin número NO se rechaza: se devuelve vacío y lo escribe la persona.
   *
   * Antes esto tiraba todo el documento a la basura. Es demasiado: el número
   * es un dato de UNA línea del PDF, y que la IA no lo encuentre —porque está
   * en un sello, porque el cliente no lo puso, porque el documento es otra
   * cosa— no invalida las veinte líneas de productos que sí leyó.
   *
   * La pantalla ya lo exige antes de importar (`faltaParaImportar`), que es
   * donde corresponde: la IA propone, la persona completa y confirma.
   */
  const numero = texto(o.numero, MAX_LARGO_NUMERO) ?? ''

  const crudas = Array.isArray(o.lineas) ? o.lineas : null
  if (crudas === null) throw new OcInvalida('sin_lineas', 'la respuesta no trae líneas')
  if (crudas.length > MAX_LINEAS) {
    throw new OcInvalida('demasiadas_lineas', `la orden trae más de ${MAX_LINEAS} líneas`)
  }

  const lineas: LineaOc[] = []
  for (const c of crudas) {
    if (typeof c !== 'object' || c === null) continue
    const l = c as Record<string, unknown>

    const codigo = texto(l.codigo, 120)
    const descripcion = texto(l.descripcion)
    // Sin código y sin descripción no hay nada que emparejar: es un renglón
    // vacío de la grilla, no una línea.
    if (codigo === null && descripcion === null) continue

    const cantidad = aNumero(l.cantidad)
    if (cantidad === null || cantidad <= 0) {
      throw new OcInvalida(
        'cantidad_invalida',
        `la línea «${(descripcion ?? codigo ?? '').slice(0, 40)}» no tiene una cantidad válida`,
      )
    }

    const precio = aNumero(l.precio)
    lineas.push({
      codigo,
      descripcion,
      cantidad,
      // Un precio negativo es un error de lectura, no un descuento.
      precio: precio !== null && precio >= 0 ? precio : null,
    })
  }

  if (lineas.length === 0) throw new OcInvalida('sin_lineas', 'no se leyó ninguna línea con producto')

  const cli = (typeof o.cliente === 'object' && o.cliente !== null ? o.cliente : {}) as Record<string, unknown>
  // Sólo se acepta una moneda que sepamos manejar. Una que no está en la
  // lista queda en null y la elige la persona: adivinarla es peor.
  const moneda = texto(o.moneda, 8)?.toUpperCase() ?? null

  return {
    cliente: { nombre: texto(cli.nombre, 200), cuit: normalizarCuit(cli.cuit) },
    numero,
    fecha: normalizarFecha(o.fecha),
    moneda: moneda !== null && (MONEDAS as readonly string[]).includes(moneda) ? moneda : null,
    lineas,
  }
}

// ── El PDF ────────────────────────────────────────────────────────────────

/**
 * Cuánto texto tiene que traer un PDF para que valga la pena mandárselo a la
 * IA.
 *
 * Un PDF escaneado —una foto adentro de un PDF— no tiene capa de texto: al
 * extraerlo salen cero caracteres, o un puñado de basura del encabezado. Si
 * eso llega al modelo, el modelo inventa: le pedimos una orden de compra y le
 * damos nada, y lo que devuelva va a ser verosímil y falso.
 *
 * Así que se corta ANTES, y se lo dice. 200 caracteres es poco para una OC de
 * verdad —un membrete solo ya los pasa— y suficiente para distinguir «esto no
 * tiene texto» de «esto es una orden corta».
 */
export const MIN_CARACTERES_PDF = 200

/** Tope del archivo. El bucket `ventas` acepta 20 MB; acá se corta antes. */
export const MAX_BYTES_PDF = 15 * 1024 * 1024

export type MotivoLectura = 'sin_archivo' | 'no_es_pdf' | 'demasiado_grande' | 'sin_texto' | 'ilegible'

export class PdfIlegible extends Error {
  constructor(
    readonly motivo: MotivoLectura,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'PdfIlegible'
  }
}

/**
 * Limpiar el texto que sale del PDF antes de mandarlo.
 *
 * Los extractores dejan saltos de línea por cada fragmento posicionado, así
 * que una tabla sale como cien renglones de una palabra. Colapsar los espacios
 * repetidos y las líneas vacías baja bastante los tokens sin perder la
 * estructura, porque los saltos simples se conservan.
 */
export function limpiarTextoPdf(crudo: string): string {
  return crudo
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Decide si el PDF sirve, y si no, por qué. */
export function revisarTextoPdf(crudo: string): string {
  const limpio = limpiarTextoPdf(crudo)
  if (limpio.length < MIN_CARACTERES_PDF) {
    throw new PdfIlegible(
      'sin_texto',
      'El PDF no tiene texto: parece escaneado o una foto. Por ahora sólo se pueden leer los PDF generados por un sistema.',
    )
  }
  return limpio
}
