import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UltimoPrecio } from '@/modules/clientes/types'
import { ultimosPrecios } from '@/modules/clientes/services/precios'
import { porProductoEnMoneda } from '../lib/ultimoPrecio'

const VACIO: Map<string, UltimoPrecio> = new Map()

/**
 * El histórico de precios del cliente del documento, listo para usar en las
 * líneas (Fase 40).
 *
 * Reusa `ultimosPrecios` del módulo de Clientes —la misma función que la ficha
 * del cliente ya muestra—, así que el «último precio» de la línea y el de la
 * ficha son el mismo número, no dos cálculos parecidos.
 *
 * SE PIDE UNA VEZ POR CLIENTE, sin lista de productos. La RPC acepta un
 * producto o ninguno, y pedir «todos» tiene dos ventajas concretas: desde acá
 * cada request cuesta ~220 ms fijos, y así pasar de página en el catálogo o
 * agregar una línea no cuesta ninguno. La contra sería el tamaño de la
 * respuesta, y no aplica: son 1.034 líneas de cotización y 601 de pedido en
 * toda la empresa, repartidas entre 1.010 clientes.
 *
 * El filtro por moneda se hace acá, con los datos ya en memoria, porque la RPC
 * devuelve una fila por producto Y POR MONEDA: cambiar la moneda del documento
 * no vuelve a pedir nada.
 */
export function useUltimoPrecio(
  clienteId: string | null,
  moneda: string | null,
): { historicos: Map<string, UltimoPrecio>; cargando: boolean } {
  const habilitado = !!clienteId

  const { data, isPending } = useQuery({
    // Sin `moneda` en la clave: la respuesta trae todas y se filtra en memoria.
    queryKey: ['ventas', 'ultimo-precio', clienteId],
    queryFn: () => ultimosPrecios(clienteId!),
    enabled: habilitado,
    // El histórico cambia sólo cuando se emite un documento nuevo: dentro de
    // una misma edición no hace falta volver a pedirlo.
    staleTime: 5 * 60_000,
  })

  const historicos = useMemo(
    () => (data ? porProductoEnMoneda(data, moneda) : VACIO),
    [data, moneda],
  )

  return { historicos, cargando: habilitado && isPending }
}
