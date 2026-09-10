import type { DocumentoDetalle, LineaDocumento, TipoDocumento } from '../types'

/**
 * El modelo de lo que se imprime.
 *
 * Se arma **sólo con los snapshots del documento**. Nunca se consulta el
 * precio ni el nombre actual del producto, ni se recalcula un total: un
 * documento de 2026-01 tiene que imprimirse hoy exactamente como se imprimió
 * entonces, y 19 de los 288 históricos no cierran sus totales. Reconstruirlos
 * los "arreglaría" y perderíamos el dato.
 */

/** Los seis formatos del legacy, con los mismos nombres. */
export type FormatoImpresion =
  | 'valorado'
  | 'sin-valorar'
  | 'sin-impuestos'
  | 'pro-forma'
  | 'sin-totales'
  | 'ticket'

export const FORMATOS: { valor: FormatoImpresion; etiqueta: string }[] = [
  { valor: 'valorado', etiqueta: 'Valorado' },
  { valor: 'sin-valorar', etiqueta: 'Sin valorar' },
  { valor: 'sin-impuestos', etiqueta: 'Sin impuestos' },
  { valor: 'pro-forma', etiqueta: 'Pro forma' },
  { valor: 'sin-totales', etiqueta: 'Sin totales' },
  { valor: 'ticket', etiqueta: 'Ticket' },
]

export interface OpcionesImpresion {
  formato: FormatoImpresion
  /** Los precios de la línea ya incluyen el impuesto. */
  preciosConImpuestos: boolean
  papel: 'A4' | 'carta'
}

export const OPCIONES_INICIALES: OpcionesImpresion = {
  formato: 'valorado',
  preciosConImpuestos: false,
  papel: 'A4',
}

/** Qué muestra cada formato. Es la misma tabla del legacy, explícita. */
export interface QueMostrar {
  precios: boolean
  impuestos: boolean
  totales: boolean
  ticket: boolean
  /** El encabezado dice PRO FORMA en vez del nombre del documento. */
  proForma: boolean
}

export function queMostrar(formato: FormatoImpresion): QueMostrar {
  return {
    precios: formato !== 'sin-valorar',
    impuestos: formato !== 'sin-valorar' && formato !== 'sin-impuestos',
    totales: formato !== 'sin-valorar' && formato !== 'sin-totales',
    ticket: formato === 'ticket',
    proForma: formato === 'pro-forma',
  }
}

export const TITULO_DE: Record<TipoDocumento, string> = {
  cotizacion: 'COTIZACIÓN DE VENTA',
  pedido: 'PEDIDO DE VENTA',
  entrega: 'NOTA DE ENTREGA',
}

export interface EmpresaImpresion {
  nombre: string
  razonSocial: string | null
  cuit: string | null
  direccion: string | null
  telefono: string | null
  email: string | null
  web: string | null
  color: string
}

export interface LineaImpresa {
  id: string
  esCapitulo: boolean
  numero: number | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  cantidad: number
  /** Ya con el impuesto adentro si la opción lo pide. */
  precio: number | null
  descuentoPct: number
  subtotal: number | null
}

export interface DocumentoImprimible {
  titulo: string
  numero: string
  fecha: string
  cliente: string
  contacto: string | null
  moneda: string | null
  formaPago: string | null
  notas: string | null
  lineas: LineaImpresa[]
  subtotal: number | null
  impuesto: number | null
  total: number | null
  /** El documento del que salió, si lo hay. */
  origen: string | null
  esHistorico: boolean
}

function subtotalDeLinea(l: LineaDocumento, factorImpuesto: number): number | null {
  if (l.precioUnitario === null) return null
  const precio = l.precioUnitario * factorImpuesto
  return precio * l.cantidad * (1 - (l.descuentoPct ?? 0) / 100)
}

/**
 * Arma el documento a imprimir.
 *
 * `subtotal`, `impuesto` y `total` salen TAL CUAL del documento guardado. La
 * única cuenta que se hace acá es el subtotal por línea, que es presentación:
 * si no coincide con el total del documento, el que manda es el del
 * documento — y eso es exactamente lo que pasa en 19 cotizaciones históricas.
 */
export function construirImprimible(
  doc: DocumentoDetalle,
  opciones: OpcionesImpresion,
): DocumentoImprimible {
  const ver = queMostrar(opciones.formato)

  return {
    titulo: ver.proForma ? 'PRO FORMA' : TITULO_DE[doc.tipo],
    numero: doc.numero,
    fecha: doc.fecha,
    cliente: doc.clienteNombre,
    contacto: doc.contactoNombre,
    moneda: doc.moneda,
    formaPago: doc.formaPago,
    notas: doc.notas,
    lineas: doc.lineas.map((l, i) => {
      // El "precio con impuestos incluidos" usa la alícuota de LA LÍNEA, no
      // un 21 % fijo: el legacy multiplicaba por 1,21 siempre y eso miente
      // en cualquier línea con 10,5 % o exenta.
      const factor = opciones.preciosConImpuestos ? 1 + (l.tasaImpuesto ?? 0) / 100 : 1
      return {
        id: l.id,
        esCapitulo: l.tipoLinea === 'chapter',
        numero: l.numeroLinea ?? i + 1,
        sku: l.sku,
        nombre: l.nombre,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio: l.precioUnitario === null ? null : l.precioUnitario * factor,
        descuentoPct: l.descuentoPct ?? 0,
        subtotal: subtotalDeLinea(l, factor),
      }
    }),
    subtotal: doc.subtotal,
    impuesto: doc.impuesto,
    total: doc.total,
    origen: doc.origen?.numero ?? null,
    esHistorico: doc.esHistorico,
  }
}

/**
 * Nombre del archivo, con el mismo formato que el legacy:
 * `fecha - número - cliente - título`.
 */
export function nombreDeArchivo(doc: DocumentoImprimible, extension: string): string {
  const limpiar = (s: string) =>
    s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
  return (
    [doc.fecha.slice(0, 10), doc.numero, doc.cliente].map(limpiar).filter(Boolean).join(' - ') +
    '.' +
    extension
  )
}
