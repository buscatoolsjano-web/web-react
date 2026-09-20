import { supabase } from '@/services/supabase/client'
import type { TotalPorMonedaYTipo } from '../types'

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
