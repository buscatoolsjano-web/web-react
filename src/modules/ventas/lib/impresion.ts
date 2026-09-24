import { formatearDomicilio } from './formato'
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
  /**
   * El documento lleva la foto del producto (Fase 19 · E6).
   *
   * Es una decisión del FORMATO, no de cada línea: cuando está en `true`, la
   * columna de la foto existe en TODAS las filas aunque el producto no tenga
   * imagen. Un producto con foto y uno sin foto no pueden mover las columnas.
   */
  conFotos: boolean
}

export const OPCIONES_INICIALES: OpcionesImpresion = {
  formato: 'valorado',
  preciosConImpuestos: false,
  papel: 'A4',
  conFotos: false,
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
  /** La alícuota de la línea, que el legacy muestra en la columna IMP. */
  impuestoPct: number | null
  /** La foto del producto, si el formato las lleva y el producto tiene una. */
  foto: string | null
}

export interface DocumentoImprimible {
  /** El tipo real, para las etiquetas propias de cada documento. */
  tipo: TipoDocumento
  titulo: string
  /** El título comercial del documento, debajo del tipo. */
  subtitulo: string | null
  numero: string
  fecha: string
  cliente: string
  /** El CUIT del cliente, cuando está cargado. */
  clienteCuit: string | null
  contacto: string | null
  moneda: string | null
  formaPago: string | null
  /** Quién lo emitió, cuando el documento lo tiene cargado. */
  vendedor: string | null
  /** Sólo el remito: el domicilio congelado al emitirlo (Fase 15 · E6). */
  domicilioEntrega: string | null
  /** Sólo el remito, y sólo lo que se haya registrado al emitirlo. */
  transporte: string | null
  seguimiento: string | null
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
  /** Foto por producto. Sólo se pide cuando el formato las lleva. */
  fotos?: ReadonlyMap<string, string>,
): DocumentoImprimible {
  const ver = queMostrar(opciones.formato)

  return {
    tipo: doc.tipo,
    titulo: ver.proForma ? 'PRO FORMA' : TITULO_DE[doc.tipo],
    subtitulo: doc.titulo,
    numero: doc.numero,
    fecha: doc.fecha,
    cliente: doc.clienteNombre,
    clienteCuit: doc.clienteCuit,
    contacto: doc.contactoNombre,
    moneda: doc.moneda,
    formaPago: doc.formaPago,
    vendedor: doc.vendedor,
    // El remito dice adónde fue. Si no se registró, no se pone la dirección
    // de hoy del cliente: no es la misma información.
    domicilioEntrega: doc.tipo === 'entrega' ? formatearDomicilio(doc.domicilioEntrega) : null,
    transporte: doc.tipo === 'entrega' ? doc.transporte : null,
    seguimiento: doc.tipo === 'entrega' ? doc.seguimiento : null,
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
        impuestoPct: l.tasaImpuesto,
        foto: opciones.conFotos && l.productId ? (fotos?.get(l.productId) ?? null) : null,
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

/**
 * El documento a imprimir armado desde un BORRADOR, sin guardarlo
 * (Fase 19 · E3).
 *
 * Es la misma estructura que `construirImprimible` y por lo tanto el mismo
 * `VistaImpresion`: **no hay dos formatos del documento**, que era el problema
 * del legacy —una plantilla para la pantalla y otra para el papel, que
 * divergían—.
 *
 * Dos diferencias, y las dos son honestas:
 *
 * - **no hay número**: lo asigna el servidor al crear, así que se dice eso en
 *   vez de inventar uno o dejar el lugar vacío;
 * - **los totales son del borrador**: se calculan acá como previsualización.
 *   `impuesto` y `total` van en `null` a propósito —los calcula el servidor con
 *   el descuento global y la percepción—, igual que en el bloque de totales de
 *   la pantalla de alta.
 */
export function imprimibleDelBorrador(
  tipo: TipoDocumento,
  datos: {
    fecha: string
    cliente: string
    clienteCuit?: string | null
    titulo?: string | null
    contacto: string | null
    moneda: string | null
    formaPago: string | null
    notas: string | null
    lineas: readonly LineaDocumento[]
  },
  opciones: OpcionesImpresion,
): DocumentoImprimible {
  const ver = queMostrar(opciones.formato)
  let subtotal = 0

  const lineas: LineaImpresa[] = datos.lineas.map((l, i) => {
    const factor = opciones.preciosConImpuestos ? 1 + (l.tasaImpuesto ?? 0) / 100 : 1
    const sub = subtotalDeLinea(l, factor)
    if (l.tipoLinea !== 'chapter' && sub !== null) subtotal += sub
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
      subtotal: sub,
      impuestoPct: l.tasaImpuesto,
      // El borrador todavía no consulta fotos: no hay documento que imprimir.
      foto: null,
    }
  })

  return {
    tipo,
    titulo: ver.proForma ? 'PRO FORMA' : TITULO_DE[tipo],
    subtitulo: datos.titulo ?? null,
    numero: 'a asignar al crear',
    fecha: datos.fecha,
    cliente: datos.cliente,
    clienteCuit: datos.clienteCuit ?? null,
    contacto: datos.contacto,
    moneda: datos.moneda,
    formaPago: datos.formaPago,
    // El borrador no tiene vendedor ni datos de envío todavía: los pone el
    // documento cuando se crea, no la pantalla que lo está armando.
    vendedor: null,
    domicilioEntrega: null,
    transporte: null,
    seguimiento: null,
    notas: datos.notas,
    lineas,
    subtotal: lineas.length === 0 ? null : subtotal,
    impuesto: null,
    total: null,
    origen: null,
    // Un borrador nunca es histórico: el histórico es lo que migró.
    esHistorico: false,
  }
}

/**
 * Las formas de pago que usa la empresa (Fase 27 · E7).
 *
 * Las mismas del sistema anterior y en su orden. Es una lista para elegir, no
 * una validación: el campo sigue siendo texto libre en la base, así que un
 * documento viejo con otra forma de pago la conserva y se sigue viendo.
 */
export const FORMAS_DE_PAGO = [
  '30 DIAS F/F con ECHEQ',
  '15 DIAS F/F',
  '60 DIAS F/F',
  'Contado',
  '50% adelanto + 50% entrega',
] as const
