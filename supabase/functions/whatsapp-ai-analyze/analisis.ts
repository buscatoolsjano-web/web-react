/**
 * El circuito de un análisis, sin HTTP y sin el SDK de Supabase adentro.
 *
 * Lo usa la Edge Function (Deno) y el script del fixture (Node). Recibe un
 * cliente con service_role YA AUTORIZADO: quién puede pedir un análisis lo
 * decide `index.ts` antes de llegar acá, leyendo la conversación con el JWT
 * de la persona.
 *
 * Incremental: se manda el resumen previo y sólo los mensajes posteriores al
 * checkpoint. Si no hay mensajes nuevos, no se llama al proveedor.
 *
 * No destructivo: si el proveedor falla o devuelve basura, el resumen previo y
 * su checkpoint quedan como estaban y se registra la corrida con el código.
 */
import {
  ESPERA_MINIMA_MS,
  FalloProveedor,
  MAX_MENSAJES_POR_ANALISIS,
  SalidaInvalida,
  calcularCostoOpenAI,
  parsearSalida,
  textoParaIA,
  validarResultado,
  type EntradaAnalisis,
  type MensajeParaIA,
  type ProveedorIA,
} from './logica.ts'

// El cliente de Supabase, reducido a lo que se usa. `any` a propósito: este
// archivo lo compilan dos runtimes con dos SDKs distintos.
// deno-lint-ignore no-explicit-any
type Cliente = any

export type EstadoAnalisis =
  | 'ok'
  | 'sin_cambios'
  | 'reciente'
  | 'no_soportado'
  | 'obsoleto'
  | 'error'

export interface ResultadoAnalisis {
  estado: EstadoAnalisis
  codigo?: string
  itemsNuevos?: number
  itemsRepetidos?: number
  itemsDescartados?: number
  aliasInventados?: number
  fechasDescartadas?: number
  mensajesEnviados?: number
  duracionMs?: number
}

export interface OpcionesAnalisis {
  admin: Cliente
  proveedor: ProveedorIA
  conversacionId: string
  completo: boolean
  solicitadoPor: string | null
  zonaHoraria?: string
  ahora?: () => number
}

export async function analizarConversacion(o: OpcionesAnalisis): Promise<ResultadoAnalisis> {
  const ahora = o.ahora ?? Date.now
  const zona = o.zonaHoraria ?? 'America/Argentina/Buenos_Aires'
  const inicio = ahora()
  // El proveedor va en CADA corrida, también en las fallidas y en las que no
  // llamaron a nadie: es lo que permite contar llamadas reales por proveedor.
  const metricasBase = { requested_by: o.solicitadoPor, provider: o.proveedor.nombre }

  const registrar = async (estado: 'error' | 'sin_cambios', codigo: string | null, extra: Record<string, unknown> = {}) => {
    await o.admin.rpc('registrar_corrida_ia_whatsapp', {
      p_conversacion: o.conversacionId,
      p_estado: estado,
      p_error_code: codigo,
      p_modelo: o.proveedor.nombre,
      p_metricas: { ...metricasBase, duration_ms: ahora() - inicio, ...extra },
    })
  }

  // 1 · La conversación. Los grupos todavía no se analizan.
  const { data: conv, error: eConv } = await o.admin
    .from('whatsapp_conversations')
    .select('id, company_id, profile_name, conversation_type')
    .eq('id', o.conversacionId)
    .maybeSingle()
  if (eConv || !conv) return { estado: 'error', codigo: 'conversacion' }
  if (conv.conversation_type !== 'individual') return { estado: 'no_soportado', codigo: 'grupo' }

  // 2 · Debounce: un análisis exitoso hace menos de 30 s alcanza.
  const { data: ultima } = await o.admin
    .from('whatsapp_ai_runs')
    .select('created_at, status')
    .eq('conversation_id', o.conversacionId)
    .eq('status', 'ok')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (ultima && ahora() - new Date(ultima.created_at).getTime() < ESPERA_MINIMA_MS) {
    return { estado: 'reciente' }
  }

  // 3 · Checkpoint.
  const { data: resumen } = await o.admin
    .from('whatsapp_conversation_ai_summary')
    .select('summary, last_analyzed_message_id, last_analyzed_message_at')
    .eq('conversation_id', o.conversacionId)
    .maybeSingle()

  const incremental = !o.completo && resumen?.last_analyzed_message_at
  let q = o.admin
    .from('whatsapp_messages')
    .select('id, direction, message_type, text_body, caption, ordenado_en, status')
    .eq('conversation_id', o.conversacionId)
  if (incremental) q = q.gte('ordenado_en', resumen.last_analyzed_message_at)
  // Los ÚLTIMOS N, no los primeros: de una conversación larga importa lo reciente.
  const { data: filas, error: eMsgs } = await q
    .order('ordenado_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(MAX_MENSAJES_POR_ANALISIS)
  if (eMsgs) return { estado: 'error', codigo: 'mensajes' }

  const nuevas = ((filas ?? []) as {
    id: string; direction: string; message_type: string
    text_body: string | null; caption: string | null; ordenado_en: string; status: string
  }[])
    .filter((f) => !incremental || f.id !== resumen.last_analyzed_message_id)
    // Un saliente que falló —o que todavía no salió— NUNCA le llegó al
    // contacto. Mandárselo al modelo es hacerle creer que se dijo algo que
    // no se dijo: un «te mando mañana» fallido se volvería un compromiso.
    // El envío fallido ya es una señal de atención por regla, sin IA.
    .filter((f) => f.direction === 'in' || f.status === 'sent')
    .reverse()

  if (nuevas.length === 0) {
    await registrar('sin_cambios', null)
    return { estado: 'sin_cambios' }
  }

  // 4 · Lo abierto, para que no lo repita. Sólo el texto.
  const { data: abiertos } = await o.admin
    .from('whatsapp_ai_items')
    .select('description')
    .eq('conversation_id', o.conversacionId)
    .eq('status', 'open')
    .order('generated_at', { ascending: false })
    .limit(30)

  // 5 · La entrada. Alias en vez de uuids; nombre de perfil, nunca el teléfono.
  const mensajes: MensajeParaIA[] = nuevas.map((f, i) => ({
    alias: `m${i + 1}`,
    id: f.id,
    autor: f.direction === 'out' ? 'empresa' : 'contacto',
    enviadoEn: f.ordenado_en,
    texto: textoParaIA(f),
  }))
  const entrada: EntradaAnalisis = {
    contacto: conv.profile_name?.trim() || 'Contacto',
    resumenPrevio: o.completo ? null : resumen?.summary ?? null,
    abiertosPrevios: ((abiertos ?? []) as { description: string }[]).map((a) => a.description),
    mensajes,
    zonaHoraria: zona,
  }

  // 6 · El proveedor.
  let respuesta
  try {
    respuesta = await o.proveedor.analizar(entrada)
  } catch (e) {
    const codigo = e instanceof FalloProveedor ? `proveedor_${e.codigo}` : 'proveedor_caido'
    await registrar('error', codigo, { messages_sent: mensajes.length })
    return { estado: 'error', codigo, mensajesEnviados: mensajes.length }
  }

  // Uso y costo de la llamada. Sin texto: ni prompt, ni respuesta, ni mensajes.
  const costo = o.proveedor.nombre === 'openai' ? calcularCostoOpenAI(respuesta.modelo, respuesta.uso) : null
  const metricasUso = {
    messages_sent: mensajes.length,
    input_tokens: respuesta.uso.inputTokens,
    output_tokens: respuesta.uso.outputTokens,
    cached_tokens: respuesta.uso.cachedTokens ?? null,
    reasoning_tokens: respuesta.uso.reasoningTokens ?? null,
    estimated_cost_usd: costo?.totalUsd ?? null,
  }

  // 7 · Validación. Una salida entera inválida no toca el resumen previo.
  let informe
  try {
    informe = validarResultado(parsearSalida(respuesta.texto), entrada)
  } catch (e) {
    const codigo = e instanceof SalidaInvalida ? `salida_${e.codigo}` : 'salida_invalida'
    await registrar('error', codigo, metricasUso)
    return { estado: 'error', codigo, mensajesEnviados: mensajes.length }
  }

  // 8 · Guardar. El checkpoint es el último mensaje que se mandó.
  const ultimoMensaje = mensajes[mensajes.length - 1]!
  const { data: guardado, error: eGuardar } = await o.admin.rpc('guardar_analisis_whatsapp', {
    p_conversacion: o.conversacionId,
    p_hasta_mensaje: ultimoMensaje.id,
    p_resultado: informe.resultado,
    p_modelo: respuesta.modelo,
    p_metricas: {
      ...metricasBase,
      ...metricasUso,
      duration_ms: ahora() - inicio,
      items_discarded: informe.descartados.length,
    },
  })

  if (eGuardar) {
    const mensaje = String(eGuardar.message ?? '')
    if (mensaje.includes('ANALISIS_OBSOLETO')) return { estado: 'obsoleto' }
    const codigo = ['FUENTE_INVALIDA', 'CHECKPOINT_INVALIDO', 'ITEM_INVALIDO', 'ITEM_SIN_FUENTE', 'RESULTADO_INVALIDO']
      .find((c) => mensaje.includes(c))?.toLowerCase() ?? 'guardado'
    await registrar('error', codigo, metricasUso)
    return { estado: 'error', codigo }
  }

  const g = (guardado ?? {}) as { items_nuevos?: number; items_repetidos?: number }
  return {
    estado: 'ok',
    itemsNuevos: g.items_nuevos ?? 0,
    itemsRepetidos: g.items_repetidos ?? 0,
    itemsDescartados: informe.descartados.length,
    aliasInventados: informe.aliasInventados.length,
    fechasDescartadas: informe.fechasDescartadas,
    mensajesEnviados: mensajes.length,
    duracionMs: ahora() - inicio,
  }
}
