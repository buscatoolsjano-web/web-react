import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cliente360 } from '../services/cliente360'
import type { Cliente360 } from '../types'

/**
 * La ficha rápida de UN cliente.
 *
 * Dos decisiones que se toman acá y que son las que hacen que el panel se
 * sienta rápido:
 *
 * - **la clave incluye el id del cliente**. Cambiar de fila cambia la clave, y
 *   la respuesta de la fila anterior —que puede llegar después— se queda en su
 *   propia entrada del caché en vez de pintarse encima. Ésa es exactamente la
 *   carrera que apareció en los defaults de la Fase 17 · E2, y acá no puede
 *   pasar: no hay estado compartido donde pisar nada.
 * - **`staleTime` de un minuto**. Hacer A → B → A es lo normal cuando se está
 *   comparando dos clientes, y la tercera no debería costar otra consulta.
 *
 * NO se usa `placeholderData`: mostrar los números del cliente anterior
 * mientras carga el nuevo es peor que un esqueleto. Son importes, y un importe
 * que pertenece a otro cliente durante 300 ms es un error de lectura.
 */
export function useCliente360(clienteId: string | null, meses = 12) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<Cliente360 | null>({
    queryKey: ['clientes', companyId, 'ficha-360', clienteId, meses],
    queryFn: () => cliente360(clienteId!, meses),
    enabled: companyId !== null && clienteId !== null,
    staleTime: 60_000,
  })
}
