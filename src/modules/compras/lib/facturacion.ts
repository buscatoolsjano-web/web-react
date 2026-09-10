import { tasaDe } from './tratamientos'
import type { LineaAFacturar } from '../services/facturas'
import type { DiferenciaConPedido, LineaFactura } from '../types'
import type { TotalesPrevios } from './lineas'

/**
 * Previsualización de los totales de una factura.
 *
 * La misma cuenta que hace `app.totales_factura_proveedor()`: neto por línea y
 * después IVA con la alícuota de su tratamiento. **El total que vale es el del
 * servidor**; esto existe para mostrar algo mientras se carga, antes de
 * guardar. Si las dos cuentas difieren, la que está mal es ésta.
 *
 * No hay descuento global ni percepción: no existen en el schema de facturas
 * de proveedor y no se inventan.
 */
export function totalesDeFactura(lineas: readonly LineaAFacturar[]): TotalesPrevios {
  const redondear = (n: number) => Math.round(n * 100) / 100
  let bruto = 0
  let neto = 0
  let iva = 0
  for (const l of lineas) {
    bruto += l.cantidad * l.precioUnitario
    const n = l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100)
    neto += n
    // La alícuota sale del TRATAMIENTO, igual que en el servidor. Tomar sólo
    // `tasaImpuesto` daba 0 mientras nadie tocara el desplegable —la línea
    // nace con la tasa en null— y la pantalla mostraba «Impuesto USD 0,00»
    // en una factura con IVA. En `other` sí manda la que se escribió, que es
    // el único caso donde el servidor la acepta del cliente.
    const tasa = l.tratamientoImpuesto === 'other' ? l.tasaImpuesto : tasaDe(l.tratamientoImpuesto)
    iva += n * ((tasa ?? 0) / 100)
  }
  const subtotal = redondear(neto)
  const impuesto = redondear(iva)
  return {
    bruto: redondear(bruto),
    descuento: redondear(bruto - neto),
    subtotal,
    impuesto,
    total: redondear(subtotal + impuesto),
  }
}

/**
 * Cuánto de la factura sale de mercadería y cuánto no.
 *
 * Sirve para que la ficha pueda decir de un vistazo qué parte corresponde a
 * cosas que llegaron y qué parte a fletes, seguros y gastos.
 */
export function repartoDeLineas(lineas: readonly LineaFactura[]): {
  conRecepcion: number
  sinRecepcion: number
  netoConRecepcion: number
  netoSinRecepcion: number
} {
  let conRecepcion = 0
  let sinRecepcion = 0
  let netoConRecepcion = 0
  let netoSinRecepcion = 0
  for (const l of lineas) {
    if (l.goodsReceiptLineId !== null) {
      conRecepcion += 1
      netoConRecepcion += l.netoServidor
    } else {
      sinRecepcion += 1
      netoSinRecepcion += l.netoServidor
    }
  }
  return {
    conRecepcion,
    sinRecepcion,
    netoConRecepcion: Math.round(netoConRecepcion * 100) / 100,
    netoSinRecepcion: Math.round(netoSinRecepcion * 100) / 100,
  }
}

/**
 * Las diferencias entre la factura y el pedido.
 *
 * Se **derivan** de lo que ya está en las líneas: no hay tabla de
 * discrepancias y no se creó una. Se comparan el precio y el tratamiento de
 * impuesto contra el snapshot de la orden. La cantidad no se compara contra la
 * orden sino contra lo recibido, y de eso ya se ocupa la sobre-facturación.
 *
 * Es un aviso, no un bloqueo: el proveedor puede facturar distinto de lo que
 * se le pidió, y eso hay que poder cargarlo.
 */
export function diferenciasConPedido(lineas: readonly LineaFactura[]): DiferenciaConPedido[] {
  const salida: DiferenciaConPedido[] = []
  for (const l of lineas) {
    if (l.purchaseOrderLineId === null) continue
    if (l.precioPedido !== null && Math.abs(l.precioPedido - l.precioUnitario) > 0.0001) {
      salida.push({
        lineaId: l.id,
        numeroLinea: l.numeroLinea,
        tipo: 'precio',
        enPedido: String(l.precioPedido),
        enFactura: String(l.precioUnitario),
      })
    }
    if (l.tratamientoPedido !== null && l.tratamientoPedido !== l.tratamientoImpuesto) {
      salida.push({
        lineaId: l.id,
        numeroLinea: l.numeroLinea,
        tipo: 'impuesto',
        enPedido: l.tratamientoPedido,
        enFactura: l.tratamientoImpuesto,
      })
    }
  }
  return salida
}
