import { supabase } from '@/services/supabase/client'
import { getEnv } from '@/lib/env'
import type {
  ActorIA,
  EstadoConversacionIA,
  EstadoItemIA,
  InformeWhatsapp,
  ItemIA,
  MotivoAtencion,
  ResumenIA,
  TipoItemIA,
} from '../lib/ia'

/**
 * La IA de WhatsApp, del lado del navegador.
 *
 * El navegador NUNCA habla con un proveedor de IA: lee lo que ya se guardó
 * (con la RLS de la conversación) y, para analizar, le pide a la Edge Function
 * `whatsapp-ai-analyze`, que es la única que tiene la clave.
 *
 * Nada de acá se consulta por intervalo. El resumen se lee al abrir la
 * conversación y se refresca cuando alguien pide actualizarlo.
 */

interface FilaResumen {
  conversation_id: string
  summary: string | null
  topics: string[] | null
  conversation_state: string | null
  requires_attention: boolean
  last_analyzed_message_id: string | null
  last_analyzed_message_at: string | null
  status: string
  last_error: string | null
  model: string | null
  analyses_count: number
  generated_at: string | null
}

interface FilaItem {
  id: string
  conversation_id: string
  type: string
  actor: string
  description: string
  source_message_ids: string[]
  confidence: number | string
  due_at: string | null
  status: string
  generated_at: string
  resolved_at: string | null
}

export function aResumen(f: FilaResumen): ResumenIA {
  return {
    conversacionId: f.conversation_id,
    resumen: f.summary,
    temas: f.topics ?? [],
    estadoConversacion: (f.conversation_state as EstadoConversacionIA | null) ?? null,
    requiereAtencion: f.requires_attention,
    ultimoMensajeAnalizadoId: f.last_analyzed_message_id,
    ultimoMensajeAnalizadoEn: f.last_analyzed_message_at,
    estado: f.status === 'error' ? 'error' : 'ok',
    ultimoError: f.last_error,
    modelo: f.model,
    analisis: f.analyses_count,
    generadoEn: f.generated_at,
  }
}

export function aItem(f: FilaItem): ItemIA {
  return {
    id: f.id,
    conversacionId: f.conversation_id,
    tipo: f.type as TipoItemIA,
    actor: f.actor as ActorIA,
    descripcion: f.description,
    fuentes: f.source_message_ids ?? [],
    confianza: Number(f.confidence),
    // Un vencimiento es un DÍA: se guarda como medianoche UTC de esa fecha.
    venceEn: f.due_at ? f.due_at.slice(0, 10) : null,
    estado: f.status as EstadoItemIA,
    generadoEn: f.generated_at,
    resueltoEn: f.resolved_at,
  }
}

const COLUMNAS_RESUMEN = `conversation_id, summary, topics, conversation_state, requires_attention,
  last_analyzed_message_id, last_analyzed_message_at, status, last_error, model, analyses_count, generated_at`

const COLUMNAS_ITEM = `id, conversation_id, type, actor, description, source_message_ids, confidence,
  due_at, status, generated_at, resolved_at`

export async function obtenerResumenIA(conversacionId: string): Promise<ResumenIA | null> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_ai_summary')
    .select(COLUMNAS_RESUMEN)
    .eq('conversation_id', conversacionId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el resumen: ${error.message}`)
  return data ? aResumen(data) : null
}

export async function listarItemsIA(conversacionId: string): Promise<ItemIA[]> {
  const { data, error } = await supabase
    .from('whatsapp_ai_items')
    .select(COLUMNAS_ITEM)
    .eq('conversation_id', conversacionId)
    .order('generated_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`No se pudieron leer las sugerencias: ${error.message}`)
  return ((data ?? []) as unknown as FilaItem[]).map(aItem)
}

export async function resolverItemIA(itemId: string, estado: EstadoItemIA): Promise<void> {
  const { error } = await supabase.rpc('resolver_item_ia_whatsapp', { p_item: itemId, p_estado: estado })
  if (error) {
    throw new Error(
      error.message.includes('ITEM_INEXISTENTE')
        ? 'La sugerencia ya no existe o no tenés acceso.'
        : 'No se pudo actualizar la sugerencia.',
    )
  }
}

/** Una corrida del análisis, para la pestaña Actividad. Sólo la ven admin y employee. */
export interface CorridaIA {
  id: number
  estado: 'ok' | 'error' | 'sin_cambios'
  codigo: string | null
  mensajes: number
  itemsGuardados: number
  itemsDescartados: number
  duracionMs: number | null
  tokensEntrada: number | null
  tokensSalida: number | null
  en: string
}

export async function listarCorridasIA(conversacionId: string): Promise<CorridaIA[]> {
  const { data, error } = await supabase
    .from('whatsapp_ai_runs')
    .select('id, status, error_code, messages_sent, items_saved, items_discarded, duration_ms, input_tokens, output_tokens, created_at')
    .eq('conversation_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw new Error(`No se pudo leer la actividad: ${error.message}`)
  return (data ?? []).map((f) => ({
    id: f.id,
    estado: f.status as CorridaIA['estado'],
    codigo: f.error_code,
    mensajes: f.messages_sent,
    itemsGuardados: f.items_saved,
    itemsDescartados: f.items_discarded,
    duracionMs: f.duration_ms,
    tokensEntrada: f.input_tokens,
    tokensSalida: f.output_tokens,
    en: f.created_at,
  }))
}

/**
 * Señales de atención para un LOTE de conversaciones: una consulta para toda
 * la bandeja, no una por fila. La base aplica la RLS: ids ajenos no vuelven.
 */
export async function senalesDeAtencion(conversaciones: readonly string[]): Promise<Record<string, MotivoAtencion[]>> {
  if (conversaciones.length === 0) return {}
  const { data, error } = await supabase.rpc('senales_atencion_whatsapp', {
    p_conversaciones: [...conversaciones],
    p_horas: 4,
  })
  if (error) throw new Error(`No se pudieron calcular las señales: ${error.message}`)
  const resultado: Record<string, MotivoAtencion[]> = {}
  for (const f of (data ?? []) as { conversation_id: string; motivos: string[] }[]) {
    resultado[f.conversation_id] = f.motivos as MotivoAtencion[]
  }
  return resultado
}

export type ResultadoAnalisisIA =
  | { estado: 'ok'; nuevos: number; descartados: number }
  | { estado: 'sin_cambios' | 'reciente' }
  | { estado: 'error'; mensaje: string }

export class FalloAnalisis extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'FalloAnalisis'
  }
}

const TEXTO_ESTADO: Record<string, string> = {
  obsoleto: 'Otra persona actualizó el resumen recién. Ya se muestra el más nuevo.',
  no_soportado: 'Los grupos todavía no se analizan.',
  conversacion_inexistente: 'La conversación ya no existe o no tenés acceso.',
  sin_sesion: 'Tu sesión venció. Volvé a entrar.',
  desactivada: 'La IA de WhatsApp está desactivada para esta empresa. Un administrador la puede encender en Configuración.',
  limite: 'Se alcanzó el límite diario de análisis con IA de la empresa. Mañana vuelve a estar disponible.',
}

/**
 * Pide un análisis. No devuelve el resumen: lo guarda la función, y la
 * pantalla lo vuelve a leer con la RLS de siempre.
 *
 * Un fallo nunca borra el resumen anterior; acá sólo se traduce a castellano.
 */
export async function pedirAnalisis(conversacionId: string, completo = false): Promise<ResultadoAnalisisIA> {
  const { data: sesion } = await supabase.auth.getSession()
  const token = sesion.session?.access_token
  if (!token) throw new FalloAnalisis(TEXTO_ESTADO.sin_sesion!)

  const env = getEnv()
  let respuesta: Response
  try {
    respuesta = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversation_id: conversacionId, ...(completo ? { completo: true } : {}) }),
    })
  } catch {
    throw new FalloAnalisis('El análisis no está disponible en este momento.')
  }

  const cuerpo = (await respuesta.json().catch(() => ({}))) as {
    estado?: string
    error?: string
    items_nuevos?: number
    items_descartados?: number
  }

  if (respuesta.status === 404 && !cuerpo.error) {
    throw new FalloAnalisis('El análisis con IA todavía no está disponible.')
  }
  if (cuerpo.estado === 'ok') {
    return { estado: 'ok', nuevos: cuerpo.items_nuevos ?? 0, descartados: cuerpo.items_descartados ?? 0 }
  }
  if (cuerpo.estado === 'sin_cambios' || cuerpo.estado === 'reciente') return { estado: cuerpo.estado }

  const clave = cuerpo.estado ?? cuerpo.error ?? ''
  throw new FalloAnalisis(TEXTO_ESTADO[clave] ?? 'No se pudo actualizar el resumen. El anterior se mantiene.')
}

export interface FilaInforme {
  desde: string
  hasta: string
  totales: Record<string, number>
  conversaciones: {
    id: string; contacto: string | null; cliente_id: string | null; cliente: string | null
    asignado_id: string | null; asignado: string | null; nueva: boolean; ultimo_mensaje_en: string | null
    motivos: string[]; resumen: string | null; estado_ia: string | null
  }[]
  items: FilaItem[]
  temas: { tema: string; veces: number }[]
  por_asignado: { asignado_id: string | null; asignado: string | null; conversaciones: number }[]
}

/**
 * El informe de un período. Se arma en la base con lo que ya existe; pedirlo
 * no llama a la IA ni escribe nada. `companyId` se valida en la base contra
 * las empresas de la persona.
 */
export async function obtenerInforme(companyId: string, desde: string, hasta: string): Promise<InformeWhatsapp> {
  const { data, error } = await supabase.rpc('informe_whatsapp', {
    p_company: companyId,
    p_desde: desde,
    p_hasta: hasta,
    p_horas: 4,
  })
  if (error) {
    throw new Error(
      error.message.includes('SIN_PERMISO') ? 'Tu rol no tiene acceso a los informes de WhatsApp.' : 'No se pudo armar el informe.',
    )
  }
  return aInforme(data as unknown as FilaInforme)
}

/** El payload del informe —en vivo o guardado— tiene la misma forma. */
export function aInforme(f: FilaInforme): InformeWhatsapp {
  const t = (k: string) => Number(f.totales[k] ?? 0)
  return {
    desde: f.desde,
    hasta: f.hasta,
    totales: {
      conversacionesActivas: t('conversaciones_activas'),
      conversacionesNuevas: t('conversaciones_nuevas'),
      mensajesEntrantes: t('mensajes_entrantes'),
      mensajesSalientes: t('mensajes_salientes'),
      erroresEnvio: t('errores_envio'),
      sinRespuesta: t('sin_respuesta'),
      sinAsignar: t('sin_asignar'),
      pendientesAbiertos: t('pendientes_abiertos'),
      pendientesResueltos: t('pendientes_resueltos'),
      compromisos: t('compromisos'),
      compromisosVencidos: t('compromisos_vencidos'),
      decisiones: t('decisiones'),
    },
    conversaciones: f.conversaciones.map((c) => ({
      id: c.id,
      contacto: c.contacto,
      clienteId: c.cliente_id,
      cliente: c.cliente,
      asignadoId: c.asignado_id,
      asignado: c.asignado,
      nueva: c.nueva,
      ultimoMensajeEn: c.ultimo_mensaje_en,
      motivos: c.motivos as MotivoAtencion[],
      resumen: c.resumen,
      estadoIA: (c.estado_ia as EstadoConversacionIA | null) ?? null,
    })),
    items: f.items.map(aItem),
    temas: f.temas,
    porAsignado: f.por_asignado.map((p) => ({ asignadoId: p.asignado_id, asignado: p.asignado, conversaciones: p.conversaciones })),
  }
}

export interface InformeGuardado {
  informe: InformeWhatsapp
  generadoEn: string
  corte: string
}

/**
 * El snapshot guardado de un período, si existe. Sólo administración los ve
 * (RLS): para cualquier otro rol vuelve null y la pantalla usa el informe en
 * vivo. Leerlo no escribe nada ni llama a la IA.
 */
export async function obtenerInformeGuardado(
  companyId: string,
  tipo: 'daily' | 'weekly',
  desde: string,
  hasta: string,
): Promise<InformeGuardado | null> {
  const { data, error } = await supabase
    .from('whatsapp_ai_reports')
    .select('payload, generated_at, source_cutoff')
    .eq('company_id', companyId)
    .eq('type', tipo)
    .eq('period_start', desde)
    .eq('period_end', hasta)
    .maybeSingle()
  if (error || !data) return null
  return { informe: aInforme(data.payload as unknown as FilaInforme), generadoEn: data.generated_at, corte: data.source_cutoff }
}
