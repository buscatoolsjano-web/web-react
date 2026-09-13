import { supabase } from '@/services/supabase/client'
import { pedir } from './contenido'
import type {
  AdjuntoRedaccion,
  BorradorEditable,
  BorradorGuardado,
  ModoRedaccion,
  ResultadoEnvio,
  ResumenBorradorGmail,
  SugerenciaDestinatario,
} from '../types'

/**
 * Borradores y envío, a través del servicio de la bandeja.
 *
 * Los borradores viven en Gmail: acá no se guarda nada en Supabase ni en
 * localStorage. El estado del formulario es memoria del componente, y el
 * borrador se recupera de Gmail por su id (que va en la URL).
 */

export interface DatosRedaccion {
  accountId: string
  modo: ModoRedaccion
  threadId: string | null
  refMessageId: string | null
  draftId: string | null
  para: string[]
  cc: string[]
  cco: string[]
  asunto: string
  texto: string
  adjuntos: AdjuntoRedaccion[]
}

function cuerpo(d: DatosRedaccion) {
  return {
    account_id: d.accountId,
    modo: d.modo,
    thread_id: d.threadId,
    ref_message_id: d.refMessageId,
    draft_id: d.draftId,
    para: d.para,
    cc: d.cc,
    cco: d.cco,
    asunto: d.asunto,
    texto: d.texto,
    adjuntos: d.adjuntos.map((a) =>
      a.tipo === 'nuevo'
        ? { tipo: 'nuevo', nombre: a.nombre, mime: a.mime, datos: a.datos }
        : a.tipo === 'borrador'
          ? { tipo: 'borrador', part_id: a.partId }
          : { tipo: 'original', message_id: a.messageId, part_id: a.partId },
    ),
  }
}

export async function guardarBorrador(d: DatosRedaccion): Promise<BorradorGuardado> {
  const r = await pedir('/gmail/draft', {}, undefined, { metodo: 'POST', cuerpo: cuerpo(d) })
  return (await r.json()) as BorradorGuardado
}

/**
 * El borrador se busca por su draftId. La pista (desde qué hilo y mensaje se
 * abrió) sólo la usa el servidor si el borrador no trae sus datos, y la valida.
 */
export async function obtenerBorrador(
  accountId: string,
  draftId: string,
  pista?: { modo: ModoRedaccion; refMessageId: string | null; threadId: string | null },
): Promise<BorradorEditable> {
  const r = await pedir('/gmail/draft', {
    account_id: accountId,
    draft_id: draftId,
    ...(pista && pista.modo !== 'nuevo'
      ? { modo: pista.modo, ...(pista.refMessageId ? { ref_message_id: pista.refMessageId } : {}), ...(pista.threadId ? { thread_id: pista.threadId } : {}) }
      : {}),
  })
  return (await r.json()) as BorradorEditable
}

export async function listarBorradores(accountId: string, threadId: string | null): Promise<ResumenBorradorGmail[]> {
  const r = await pedir('/gmail/drafts', { account_id: accountId, ...(threadId ? { thread_id: threadId } : {}) })
  return ((await r.json()) as { borradores: ResumenBorradorGmail[] }).borradores
}

export async function descartarBorrador(accountId: string, draftId: string): Promise<void> {
  await pedir('/gmail/draft', { account_id: accountId, draft_id: draftId }, undefined, { metodo: 'DELETE' })
}

/**
 * Enviar. `clientRequestId` lo genera el composer UNA vez por envío y lo
 * conserva en cada reintento: es lo que impide que un doble click, una segunda
 * pestaña o un reintento manden dos mails.
 */
export async function enviar(d: DatosRedaccion, clientRequestId: string): Promise<ResultadoEnvio> {
  const r = await pedir('/gmail/send', {}, undefined, {
    metodo: 'POST',
    cuerpo: { ...cuerpo(d), client_request_id: clientRequestId },
    aceptar: [202, 502],
  })
  const j = (await r.json()) as ResultadoEnvio | { error: string }
  if ('estado' in j) return j
  return { estado: 'fallido', error: j.error }
}

/** Sugerencias del CRM y del historial. Contexto, nunca vínculo verificado. */
export async function autocompletar(companyId: string, texto: string): Promise<SugerenciaDestinatario[]> {
  if (texto.trim().length < 2) return []
  const { data, error } = await supabase.rpc('autocompletar_destinatarios_email', { p_company: companyId, p_q: texto })
  if (error) throw new Error(`No se pudieron buscar destinatarios: ${error.message}`)
  return (data ?? []).map((s) => ({
    direccion: s.direccion,
    nombre: s.nombre,
    clienteId: s.cliente_id,
    clienteNombre: s.cliente_nombre,
    fuente: s.fuente as SugerenciaDestinatario['fuente'],
    clientes: s.clientes,
  }))
}

/** Después de enviar un mail nuevo, el uuid del hilo en el índice cuando llegue. */
export async function hiloIndexado(accountId: string, gmailThreadId: string): Promise<string | null> {
  const { data } = await supabase
    .from('email_threads')
    .select('id')
    .eq('account_id', accountId)
    .eq('gmail_thread_id', gmailThreadId)
    .maybeSingle()
  return data?.id ?? null
}

/** Espera a que el sync indexe un hilo, por Realtime y con tope. Sin polling. */
export function esperarHiloIndexado(accountId: string, gmailThreadId: string, alLlegar: (id: string) => void, topeMs = 45_000): () => void {
  let terminado = false
  const canal = supabase
    .channel(`emails-enviado:${gmailThreadId}:${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'email_threads', filter: `gmail_thread_id=eq.${gmailThreadId}` },
      (p) => {
        const fila = p.new as { id?: string; account_id?: string }
        if (!terminado && fila.id && fila.account_id === accountId) {
          terminado = true
          alLlegar(fila.id)
        }
      },
    )
    .subscribe()
  // Por si llegó antes de suscribirse.
  void hiloIndexado(accountId, gmailThreadId).then((id) => {
    if (id && !terminado) {
      terminado = true
      alLlegar(id)
    }
  })
  const reloj = setTimeout(() => {
    terminado = true
  }, topeMs)
  return () => {
    terminado = true
    clearTimeout(reloj)
    void supabase.removeChannel(canal)
  }
}
