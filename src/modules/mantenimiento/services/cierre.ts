import { supabase } from '@/services/supabase/client'
import type { EstadoCotizacion, EstadoOrden, EtapaOrden, PrecheckCierre } from '../types'

/**
 * El cierre de la orden.
 *
 * Las doce condiciones viven en `app.bloqueos_de_cierre_mant()`, del lado del
 * servidor, y **no están duplicadas acá**. La pantalla no decide si se puede
 * cerrar: pregunta.
 *
 *   · `precheck_cierre_mantenimiento()` devuelve la lista de bloqueos sin
 *     efectos, para armar el resumen antes de apretar el botón.
 *   · `cerrar_orden_mantenimiento()` vuelve a evaluar la MISMA lista dentro de
 *     la transacción y falla si algo cambió mientras tanto.
 *
 * Por eso el precheck es una comodidad y no la autorización: lo que decide es
 * el cierre.
 */

interface FilaPrecheck {
  estado: string
  ya_cerrada: boolean
  puede_cerrar: boolean
  bloqueos: string[] | null
  en_espera: boolean
  etapa: string
  diagnosticada: boolean
  cotizacion: string
  lineas: number
  requiere_reparacion: boolean
  reparada: boolean
  requiere_torque: boolean
  torque_hecho: boolean
  mediciones: number
  repuestos_pendientes: number
  repuestos_consumidos: number
  entregada: string | null
}

export async function precheckCierre(ordenId: string): Promise<PrecheckCierre> {
  const { data, error } = await supabase.rpc('precheck_cierre_mantenimiento', {
    p_order: ordenId,
  })
  if (error) throw new Error(traducir(error.message, error.code))
  const r = data as unknown as FilaPrecheck
  return {
    estado: r.estado as EstadoOrden,
    yaCerrada: r.ya_cerrada,
    puedeCerrar: r.puede_cerrar,
    bloqueos: r.bloqueos ?? [],
    enEspera: r.en_espera,
    etapa: r.etapa as EtapaOrden,
    diagnosticada: r.diagnosticada,
    cotizacion: r.cotizacion as EstadoCotizacion,
    lineas: r.lineas,
    requiereReparacion: r.requiere_reparacion,
    reparada: r.reparada,
    requiereTorque: r.requiere_torque,
    torqueHecho: r.torque_hecho,
    mediciones: r.mediciones,
    repuestosPendientes: r.repuestos_pendientes,
    repuestosConsumidos: r.repuestos_consumidos,
    entregada: r.entregada,
  }
}

export async function cerrarOrden(ordenId: string): Promise<{ yaEstaba: boolean }> {
  const { data, error } = await supabase.rpc('cerrar_orden_mantenimiento', {
    p_order: ordenId,
  })
  if (error) throw new Error(traducir(error.message, error.code))
  return { yaEstaba: (data as unknown as { ya_estaba: boolean }).ya_estaba }
}

/**
 * La reparación.
 *
 * No hay checklist nuevo: los campos son los que ya existían en el schema —
 * `repair_notes`, `repaired_at`, `labour_hours`—. Marcarla completada **no**
 * consume ningún repuesto: son dos cosas distintas y siguen siéndolo.
 */
export async function guardarReparacion(
  companyId: string,
  ordenId: string,
  d: { notas?: string | null; completadaEn?: string | null; horas?: number | null },
): Promise<void> {
  const fila: { repair_notes?: string | null; repaired_at?: string | null; labour_hours?: number | null } = {}
  if (d.notas !== undefined) fila.repair_notes = d.notas === '' ? null : d.notas
  if (d.completadaEn !== undefined) fila.repaired_at = d.completadaEn
  if (d.horas !== undefined) fila.labour_hours = d.horas
  if (Object.keys(fila).length === 0) return

  const { error } = await supabase
    .from('maintenance_orders')
    .update(fila)
    .eq('company_id', companyId)
    .eq('id', ordenId)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** El diagnóstico: la primera etapa, con los campos que ya existían. */
export async function guardarDiagnostico(
  companyId: string,
  ordenId: string,
  d: { notas?: string | null; completadoEn?: string | null },
): Promise<void> {
  const fila: { diagnosis_notes?: string | null; diagnosed_at?: string | null } = {}
  if (d.notas !== undefined) fila.diagnosis_notes = d.notas === '' ? null : d.notas
  if (d.completadoEn !== undefined) fila.diagnosed_at = d.completadoEn
  if (Object.keys(fila).length === 0) return

  const { error } = await supabase
    .from('maintenance_orders')
    .update(fila)
    .eq('company_id', companyId)
    .eq('id', ordenId)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** La fecha de entrega, que el cierre exige. */
export async function guardarEntrega(
  companyId: string,
  ordenId: string,
  fecha: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_orders')
    .update({ delivered_at: fecha })
    .eq('company_id', companyId)
    .eq('id', ordenId)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Los CHECK de tabla que puede tocar esta pantalla, en castellano.
 *
 * Las funciones y los triggers levantan su excepción con un mensaje escrito
 * para leer —«Falta completar el diagnóstico»—; un CHECK de tabla no: devuelve
 * «new row for relation "maintenance_orders" violates check constraint
 * "chk_mo_fechas"». Se traduce por nombre de constraint, que es lo único
 * estable del mensaje.
 */
const CONSTRAINTS: Record<string, string> = {
  chk_mo_fechas: 'La fecha de entrega no puede ser anterior a la de ingreso.',
  chk_mo_repair_coherente:
    'Esta orden tiene la reparación marcada como no requerida: no se le carga fecha de reparación.',
  maintenance_orders_labour_hours_check: 'Las horas de mano de obra no pueden ser negativas.',
}

function traducir(mensaje: string, codigo?: string): string {
  for (const [nombre, texto] of Object.entries(CONSTRAINTS)) {
    if (mensaje.includes(nombre)) return texto
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Mantenimiento es de administradores y empleados.'
  }
  if (codigo === '23001' || codigo === '23514' || codigo === '22007') return mensaje
  return mensaje
}
