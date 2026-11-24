import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import { obtenerFacetas } from '../services/facetas'
import { consultarProductos } from '../services/productos'
import { claveDeProductos } from './useProductos'
import { escribirFiltros, leerFiltros } from './useFiltrosCatalogo'
import type { FiltrosCatalogo } from '../types'

const CINCO_MINUTOS = 5 * 60_000

/**
 * Pedir ANTES del clic lo que el clic va a pedir.
 *
 * «Cuando toco Puntas y tubos tarda mucho en que aparezca»: medido, con los
 * datos en caché el cambio se dibuja en ~70 ms; lo que tarda es ir a buscarlos
 * (las facetas y la primera página, ~0,6 s, y después el detalle de las
 * filas). Entre que el puntero llega a un tile y se hace clic pasan 150–300
 * ms, así que pedirlo al apoyarse sobre el tile hace que, al hacer clic, la
 * respuesta ya esté o esté por llegar.
 *
 * Con las MISMAS claves que `useFacetas` y `useProductos`, armadas pasando los
 * filtros por la URL y de vuelta (`escribirFiltros` → `leerFiltros`) igual que
 * hace `actualizar`: si la forma no coincide exacto, el precalentado no ahorra
 * nada. `prefetchQuery` no repite lo que ya está fresco en caché.
 */
export function useAnticiparFiltro(
  companyId: string | null,
  filtros: FiltrosCatalogo,
  priceListId: string | null,
  esInterno: boolean,
  listaResuelta: boolean,
) {
  const qc = useQueryClient()
  return useCallback(
    (cambios: Partial<FiltrosCatalogo>) => {
      if (!companyId) return
      const siguientes = leerFiltros(escribirFiltros({ ...filtros, ...cambios, pagina: 1 }))
      void qc.prefetchQuery({
        queryKey: ['catalogo', companyId, 'facetas', { ...siguientes, pagina: 1, porPagina: 0 }],
        queryFn: () => obtenerFacetas(construirPlanDeConsulta(siguientes, companyId)),
        staleTime: CINCO_MINUTOS,
      })
      if (!listaResuelta) return
      void qc.prefetchQuery({
        queryKey: claveDeProductos(companyId, siguientes, priceListId, esInterno),
        queryFn: () => consultarProductos(construirPlanDeConsulta(siguientes, companyId), priceListId, esInterno),
        staleTime: CINCO_MINUTOS,
      })
    },
    [qc, companyId, filtros, priceListId, esInterno, listaResuelta],
  )
}
