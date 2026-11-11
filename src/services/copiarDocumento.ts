import { supabase } from '@/services/supabase/client'

/**
 * «Duplicar como…» (Fase 233).
 *
 * «Cuando pongo duplicar no quiero solamente duplicar eso mismo. Si hago una
 * cotización, quiero poder duplicarla pero en formato de compra: si la tengo
 * que mandar a un pedido proveedor, duplico el mismo formato pero para pedido
 * proveedor. Y así con todo.»
 *
 * Cómo: la copia NO se crea sola. Se abre el ALTA del documento destino con
 * las líneas ya cargadas (`?copiar=<tipo>:<id>`), y ahí se elige lo que el
 * origen no puede saber —el proveedor de una compra, el cliente de una venta
 * que vino de una compra— y se guarda por el camino de siempre: misma
 * numeración, misma validación. Lo peor que pasa es un borrador descartado.
 *
 * Qué se copia: título, observaciones, moneda y las líneas (producto,
 * referencia, nombre, descripción, cantidad, descuento, impuesto, y las notas
 * entre líneas). El precio depende del cruce:
 *   · Mismo lado (cotización ↔ pedido de venta): el mismo precio.
 *   · Venta → compra: vacío. Un precio de venta no es lo que se le paga al
 *     proveedor, y el formulario de compras ya muestra al lado de cada línea
 *     el último precio pagado (y a propósito nunca lo autocompleta).
 *   · Compra → venta: el de la tarifa del documento (lo resuelve la página,
 *     igual que el carrito del catálogo); sin tarifa, 0 y se avisa.
 */

export type TipoCopiable = 'cotizacion' | 'pedido' | 'pedido_compra'

export const DESTINOS: readonly { tipo: TipoCopiable; nombre: string; lado: 'venta' | 'compra' }[] = [
  { tipo: 'cotizacion', nombre: 'Cotización de venta', lado: 'venta' },
  { tipo: 'pedido', nombre: 'Pedido de venta', lado: 'venta' },
  { tipo: 'pedido_compra', nombre: 'Pedido a proveedor', lado: 'compra' },
]

const RUTA_NUEVO: Record<TipoCopiable, string> = {
  cotizacion: '/ventas/cotizaciones/nueva',
  pedido: '/ventas/pedidos/nuevo',
  pedido_compra: '/compras/pedidos/nuevo',
}

export const ladoDe = (t: TipoCopiable): 'venta' | 'compra' => (t === 'pedido_compra' ? 'compra' : 'venta')

/** Si al copiar se cruza de venta a compra o al revés: ahí el precio no viaja. */
export const cruzaDeLado = (origen: TipoCopiable, destino: TipoCopiable): boolean => ladoDe(origen) !== ladoDe(destino)

export function rutaDeCopia(destino: TipoCopiable, origen: TipoCopiable, id: string): string {
  return `${RUTA_NUEVO[destino]}?copiar=${origen}:${encodeURIComponent(id)}`
}

/** Lee `?copiar=<tipo>:<id>`. Cualquier otra cosa es `null`. */
export function leerParametroCopia(valor: string | null): { tipo: TipoCopiable; id: string } | null {
  if (!valor) return null
  const i = valor.indexOf(':')
  if (i <= 0) return null
  const tipo = valor.slice(0, i)
  const id = valor.slice(i + 1)
  if (tipo !== 'cotizacion' && tipo !== 'pedido' && tipo !== 'pedido_compra') return null
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return { tipo, id }
}

export interface LineaCopiada {
  esNota: boolean
  productId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  cantidad: number
  /** `null` cuando no viaja (venta → compra) o el origen no lo tenía. */
  precioUnitario: number | null
  descuentoPct: number
  tratamientoImpuesto: string
  tasaImpuesto: number | null
}

export interface DocumentoCopiado {
  origen: TipoCopiable
  numero: string | null
  titulo: string | null
  notas: string | null
  moneda: string | null
  lineas: LineaCopiada[]
}

type FilaLinea = {
  line_type: string | null
  product_id: string | null
  sku_snapshot: string | null
  name_snapshot: string | null
  description_snapshot: string | null
  unit_price: number | null
  discount_pct: number | null
  tax_treatment: string | null
  tax_rate_snapshot: number | null
}

const aLinea = (l: FilaLinea, cantidad: number | null): LineaCopiada => ({
  esNota: l.line_type === 'chapter',
  productId: l.product_id,
  sku: l.sku_snapshot,
  nombre: l.name_snapshot,
  descripcion: l.description_snapshot,
  cantidad: Number(cantidad ?? 0),
  precioUnitario: l.unit_price === null ? null : Number(l.unit_price),
  descuentoPct: Number(l.discount_pct ?? 0),
  tratamientoImpuesto: l.tax_treatment ?? 'vat_21',
  tasaImpuesto: l.tax_rate_snapshot === null ? null : Number(l.tax_rate_snapshot),
})

const COLS = `line_no, line_type, product_id, sku_snapshot, name_snapshot, description_snapshot,
  unit_price, discount_pct, tax_treatment, tax_rate_snapshot`

/**
 * Lee un documento en la forma común de «para copiar». Acotado SIEMPRE por
 * empresa: una copia nunca cruza de Buscatools a Torquetools.
 */
export async function leerParaCopiar(companyId: string, tipo: TipoCopiable, id: string): Promise<DocumentoCopiado> {
  if (tipo === 'cotizacion') {
    const [cab, lin] = await Promise.all([
      supabase.from('sales_quotes').select('number, title, notes, currency_code').eq('company_id', companyId).eq('id', id).single(),
      supabase.from('sales_quote_lines').select(`${COLS}, quantity`).eq('company_id', companyId).eq('quote_id', id).order('line_no'),
    ])
    if (cab.error) throw new Error(`No se pudo leer la cotización: ${cab.error.message}`)
    if (lin.error) throw new Error(`No se pudieron leer las líneas: ${lin.error.message}`)
    return {
      origen: tipo,
      numero: cab.data.number,
      titulo: cab.data.title,
      notas: cab.data.notes,
      moneda: cab.data.currency_code,
      lineas: (lin.data ?? []).map((l) => aLinea(l as FilaLinea, l.quantity)),
    }
  }
  if (tipo === 'pedido') {
    const [cab, lin] = await Promise.all([
      supabase.from('sales_orders').select('number, title, notes, currency_code').eq('company_id', companyId).eq('id', id).single(),
      supabase.from('sales_order_lines').select(`${COLS}, quantity_ordered`).eq('company_id', companyId).eq('order_id', id).order('line_no'),
    ])
    if (cab.error) throw new Error(`No se pudo leer el pedido: ${cab.error.message}`)
    if (lin.error) throw new Error(`No se pudieron leer las líneas: ${lin.error.message}`)
    return {
      origen: tipo,
      numero: cab.data.number,
      titulo: cab.data.title,
      notas: cab.data.notes,
      moneda: cab.data.currency_code,
      lineas: (lin.data ?? []).map((l) => aLinea(l as FilaLinea, l.quantity_ordered)),
    }
  }
  const [cab, lin] = await Promise.all([
    supabase.from('purchase_orders').select('number, notes, currency_code').eq('company_id', companyId).eq('id', id).single(),
    supabase.from('purchase_order_lines').select(`${COLS}, quantity`).eq('company_id', companyId).eq('purchase_order_id', id).order('line_no'),
  ])
  if (cab.error) throw new Error(`No se pudo leer el pedido de compra: ${cab.error.message}`)
  if (lin.error) throw new Error(`No se pudieron leer las líneas: ${lin.error.message}`)
  return {
    origen: tipo,
    numero: cab.data.number,
    titulo: null,
    notas: cab.data.notes,
    moneda: cab.data.currency_code,
    lineas: (lin.data ?? []).map((l) => aLinea(l as FilaLinea, l.quantity)),
  }
}
