import { supabase } from '@/services/supabase/client'

/**
 * Lo pendiente, persona por persona (Fase 40).
 *
 * Una sola RPC —`pendiente_por_persona`— porque las tres cuentas se cruzan por
 * usuario y hacerlo en el navegador serían tres consultas y un `join` a mano.
 * La RPC es SECURITY DEFINER con su propia puerta: sólo `admin` y `employee`
 * ven el tablero de toda la empresa, y si otro rol la llama devuelve
 * `insufficient_privilege` en vez de datos.
 *
 * Las tres definiciones de «pendiente» son las MISMAS que ya usa el resto de
 * la app: correo recibido con el último mensaje entrante y sin resolver (igual
 * que la tarjeta y el filtro de la bandeja), cotizaciones `sent`, y pedidos
 * con `fulfillment_status = 'pending'`.
 */
export interface PendienteDePersona {
  /** `null` es la fila «Sin asignar», no un usuario que falta. */
  userId: string | null
  nombre: string
  rol: string
  correos: number
  cotizaciones: number
  pedidos: number
}

function aNumero(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function pendientePorPersona(companyId: string): Promise<PendienteDePersona[]> {
  const { data, error } = await supabase.rpc('pendiente_por_persona', { p_company: companyId })
  if (error) throw new Error(`No se pudo leer el pendiente por persona: ${error.message}`)

  return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
    userId: typeof f['user_id'] === 'string' ? f['user_id'] : null,
    nombre: typeof f['nombre'] === 'string' ? f['nombre'] : '(sin nombre)',
    rol: typeof f['rol'] === 'string' ? f['rol'] : '',
    correos: aNumero(f['correos_sin_responder']),
    cotizaciones: aNumero(f['cotizaciones_enviadas']),
    pedidos: aNumero(f['pedidos_sin_entregar']),
  }))
}

/** El total de las tres columnas: lo que hace falta para ordenar y para el vacío. */
export function totalDe(p: PendienteDePersona): number {
  return p.correos + p.cotizaciones + p.pedidos
}
