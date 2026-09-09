import { supabase } from '@/services/supabase/client'
import type { TablesUpdate } from '@/types/database.types'
import type { LineaDocumento } from '../types'

export type CambiosCabecera = TablesUpdate<'sales_quotes'>
export type CambiosLinea = TablesUpdate<'sales_quote_lines'>

/**
 * Escritura de cotizaciones.
 *
 * Tres cosas que este archivo NO hace, a propósito:
 *
 *   · no calcula subtotal, impuesto ni total — eso lo hace un trigger en la
 *     base (`app.totales_cotizacion`). El navegador muestra lo que le
 *     devuelve el servidor, así que no puede haber un total inventado.
 *   · no arma el número — sale de `next_document_number()`. El `MAX+1` local
 *     del legacy es la causa demostrada de los 9 `PDV11xxx`.
 *   · no decide quién puede escribir — eso es RLS. La UI oculta botones,
 *     que es otra cosa.
 */

export interface CabeceraNueva {
  companyId: string
  customerId: string
  contactId: string | null
  titulo: string | null
  fecha: string
  validaHasta: string | null
  moneda: string
  tipoCambio: number | null
  formaPago: string | null
  notas: string | null
  descuentoPct: number | null
  percepcionPct: number | null
}

export interface LineaNueva {
  tipoLinea: 'item' | 'service' | 'chapter'
  productId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  marca: string | null
  cantidad: number
  precioUnitario: number
  precioLista: number | null
  descuentoPct: number
  tratamientoImpuesto: string
  tasaImpuesto: number
}

function filaLinea(companyId: string, quoteId: string, lineNo: number, l: LineaNueva) {
  return {
    company_id: companyId,
    quote_id: quoteId,
    line_no: lineNo,
    line_type: l.tipoLinea,
    product_id: l.productId,
    sku_snapshot: l.sku,
    name_snapshot: l.nombre,
    description_snapshot: l.descripcion,
    brand_snapshot: l.marca,
    // `quantity <> 0` es un CHECK: un capítulo lleva 1 y precio 0, y el
    // trigger de totales lo excluye por `line_type`.
    quantity: l.tipoLinea === 'chapter' ? 1 : l.cantidad,
    unit_price: l.tipoLinea === 'chapter' ? 0 : l.precioUnitario,
    list_price_snapshot: l.precioLista,
    discount_pct: l.tipoLinea === 'chapter' ? 0 : l.descuentoPct,
    tax_treatment: l.tipoLinea === 'chapter' ? 'not_taxed' : l.tratamientoImpuesto,
    tax_rate_snapshot: l.tipoLinea === 'chapter' ? 0 : l.tasaImpuesto,
  }
}

/**
 * Crea la cotización con sus líneas.
 *
 * El número se pide RECIÉN ACÁ, cuando el documento se guarda de verdad. Si
 * se pidiera al abrir el editor, cada borrador abandonado se comería un
 * número de la serie.
 */
export async function crearCotizacion(
  cab: CabeceraNueva,
  lineas: readonly LineaNueva[],
): Promise<string> {
  const { data: numero, error: eNum } = await supabase.rpc('next_document_number', {
    p_company: cab.companyId,
    p_doc_type: 'quote',
  })
  if (eNum) throw new Error(`No se pudo obtener el número: ${eNum.message}`)
  if (!numero) throw new Error('La numeración no devolvió ningún número')

  const { data, error } = await supabase
    .from('sales_quotes')
    .insert({
      company_id: cab.companyId,
      number: numero,
      series_code: 'COTI',
      customer_id: cab.customerId,
      contact_id: cab.contactId,
      title: cab.titulo,
      quote_date: cab.fecha,
      valid_until: cab.validaHasta,
      currency_code: cab.moneda,
      exchange_rate: cab.tipoCambio,
      payment_terms: cab.formaPago,
      notes: cab.notas,
      discount_pct: cab.descuentoPct,
      perception_pct: cab.percepcionPct,
      status: 'draft',
    })
    .select('id')
    .single()
  if (error) throw new Error(`No se pudo crear la cotización: ${error.message}`)

  if (lineas.length > 0) {
    const { error: eL } = await supabase
      .from('sales_quote_lines')
      .insert(lineas.map((l, i) => filaLinea(cab.companyId, data.id, i + 1, l)))
    if (eL) throw new Error(`No se pudieron guardar las líneas: ${eL.message}`)
  }

  await registrarEvento('sales_quote', data.id, 'created', null, 'draft', null)
  return data.id
}

/** Un solo campo de la cabecera. Se llama sólo si el valor cambió de verdad. */
export async function actualizarCabecera(
  quoteId: string,
  cambios: CambiosCabecera,
): Promise<void> {
  const { error } = await supabase.from('sales_quotes').update(cambios).eq('id', quoteId)
  if (error) throw new Error(`No se pudo guardar: ${error.message}`)
}

export async function agregarLinea(
  companyId: string,
  quoteId: string,
  lineNo: number,
  l: LineaNueva,
): Promise<void> {
  const { error } = await supabase
    .from('sales_quote_lines')
    .insert(filaLinea(companyId, quoteId, lineNo, l))
  if (error) throw new Error(`No se pudo agregar la línea: ${error.message}`)
}

export async function actualizarLinea(
  lineaId: string,
  cambios: CambiosLinea,
): Promise<void> {
  const { error } = await supabase.from('sales_quote_lines').update(cambios).eq('id', lineaId)
  if (error) throw new Error(`No se pudo guardar la línea: ${error.message}`)
}

export async function eliminarLinea(lineaId: string): Promise<void> {
  const { error } = await supabase.from('sales_quote_lines').delete().eq('id', lineaId)
  if (error) throw new Error(`No se pudo borrar la línea: ${error.message}`)
}

/**
 * Intercambia dos líneas de lugar.
 *
 * El orden es `line_no` y no la posición en un array: el legacy usaba el
 * índice como identidad y por eso insertar una línea corría las entregas.
 *
 * Hay un `unique (quote_id, line_no)`, así que el intercambio directo en dos
 * pasos choca contra el índice en el primero. Se pasa por un número libre —
 * y alto, no negativo, porque también hay un `check (line_no > 0)`.
 */
export async function intercambiarOrden(
  a: { id: string; numeroLinea: number },
  b: { id: string; numeroLinea: number },
): Promise<void> {
  const provisorio = Math.max(a.numeroLinea, b.numeroLinea) + 1000
  await actualizarLinea(a.id, { line_no: provisorio })
  await actualizarLinea(b.id, { line_no: a.numeroLinea })
  await actualizarLinea(a.id, { line_no: b.numeroLinea })
}

export async function cambiarEstado(
  quoteId: string,
  desde: string,
  hasta: string,
): Promise<void> {
  const { error } = await supabase.from('sales_quotes').update({ status: hasta }).eq('id', quoteId)
  if (error) throw new Error(`No se pudo cambiar el estado: ${error.message}`)

  const accion =
    hasta === 'sent' ? 'sent'
    : hasta === 'accepted' ? 'approved'
    : hasta === 'rejected' ? 'rejected'
    : 'cancelled'
  await registrarEvento('sales_quote', quoteId, accion, desde, hasta, null)
}

/**
 * Auditoría.
 *
 * `sales_audit` no tiene policy de INSERT: la única puerta es esta función
 * `SECURITY DEFINER`. Se llama por ACCIÓN DE NEGOCIO —crear, enviar,
 * aprobar, rechazar, cancelar, o cambiar un precio de un documento ya
 * enviado— y nunca por un guardado técnico.
 */
export async function registrarEvento(
  tipo: 'sales_quote' | 'sales_order' | 'delivery',
  id: string,
  accion: 'created' | 'updated_sensitive_fields' | 'sent' | 'approved' | 'rejected' | 'cancelled',
  desde: string | null,
  hasta: string | null,
  diff: Record<string, { from: string | number | null; to: string | number | null }> | null,
): Promise<void> {
  const { error } = await supabase.rpc('registrar_evento_venta', {
    p_entity_type: tipo,
    p_entity_id: id,
    p_action: accion,
    ...(desde !== null && { p_from_status: desde }),
    ...(hasta !== null && { p_to_status: hasta }),
    ...(diff !== null && { p_diff: diff }),
  })
  // Un fallo de auditoría no puede tumbar la operación de negocio que ya se
  // hizo, pero tampoco se traga en silencio.
  if (error) console.error('No se pudo registrar el evento de auditoría:', error.message)
}

/** Campos cuyo cambio, en un documento ya enviado, se audita. */
const SENSIBLES = new Set(['unit_price', 'quantity', 'discount_pct', 'perception_pct'])

export function esSensible(campo: string): boolean {
  return SENSIBLES.has(campo)
}

/** Qué se puede hacer con una cotización según su estado. */
export interface Editabilidad {
  editable: boolean
  motivo: string | null
}

export function editabilidad(estado: string, esInterno: boolean): Editabilidad {
  if (!esInterno) return { editable: false, motivo: 'Sólo el equipo interno edita cotizaciones.' }
  if (estado === 'draft') return { editable: true, motivo: null }
  if (estado === 'sent')
    return { editable: true, motivo: 'Ya fue enviada: los cambios de precio quedan registrados.' }
  return {
    editable: false,
    motivo: 'La cotización está cerrada y no se puede modificar.',
  }
}

/** Las líneas del editor, ordenadas y con su identidad propia. */
export function ordenarLineas(lineas: readonly LineaDocumento[]): LineaDocumento[] {
  return [...lineas].sort((a, b) => (a.numeroLinea ?? 0) - (b.numeroLinea ?? 0))
}
