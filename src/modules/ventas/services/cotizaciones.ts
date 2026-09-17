import { supabase } from '@/services/supabase/client'
import type { Json, TablesUpdate } from '@/types/database.types'
import { registrarEvento, type Editabilidad } from './auditoria'
import type { LineaDocumento } from '../types'
import { exigirMoneda } from '../lib/moneda'

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

export interface CotizacionCreada {
  id: string
  numero: string
  total: number
  lineas: number
}

/**
 * Crea la cotización con sus líneas, en UNA transacción del servidor.
 *
 * Fase 15 · E3. Antes esto eran cuatro viajes desde el navegador —número,
 * cabecera, líneas, auditoría—: si fallaba el segundo quedaba un número
 * consumido, y si fallaba el tercero, una cotización sin líneas. Ahora
 * `crear_cotizacion` valida cliente, contacto, vendedor, tarifa y moneda,
 * reserva el número, inserta todo, calcula los totales y audita; si algo falla,
 * no queda nada (tampoco el número).
 */
export async function crearCotizacion(
  companyId: string,
  cabecera: Record<string, string | number | null>,
  lineas: readonly Record<string, unknown>[],
): Promise<CotizacionCreada> {
  // Antes de llamar: sin moneda no se crea nada. El servidor lo vuelve a exigir.
  const moneda = cabecera['currency_code']
  exigirMoneda(typeof moneda === 'string' ? moneda : null)

  const { data, error } = await supabase.rpc('crear_cotizacion', {
    p_company: companyId,
    p_cabecera: cabecera as unknown as Json,
    p_lineas: lineas as unknown as Json,
  })
  if (error) {
    const codigo = Object.keys(MOTIVOS_GUARDADO).find((c) => error.message.includes(c))
    throw new FalloDeGuardado(
      codigo ?? 'error_interno',
      codigo ? MOTIVOS_GUARDADO[codigo]! : 'No se pudo crear la cotización.',
    )
  }

  const r = data as unknown as { id: string; number: string; total: number | string; lineas: number }
  return { id: r.id, numero: r.number, total: Number(r.total ?? 0), lineas: r.lineas }
}

/** El alta de E1, que insertaba desde el navegador. La usa sólo el pedido. */
export async function crearCotizacionLegacy(
  cab: CabeceraNueva,
  lineas: readonly LineaNueva[],
): Promise<string> {
  // Antes del número: un guardado sin moneda no quema un número de la serie.
  exigirMoneda(cab.moneda)
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

export function editabilidad(estado: string, esInterno: boolean): Editabilidad {
  if (!esInterno)
    return { editable: false, motivo: 'Tu rol no edita cotizaciones: es de administradores y empleados.', audita: false }
  if (estado === 'draft') return { editable: true, motivo: null, audita: false }
  if (estado === 'sent')
    return {
      editable: true,
      motivo: 'Ya fue enviada: los cambios de precio quedan registrados.',
      audita: true,
    }
  return {
    editable: false,
    motivo: 'La cotización está cerrada y no se puede modificar.',
    audita: false,
  }
}

/** Las líneas del editor, ordenadas y con su identidad propia. */
export function ordenarLineas(lineas: readonly LineaDocumento[]): LineaDocumento[] {
  return [...lineas].sort((a, b) => (a.numeroLinea ?? 0) - (b.numeroLinea ?? 0))
}

// ── Guardado atómico (Fase 15 · E2) ────────────────────────────────────────

/** Los códigos que puede levantar `guardar_cotizacion`, con su texto. */
export const MOTIVOS_GUARDADO: Record<string, string> = {
  CONFLICTO_DE_EDICION:
    'Alguien más guardó esta cotización mientras la editabas. Recargá para ver los cambios; lo tuyo no se perdió.',
  ESTADO_NO_EDITABLE: 'La cotización ya está cerrada y no se puede modificar.',
  SIN_PERMISO: 'Tu rol no edita cotizaciones.',
  COTIZACION_INEXISTENTE: 'La cotización ya no existe.',
  CLIENTE_INVALIDO: 'El cliente elegido no es válido.',
  CONTACTO_DE_OTRO_CLIENTE: 'El contacto elegido es de otro cliente.',
  VENDEDOR_INVALIDO: 'El vendedor elegido no es de esta empresa.',
  TARIFA_INVALIDA: 'La tarifa elegida no es de esta empresa.',
  TARIFA_OTRA_MONEDA: 'La tarifa está en otra moneda que el documento. Elegí una compatible o cambiá la moneda.',
  PRODUCTO_INVALIDO: 'Una de las líneas tiene un producto que no es del catálogo de esta empresa.',
  CANTIDAD_INVALIDA: 'Una línea tiene cantidad cero.',
  DESCUENTO_INVALIDO: 'Un descuento está fuera del rango 0–100 %.',
  PRECIO_INVALIDO: 'Un precio es negativo.',
  LINEA_AJENA: 'Una de las líneas no pertenece a esta cotización.',
  CAMPO_NO_PERMITIDO: 'Se intentó guardar un campo que no se puede editar.',
  // Sólo del alta (Fase 15 · E3).
  CLIENTE_REQUERIDO: 'Elegí un cliente antes de crear la cotización.',
  DOCUMENT_CURRENCY_REQUIRED: 'Elegí la moneda del documento antes de crear la cotización.',
  SIN_SERIE: 'La empresa no tiene una serie de numeración para cotizaciones.',
  external_numbering_authority: 'La numeración de cotizaciones todavía la administra STEL: no se puede crear desde el ERP.',
}

export class FalloDeGuardado extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloDeGuardado'
  }
  /** Un conflicto se resuelve recargando, no reintentando. */
  get esConflicto(): boolean {
    return this.codigo === 'CONFLICTO_DE_EDICION'
  }
}

export interface ResultadoGuardado {
  /** El nuevo testigo de concurrencia: se guarda para la próxima edición. */
  actualizadoEn: string
  cambiosCabecera: number
  lineasTocadas: number
}

/**
 * Guarda cabecera y líneas de una cotización en UNA transacción.
 *
 * Es el único camino de escritura del editor. El navegador no arma updates
 * sueltos: manda el estado deseado y el servidor decide qué cambió, valida
 * todo y escribe o no escribe nada.
 *
 * `esperado` es el `updated_at` que se leyó al entrar en edición. Si alguien
 * guardó en el medio, la base corta con `CONFLICTO_DE_EDICION` en vez de
 * pisarlo.
 */
export async function guardarCotizacion(
  quoteId: string,
  esperado: string,
  cabecera: Record<string, string | number | null>,
  lineas: Record<string, unknown>[],
): Promise<ResultadoGuardado> {
  const { data, error } = await supabase.rpc('guardar_cotizacion', {
    p_quote: quoteId,
    p_esperado: esperado,
    // Los dos viajan como `jsonb`. El tipo generado es `Json`, que no acepta
    // un `Record<string, unknown>` directo; el contenido lo valida la base.
    p_cabecera: cabecera as unknown as Json,
    p_lineas: lineas as unknown as Json,
  })

  if (error) {
    const codigo = Object.keys(MOTIVOS_GUARDADO).find((c) => error.message.includes(c))
    throw new FalloDeGuardado(
      codigo ?? 'error_interno',
      codigo ? MOTIVOS_GUARDADO[codigo]! : 'No se pudo guardar la cotización.',
    )
  }

  const r = (data ?? {}) as { updated_at?: string; cambios_cabecera?: number; lineas_tocadas?: number }
  return {
    actualizadoEn: r.updated_at ?? '',
    cambiosCabecera: r.cambios_cabecera ?? 0,
    lineasTocadas: r.lineas_tocadas ?? 0,
  }
}
