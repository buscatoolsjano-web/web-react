import { supabase } from '@/services/supabase/client'
import type { ActividadMensual, ResumenCliente, TotalPorMonedaYTipo } from '../types'

/**
 * El panel rápido del cliente.
 *
 * El legacy lo abría desde el listado (`abrirClienteQuickPanel`) con un
 * resumen y un gráfico de doce meses. Se migran las dos cosas, con una
 * diferencia que no es de estilo: **el importe único desaparece**. Aquél
 * sumaba ARS, USD y EUR en un solo número; acá cada moneda va por su lado.
 *
 * Las tres consultas son funciones SQL `security invoker` que empiezan
 * comprobando que el cliente sea legible: si un vendedor no ve al cliente, no
 * ve sus números.
 */

function aNumero(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function resumenDeCliente(clienteId: string): Promise<ResumenCliente | null> {
  const { data, error } = await supabase.rpc('resumen_cliente', { p_customer: clienteId })
  if (error) throw new Error(`No se pudo leer el resumen: ${error.message}`)

  const f = ((data ?? []) as unknown as Record<string, unknown>[])[0]
  if (!f) return null
  return {
    cotizaciones: aNumero(f['cotizaciones'] as number),
    pedidos: aNumero(f['pedidos'] as number),
    entregas: aNumero(f['entregas'] as number),
    ultimaActividad: typeof f['ultima_actividad'] === 'string' ? f['ultima_actividad'] : null,
    productosDistintos: aNumero(f['productos_distintos'] as number),
    documentos12m: aNumero(f['documentos_12m'] as number),
  }
}

export async function totalesPorMonedaYTipo(
  clienteId: string,
): Promise<TotalPorMonedaYTipo[]> {
  const { data, error } = await supabase.rpc('totales_por_moneda_cliente', {
    p_customer: clienteId,
  })
  if (error) throw new Error(`No se pudieron leer los totales: ${error.message}`)

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((f) => ({
    tipo: String(f['tipo']) as TotalPorMonedaYTipo['tipo'],
    moneda: typeof f['moneda'] === 'string' ? f['moneda'] : null,
    documentos: aNumero(f['documentos'] as number),
    importe: aNumero(f['importe'] as number),
    sinImporte: aNumero(f['sin_importe'] as number),
  }))
}

export async function actividadMensual(
  clienteId: string,
  meses = 12,
): Promise<ActividadMensual[]> {
  const { data, error } = await supabase.rpc('actividad_mensual_cliente', {
    p_customer: clienteId,
    p_meses: meses,
  })
  if (error) throw new Error(`No se pudo leer la actividad: ${error.message}`)

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((f) => ({
    mes: String(f['mes']),
    tipo: String(f['tipo']) as ActividadMensual['tipo'],
    moneda: typeof f['moneda'] === 'string' ? f['moneda'] : null,
    documentos: aNumero(f['documentos'] as number),
    importe: aNumero(f['importe'] as number),
  }))
}
