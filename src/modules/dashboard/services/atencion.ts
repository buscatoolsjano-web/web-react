import { supabase } from '@/services/supabase/client'
import type { TipoDocumento } from '@/modules/ventas/types'

/**
 * Los documentos que requieren atención HOY (Fase 21 · E2).
 *
 * La fuente es `revision_de_documentos`, la misma vista que ya usan la ficha
 * del documento y los informes. Lo que se cuenta es `requires_attention_now`,
 * **no** `needs_review`: ése es la foto del día de la migración —241
 * documentos— y hoy 126 de sus motivos ya no pasan. Contar la foto sería
 * inflar el número con problemas resueltos.
 *
 * Se traen las filas y no sólo el conteo porque el número tiene que poder
 * abrirse: 219 filas de cinco campos pesan poco y con ellas el Dashboard
 * muestra cuáles son sin pedir nada más.
 */

const DOC_TYPE_A_TIPO: Record<string, TipoDocumento> = {
  quote: 'cotizacion',
  sales_order: 'pedido',
  delivery: 'entrega',
}

export interface DocumentoEnAtencion {
  id: string
  tipo: TipoDocumento
  numero: string
  fecha: string
  /** Motivos que todavía se pueden demostrar con el documento de hoy. */
  activos: string[]
  /** Motivos que no se pueden comprobar. Nunca son «resueltos». */
  noVerificables: string[]
}

export interface Atencion {
  documentos: DocumentoEnAtencion[]
  total: number
  /** De los que requieren atención, cuántos tienen algún motivo no verificable. */
  conNoVerificable: number
}

export async function documentosEnAtencion(companyId: string): Promise<Atencion> {
  const { data, error } = await supabase
    .from('revision_de_documentos')
    .select('document_id, doc_type, numero, fecha, active_reasons, unverifiable_reasons')
    .eq('company_id', companyId)
    .eq('requires_attention_now', true)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los documentos en revisión: ${error.message}`)

  const filas = (data ?? []) as unknown as {
    document_id: string
    doc_type: string
    numero: string | null
    fecha: string | null
    active_reasons: string[] | null
    unverifiable_reasons: string[] | null
  }[]

  const documentos = filas.flatMap((f): DocumentoEnAtencion[] => {
    const tipo = DOC_TYPE_A_TIPO[f.doc_type]
    // Un tipo que no conocemos no se dibuja como si fuera una cotización.
    if (!tipo || !f.fecha) return []
    return [
      {
        id: f.document_id,
        tipo,
        numero: f.numero ?? '—',
        fecha: f.fecha,
        activos: f.active_reasons ?? [],
        noVerificables: f.unverifiable_reasons ?? [],
      },
    ]
  })

  return {
    documentos,
    total: filas.length,
    conNoVerificable: filas.filter((f) => (f.unverifiable_reasons ?? []).length > 0).length,
  }
}
