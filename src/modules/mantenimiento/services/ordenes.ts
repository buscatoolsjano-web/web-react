import { supabase } from '@/services/supabase/client'
import type {
  CheckDeOrden,
  EtapaOrden,
  EventoDeMantenimiento,
  FiltrosOrdenes,
  OrdenDetalle,
  OrdenListado,
  PaginaDeOrdenes,
  ResultadoCheck,
  Tecnico,
} from '../types'

/**
 * Órdenes de servicio.
 *
 * Lo que importa y no se decide acá:
 *
 *   1. **`customer_id` es un snapshot congelado.** Se precarga del dueño
 *      actual del equipo y después un trigger impide cambiarlo. Si la
 *      herramienta se vende, las órdenes viejas siguen diciendo a quién se le
 *      hizo el trabajo.
 *   2. **La etapa avanza de a una**, salteando sólo las marcadas como no
 *      requeridas, y volver atrás queda auditado. Lo valida el servidor.
 *   3. **Cerrar y cancelar son RPC**, no un UPDATE del estado: por un UPDATE
 *      suelto no se pasa.
 */

const aNumero = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

const COLUMNAS = `
  id, number, asset_id, customer_id, status, stage, on_hold, service_type,
  entry_reason, technician_id, received_at, delivered_at, quote_status,
  quote_currency, quote_total,
  equipo:maintenance_assets!asset_id ( reference, serial_number, model_text ),
  cliente:customers!customer_id ( legal_name ),
  tecnico:profiles!technician_id ( full_name )
`

interface Fila {
  id: string
  number: string
  asset_id: string
  customer_id: string
  status: string
  stage: string
  on_hold: boolean
  service_type: string
  entry_reason: string | null
  technician_id: string | null
  received_at: string
  delivered_at: string | null
  quote_status: string
  quote_currency: string | null
  quote_total: number | string
  equipo: { reference: string; serial_number: string | null; model_text: string | null } | null
  cliente: { legal_name: string } | null
  tecnico: { full_name: string | null } | null
}

const aFila = (f: Fila): OrdenListado => ({
  id: f.id,
  numero: f.number,
  activoId: f.asset_id,
  activoReferencia: f.equipo?.reference ?? '—',
  activoSerie: f.equipo?.serial_number ?? null,
  clienteId: f.customer_id,
  cliente: f.cliente?.legal_name ?? '(cliente no accesible)',
  estado: f.status as OrdenListado['estado'],
  etapa: f.stage as EtapaOrden,
  enEspera: f.on_hold,
  tipoServicio: f.service_type as OrdenListado['tipoServicio'],
  motivoIngreso: f.entry_reason,
  tecnicoId: f.technician_id,
  tecnico: f.tecnico?.full_name ?? null,
  fechaIngreso: f.received_at,
  fechaEntrega: f.delivered_at,
  estadoCotizacion: f.quote_status as OrdenListado['estadoCotizacion'],
  moneda: f.quote_currency,
  total: aNumero(f.quote_total),
})

export async function listarOrdenes(
  companyId: string,
  filtros: FiltrosOrdenes,
): Promise<PaginaDeOrdenes> {
  let q = supabase
    .from('maintenance_orders')
    .select(COLUMNAS, { count: 'exact' })
    .eq('company_id', companyId)

  const texto = filtros.q.trim().replace(/[,()*]/g, '')
  if (texto !== '') q = q.ilike('number', `%${texto}%`)
  if (filtros.clienteId) q = q.eq('customer_id', filtros.clienteId)
  if (filtros.activoId) q = q.eq('asset_id', filtros.activoId)
  if (filtros.estado) q = q.eq('status', filtros.estado)
  if (filtros.etapa) q = q.eq('stage', filtros.etapa)
  if (filtros.tecnicoId) q = q.eq('technician_id', filtros.tecnicoId)
  if (filtros.enEspera === 'si') q = q.eq('on_hold', true)
  if (filtros.enEspera === 'no') q = q.eq('on_hold', false)
  if (filtros.desde) q = q.gte('received_at', filtros.desde)
  if (filtros.hasta) q = q.lte('received_at', filtros.hasta)

  const columna = {
    numero: 'number',
    fecha: 'received_at',
    cliente: 'customer_id',
    etapa: 'stage',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  if (columna !== 'number') q = q.order('number', { ascending: asc })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de órdenes: ${error.message}`)

  return { filas: ((data ?? []) as unknown as Fila[]).map(aFila), total: count ?? 0 }
}

export async function obtenerOrden(
  companyId: string,
  id: string,
): Promise<OrdenDetalle | null> {
  const { data, error } = await supabase
    .from('maintenance_orders')
    .select(
      `${COLUMNAS}, series_code, visual_condition, diagnosis_notes, diagnosed_at,
       diagnosed_by, repair_required, torque_required, repaired_at, torque_at,
       on_hold_since, closing_notes, closed_at, received_by, created_at, updated_at,
       autor:profiles!created_by ( full_name ),
       recibida:profiles!received_by ( full_name )`,
    )
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la orden: ${error.message}`)
  if (!data) return null

  const f = data as unknown as Fila & {
    series_code: string
    visual_condition: string | null
    diagnosis_notes: string | null
    diagnosed_at: string | null
    diagnosed_by: string | null
    repair_required: boolean
    torque_required: boolean
    repaired_at: string | null
    torque_at: string | null
    on_hold_since: string | null
    closing_notes: string | null
    closed_at: string | null
    received_by: string | null
    created_at: string
    updated_at: string
    autor: { full_name: string | null } | null
    recibida: { full_name: string | null } | null
  }

  return {
    ...aFila(f),
    serie: f.series_code,
    activoModelo: f.equipo?.model_text ?? null,
    recibidaPorId: f.received_by,
    recibidaPor: f.recibida?.full_name ?? null,
    condicionVisual: f.visual_condition,
    notasDiagnostico: f.diagnosis_notes,
    diagnosticadaEn: f.diagnosed_at,
    diagnosticadaPorId: f.diagnosed_by,
    requiereReparacion: f.repair_required,
    requiereTorque: f.torque_required,
    reparadaEn: f.repaired_at,
    torqueEn: f.torque_at,
    enEsperaDesde: f.on_hold_since,
    notasCierre: f.closing_notes,
    cerradaEn: f.closed_at,
    autor: f.autor?.full_name ?? null,
    creadoEn: f.created_at,
    actualizadoEn: f.updated_at,
  }
}

/** Los técnicos posibles: los miembros internos de la empresa. */
export async function tecnicosDe(companyId: string): Promise<Tecnico[]> {
  const { data, error } = await supabase
    .from('company_memberships')
    .select('user_id, role, perfil:profiles!user_id ( full_name )')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .in('role', ['admin', 'employee', 'technician'])
  if (error) throw new Error(`No se pudieron leer los técnicos: ${error.message}`)

  return ((data ?? []) as unknown as {
    user_id: string
    perfil: { full_name: string | null } | null
  }[])
    .map((m) => ({ id: m.user_id, nombre: m.perfil?.full_name ?? '(sin nombre)' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// ── Escritura ──────────────────────────────────────────────────────────────

export interface DatosOrden {
  activoId: string
  clienteId: string
  tipoServicio: string
  motivoIngreso: string
  condicionVisual: string
  tecnicoId: string | null
  fechaIngreso: string
  notasDiagnostico: string
}

async function proximoNumero(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'maintenance_order',
  })
  if (error) throw new Error(`No se pudo obtener el número: ${traducir(error.message, error.code)}`)
  if (!data) throw new Error('La numeración no devolvió ningún número')
  return data
}

/**
 * Alta.
 *
 * La orden nace **abierta y en diagnóstico**, que es la primera etapa real del
 * circuito del legacy. El cliente se congela acá: después ni la pantalla ni un
 * UPDATE directo pueden cambiarlo.
 */
export async function crearOrden(
  companyId: string,
  d: DatosOrden,
): Promise<{ id: string; numero: string }> {
  const numero = await proximoNumero(companyId)
  const { data, error } = await supabase
    .from('maintenance_orders')
    .insert({
      company_id: companyId,
      number: numero,
      asset_id: d.activoId,
      customer_id: d.clienteId,
      service_type: d.tipoServicio,
      entry_reason: vacioANulo(d.motivoIngreso),
      visual_condition: vacioANulo(d.condicionVisual),
      technician_id: d.tecnicoId,
      received_at: d.fechaIngreso,
      diagnosis_notes: vacioANulo(d.notasDiagnostico),
    })
    .select('id, number')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))
  return { id: data.id, numero: data.number }
}

export interface CambiosOrden {
  tipoServicio?: string
  motivoIngreso?: string
  condicionVisual?: string
  tecnicoId?: string | null
  fechaIngreso?: string
  notasDiagnostico?: string
  diagnosticadaEn?: string | null
  requiereReparacion?: boolean
  requiereTorque?: boolean
}

export async function actualizarOrden(
  companyId: string,
  id: string,
  c: CambiosOrden,
): Promise<void> {
  const fila: {
    service_type?: string
    entry_reason?: string | null
    visual_condition?: string | null
    technician_id?: string | null
    received_at?: string
    diagnosis_notes?: string | null
    diagnosed_at?: string | null
    repair_required?: boolean
    torque_required?: boolean
  } = {}
  if (c.tipoServicio !== undefined) fila.service_type = c.tipoServicio
  if (c.motivoIngreso !== undefined) fila.entry_reason = vacioANulo(c.motivoIngreso)
  if (c.condicionVisual !== undefined) fila.visual_condition = vacioANulo(c.condicionVisual)
  if (c.tecnicoId !== undefined) fila.technician_id = c.tecnicoId
  if (c.fechaIngreso !== undefined) fila.received_at = c.fechaIngreso
  if (c.notasDiagnostico !== undefined) fila.diagnosis_notes = vacioANulo(c.notasDiagnostico)
  if (c.diagnosticadaEn !== undefined) fila.diagnosed_at = c.diagnosticadaEn
  if (c.requiereReparacion !== undefined) fila.repair_required = c.requiereReparacion
  if (c.requiereTorque !== undefined) fila.torque_required = c.requiereTorque
  if (Object.keys(fila).length === 0) return

  const { error } = await supabase
    .from('maintenance_orders')
    .update(fila)
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Mover de etapa.
 *
 * El servidor valida: adelante de a una salteando las no requeridas, atrás a
 * cualquier anterior, y sólo con la orden abierta. Acá no se decide nada.
 */
export async function moverEtapa(
  companyId: string,
  id: string,
  etapa: EtapaOrden,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_orders')
    .update({ stage: etapa })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** Pausar y reanudar. No cambia la etapa: es un flag ortogonal. */
export async function ponerEnEspera(
  companyId: string,
  id: string,
  enEspera: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_orders')
    .update({
      on_hold: enEspera,
      on_hold_since: enEspera ? new Date().toISOString() : null,
    })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** Cancelar: la salida sin requisitos, por su RPC. */
export async function cancelarOrden(id: string, motivo: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancelar_orden_mantenimiento', {
    p_order: id,
    p_motivo: vacioANulo(motivo),
  })
  if (error) throw new Error(traducir(error.message, error.code))
  return !(data as unknown as { ya_estaba: boolean }).ya_estaba
}

// ── Checks de la orden ─────────────────────────────────────────────────────

export async function checksDeOrden(
  companyId: string,
  ordenId: string,
): Promise<CheckDeOrden[]> {
  const { data, error } = await supabase
    .from('maintenance_order_checks')
    .select(
      `id, check_point_id, phase, result,
       punto:maintenance_check_points!check_point_id ( key, label, sort_order )`,
    )
    .eq('company_id', companyId)
    .eq('maintenance_order_id', ordenId)
  if (error) throw new Error(`No se pudieron leer las revisiones: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: string
    check_point_id: string
    phase: string
    result: string
    punto: { key: string; label: string; sort_order: number } | null
  }[])
    .map((c) => ({
      id: c.id,
      puntoId: c.check_point_id,
      clave: c.punto?.key ?? '',
      etiqueta: c.punto?.label ?? '(punto no accesible)',
      posicion: c.punto?.sort_order ?? 0,
      fase: c.phase as CheckDeOrden['fase'],
      resultado: c.result as ResultadoCheck,
    }))
    .sort((a, b) => a.posicion - b.posicion)
}

/**
 * Marca un punto en una fase.
 *
 * Un `upsert` sobre el único `(orden, punto, fase)`: marcar dos veces el mismo
 * punto corrige el valor en vez de duplicarlo.
 */
export async function marcarCheck(
  companyId: string,
  ordenId: string,
  puntoId: string,
  fase: string,
  resultado: ResultadoCheck,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_order_checks')
    .upsert(
      {
        company_id: companyId,
        maintenance_order_id: ordenId,
        check_point_id: puntoId,
        phase: fase,
        result: resultado,
      },
      { onConflict: 'maintenance_order_id,check_point_id,phase' },
    )
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarCheck(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('maintenance_order_checks')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

// ── Historial ──────────────────────────────────────────────────────────────

export async function historialDe(
  companyId: string,
  entidad: 'maintenance_asset' | 'maintenance_order',
  entidadId: string,
  tope = 100,
): Promise<EventoDeMantenimiento[]> {
  const { data, error } = await supabase
    .from('maintenance_audit')
    .select('id, entity_type, action, from_status, to_status, diff, created_at, actor:profiles!actor_id ( full_name )')
    .eq('company_id', companyId)
    .eq('entity_type', entidad)
    .eq('entity_id', entidadId)
    .order('id', { ascending: false })
    .limit(tope)
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: number
    entity_type: string
    action: string
    from_status: string | null
    to_status: string | null
    diff: Record<string, unknown> | null
    created_at: string
    actor: { full_name: string | null } | null
  }[]).map((e) => ({
    id: e.id,
    entidad: e.entity_type,
    accion: e.action,
    estadoAnterior: e.from_status,
    estadoNuevo: e.to_status,
    autor: e.actor?.full_name ?? null,
    fecha: e.created_at,
    diff: e.diff,
  }))
}

/** El error de Postgres, en castellano. */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23001' || codigo === '23514') return mensaje
  if (codigo === '23505' && mensaje.includes('number')) return 'Ese número de orden ya existe.'
  if (codigo === '23505') return 'Ese valor ya está cargado.'
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Mantenimiento es de administradores y empleados.'
  }
  return mensaje
}
