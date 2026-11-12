import type { FacturaListada } from '../services/facturas'
import { celda } from './csv'

/**
 * El listado de facturas de venta, filtrado y ordenado EN EL NAVEGADOR.
 *
 * Las facturas se traen todas (cientos, no miles) y acá se filtran y ordenan:
 * así la pantalla funciona igual que los otros listados de Ventas —buscar,
 * cliente, estado, fechas, orden por columna— sin una RPC nueva.
 */
export type OrdenFacturasVenta = 'numero' | 'cliente' | 'fecha' | 'total' | 'estado'

export interface FiltrosFacturasVenta {
  q: string
  cliente: string
  estado: string
  desde: string
  hasta: string
  orden: OrdenFacturasVenta
  direccion: 'asc' | 'desc'
}

export const FILTROS_FACTURAS_VENTA: FiltrosFacturasVenta = {
  q: '',
  cliente: '',
  estado: '',
  desde: '',
  hasta: '',
  orden: 'fecha',
  direccion: 'desc',
}

export const ESTADOS_FACTURA_VENTA: Record<string, { texto: string; tono: 'neutral' | 'info' | 'success' | 'danger' }> = {
  draft: { texto: 'Borrador', tono: 'neutral' },
  issued: { texto: 'Emitida', tono: 'info' },
  paid: { texto: 'Cobrada', tono: 'success' },
  cancelled: { texto: 'Anulada', tono: 'danger' },
}

export const estadoDeFactura = (e: string) => ESTADOS_FACTURA_VENTA[e] ?? { texto: e, tono: 'neutral' as const }

const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function filtrarFacturas(filas: readonly FacturaListada[], f: FiltrosFacturasVenta): FacturaListada[] {
  const q = normal(f.q.trim())
  const salen = filas.filter(
    (x) =>
      (q === '' ||
        normal(x.numero).includes(q) ||
        normal(x.numeroExterno ?? '').includes(q) ||
        normal(x.pedidoNumero ?? '').includes(q) ||
        normal(x.cliente).includes(q)) &&
      (f.cliente === '' || x.cliente === f.cliente) &&
      (f.estado === '' || x.estado === f.estado) &&
      (f.desde === '' || x.fecha.slice(0, 10) >= f.desde) &&
      (f.hasta === '' || x.fecha.slice(0, 10) <= f.hasta),
  )
  const signo = f.direccion === 'asc' ? 1 : -1
  const clave = (x: FacturaListada): string | number => {
    switch (f.orden) {
      case 'numero':
        return x.numero
      case 'cliente':
        return normal(x.cliente)
      case 'total':
        return x.total
      case 'estado':
        return estadoDeFactura(x.estado).texto
      default:
        return x.fecha
    }
  }
  return [...salen].sort((a, b) => {
    const ka = clave(a)
    const kb = clave(b)
    const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'es', { numeric: true })
    return c !== 0 ? c * signo : b.numero.localeCompare(a.numero, 'es', { numeric: true })
  })
}

export function facturasVentaACsv(filas: readonly FacturaListada[]): string {
  const lineas = [['Numero', 'Cliente', 'Fecha', 'Pedido', 'Numero en Tango', 'Estado', 'Moneda', 'Total'].join(';')]
  for (const x of filas) {
    lineas.push(
      [
        celda(x.numero),
        celda(x.cliente),
        celda(x.fecha.slice(0, 10)),
        celda(x.pedidoNumero),
        celda(x.numeroExterno),
        celda(estadoDeFactura(x.estado).texto),
        celda(x.moneda),
        celda(x.total.toFixed(2)),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}
