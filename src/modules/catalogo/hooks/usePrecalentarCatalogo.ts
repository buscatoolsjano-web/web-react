import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { listaPorDefecto } from '../services/facetas'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import { consultarProductos } from '../services/productos'
import { FILTROS_INICIALES } from '../types'

/**
 * La primera página del catálogo, pedida antes de que la pidan (Fase 66).
 *
 * ── Qué se midió ────────────────────────────────────────────────────────────
 *
 * «Cuando entrás por primera vez a catálogo tarda unos 3 segundos en que
 * aparezcan los productos; después el resto sí va rápido». Es exactamente lo
 * que pasa, y el plan de `search_products` dice por qué:
 *
 *     Buffers: shared hit=5595
 *
 * Son 45 MB entre la tabla `products` —32 MB— y sus índices. Con la caché de
 * Postgres caliente eso cuesta 137 ms; con la caché fría hay que leerlos del
 * disco, y ahí se midieron 2.455 ms contra 452 ms en la consulta siguiente.
 * No es un índice que falte: para dar el total exacto del paginador hay que
 * recorrer las 21.893 filas igual, y recorrerlas por primera vez cuesta eso.
 *
 * ── Por qué adelantarla en vez de acelerarla ────────────────────────────────
 *
 * Se probó primero por el lado de la consulta. Sacarle el trabajo que se
 * tiraba —21.893 `EXISTS` contra `product_images` por consulta— era correcto y
 * se hizo, pero no movió el número: el costo es leer la tabla, no computarla.
 * Hacerla barata de verdad pide que no referencie `attributes` para poder
 * resolverse sólo con un índice, y eso obliga a partir la consulta en dos
 * caminos casi iguales. Dos definiciones de qué productos entran es justo lo
 * que la Fase 3.6 vino a eliminar.
 *
 * Así que la consulta sigue costando lo que cuesta, y lo que cambia es CUÁNDO
 * se paga: mientras se mira el Dashboard en vez de mirando un catálogo vacío.
 *
 * ── Las tres cosas que la hacen inofensiva ──────────────────────────────────
 *
 * 1. SALE CON RETARDO Y RECIÉN CON LA EMPRESA RESUELTA, no «cuando haya un
 *    hueco». `requestIdleCallback` considera ocioso el rato en que se espera
 *    la autenticación, que es justo el peor momento —está medido en
 *    `AppLayout`, donde la precarga de chunks tropezó con lo mismo—. Para
 *    cuando esto sale, la pantalla en la que uno está ya pidió lo suyo.
 * 2. USA LA MISMA CLAVE DE CACHÉ que `useProductos`. Si no fuera idéntica
 *    sería una consulta de más que no ahorra nada, que es el modo de fallo
 *    obvio de un precalentado: por eso la clave se arma con las mismas
 *    piezas y hay un test que las compara.
 * 3. ES `prefetchQuery` Y NO `fetchQuery`: si ya hay datos frescos no pide
 *    nada, y si falla no rompe ni avisa. Nadie está esperando esto.
 */
export function usePrecalentarCatalogo(habilitado: boolean): void {
  const qc = useQueryClient()
  const { activa, cargando } = useEmpresa()

  useEffect(() => {
    if (!habilitado || cargando || !activa) return

    // Las listas de precios ya vienen con la membresía (Fase 39), así que la
    // lista efectiva se sabe sin pedir nada: no hay que encadenar.
    const lista = listaPorDefecto(activa.listasDePrecios ?? [])
    const companyId = activa.companyId
    const esInterno = activa.esInterno
    const priceListId = lista?.id ?? null

    const pedir = () => {
      void qc.prefetchQuery({
        queryKey: claveDeLaPrimeraPagina(companyId, priceListId, esInterno),
        queryFn: () =>
          consultarProductos(
            construirPlanDeConsulta(FILTROS_INICIALES, companyId),
            priceListId,
            esInterno,
          ),
        staleTime: 60_000,
      })
    }

    /*
     * 1,2 s: después de que la pantalla en la que uno está haya pedido lo
     * suyo —el Dashboard tarda ~400 ms en traer sus ocho consultas— y antes
     * de la precarga de chunks de `AppLayout`, que sale a 1,5 s. Ese orden
     * es a propósito: esto es UNA consulta cuyo costo es del servidor, y
     * aquello son 55 archivos que compiten por el hilo principal. Conviene
     * que la lenta arranque primero.
     */
    const id = window.setTimeout(pedir, 1_200)
    return () => window.clearTimeout(id)
  }, [habilitado, cargando, activa, qc])
}

/**
 * La clave de caché de la primera página del catálogo.
 *
 * TIENE QUE SER IDÉNTICA a la que arma `useProductos` con los filtros
 * iniciales. Está acá, exportada y con un test que la compara contra la de
 * verdad, porque una clave que se parece pero no es igual convierte el
 * precalentado en una consulta de más que no ahorra nada — y encima en
 * silencio, porque la pantalla seguiría andando igual de lenta.
 */
export function claveDeLaPrimeraPagina(
  companyId: string,
  priceListId: string | null,
  esInterno: boolean,
): readonly unknown[] {
  return ['catalogo', companyId, 'productos', { ...FILTROS_INICIALES, q: '' }, priceListId, esInterno]
}
