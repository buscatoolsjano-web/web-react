import { supabase } from '@/services/supabase/client'
import type { PaginaDeProductos, ProductoDelCliente } from '../types'

/**
 * «¿Qué compra este cliente?» (Fase 17 · E4).
 *
 * El cálculo va del lado del servidor, en `productos_del_cliente`, por las dos
 * razones de siempre: el volumen —Grupo Mirgor tiene 397 productos distintos y
 * 772 líneas con precio— y que `security invoker` hace que RLS se aplique a
 * quien llama. Si un vendedor no ve al cliente, no ve qué compra.
 *
 * Lo **cotizado** y lo **pedido** vuelven en columnas separadas y nunca se
 * suman: una cotización es una pregunta que el cliente hizo y un pedido es una
 * compra que hizo. Llamar «vendido» a lo primero sería inventar una venta que
 * no existió.
 */

function aNumero(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

interface Fila {
  product_id: string | null
  sku: string | null
  nombre: string | null
  moneda: string | null
  cotizaciones: number | string
  pedidos: number | string
  cantidad_cotizada: number | string | null
  cantidad_pedida: number | string | null
  ultima_fecha: string | null
  ultimo_tipo: string
  ultimo_documento_id: string | null
  ultimo_numero: string | null
  ultima_cantidad: number | string | null
  ultimo_precio: number | string | null
  total_filas: number | string
}

export async function productosDelCliente(
  clienteId: string,
  opciones: { texto?: string | null; pagina?: number; porPagina?: number } = {},
): Promise<PaginaDeProductos> {
  const porPagina = opciones.porPagina ?? 25
  const pagina = opciones.pagina ?? 1

  const { data, error } = await supabase.rpc('productos_del_cliente', {
    p_customer: clienteId,
    p_texto: opciones.texto?.trim() || null,
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  })
  if (error) throw new Error(`No se pudieron leer los productos: ${error.message}`)

  const filas = (data ?? []) as unknown as Fila[]
  return {
    filas: filas.map(
      (f): ProductoDelCliente => ({
        productId: f.product_id,
        sku: f.sku,
        nombre: f.nombre,
        moneda: f.moneda,
        cotizaciones: aNumero(f.cotizaciones) ?? 0,
        pedidos: aNumero(f.pedidos) ?? 0,
        cantidadCotizada: aNumero(f.cantidad_cotizada),
        cantidadPedida: aNumero(f.cantidad_pedida),
        ultimaFecha: f.ultima_fecha,
        ultimoTipo: f.ultimo_tipo === 'pedido' ? 'pedido' : 'cotizacion',
        ultimoDocumentoId: f.ultimo_documento_id,
        ultimoNumero: f.ultimo_numero,
        ultimaCantidad: aNumero(f.ultima_cantidad),
        ultimoPrecio: aNumero(f.ultimo_precio),
      }),
    ),
    // `total_filas` viene con `count(*) over ()`: el total antes de paginar,
    // calculado por la base en la misma pasada.
    total: filas.length > 0 ? (aNumero(filas[0]!.total_filas) ?? 0) : 0,
  }
}
