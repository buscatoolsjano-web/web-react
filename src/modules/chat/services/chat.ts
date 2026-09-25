import { supabase } from '@/services/supabase/client'
import type { Conversacion, MensajeChat, UsuarioDeChat } from '../types'

/**
 * El chat interno, contra Supabase.
 *
 * Todo lo que escribe va por RPC `security definer`: las tablas no tienen
 * política de `insert` para nadie. Así el servidor decide quién puede hablar
 * con quién, y no el navegador.
 */

function fallo(que: string, error: { message: string }): never {
  throw new Error(`${que}: ${error.message}`)
}

/** Las personas de la empresa con las que se puede abrir un chat. */
export async function usuariosParaChat(companyId: string): Promise<UsuarioDeChat[]> {
  const { data, error } = await supabase.rpc('usuarios_para_chat', { p_company: companyId })
  if (error) fallo('No se pudieron leer los usuarios', error)
  return (data ?? []).map((u) => ({ id: u.user_id, nombre: u.nombre, rol: u.rol }))
}

export async function listarChats(companyId: string): Promise<Conversacion[]> {
  const { data, error } = await supabase.rpc('listar_chats', { p_company: companyId })
  if (error) fallo('No se pudieron leer las conversaciones', error)
  return (data ?? []).map((c) => ({
    id: c.id,
    conQuien: c.con_quien,
    conQuienId: c.con_quien_id,
    ultimoMensaje: c.ultimo_mensaje,
    ultimoMensajeEn: c.ultimo_mensaje_en,
    sinLeer: c.sin_leer,
  }))
}

/** Devuelve el chat de a dos con esa persona, creándolo si no existía. */
export async function abrirChatDirecto(companyId: string, otroUsuarioId: string): Promise<string> {
  const { data, error } = await supabase.rpc('abrir_chat_directo', {
    p_company: companyId,
    p_otro: otroUsuarioId,
  })
  if (error) fallo('No se pudo abrir la conversación', error)
  return data
}

/**
 * Los mensajes de una conversación.
 *
 * Trae los últimos 200 y los devuelve en orden de lectura. Una conversación de
 * trabajo con más de doscientos mensajes necesita paginado, y lo va a tener
 * cuando exista: hoy no hay ninguna.
 */
export async function mensajesDeChat(conversacionId: string, miUsuarioId: string): Promise<MensajeChat[]> {
  const { data, error } = await supabase
    .from('chat_mensajes')
    .select('id, conversacion_id, autor_id, texto, created_at, profiles ( full_name )')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) fallo('No se pudieron leer los mensajes', error)

  return (data ?? [])
    .map((m) => ({
      id: m.id,
      conversacionId: m.conversacion_id,
      autorId: m.autor_id,
      autorNombre: m.profiles?.full_name ?? 'Sin nombre',
      texto: m.texto,
      creadoEn: m.created_at,
      esMio: m.autor_id === miUsuarioId,
    }))
    .reverse()
}

export async function enviarMensaje(conversacionId: string, texto: string): Promise<void> {
  const { error } = await supabase.rpc('enviar_mensaje_chat', {
    p_conversacion: conversacionId,
    p_texto: texto,
  })
  if (error) fallo('No se pudo enviar el mensaje', error)
}

export async function marcarChatLeido(conversacionId: string): Promise<void> {
  const { error } = await supabase.rpc('marcar_chat_leido', { p_conversacion: conversacionId })
  if (error) fallo('No se pudo marcar como leído', error)
}

/**
 * Cuántos mensajes sin leer hay, y nada más (para el globito del menú).
 *
 * Es su propia RPC y no un `listar_chats().reduce()`: el menú necesita UN
 * número, y traer todas las conversaciones para sumarlas sería pagar la
 * pantalla entera para dibujarlo.
 */
export async function contarChatsSinLeer(companyId: string): Promise<number> {
  const { data, error } = await supabase.rpc('contar_chats_sin_leer', { p_company: companyId })
  if (error) fallo('No se pudieron contar los mensajes sin leer', error)
  return Number(data ?? 0)
}
