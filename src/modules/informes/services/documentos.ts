import { supabase } from '@/services/supabase/client'
import { errorDeInforme } from './actividad'

/**
 * Los documentos que forman cada KPI (Fase 21 · E3).
 *
 * `informe_documentos` es la MISMA fuente que `informe_actividad_comercial`:
 * las dos agregan sobre `documentos_comerciales`. Por eso la suma de la lista
 * es el KPI y no «aproximadamente» el KPI — no es una coincidencia que haya
 * que mantener, es la misma consulta contada de dos maneras.
 */

export interface FilaDocumentoInforme {
  tipo: 'cotizaciones' | 'pedidos' | 'entregas'
  id: string
  numero: string
  fecha: string
  clienteId: string | null
  cliente: string | null
  estado: string
  serie: string | null
  origen: string | null
  moneda: string
  importe: number
  enRevision: boolean
}

export interface PaginaDocumentosInforme {
  filas: FilaDocumentoInforme[]
  /** Documentos del universo completo, no de la página. */
  total: number
  /** Suma del universo completo. Es lo que tiene que dar el KPI. */
  totalImporte: number
}

export interface FiltrosDocumentosInforme {
  desde: string
  hasta: string
  tipo?: string | null
  moneda?: string | null
  estado?: string | null
  serie?: string | null
  origen?: string | null
  cliente?: string | null
}

export async function obtenerDocumentosInforme(
  companyId: string,
  f: FiltrosDocumentosInforme,
  limite: number,
  desplazamiento: number,
): Promise<PaginaDocumentosInforme> {
  const { data, error } = await supabase.rpc('informe_documentos', {
    p_company: companyId,
    p_desde: f.desde,
    p_hasta: f.hasta,
    p_tipo: f.tipo ?? null,
    p_moneda: f.moneda ?? null,
    p_estado: f.estado ?? null,
    p_serie: f.serie ?? null,
    p_origen: f.origen ?? null,
    p_cliente: f.cliente ?? null,
    p_limite: limite,
    p_offset: desplazamiento,
  } as never)
  if (error) throw errorDeInforme(error.message)

  const filas = (data ?? []) as unknown as {
    tipo: string; id: string; numero: string; fecha: string
    cliente_id: string | null; cliente: string | null
    estado: string; serie: string | null; origen: string | null
    moneda: string; importe: number; en_revision: boolean
    total_filas: number; total_importe: number
  }[]

  return {
    filas: filas.map((r) => ({
      tipo: r.tipo as FilaDocumentoInforme['tipo'],
      id: r.id,
      numero: r.numero,
      fecha: r.fecha,
      clienteId: r.cliente_id,
      cliente: r.cliente,
      estado: r.estado,
      serie: r.serie,
      origen: r.origen,
      moneda: r.moneda,
      importe: Number(r.importe),
      enRevision: r.en_revision,
    })),
    // El total viene repetido en cada fila (cross join). Sin filas no hay
    // universo: cero documentos suman cero, no «no sé».
    total: Number(filas[0]?.total_filas ?? 0),
    totalImporte: Number(filas[0]?.total_importe ?? 0),
  }
}

export interface FacetaDocumentos {
  dimension: 'estado' | 'serie' | 'origen' | 'moneda' | 'tipo'
  valor: string
  documentos: number
}

/**
 * Qué valores EXISTEN en el universo que se está mirando.
 *
 * Sin esto el selector de estados ofrece los de los tres tipos mezclados —un
 * «shipped» cuando uno mira cotizaciones— y el de series ofrece RT viendo
 * PDV. Las opciones salen de los datos, no de una lista escrita a mano que se
 * desactualiza.
 */
export async function obtenerFacetasDocumentos(
  companyId: string,
  desde: string,
  hasta: string,
  tipo: string | null,
  moneda: string | null,
): Promise<FacetaDocumentos[]> {
  const { data, error } = await supabase.rpc('informe_documentos_facetas', {
    p_company: companyId,
    p_desde: desde,
    p_hasta: hasta,
    p_tipo: tipo,
    p_moneda: moneda,
  } as never)
  if (error) throw errorDeInforme(error.message)
  return ((data ?? []) as unknown as FacetaDocumentos[]).map((r) => ({
    dimension: r.dimension,
    valor: r.valor,
    documentos: Number(r.documentos),
  }))
}
