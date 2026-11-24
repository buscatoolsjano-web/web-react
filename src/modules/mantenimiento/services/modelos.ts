import { supabase } from '@/services/supabase/client'
import { normalizarModelo } from '../lib/modelos'

/** Un modelo del catálogo (FEIN AccuTec), con sus especificaciones y accesorios. */
export interface ModeloHerramienta {
  id: string
  marca: string
  codigo: string
  familia: string | null
  descripcion: string | null
  codigoFabricante: string | null
  torqueMin: number
  torqueMax: number
  precisionPct: number
  velocidad: string | null
  velocidadFabrica: string | null
  peso: string | null
  bateria: string | null
  precision: string | null
  programacion: string | null
  usoTipico: string | null
  accesorios: { codigo: string; nombre: string; codigoFabricante: string | null }[]
}

const aNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function listarModelos(companyId: string): Promise<ModeloHerramienta[]> {
  const { data, error } = await supabase
    .from('maintenance_models')
    .select(
      `id, brand, code, family, description, part_number, torque_min, torque_max, accuracy_pct,
       speed, factory_speed, weight, battery, accuracy, programming, typical_use,
       accesorios:maintenance_model_accessories ( acc:maintenance_accessories ( code, name, part_number ) )`,
    )
    .eq('company_id', companyId)
    .eq('active', true)
    .order('family')
    .order('torque_max')
  if (error) throw new Error(`No se pudieron leer los modelos: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    brand: string
    code: string
    family: string | null
    description: string | null
    part_number: string | null
    torque_min: number | string
    torque_max: number | string
    accuracy_pct: number | string
    speed: string | null
    factory_speed: string | null
    weight: string | null
    battery: string | null
    accuracy: string | null
    programming: string | null
    typical_use: string | null
    accesorios: { acc: { code: string; name: string; part_number: string | null } | null }[] | null
  }[]).map((m) => ({
    id: m.id,
    marca: m.brand,
    codigo: m.code,
    familia: m.family,
    descripcion: m.description,
    codigoFabricante: m.part_number,
    torqueMin: aNumero(m.torque_min),
    torqueMax: aNumero(m.torque_max),
    precisionPct: aNumero(m.accuracy_pct),
    velocidad: m.speed,
    velocidadFabrica: m.factory_speed,
    peso: m.weight,
    bateria: m.battery,
    precision: m.accuracy,
    programacion: m.programming,
    usoTipico: m.typical_use,
    accesorios: (m.accesorios ?? [])
      .map((x) => x.acc)
      .filter((a): a is { code: string; name: string; part_number: string | null } => a !== null)
      .map((a) => ({ codigo: a.code, nombre: a.name, codigoFabricante: a.part_number }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo)),
  }))
}

/** Cuántos equipos de la flota son de cada modelo (por el modelo normalizado). */
export async function flotaPorModelo(companyId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('maintenance_assets')
    .select('model_text')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .range(0, 4999)
  if (error) throw new Error(`No se pudo contar la flota: ${error.message}`)
  const cuenta: Record<string, number> = {}
  for (const a of data ?? []) {
    const k = normalizarModelo(a.model_text)
    if (k) cuenta[k] = (cuenta[k] ?? 0) + 1
  }
  return cuenta
}

/** El modelo de un equipo, si está en el catálogo. */
export function modeloDe(modelos: readonly ModeloHerramienta[], textoDelEquipo: string | null): ModeloHerramienta | null {
  const k = normalizarModelo(textoDelEquipo)
  return k === '' ? null : (modelos.find((m) => m.codigo === k) ?? null)
}
