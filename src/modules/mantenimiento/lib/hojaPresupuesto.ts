import type { DocumentoImprimible as HojaVentas } from '@/modules/ventas/lib/impresion'
import { etiquetaDeServicio, etiquetaDeTipoLinea } from './estados'
import type { LineaCotizacion, OrdenDetalle } from '../types'
import type { LoteDetalle } from '../services/lotes'

/**
 * El presupuesto de una orden de mantenimiento, en la MISMA hoja que Ventas.
 *
 * Logo, franjas y columnas iguales a una cotización comercial; cambian los
 * rótulos («Datos del servicio») y se agregan el equipo y su serie, que es lo
 * que el cliente necesita para saber de qué herramienta se le habla.
 */
export function aHojaDePresupuesto(orden: OrdenDetalle, lineas: readonly LineaCotizacion[]): HojaVentas {
  const impuesto = orden.total - orden.subtotal
  const equipo = [orden.activoModelo, orden.activoSerie ? `N° de serie ${orden.activoSerie}` : null]
    .filter(Boolean)
    .join(' · ')
  return {
    tipo: 'cotizacion',
    titulo: 'PRESUPUESTO DE SERVICIO',
    subtitulo: equipo === '' ? null : equipo,
    numero: orden.numero,
    fecha: orden.fechaIngreso,
    cliente: orden.cliente,
    clienteCuit: null,
    contacto: null,
    moneda: orden.moneda,
    formaPago: null,
    vendedor: orden.tecnico,
    domicilioEntrega: null,
    transporte: null,
    seguimiento: null,
    notas: orden.notasCotizacion,
    lineas: [...lineas]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l, i) => ({
        id: l.id,
        esCapitulo: false,
        numero: i + 1,
        sku: l.sku,
        nombre: l.descripcion ?? etiquetaDeTipoLinea(l.tipo),
        descripcion: l.descripcion ? etiquetaDeTipoLinea(l.tipo) : null,
        cantidad: l.cantidad,
        precio: l.precioUnitario,
        descuentoPct: 0,
        subtotal: l.total,
        impuestoPct: null,
        foto: null,
        partes: [],
      })),
    subtotal: orden.subtotal,
    impuesto: impuesto > 0.005 ? impuesto : null,
    total: orden.total,
    origen: null,
    esHistorico: false,
    rotulos: {
      bloqueDatos: 'Datos del servicio',
      bloqueContraparte: 'Datos del cliente',
      contraparte: 'Cliente',
      identificador: null,
    },
    datosExtra: [
      { etiqueta: 'Equipo', valor: orden.activoReferencia },
      { etiqueta: 'Servicio', valor: etiquetaDeServicio(orden.tipoServicio) },
      ...(orden.motivoIngreso ? [{ etiqueta: 'Motivo', valor: orden.motivoIngreso }] : []),
    ],
  }
}

export function asuntoDePresupuesto(orden: OrdenDetalle): string {
  return `Presupuesto de servicio ${orden.numero} · ${orden.activoModelo ?? orden.activoReferencia}`
}

export function cuerpoDePresupuesto(orden: OrdenDetalle): string {
  const equipo = [orden.activoModelo, orden.activoSerie ? `serie ${orden.activoSerie}` : null].filter(Boolean).join(', ')
  return (
    `Hola,\n\nTe adjunto el presupuesto ${orden.numero} por el servicio de ` +
    `${equipo === '' ? 'tu herramienta' : `la herramienta ${equipo}`}. ` +
    `Quedamos a la espera de tu aprobación para avanzar con la reparación.\n\nSaludos.`
  )
}

/**
 * El presupuesto de un LOTE: un capítulo por equipo (número de orden, modelo
 * y serie) y debajo sus líneas. Mismo formato que el de una orden.
 */
export function aHojaDeLote(lote: LoteDetalle): HojaVentas {
  const lineas: HojaVentas['lineas'] = []
  let n = 0
  for (const o of lote.ordenes) {
    lineas.push({
      id: `cap-${o.id}`,
      esCapitulo: true,
      numero: null,
      sku: null,
      nombre: [o.numero, o.modelo, o.serie ? `serie ${o.serie}` : null].filter(Boolean).join(' · '),
      descripcion: null,
      cantidad: 0,
      precio: null,
      descuentoPct: 0,
      subtotal: o.total,
      impuestoPct: null,
      foto: null,
      partes: [],
    })
    for (const l of [...o.lineas].sort((a, b) => a.posicion - b.posicion)) {
      n += 1
      lineas.push({
        id: l.id,
        esCapitulo: false,
        numero: n,
        sku: l.sku,
        nombre: l.descripcion ?? etiquetaDeTipoLinea(l.tipo),
        descripcion: l.descripcion ? etiquetaDeTipoLinea(l.tipo) : null,
        cantidad: l.cantidad,
        precio: l.precioUnitario,
        descuentoPct: 0,
        subtotal: l.total,
        impuestoPct: null,
        foto: null,
        partes: [],
      })
    }
  }
  return {
    tipo: 'cotizacion',
    titulo: 'PRESUPUESTO DE SERVICIO',
    subtitulo: `Lote ${lote.numero} · ${lote.equipos} ${lote.equipos === 1 ? 'equipo' : 'equipos'}`,
    numero: lote.numero,
    fecha: lote.creadoEn.slice(0, 10),
    cliente: lote.cliente,
    clienteCuit: null,
    contacto: null,
    moneda: lote.moneda,
    formaPago: null,
    vendedor: null,
    domicilioEntrega: null,
    transporte: null,
    seguimiento: null,
    notas: lote.notas,
    lineas,
    subtotal: lote.total,
    impuesto: null,
    total: lote.total,
    origen: null,
    esHistorico: false,
    rotulos: {
      bloqueDatos: 'Datos del servicio',
      bloqueContraparte: 'Datos del cliente',
      contraparte: 'Cliente',
      identificador: null,
    },
    datosExtra: [{ etiqueta: 'Órdenes', valor: lote.ordenes.map((o) => o.numero).join(', ') }],
  }
}

export function asuntoDeLote(lote: LoteDetalle): string {
  return `Presupuesto de servicio · lote ${lote.numero} (${lote.equipos} ${lote.equipos === 1 ? 'equipo' : 'equipos'})`
}

export function cuerpoDeLote(lote: LoteDetalle): string {
  return (
    `Hola,\n\nTe adjunto el presupuesto ${lote.numero} por el servicio de ${lote.equipos} ` +
    `${lote.equipos === 1 ? 'herramienta' : 'herramientas'}, con el detalle de cada una. ` +
    `Quedamos a la espera de tu aprobación para avanzar con las reparaciones.\n\nSaludos.`
  )
}
