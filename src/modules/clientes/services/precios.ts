import { supabase } from '@/services/supabase/client'
import type { PagRecordDePrecios, PrecioHistorico, UltimoPrecio } from '../types'

/**
 * Precios históricos del cliente.
 *
 * **No hay tabla de memoria de precios.** El legacy guardaba
 * `bterp_price_memory` en `localStorage`: un caché escrito al guardar cada
 * cotización, con `{ precio, precioAnterior, cotRef, qty, fecha, veces }` por
 * cliente y SKU, **sin moneda**. En el perfil real contenía nueve registros:
 * las nueve líneas de UNA cotización (Grupo Mirgor, COTI02530). Todo eso está
 * en `sales_quote_lines`, así que no se migró nada y no se creó ninguna tabla
 * equivalente.
 *
 * El cálculo va del lado del servidor, en dos funciones SQL. La razón no es
 * sólo el volumen —Grupo Mirgor tiene 772 líneas con precio— sino que
 * `security invoker` hace que RLS se aplique al que llama, y ambas exigen
 * además poder leer al cliente: si un vendedor no ve al cliente, no ve sus
 * precios.
 */

interface FilaHistorico {
  tipo: string
  documento_id: string
  numero: string
  fecha: string | null
  product_id: string | null
  sku: string | null
  nombre: string | null
  cantidad: number | string | null
  precio: number | string | null
  descuento_pct: number | string | null
  moneda: string | null
  total_filas: number | string
}

function aNumero(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const TIPOS = { cotizacion: 'cotizacion', pedido: 'pedido' } as const
function aTipo(v: string): PrecioHistorico['tipo'] {
  return v === 'pedido' ? TIPOS.pedido : TIPOS.cotizacion
}

export async function preciosHistoricos(
  clienteId: string,
  opciones: { productId?: string | null; pagina?: number; porPagina?: number } = {},
): Promise<PagRecordDePrecios> {
  const porPagina = opciones.porPagina ?? 50
  const pagina = opciones.pagina ?? 1

  const { data, error } = await supabase.rpc('precios_historicos_cliente', {
    p_customer: clienteId,
    p_product: opciones.productId ?? null,
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  })
  if (error) throw new Error(`No se pudo leer el historial de precios: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaHistorico[]
  return {
    filas: filas.map((f) => ({
      tipo: aTipo(f.tipo),
      documentoId: f.documento_id,
      numero: f.numero,
      fecha: f.fecha,
      productId: f.product_id,
      sku: f.sku,
      nombre: f.nombre,
      cantidad: aNumero(f.cantidad),
      precio: aNumero(f.precio),
      descuentoPct: aNumero(f.descuento_pct),
      moneda: f.moneda,
    })),
    // `total_filas` viene con `count(*) over ()`: es el total ANTES de
    // paginar, calculado por la base en la misma consulta.
    total: filas.length > 0 ? (aNumero(filas[0]!.total_filas) ?? 0) : 0,
  }
}

interface FilaUltimo {
  product_id: string | null
  sku: string | null
  nombre: string | null
  moneda: string | null
  ultimo_precio: number | string | null
  ultima_fecha: string | null
  ultimo_documento: string | null
  ultimo_tipo: string
  precio_anterior: number | string | null
  veces: number | string
}

/**
 * «¿A qué precio se le cotizó esto la última vez?»
 *
 * Una fila **por producto y por moneda**. Un producto cotizado en USD y en
 * ARS aparece dos veces, y está bien: son dos respuestas distintas a la misma
 * pregunta. Lo que no existe es una fila «última vez» que mezcle las dos.
 */
export async function ultimosPrecios(
  clienteId: string,
  productId?: string | null,
): Promise<UltimoPrecio[]> {
  const { data, error } = await supabase.rpc('ultimo_precio_cliente', {
    p_customer: clienteId,
    p_product: productId ?? null,
  })
  if (error) throw new Error(`No se pudo leer el último precio: ${error.message}`)

  return ((data ?? []) as unknown as FilaUltimo[]).map((f) => ({
    productId: f.product_id,
    sku: f.sku,
    nombre: f.nombre,
    moneda: f.moneda,
    ultimoPrecio: aNumero(f.ultimo_precio),
    ultimaFecha: f.ultima_fecha,
    ultimoDocumento: f.ultimo_documento,
    ultimoTipo: aTipo(f.ultimo_tipo),
    precioAnterior: aNumero(f.precio_anterior),
    veces: aNumero(f.veces) ?? 0,
  }))
}
