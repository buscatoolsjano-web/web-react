import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { enSegundoPlano, META_SEGUNDO_PLANO } from '@/lib/segundoPlano'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import { obtenerFacetas } from '../services/facetas'
import { consultarProductos } from '../services/productos'
import { claveDeProductos } from './useProductos'
import { escribirFiltros, leerFiltros } from './useFiltrosCatalogo'
import type { FiltrosCatalogo } from '../types'

const CINCO_MINUTOS = 5 * 60_000

/**
 * Anticipos en vuelo o en cola, entre todos los catálogos montados. Ver abajo.
 */
let enCurso = 0

/** Sólo para los tests: deja el contador como recién cargado. */
export function reiniciarAnticipos(): void {
  enCurso = 0
}

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
 *
 * DE A UNO Y EN SEGUNDO PLANO (2026-11-27, «el catálogo lo sigo sintiendo MUY
 * lento»). La base es una instancia chica con CPU que va y viene: las mismas
 * consultas tardan 0,1–0,3 s cuando hay CPU y 3–6 s cuando no, y lo que más
 * la ahoga es pedir muchas cosas a la vez. Cada anticipo son cuatro pedidos
 * (facetas, búsqueda, filas y PVP); pasar el mouse por tres rubros eran doce,
 * justo antes del clic de verdad, que quedaba en la fila detrás de ellos.
 *
 *  · Mientras haya un anticipo pendiente no se arranca otro: el que importa
 *    es el que ya está en camino, no el del rubro por el que se pasó de largo.
 *  · Van por la cola de segundo plano: esperan a que la pantalla termine de
 *    pedir lo suyo. Si el clic llega mientras esperan, la pantalla adopta la
 *    consulta y la cola la larga en el acto (`fuePromovida`), así que el clic
 *    nunca espera de más.
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
      if (!companyId || enCurso > 0) return
      const siguientes = leerFiltros(escribirFiltros({ ...filtros, ...cambios, pagina: 1 }))
      const claveFacetas = ['catalogo', companyId, 'facetas', { ...siguientes, pagina: 1, porPagina: 0 }]
      const claveLista = claveDeProductos(companyId, siguientes, priceListId, esInterno)

      // Si las dos ya están frescas en caché no hay nada que anticipar, y no
      // tiene sentido bloquear el próximo anticipo por éste.
      const fresca = (clave: readonly unknown[]) => {
        const estado = qc.getQueryState(clave)
        return estado?.dataUpdatedAt !== undefined && Date.now() - estado.dataUpdatedAt < CINCO_MINUTOS
      }
      const pedirLista = listaResuelta && !fresca(claveLista)
      if (fresca(claveFacetas) && !pedirLista) return

      enCurso++
      const pedidos: Promise<void>[] = [
        qc.prefetchQuery({
          queryKey: claveFacetas,
          queryFn: ({ queryKey }) =>
            enSegundoPlano(() => obtenerFacetas(construirPlanDeConsulta(siguientes, companyId)), queryKey),
          meta: META_SEGUNDO_PLANO,
          staleTime: CINCO_MINUTOS,
        }),
      ]
      if (pedirLista) {
        pedidos.push(
          qc.prefetchQuery({
            queryKey: claveLista,
            queryFn: ({ queryKey }) =>
              enSegundoPlano(
                () => consultarProductos(construirPlanDeConsulta(siguientes, companyId), priceListId, esInterno),
                queryKey,
              ),
            meta: META_SEGUNDO_PLANO,
            staleTime: CINCO_MINUTOS,
          }),
        )
      }
      void Promise.allSettled(pedidos).then(() => {
        enCurso = Math.max(0, enCurso - 1)
      })
    },
    [qc, companyId, filtros, priceListId, esInterno, listaResuelta],
  )
}
