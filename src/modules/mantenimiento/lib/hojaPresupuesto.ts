import type { DocumentoImprimible as HojaVentas } from '@/modules/ventas/lib/impresion'
import { etiquetaDeServicio, etiquetaDeTipoLinea } from './estados'
import type { LineaCotizacion, OrdenDetalle } from '../types'

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
