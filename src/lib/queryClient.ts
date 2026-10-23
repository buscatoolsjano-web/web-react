import { QueryClient } from '@tanstack/react-query'

/**
 * Defaults de TanStack Query — ADR-002.
 *
 * Estos valores son la respuesta directa a los problemas del legacy:
 *
 *  · `staleTime > 0` evita el refetch en cada montaje.
 *  · NO hay `refetchInterval` global: cero polling. El legacy tenía un
 *    setInterval de 30 s que bajaba la base entera, para todos los
 *    usuarios, estuvieran mirando lo que estuvieran mirando.
 *  · `refetchOnWindowFocus: false` — con datos que cambian poco, volver a
 *    la pestaña no justifica una tanda de requests.
 *
 * Cada módulo puede subir o bajar su `staleTime` en su propio hook. Lo que
 * no se hace es activar polling global. Ver ADR-002 y ADR-006.
 */
export function crearQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        /*
         * La caché vive 30 minutos aunque nadie la mire (antes 5). Así volver a
         * una pantalla que ya se abrió —el catálogo es el caso— la muestra al
         * instante en vez de volver a bajar todo: TanStack Query sirve lo que
         * tiene guardado y, si está viejo, lo refresca en segundo plano sin
         * pantalla en blanco. Cuesta algo de memoria; para un ERP es barato.
         */
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  })
}
