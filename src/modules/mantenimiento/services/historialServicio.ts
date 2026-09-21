import { supabase } from '@/services/supabase/client'
import type { DocumentoFuente, LineaFuente, ServicioHistorico } from '../types'

/**
 * El historial de servicio que se importó de STEL (Fase 20 · E2).
 *
 * Es **de sólo lectura**, y no por convención: las cuatro tablas no tienen
 * policy de escritura y `authenticated` sólo tiene el grant de SELECT. Por eso
 * en este archivo no hay ni un insert ni un update, y no los va a haber.
 *
 * No se mezcla con `maintenance_orders`. Un servicio de 2024 que STEL dejó con
 * el presupuesto pendiente NO es trabajo pendiente de hoy, y sumarlos en el
 * mismo número sería inventar una cola de trabajo que no existe.
 *
 * Se pide **por equipo y a pedido**: abrir el listado no baja los 76
 * documentos ni las 263 líneas de nadie.
 */

const COLUMNAS = `
  id, chain_id, asset_id, external_id, received_at, delivered_at, status, quotation_status,
  invoiced, title, diagnosis_notes, repair_notes, closing_notes, technician_name_raw,
  currency_code, amount, amount_attribution, stel_status_raw,
  cadena:maintenance_service_chains!chain_id (
    id, label, asset_count, amount, currency_code,
    documentos:maintenance_service_source_documents (
      id, doc_kind, reference, doc_date, stel_status, currency_code, total_amount, pdf_path,
      lineas:maintenance_service_source_lines (
        id, line_type, sku, description, quantity, unit_price, amount, currency_code, matched_product_id
      )
    )
  )
`

interface FilaLinea {
  id: string
  line_type: LineaFuente['tipo']
  sku: string | null
  description: string | null
  quantity: number | null
  unit_price: number | null
  amount: number | null
  currency_code: string | null
  matched_product_id: string | null
}

interface FilaDocumento {
  id: string
  doc_kind: DocumentoFuente['tipo']
  reference: string
  doc_date: string
  stel_status: string | null
  currency_code: string | null
  total_amount: number | null
  pdf_path: string | null
  lineas: FilaLinea[] | null
}

interface Fila {
  id: string
  chain_id: string
  asset_id: string
  external_id: string
  received_at: string
  delivered_at: string | null
  status: ServicioHistorico['estado']
  quotation_status: ServicioHistorico['cotizacion']
  invoiced: boolean | null
  title: string | null
  diagnosis_notes: string | null
  repair_notes: string | null
  closing_notes: string | null
  technician_name_raw: string | null
  currency_code: string | null
  amount: number | null
  amount_attribution: ServicioHistorico['importeAtribuible']
  stel_status_raw: string
  cadena: {
    id: string
    label: string
    asset_count: number
    amount: number | null
    currency_code: string | null
    documentos: FilaDocumento[] | null
  } | null
}

/**
 * La referencia más útil del servicio: la del documento más avanzado.
 *
 * Alguien que busca «qué le hicimos a esta llave» reconoce antes el remito o
 * la orden que el presupuesto, porque son los que salieron del taller.
 */
const ORDEN_DOC: Record<DocumentoFuente['tipo'], number> = {
  delivery_note: 3,
  work_order: 2,
  estimate: 1,
}

function aServicio(f: Fila): ServicioHistorico {
  const documentos = [...(f.cadena?.documentos ?? [])]
    .sort((a, b) => ORDEN_DOC[a.doc_kind] - ORDEN_DOC[b.doc_kind])
    .map(
      (d): DocumentoFuente => ({
        id: d.id,
        tipo: d.doc_kind,
        referencia: d.reference,
        fecha: d.doc_date,
        estadoStel: d.stel_status,
        moneda: d.currency_code,
        total: d.total_amount,
        pdf: d.pdf_path,
        lineas: (d.lineas ?? [])
          .map(
            (l): LineaFuente => ({
              id: l.id,
              tipo: l.line_type,
              sku: l.sku,
              descripcion: l.description,
              cantidad: l.quantity,
              precioUnitario: l.unit_price,
              importe: l.amount,
              moneda: l.currency_code,
              productoId: l.matched_product_id,
            }),
          )
          // Sin texto y sin SKU una línea no le dice nada a nadie: son las
          // secciones de maquetado del documento de STEL.
          .filter((l) => l.descripcion !== null || l.sku !== null),
      }),
    )

  const principal = documentos.at(-1)

  return {
    id: f.id,
    cadenaId: f.chain_id,
    activoId: f.asset_id,
    referencia: principal?.referencia ?? (f.cadena?.label ?? f.external_id),
    estado: f.status,
    cotizacion: f.quotation_status,
    facturado: f.invoiced,
    ingreso: f.received_at,
    entrega: f.delivered_at,
    titulo: f.title,
    diagnostico: f.diagnosis_notes,
    trabajo: f.repair_notes,
    cierre: f.closing_notes,
    tecnico: f.technician_name_raw,
    moneda: f.currency_code,
    importe: f.amount,
    importeAtribuible: f.amount_attribution,
    estadoStel: f.stel_status_raw,
    equiposEnElServicio: f.cadena?.asset_count ?? 1,
    importeDeLaCadena: f.cadena?.amount ?? null,
    documentos,
  }
}

/**
 * Todo el historial de un equipo, del servicio más nuevo al más viejo.
 *
 * Una sola consulta: los documentos y las líneas vienen embebidos. Un equipo
 * tiene a lo sumo un puñado de servicios, así que no se pagina.
 */
export async function historialDeActivo(companyId: string, activoId: string): Promise<ServicioHistorico[]> {
  const { data, error } = await supabase
    .from('maintenance_service_history')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .eq('asset_id', activoId)
    .order('received_at', { ascending: false })
  if (error) throw new Error(`No se pudo leer el historial de servicio: ${error.message}`)
  return ((data ?? []) as unknown as Fila[]).map(aServicio)
}
