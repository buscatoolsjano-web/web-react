import { supabase } from '@/services/supabase/client'

/**
 * Aplicar un cambio a muchos productos (Fase 137).
 *
 * Llama a la RPC `editar_productos_masivo`, que corre como quien pide (SECURITY
 * INVOKER) y por lo tanto queda sujeta a la policy `products_write`: si el rol
 * no puede escribir, la base lo rechaza, no la pantalla.
 *
 * Se manda por TANDAS y no todo de un saque: así hay avance para mostrar —un
 * cambio sobre cientos de productos no es instantáneo— y el cuerpo de cada
 * pedido no se dispara. El orden no importa (es el mismo cambio en todos), así
 * que si una tanda falla se corta y se informa lo que ya se aplicó.
 */

/** Cuántos ids por pedido. Ni tan chico que sean mil viajes, ni tan grande. */
const TANDA = 300

export interface AvanceMasivo {
  hechos: number
  total: number
}

export async function editarProductosMasivo(
  companyId: string,
  ids: readonly string[],
  campo: string,
  valor: string,
  onAvance?: (a: AvanceMasivo) => void,
): Promise<number> {
  let cambiados = 0
  for (let i = 0; i < ids.length; i += TANDA) {
    const tanda = ids.slice(i, i + TANDA)
    const { data, error } = await supabase.rpc('editar_productos_masivo', {
      p_company: companyId,
      p_ids: tanda,
      p_campo: campo,
      p_valor: valor,
    })
    if (error) {
      throw new Error(
        `No se pudo aplicar el cambio${cambiados > 0 ? ` (se alcanzaron a cambiar ${cambiados})` : ''}: ${error.message}`,
      )
    }
    cambiados += typeof data === 'number' ? data : tanda.length
    onAvance?.({ hechos: Math.min(i + TANDA, ids.length), total: ids.length })
  }
  return cambiados
}
