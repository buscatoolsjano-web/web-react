import { supabase } from '@/services/supabase/client'

/**
 * Facturas de venta (Fase 29 · E7).
 *
 * Módulo propio y no una rama más de `documentos.ts` a propósito: ahí el tipo
 * `TipoDocumento` está cableado en la configuración, en las rutas, en las
 * etiquetas y en media docena de componentes. Ampliarlo para una tabla que
 * recién nace sería mover todo el módulo de Ventas para estrenar una
 * pantalla. Cuando la factura tenga el mismo peso que un pedido —edición,
 * hoja imprimible, adjuntos— se unifican.
 */

export interface FacturaListada {
  id: string
  numero: string
  fecha: string
  clienteId: string | null
  cliente: string
  moneda: string
  total: number
  estado: string
  /** El número que devuelva Tango cuando se sincronice. Null = todavía no. */
  numeroExterno: string | null
  pedidoId: string | null
  pedidoNumero: string | null
}

export interface LineaFactura {
  id: string
  sku: string
  nombre: string
  cantidad: number
  precioUnitario: number
  descuentoPct: number
  tasaImpuesto: number
}

export interface FacturaDetalle extends FacturaListada {
  subtotal: number
  impuestos: number
  lineas: LineaFactura[]
}

const COLUMNAS =
  'id, number, invoice_date, customer_id, currency_code, total, status, external_number, order_id,' +
  ' cliente:customers ( legal_name, trade_name ), pedido:sales_orders ( number )'

type FilaCliente = { legal_name: string | null; trade_name: string | null } | null

/**
 * La fila tal como vuelve de PostgREST.
 *
 * Escrita a mano y no como `Record<string, unknown>`: con el Record hay que
 * pasar cada campo por `String()`, y eso convierte en `"[object Object]"`
 * cualquier columna que mañana devuelva un objeto, sin que nada avise. Con el
 * tipo puesto, eso lo agarra el compilador.
 */
interface FilaFactura {
  id: string
  number: string | null
  invoice_date: string | null
  customer_id: string | null
  currency_code: string | null
  total: number | string | null
  status: string | null
  external_number: string | null
  order_id: string | null
  cliente: FilaCliente
  pedido: { number: string } | null
  subtotal?: number | string | null
  tax_amount?: number | string | null
}

function nombreCliente(c: FilaCliente): string {
  return c?.trade_name ?? c?.legal_name ?? 'Sin cliente'
}

function aListada(f: FilaFactura): FacturaListada {
  return {
    id: f.id,
    numero: f.number ?? '',
    fecha: f.invoice_date ?? '',
    clienteId: f.customer_id,
    cliente: nombreCliente(f.cliente),
    moneda: f.currency_code ?? '',
    total: Number(f.total ?? 0),
    estado: f.status ?? 'draft',
    numeroExterno: f.external_number,
    pedidoId: f.order_id,
    pedidoNumero: f.pedido?.number ?? null,
  }
}

export async function listarFacturas(companyId: string): Promise<FacturaListada[]> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .order('invoice_date', { ascending: false })
    .order('number', { ascending: false })
    .limit(200)

  if (error) throw new Error(`No se pudieron leer las facturas: ${error.message}`)
  return (data ?? []).map((f) => aListada(f as unknown as FilaFactura))
}

export async function obtenerFactura(companyId: string, id: string): Promise<FacturaDetalle | null> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(`${COLUMNAS}, subtotal, tax_amount`)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer la factura: ${error.message}`)
  if (!data) return null

  const { data: filas, error: errorLineas } = await supabase
    .from('sales_invoice_lines')
    .select('id, sku_snapshot, name_snapshot, quantity, unit_price, discount_pct, tax_rate_snapshot')
    .eq('invoice_id', id)
    .order('created_at')

  if (errorLineas) throw new Error(`No se pudieron leer las líneas: ${errorLineas.message}`)

  const f = data as unknown as FilaFactura
  return {
    ...aListada(f),
    subtotal: Number(f.subtotal ?? 0),
    impuestos: Number(f.tax_amount ?? 0),
    lineas: (filas ?? []).map((l) => ({
      id: String(l.id),
      sku: l.sku_snapshot ?? '',
      nombre: l.name_snapshot ?? '',
      cantidad: Number(l.quantity ?? 0),
      precioUnitario: Number(l.unit_price ?? 0),
      descuentoPct: Number(l.discount_pct ?? 0),
      tasaImpuesto: Number(l.tax_rate_snapshot ?? 0),
    })),
  }
}

/**
 * Emitir la factura de un pedido.
 *
 * Nace en `draft` y con número interno (FAC-BTS…): el número fiscal lo da
 * AFIP por Tango, y hasta que la API esté enchufada esto no pretende ser el
 * comprobante. Un pedido no se puede facturar dos veces — lo corta la RPC,
 * no la pantalla.
 */
export async function crearFacturaDesdePedido(
  orderId: string,
  fecha?: string | null,
): Promise<{ id: string; numero: string }> {
  const { data, error } = await supabase.rpc('crear_factura_desde_pedido', {
    p_order: orderId,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { id?: string; numero?: string }
  return { id: String(r.id ?? ''), numero: String(r.numero ?? '') }
}
