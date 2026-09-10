import { supabase } from '@/services/supabase/client'
import { aCsv } from '../lib/csv'
import { registrarEvento } from './auditoria'
import { listarDocumentos } from './documentos'
import type { DocumentoListado, FiltrosVentas, TipoDocumento } from '../types'

/**
 * Acciones sueltas del módulo: duplicar, cancelar, borrar y exportar.
 */

/**
 * Duplica un documento.
 *
 * Copia la cabecera y las líneas con sus snapshots. **No copia las relaciones
 * comerciales** —`quote_id`, `po_id`, la fecha original, el estado, los
 * números de revisión ni la auditoría— y nace en borrador con un número nuevo
 * pedido al servidor.
 *
 * Es lo mismo que hacía `duplicarCotizacion` en el legacy, que también
 * borraba `convertidaA` para no arrastrar el vínculo al pedido derivado.
 */
export async function duplicarDocumento(
  tipo: 'cotizacion' | 'pedido',
  companyId: string,
  id: string,
): Promise<string> {
  const hoy = new Date().toISOString().slice(0, 10)

  const numeroNuevo = async (docType: 'quote' | 'sales_order') => {
    const { data, error } = await supabase.rpc('next_document_number', {
      p_company: companyId,
      p_doc_type: docType,
    })
    if (error) throw new Error(`No se pudo obtener el número: ${error.message}`)
    if (!data) throw new Error('La numeración no devolvió ningún número')
    return data
  }

  // Las dos ramas están escritas aparte a propósito: los nombres de columna
  // difieren (`quantity` contra `quantity_ordered`, `status` contra
  // `commercial_status`) y con una tabla dinámica supabase-js pierde el tipo
  // y deja de avisar si falta una columna obligatoria.
  if (tipo === 'cotizacion') {
    const { data: o, error } = await supabase
      .from('sales_quotes')
      .select(
        `customer_id, contact_id, title, currency_code, exchange_rate,
         payment_terms, notes, discount_pct, perception_pct`,
      )
      .eq('company_id', companyId)
      .eq('id', id)
      .single()
    if (error) throw new Error(`No se pudo leer la cotización: ${error.message}`)

    const { data: copia, error: eIns } = await supabase
      .from('sales_quotes')
      .insert({
        company_id: companyId,
        number: await numeroNuevo('quote'),
        series_code: 'COTI',
        customer_id: o.customer_id,
        contact_id: o.contact_id,
        title: o.title,
        quote_date: hoy,
        currency_code: o.currency_code,
        exchange_rate: o.exchange_rate,
        payment_terms: o.payment_terms,
        notes: o.notes,
        discount_pct: o.discount_pct,
        perception_pct: o.perception_pct,
        status: 'draft',
      })
      .select('id')
      .single()
    if (eIns) throw new Error(`No se pudo duplicar: ${eIns.message}`)

    const { data: lineas, error: eL } = await supabase
      .from('sales_quote_lines')
      .select(
        `line_no, line_type, product_id, sku_snapshot, name_snapshot,
         description_snapshot, brand_snapshot, quantity, unit_price,
         list_price_snapshot, discount_pct, tax_treatment, tax_rate_snapshot`,
      )
      .eq('company_id', companyId)
      .eq('quote_id', id)
      .order('line_no')
    if (eL) throw new Error(`No se pudieron leer las líneas: ${eL.message}`)

    if ((lineas ?? []).length > 0) {
      const { error: eIL } = await supabase.from('sales_quote_lines').insert(
        (lineas ?? []).map((l) => ({ ...l, company_id: companyId, quote_id: copia.id })),
      )
      if (eIL) throw new Error(`No se pudieron copiar las líneas: ${eIL.message}`)
    }

    await registrarEvento('sales_quote', copia.id, 'created', null, 'draft', null)
    return copia.id
  }

  const { data: o, error } = await supabase
    .from('sales_orders')
    .select(
      `customer_id, contact_id, title, currency_code, exchange_rate,
       payment_terms, notes, discount_pct, perception_pct`,
    )
    .eq('company_id', companyId)
    .eq('id', id)
    .single()
  if (error) throw new Error(`No se pudo leer el pedido: ${error.message}`)

  const { data: copia, error: eIns } = await supabase
    .from('sales_orders')
    .insert({
      company_id: companyId,
      number: await numeroNuevo('sales_order'),
      series_code: 'PDV',
      customer_id: o.customer_id,
      contact_id: o.contact_id,
      title: o.title,
      order_date: hoy,
      currency_code: o.currency_code,
      exchange_rate: o.exchange_rate,
      payment_terms: o.payment_terms,
      notes: o.notes,
      discount_pct: o.discount_pct,
      perception_pct: o.perception_pct,
      commercial_status: 'draft',
      // La copia NO hereda de dónde vino el original: `quote_id` queda en
      // null y el origen pasa a ser manual. Copiar el vínculo haría que dos
      // pedidos apuntaran a la misma cotización, que es justo lo que el
      // índice único impide.
      origin: 'manual',
    })
    .select('id')
    .single()
  if (eIns) throw new Error(`No se pudo duplicar: ${eIns.message}`)

  const { data: lineas, error: eL } = await supabase
    .from('sales_order_lines')
    .select(
      `line_no, line_type, product_id, sku_snapshot, name_snapshot,
       description_snapshot, quantity_ordered, unit_price, list_price_snapshot,
       discount_pct, tax_treatment, tax_rate_snapshot`,
    )
    .eq('company_id', companyId)
    .eq('order_id', id)
    .order('line_no')
  if (eL) throw new Error(`No se pudieron leer las líneas: ${eL.message}`)

  if ((lineas ?? []).length > 0) {
    const { error: eIL } = await supabase.from('sales_order_lines').insert(
      (lineas ?? []).map((l) => ({ ...l, company_id: companyId, order_id: copia.id })),
    )
    if (eIL) throw new Error(`No se pudieron copiar las líneas: ${eIL.message}`)
  }

  await registrarEvento('sales_order', copia.id, 'created', null, 'draft', null)
  return copia.id
}

/**
 * Cancela un documento.
 *
 * La cotización no tiene «cancelada»: tiene `rejected`. Es lo mismo desde el
 * punto de vista comercial —no prosperó— y no hace falta inventar un estado
 * nuevo para decir algo que ya se puede decir.
 */
export async function cancelarDocumento(
  tipo: TipoDocumento,
  id: string,
  desde: string,
): Promise<void> {
  if (tipo === 'cotizacion') {
    const { error } = await supabase
      .from('sales_quotes')
      .update({ status: 'rejected' })
      .eq('id', id)
    if (error) throw new Error(`No se pudo cancelar: ${error.message}`)
    await registrarEvento('sales_quote', id, 'rejected', desde, 'rejected', null)
    return
  }

  if (tipo === 'pedido') {
    const { error } = await supabase
      .from('sales_orders')
      .update({ commercial_status: 'cancelled' })
      .eq('id', id)
    if (error) throw new Error(`No se pudo cancelar: ${error.message}`)
    await registrarEvento('sales_order', id, 'cancelled', desde, 'cancelled', null)
    return
  }

  const { error } = await supabase.from('deliveries').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw new Error(`No se pudo cancelar: ${error.message}`)
  await registrarEvento('delivery', id, 'cancelled', desde, 'cancelled', null)
}

/**
 * Borra un documento.
 *
 * Los triggers de la base deciden si se puede: un documento histórico no se
 * borra nunca, uno con documentos derivados tampoco, y un remito que ya movió
 * stock menos —borrar el movimiento NO devuelve las unidades, porque el
 * trigger de stock es AFTER INSERT.
 */
export async function borrarDocumento(tipo: TipoDocumento, id: string): Promise<void> {
  const tabla = {
    cotizacion: 'sales_quotes' as const,
    pedido: 'sales_orders' as const,
    entrega: 'deliveries' as const,
  }[tipo]

  const { error } = await supabase.from(tabla).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Exporta a CSV **lo que muestran los filtros activos**, no la tabla entera.
 *
 * Se pide al servidor de a 500 filas con los mismos filtros del listado. Con
 * 636 documentos son dos requests; el legacy tenía los 636 en memoria porque
 * nunca dejó de tenerlos.
 */
export async function exportarCsv(
  tipo: TipoDocumento,
  companyId: string,
  filtros: FiltrosVentas,
): Promise<{ contenido: string; filas: number }> {
  const POR_PAGINA = 500
  const todas: DocumentoListado[] = []

  for (let pagina = 1; ; pagina++) {
    const { filas, total } = await listarDocumentos(tipo, companyId, {
      ...filtros,
      pagina,
      porPagina: POR_PAGINA,
    })
    todas.push(...filas)
    if (todas.length >= total || filas.length === 0) break
    // Cinturón: 20 páginas son 10.000 documentos. Si alguna vez se llega
    // ahí, el export tiene que ser del lado del servidor, no un bucle acá.
    if (pagina >= 20) break
  }

  return { contenido: aCsv(tipo, todas), filas: todas.length }
}
