import { supabase } from '@/services/supabase/client'
import type { CapacidadTorque, DatosMedicion, LimitesTorque, Medicion } from '../types'

/**
 * Torque: límites, mediciones y capacidad.
 *
 * El alcance es el del sistema anterior y ni un campo más: LCI, nominal, LCS y
 * N mediciones. No hay unidad, instrumento, número de serie, certificado,
 * incertidumbre ni técnico por medición — eso es backlog, no v1.
 *
 * **Los indicadores no se guardan.** Cp, Cpk, CV, promedio, desvío y veredicto
 * los calcula `capacidad_torque()` cada vez que se preguntan. Acá no hay una
 * segunda implementación matemática: sería la forma más rápida de que dos
 * números que deberían ser el mismo dejen de serlo.
 */

const COLUMNAS = 'id, row_no, target_value, min_value, max_value'

interface Fila {
  id: string
  row_no: number
  target_value: number | string | null
  min_value: number | string | null
  max_value: number | string | null
}

const aNumero = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const aMedicion = (f: Fila): Medicion => ({
  id: f.id,
  fila: f.row_no,
  valor: aNumero(f.target_value),
  minimo: aNumero(f.min_value),
  maximo: aNumero(f.max_value),
})

export async function medicionesDeOrden(
  companyId: string,
  ordenId: string,
): Promise<Medicion[]> {
  const { data, error } = await supabase
    .from('maintenance_measurements')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .eq('maintenance_order_id', ordenId)
    .order('row_no', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las mediciones: ${error.message}`)
  return ((data ?? []) as unknown as Fila[]).map(aMedicion)
}

/**
 * La capacidad, calculada por el servidor.
 *
 * Devuelve `null` en cualquier indicador que no exista matemáticamente: con
 * cero o una medición no hay desvío muestral, y con todas iguales el desvío es
 * cero y dividir por él no da un número. La pantalla muestra «N/D».
 */
export async function capacidadDeTorque(ordenId: string): Promise<CapacidadTorque> {
  const { data, error } = await supabase.rpc('capacidad_torque', { p_order: ordenId })
  if (error) throw new Error(`No se pudo calcular la capacidad: ${error.message}`)
  const r = data as unknown as {
    mediciones: number
    promedio: number | string | null
    desvio: number | string | null
    promedio_min: number | string | null
    promedio_max: number | string | null
    cp: number | string | null
    cpk: number | string | null
    cv: number | string | null
    veredicto: string | null
  }
  return {
    mediciones: r.mediciones ?? 0,
    promedio: aNumero(r.promedio),
    desvio: aNumero(r.desvio),
    promedioMin: aNumero(r.promedio_min),
    promedioMax: aNumero(r.promedio_max),
    cp: aNumero(r.cp),
    cpk: aNumero(r.cpk),
    cv: aNumero(r.cv),
    veredicto: (r.veredicto as CapacidadTorque['veredicto']) ?? null,
  }
}

function fila(d: DatosMedicion) {
  return {
    row_no: d.fila,
    target_value: d.valor,
    min_value: d.minimo,
    max_value: d.maximo,
  }
}

export async function crearMedicion(
  companyId: string,
  ordenId: string,
  d: DatosMedicion,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_measurements')
    .insert({ company_id: companyId, maintenance_order_id: ordenId, ...fila(d) })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function actualizarMedicion(
  companyId: string,
  id: string,
  d: DatosMedicion,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_measurements')
    .update(fila(d))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarMedicion(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('maintenance_measurements')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Los límites de la especificación.
 *
 * La base exige LCS ≥ LCI y el nominal dentro de la banda. Acá se manda lo que
 * cargó la persona y se muestra el mensaje del servidor si no cierra: duplicar
 * la regla del lado del navegador sería tener dos versiones de la misma.
 */
export async function guardarLimites(
  companyId: string,
  ordenId: string,
  l: LimitesTorque,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_orders')
    .update({ torque_lsl: l.lsl, torque_nominal: l.nominal, torque_usl: l.usl })
    .eq('company_id', companyId)
    .eq('id', ordenId)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Dar el torque por completado, o volver atrás.
 *
 * Sin al menos una medición el servidor lo rechaza, y con el torque completado
 * tampoco deja borrar la última. Acá no se decide nada de eso.
 */
export async function completarTorque(
  companyId: string,
  ordenId: string,
  fecha: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_orders')
    .update({ torque_at: fecha })
    .eq('company_id', companyId)
    .eq('id', ordenId)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Los CHECK de tabla que puede tocar esta pantalla, en castellano.
 *
 * Un trigger levanta su excepción con un mensaje escrito para leer; un CHECK
 * de tabla no; devuelve «new row for relation "maintenance_orders" violates
 * check constraint "chk_mo_torque_nominal"», que no le dice nada a quien está
 * cargando una calibración. Se traduce por nombre de constraint, que es lo
 * único estable del mensaje.
 */
const CONSTRAINTS: Record<string, string> = {
  chk_mo_torque_nominal: 'El nominal tiene que quedar entre el LCI y el LCS.',
  chk_mo_torque_rango: 'El LCS no puede ser menor que el LCI.',
  chk_mo_torque_numeros: 'Alguno de los límites no es un número válido.',
  chk_mo_torque_coherente:
    'Esta orden tiene el torque marcado como no requerido: no se le cargan límites ni mediciones.',
  chk_mm_numeros: 'Esa medición no es un número válido.',
  chk_mm_rango: 'El máximo no puede ser menor que el mínimo.',
}

function traducir(mensaje: string, codigo?: string): string {
  for (const [nombre, texto] of Object.entries(CONSTRAINTS)) {
    if (mensaje.includes(nombre)) return texto
  }
  if (codigo === '23505' && mensaje.includes('row_no')) {
    return 'Ya hay otra medición en esa posición.'
  }
  if (codigo === '22003') {
    return 'Ese número no entra en el campo: las mediciones admiten hasta 8 enteros y 4 decimales.'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Mantenimiento es de administradores y empleados.'
  }
  if (codigo === '23001' || codigo === '23514') return mensaje
  return mensaje
}
