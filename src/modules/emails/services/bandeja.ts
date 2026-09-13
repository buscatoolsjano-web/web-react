import { supabase } from '@/services/supabase/client'
import type {
  ClaseSugerencia,
  ClienteVinculado,
  CuentaEmail,
  EstadoHilo,
  EstadoTrabajo,
  FiltrosEmails,
  HiloIndice,
  PaginaBandeja,
  SugerenciaCliente,
  UsuarioAsignable,
} from '../types'

/**
 * El índice y el trabajo del ERP, en Supabase.
 *
 * NADA de acá habla con Gmail, y nada de acá trae un cuerpo: el listado sale
 * de `email_threads`, que no tiene dónde guardarlo.
 */

function fallo(que: string, error: { message: string }): never {
  throw new Error(`${que}: ${error.message}`)
}

export async function listarCuentas(companyId: string): Promise<CuentaEmail[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('id, email_address, display_name, sync_error, sync_error_at, last_synced_at')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('email_address')
  if (error) fallo('No se pudieron leer las cuentas de correo', error)
  return (data ?? []).map((c) => ({
    id: c.id,
    direccion: c.email_address,
    nombre: c.display_name,
    errorSync: c.sync_error,
    errorSyncEn: c.sync_error_at,
    ultimaSync: c.last_synced_at,
  }))
}

export async function listarBandeja(companyId: string, f: FiltrosEmails): Promise<PaginaBandeja> {
  const { data, error } = await supabase.rpc('listar_bandeja_email', {
    p_company: companyId,
    p_account: f.cuenta,
    p_q: f.q.trim() || null,
    p_sin_leer: f.soloNoLeidos,
    p_estado: f.estado,
    p_asignado: f.asignado,
    p_cliente: f.cliente,
    p_adjuntos: f.soloConAdjuntos,
    p_limite: f.porPagina,
    p_offset: (f.pagina - 1) * f.porPagina,
  })
  if (error) fallo('No se pudo leer la bandeja', error)
  const filas = data ?? []
  return {
    filas: filas.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      gmailThreadId: r.gmail_thread_id,
      asunto: r.subject,
      extracto: r.snippet,
      ultimoMensajeEn: r.last_message_at,
      ultimoRemitente: r.last_message_from,
      ultimaDireccion: r.last_message_dir === 'in' || r.last_message_dir === 'out' ? r.last_message_dir : null,
      participantes: r.participants,
      cantidadMensajes: r.message_count,
      tieneAdjuntos: r.has_attachments,
      estado: r.workflow_status as EstadoTrabajo,
      asignadoA: r.assigned_to,
      asignadoNombre: r.assigned_name,
      clienteId: r.customer_id,
      clienteNombre: r.customer_name,
      vinculoOrigen: r.vinculo_origen,
      sinLeer: r.sin_leer,
    })),
    total: Number(filas[0]?.total ?? 0),
    totalSinLeer: Number(filas[0]?.total_sin_leer ?? 0),
  }
}

export async function obtenerHilo(companyId: string, id: string): Promise<HiloIndice | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('id, account_id, gmail_thread_id, subject, participants, last_message_at, message_count, has_attachments')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) fallo('No se pudo leer el hilo', error)
  if (!data) return null
  return {
    id: data.id,
    accountId: data.account_id,
    gmailThreadId: data.gmail_thread_id,
    asunto: data.subject,
    participantes: data.participants,
    ultimoMensajeEn: data.last_message_at,
    cantidadMensajes: data.message_count,
    tieneAdjuntos: data.has_attachments,
  }
}

/** Sin fila de estado, el hilo es `pendiente` y no tiene nada asignado. */
export async function obtenerEstado(accountId: string, gmailThreadId: string): Promise<EstadoHilo> {
  const { data, error } = await supabase
    .from('email_thread_state')
    .select('workflow_status, assigned_to, customer_id, customer_contact_id, vinculo_origen')
    .eq('account_id', accountId)
    .eq('gmail_thread_id', gmailThreadId)
    .maybeSingle()
  if (error) fallo('No se pudo leer el estado del hilo', error)
  return {
    estado: (data?.workflow_status as EstadoTrabajo | undefined) ?? 'pendiente',
    asignadoA: data?.assigned_to ?? null,
    clienteId: data?.customer_id ?? null,
    contactoId: data?.customer_contact_id ?? null,
    vinculoOrigen: data?.vinculo_origen ?? null,
  }
}

export async function usuariosAsignables(companyId: string): Promise<UsuarioAsignable[]> {
  const { data, error } = await supabase.rpc('usuarios_asignables_email', { p_company: companyId })
  if (error) fallo('No se pudieron leer los usuarios', error)
  return (data ?? []).map((u) => ({ id: u.user_id, nombre: u.full_name }))
}

export async function sugerenciasCliente(accountId: string, gmailThreadId: string): Promise<SugerenciaCliente[]> {
  const { data, error } = await supabase.rpc('sugerencias_cliente_email', {
    p_account: accountId,
    p_thread: gmailThreadId,
  })
  if (error) fallo('No se pudieron calcular las sugerencias', error)
  return (data ?? []).map((s) => ({
    clienteId: s.customer_id,
    clienteNombre: s.customer_name ?? 'Cliente sin nombre',
    contactoId: s.contact_id,
    contactoNombre: s.contact_name,
    direccion: s.direccion,
    clase: s.clase as ClaseSugerencia,
  }))
}

export async function clienteVinculado(companyId: string, clienteId: string): Promise<ClienteVinculado | null> {
  const [cliente, contactos] = await Promise.all([
    supabase
      .from('customers')
      .select('id, legal_name, trade_name, legacy_ref')
      .eq('company_id', companyId)
      .eq('id', clienteId)
      .maybeSingle(),
    supabase
      .from('customer_contacts')
      .select('id, full_name, email, phone')
      .eq('company_id', companyId)
      .eq('customer_id', clienteId)
      .order('is_default', { ascending: false })
      .limit(5),
  ])
  if (cliente.error) fallo('No se pudo leer el cliente', cliente.error)
  if (contactos.error) fallo('No se pudieron leer los contactos', contactos.error)
  if (!cliente.data) return null
  return {
    id: cliente.data.id,
    nombre: cliente.data.trade_name?.trim() || cliente.data.legal_name,
    referencia: cliente.data.legacy_ref,
    contactos: (contactos.data ?? []).map((c) => ({
      id: c.id,
      nombre: c.full_name,
      email: c.email,
      telefono: c.phone,
    })),
  }
}

export interface ClienteEncontrado {
  id: string
  nombre: string
  referencia: string | null
}

/** Para vincular a mano. Como mucho 10 filas: son 1.010 clientes. */
export async function buscarClientes(companyId: string, texto: string): Promise<ClienteEncontrado[]> {
  const t = texto.trim()
  if (t.length < 2) return []
  const patron = `%${t.replace(/[\\%_,()]/g, ' ')}%`
  const { data, error } = await supabase
    .from('customers')
    .select('id, legal_name, trade_name, legacy_ref')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .or(`legal_name.ilike.${patron},trade_name.ilike.${patron},legacy_ref.ilike.${patron}`)
    .order('legal_name')
    .limit(10)
  if (error) fallo('No se pudo buscar clientes', error)
  return (data ?? []).map((c) => ({
    id: c.id,
    nombre: c.trade_name?.trim() || c.legal_name,
    referencia: c.legacy_ref,
  }))
}

// ── Acciones: siempre por RPC, nunca un UPDATE desde el navegador ─────────

export async function marcarLeido(accountId: string, gmailThreadId: string): Promise<void> {
  const { error } = await supabase.rpc('marcar_hilo_leido_email', {
    p_account: accountId,
    p_thread: gmailThreadId,
  })
  if (error) fallo('No se pudo marcar como leído', error)
}

export async function asignar(accountId: string, gmailThreadId: string, usuario: string | null): Promise<void> {
  const { error } = await supabase.rpc('asignar_hilo_email', {
    p_account: accountId,
    p_thread: gmailThreadId,
    p_usuario: usuario,
  })
  if (error) fallo('No se pudo asignar', error)
}

export async function cambiarEstado(accountId: string, gmailThreadId: string, estado: EstadoTrabajo): Promise<void> {
  const { error } = await supabase.rpc('cambiar_estado_email', {
    p_account: accountId,
    p_thread: gmailThreadId,
    p_estado: estado,
  })
  if (error) fallo('No se pudo cambiar el estado', error)
}

export async function vincularCliente(
  accountId: string,
  gmailThreadId: string,
  cliente: { id: string; contactoId: string | null; origen: ClaseSugerencia | 'manual' } | null,
): Promise<void> {
  const { error } = await supabase.rpc('vincular_cliente_email', {
    p_account: accountId,
    p_thread: gmailThreadId,
    p_customer: cliente?.id ?? null,
    p_contacto: cliente?.contactoId ?? null,
    p_origen: cliente?.origen ?? 'manual',
  })
  if (error) fallo(cliente ? 'No se pudo vincular el cliente' : 'No se pudo desvincular el cliente', error)
}
