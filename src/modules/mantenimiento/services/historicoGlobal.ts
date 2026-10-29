import { supabase } from '@/services/supabase/client'
import type { EstadoOrden, EtapaOrden, ResultadoCheck, TipoServicio } from '../types'

/**
 * El histórico global de mantenimiento (Fase 219), como el «Histórico» del app
 * FEIN AccuTec: una fila por orden con sus datos clave —equipo, fecha, tipo,
 * técnico, el estado de partes al diagnóstico, aprietes, CP/CPK del torque,
 * horas de trabajo y estado—.
 *
 * Todo lo arma la RPC `maintenance_historico` en una sola consulta (une checks
 * y `capacidad_torque` por orden), así que la pantalla no encadena pedidos.
 */
export interface FilaHistorico {
  id: string
  numero: string
  equipoId: string
  equipoRef: string
  serie: string | null
  modelo: string | null
  cliente: string | null
  fecha: string
  entregada: string | null
  tipoServicio: TipoServicio
  tecnico: string | null
  /** Estado de la parte al diagnóstico (`ok`/`nok`/`na`) o nulo si no se marcó. */
  carcasa: ResultadoCheck | null
  tornillos: ResultadoCheck | null
  embrague: ResultadoCheck | null
  firmware: ResultadoCheck | null
  aprietes: number | null
  /** Capacidad del torque. Nulo si la orden no requiere torque o no hay medición. */
  cp: number | null
  cpk: number | null
  horasTrabajo: number | null
  estado: EstadoOrden
  etapa: EtapaOrden
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null
const check = (v: unknown): ResultadoCheck | null =>
  v === 'ok' || v === 'nok' || v === 'na' ? v : null

export async function historicoGlobal(companyId: string, soloCerradas = false): Promise<FilaHistorico[]> {
  const { data, error } = await supabase.rpc('maintenance_historico', {
    p_company: companyId,
    p_solo_cerradas: soloCerradas,
  })
  if (error) throw new Error(`No se pudo leer el histórico: ${error.message}`)

  const filas = (Array.isArray(data) ? data : []) as Record<string, unknown>[]
  return filas.map((f) => ({
    id: str(f.id),
    numero: str(f.numero),
    equipoId: str(f.equipoId),
    equipoRef: str(f.equipoRef) || '—',
    serie: texto(f.serie),
    modelo: texto(f.modelo),
    cliente: texto(f.cliente),
    fecha: str(f.fecha),
    entregada: texto(f.entregada),
    tipoServicio: f.tipoServicio as TipoServicio,
    tecnico: texto(f.tecnico),
    carcasa: check(f.carcasa),
    tornillos: check(f.tornillos),
    embrague: check(f.embrague),
    firmware: check(f.firmware),
    aprietes: num(f.aprietes),
    cp: num(f.cp),
    cpk: num(f.cpk),
    horasTrabajo: num(f.horasTrabajo),
    estado: f.estado as EstadoOrden,
    etapa: f.etapa as EtapaOrden,
  }))
}
