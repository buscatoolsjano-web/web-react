import { supabase } from '@/services/supabase/client'
import type { ConversacionListado, DetalleConversacion, FiltroBandeja } from '../types'

/**
 * La bandeja.
 *
 * Dos reglas que vienen del incidente de egreso del sistema anterior:
 *
 * 1. **Nunca `select *`.** El listado pide sólo lo que se dibuja; el cuerpo de
 *    los mensajes no entra acá, sólo el preview de 160 caracteres que ya
 *    calculó la base.
 * 2. **Nunca polling.** Lo que refresca la bandeja es Realtime. Estas
 *    consultas se pagan una vez al abrir y cuando llega un evento.
 */

/** Columnas del listado. Livianas a propósito. */
const COLUMNAS = `
  id, profile_name, phone_e164, customer_id, assigned_to, archived_at,
  last_message_at, last_message_preview, last_message_dir, service_window_expires_at,
  cliente:customers!customer_id ( legal_name, trade_name ),
  asignado:profiles!assigned_to ( full_name )
`

interface FilaListado {
  id: string
  profile_name: string | null
  phone_e164: string | null
  customer_id: string | null
  assigned_to: string | null
  archived_at: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_message_dir: string | null
  service_window_expires_at: string | null
  cliente: { legal_name: string | null; trade_name: string | null } | null
  asignado: { full_name: string | null } | null
}

const nombreCliente = (c: FilaListado['cliente']) =>
  c?.trade_name?.trim() || c?.legal_name?.trim() || null

function aListado(f: FilaListado, noLeidos: number): ConversacionListado {
  return {
    id: f.id,
    perfil: f.profile_name,
    telefono: f.phone_e164,
    clienteId: f.customer_id,
    clienteNombre: nombreCliente(f.cliente),
    asignadoA: f.assigned_to,
    asignadoNombre: f.asignado?.full_name ?? null,
    ultimoMensajeEn: f.last_message_at,
    ultimoMensaje: f.last_message_preview,
    ultimaDireccion: (f.last_message_dir as 'in' | 'out' | null) ?? null,
    ventanaVenceEn: f.service_window_expires_at,
    archivada: f.archived_at !== null,
    noLeidos,
  }
}

/**
 * Las conversaciones que la persona puede ver.
 *
 * Quién ve qué lo decide la RLS (`app.puede_ver_conversacion_wa`): admin y
 * employee ven toda la empresa, el vendedor sólo lo que tiene asignado. Acá
 * no se filtra por rol — se pide y la base devuelve lo que corresponde.
 */
export async function listarConversaciones(
  companyId: string,
  filtro: FiltroBandeja,
  usuarioId: string | null,
  limite = 50,
): Promise<ConversacionListado[]> {
  let q = supabase
    .from('whatsapp_conversations')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .is('archived_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limite)

  if (filtro === 'sin_asignar') q = q.is('assigned_to', null)
  if (filtro === 'mios' && usuarioId) q = q.eq('assigned_to', usuarioId)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer las conversaciones: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaListado[]
  if (filas.length === 0) return []

  // Los no leídos son POR USUARIO y salen de una RPC, no de un contador en la
  // fila: en el sistema anterior el contador era global y si una persona abría
  // un chat se apagaba para todo el mundo.
  const { data: conteos } = await supabase.rpc('no_leidos_whatsapp', {
    p_conversaciones: filas.map((f) => f.id),
  })
  const porId = new Map(
    ((conteos ?? []) as { conversation_id: string; no_leidos: number }[]).map((c) => [
      c.conversation_id,
      Number(c.no_leidos),
    ]),
  )

  const lista = filas.map((f) => aListado(f, porId.get(f.id) ?? 0))
  return filtro === 'no_leidos' ? lista.filter((c) => c.noLeidos > 0) : lista
}

const COLUMNAS_DETALLE = `
  id, company_id, account_id, profile_name, phone_e164, customer_id,
  customer_contact_id, vinculo_origen, assigned_to, archived_at,
  last_message_at, last_message_preview, last_message_dir, service_window_expires_at,
  cliente:customers!customer_id ( legal_name, trade_name, tax_id ),
  contacto:customer_contacts!customer_contact_id ( full_name ),
  asignado:profiles!assigned_to ( full_name )
`

export async function obtenerConversacion(
  companyId: string,
  id: string,
): Promise<DetalleConversacion | null> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select(COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`)
  if (!data) return null

  const f = data as unknown as FilaListado & {
    company_id: string
    account_id: string
    customer_contact_id: string | null
    vinculo_origen: string | null
    cliente: { legal_name: string | null; trade_name: string | null; tax_id: string | null } | null
    contacto: { full_name: string | null } | null
  }

  return {
    ...aListado(f, 0),
    companyId: f.company_id,
    cuentaId: f.account_id,
    contactoId: f.customer_contact_id,
    contactoNombre: f.contacto?.full_name ?? null,
    vinculoOrigen: f.vinculo_origen,
    clienteCuit: f.cliente?.tax_id ?? null,
  }
}

/** Marca leída hasta ahora, para esta persona y nadie más. */
export async function marcarLeida(conversacionId: string): Promise<void> {
  const { error } = await supabase.rpc('marcar_conversacion_leida_whatsapp', {
    p_conversacion: conversacionId,
  })
  if (error) throw new Error(`No se pudo marcar como leída: ${error.message}`)
}

/**
 * Asignar o desasignar (`usuarioId` en `null`).
 *
 * Es la única puerta: no hay `UPDATE` sobre `whatsapp_conversations` para
 * nadie. Sin eso, un vendedor se asignaría cualquier chat y la RLS lo dejaría
 * entrar. La RPC valida al actor adentro.
 */
export async function asignar(conversacionId: string, usuarioId: string | null): Promise<void> {
  const { error } = await supabase.rpc('asignar_conversacion_whatsapp', {
    p_conversacion: conversacionId,
    p_usuario: usuarioId,
  })
  if (error) throw new Error(`No se pudo asignar: ${error.message}`)
}
