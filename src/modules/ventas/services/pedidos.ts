import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'
import { registrarEvento, type Editabilidad } from './auditoria'
import { FalloDeGuardado } from './cotizaciones'
import { exigirMoneda } from '../lib/moneda'

/**
 * Escritura de pedidos.
 *
 * Mismas tres reglas que en cotizaciones: los totales los calcula un trigger,
 * el número sale de `next_document_number()` y quién puede escribir lo decide
 * RLS. Lo único que cambia son los nombres de las columnas —el pedido usa
 * `quantity_ordered` y `commercial_status`— y que un pedido con entregas
 * tiene las líneas congeladas.
 */

export interface PedidoCreado {
  id: string
  numero: string
  total: number
  lineas: number
}

/**
 * Crea el pedido con sus líneas, en UNA transacción del servidor.
 *
 * Fase 15 · E4, gemela de `crearCotizacion`. Antes eran cuatro viajes desde el
 * navegador —número, cabecera, líneas, auditoría—: si fallaba el segundo
 * quedaba un número consumido y si fallaba el tercero, un pedido sin líneas.
 * `crear_pedido` valida cliente, contacto, vendedor, tarifa y moneda, reserva
 * el número, inserta todo, calcula los totales y audita.
 */
export async function crearPedido(
  companyId: string,
  cabecera: Record<string, string | number | null>,
  lineas: readonly Record<string, unknown>[],
): Promise<PedidoCreado> {
  const moneda = cabecera['currency_code']
  exigirMoneda(typeof moneda === 'string' ? moneda : null)

  const { data, error } = await supabase.rpc('crear_pedido', {
    p_company: companyId,
    p_cabecera: cabecera as unknown as Json,
    p_lineas: lineas as unknown as Json,
  })
  if (error) throw falloDePedido(error.message, 'No se pudo crear el pedido.')

  const r = data as unknown as { id: string; number: string; total: number | string; lineas: number }
  return { id: r.id, numero: r.number, total: Number(r.total ?? 0), lineas: r.lineas }
}

/**
 * Cotización → pedido, en UNA transacción del servidor.
 *
 * El pedido hereda el SNAPSHOT COMERCIAL APROBADO: precios, descuentos,
 * impuestos y descripciones de la cotización, tal como quedaron. La tarifa se
 * copia como dato y NO se vuelve a consultar: si cambió después de cotizar, el
 * pedido derivado no se entera.
 *
 * **La cotización no se toca**: no cambia de estado ni se marca. Si además hay
 * que darla por aceptada, es una acción aparte que decide la persona.
 *
 * Idempotencia: la cotización se bloquea en la transacción y el índice único
 * sobre (company_id, quote_id) remata. Dos clics dejan UN pedido.
 */
export async function convertirCotizacionEnPedido(
  quoteId: string,
  esperado: string | null = null,
): Promise<PedidoCreado> {
  const { data, error } = await supabase.rpc('convertir_cotizacion_en_pedido', {
    p_quote: quoteId,
    p_esperado: esperado as string,
  })
  if (error) throw falloDePedido(error.message, 'No se pudo generar el pedido.')

  const r = data as unknown as { id: string; number: string; total: number | string; lineas: number }
  return { id: r.id, numero: r.number, total: Number(r.total ?? 0), lineas: r.lineas }
}

/**
 * La misma conversión, con la serie del pedido elegida a mano (Fase 19 · E4).
 *
 * Es una función DISTINTA en el servidor, no un parámetro más de la de
 * siempre: `convertir_cotizacion_en_pedido` conserva su firma y su
 * semántica, y las dos comparten la implementación interna. La serie acá es
 * obligatoria —el servidor rechaza una vacía—: esta puerta existe justamente
 * para elegirla.
 */
export async function convertirCotizacionEnPedidoEnSerie(
  quoteId: string,
  esperado: string | null,
  serie: string,
): Promise<PedidoCreado> {
  const { data, error } = await supabase.rpc('convertir_cotizacion_en_pedido_en_serie', {
    p_quote: quoteId,
    p_esperado: esperado as string,
    p_serie: serie,
  })
  if (error) throw falloDePedido(error.message, 'No se pudo generar el pedido.')

  const r = data as unknown as { id: string; number: string; total: number | string; lineas: number }
  return { id: r.id, numero: r.number, total: Number(r.total ?? 0), lineas: r.lineas }
}

export interface ResultadoGuardadoPedido {
  actualizadoEn: string
  cambiosCabecera: number
  lineasTocadas: number
}

/**
 * Guarda cabecera y líneas del pedido en UNA transacción.
 *
 * Es el único camino de escritura del editor: el navegador manda el estado
 * deseado con el testigo de concurrencia y el servidor decide qué cambió,
 * valida, renumera las líneas, recalcula los totales y audita el antes y el
 * después.
 */
export async function guardarPedido(
  orderId: string,
  esperado: string,
  cabecera: Record<string, string | number | null>,
  lineas: readonly Record<string, unknown>[],
): Promise<ResultadoGuardadoPedido> {
  const { data, error } = await supabase.rpc('guardar_pedido', {
    p_order: orderId,
    p_esperado: esperado,
    p_cabecera: cabecera as unknown as Json,
    p_lineas: lineas as unknown as Json,
  })
  if (error) throw falloDePedido(error.message, 'No se pudo guardar el pedido.')

  const r = (data ?? {}) as { updated_at?: string; cambios_cabecera?: number; lineas_tocadas?: number }
  return {
    actualizadoEn: r.updated_at ?? '',
    cambiosCabecera: r.cambios_cabecera ?? 0,
    lineasTocadas: r.lineas_tocadas ?? 0,
  }
}

const MOTIVOS_PEDIDO: Record<string, string> = {
  CONFLICTO_DE_EDICION: 'Otra persona guardó cambios mientras editabas. Recargá para ver la versión actual.',
  PEDIDO_INEXISTENTE: 'El pedido ya no existe.',
  ESTADO_NO_EDITABLE: 'El pedido está cancelado y no se puede modificar.',
  PEDIDO_CON_ENTREGAS: 'El pedido ya tiene entregas: sus líneas no se modifican.',
  SIN_PERMISO: 'Tu rol no edita pedidos.',
  CLIENTE_REQUERIDO: 'Elegí un cliente antes de crear el pedido.',
  CLIENTE_INVALIDO: 'El cliente no es de esta empresa.',
  CONTACTO_DE_OTRO_CLIENTE: 'El contacto elegido es de otro cliente.',
  VENDEDOR_INVALIDO: 'El vendedor no es de esta empresa.',
  TARIFA_INVALIDA: 'La tarifa no es de esta empresa.',
  TARIFA_OTRA_MONEDA: 'La tarifa está en otra moneda que el documento.',
  DOCUMENT_CURRENCY_REQUIRED: 'Elegí la moneda del documento.',
  CANTIDAD_INVALIDA: 'Una línea quedó con cantidad cero.',
  DESCUENTO_INVALIDO: 'Un descuento está fuera de rango (0 a 100).',
  PRECIO_INVALIDO: 'Un precio es negativo.',
  PRODUCTO_INVALIDO: 'Un producto no es de esta empresa.',
  LINEA_AJENA: 'Una de las líneas no pertenece a este pedido.',
  CAMPO_NO_PERMITIDO: 'Se intentó guardar un campo que no se puede editar.',
  PEDIDO_YA_EXISTE: 'Esa cotización ya tiene un pedido.',
  COTIZACION_RECHAZADA: 'Una cotización rechazada no se convierte.',
  COTIZACION_INEXISTENTE: 'La cotización ya no existe o no tenés acceso.',
  SIN_SERIE: 'La empresa no tiene una serie de numeración para pedidos.',
  external_numbering_authority: 'La numeración de pedidos todavía la administra STEL: no se puede emitir desde el ERP.',
}

function falloDePedido(mensaje: string, porDefecto: string): FalloDeGuardado {
  const codigo = Object.keys(MOTIVOS_PEDIDO).find((c) => mensaje.includes(c))
  return new FalloDeGuardado(codigo ?? 'error_interno', codigo ? MOTIVOS_PEDIDO[codigo]! : porDefecto)
}

export async function cambiarEstadoPedido(
  orderId: string,
  desde: string,
  hasta: string,
): Promise<void> {
  const { error } = await supabase
    .from('sales_orders')
    .update({ commercial_status: hasta })
    .eq('id', orderId)
  if (error) throw new Error(`No se pudo cambiar el estado: ${error.message}`)

  await registrarEvento(
    'sales_order',
    orderId,
    hasta === 'cancelled' ? 'cancelled' : 'approved',
    desde,
    hasta,
    null,
  )
}

/**
 * Qué se puede editar de un pedido.
 *
 * `confirmed` con entregas tiene las líneas congeladas, y no por gusto:
 * cambiar la cantidad pedida de una línea ya entregada mueve el pendiente de
 * un documento que el cliente ya firmó. Es el mismo dato que Stage 2.5 tuvo
 * que reconstruir para 505 líneas.
 */
export function editabilidadPedido(
  estado: string,
  esInterno: boolean,
  tieneEntregas: boolean,
): Editabilidad {
  if (!esInterno) {
    return { editable: false, motivo: 'Tu rol no edita pedidos: es de administradores y empleados.', audita: false }
  }
  if (estado === 'cancelled') {
    return { editable: false, motivo: 'El pedido está cancelado.', audita: false }
  }
  if (tieneEntregas) {
    return {
      editable: false,
      motivo: 'El pedido ya tiene entregas: sus líneas no se modifican.',
      audita: false,
    }
  }
  if (estado === 'draft') return { editable: true, motivo: null, audita: false }
  return {
    editable: true,
    motivo: 'Ya está confirmado: los cambios de precio quedan registrados.',
    audita: true,
  }
}
