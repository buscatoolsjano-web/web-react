import { useCallback, useEffect, useRef, useState } from 'react'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import { catalogoACsv, nombreDeArchivo } from '../lib/exportar'
import { consultarTodosLosProductos, contarCatalogoCompleto, TOPE_EXPORTACION } from '../services/productos'
import { FILTROS_INICIALES, type FiltrosCatalogo, type ProductoListado } from '../types'

/** Qué conjunto de productos se exporta. */
export type AlcanceExportacion = 'filtrado' | 'todo' | 'seleccionados'

/**
 * Armar y bajar el CSV del catálogo (Fase 22 · paridad, #49).
 *
 * **«Lo que estoy viendo» es lo que se exporta** (§7): se vuelve a consultar
 * con el MISMO plan que dibujó la pantalla —búsqueda, marca, categoría,
 * subtipos, atributos, rangos, orden y visibilidad de catálogo— y sólo cambia
 * la paginación, para traer todo lo que coincide y no los 50 de la página.
 *
 * «Todo el catálogo» usa los filtros iniciales, es decir ninguno, pero
 * **conserva la lista de precios y la visibilidad**: sigue siendo el
 * catálogo, no la tabla `products`.
 */
export function useExportarCatalogo(
  companyId: string | null,
  esInterno: boolean,
  listaPrecioId: string | null,
  moneda: string | null,
) {
  const [exportando, setExportando] = useState(false)
  const [avance, setAvance] = useState<{ traidos: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // El controlador del viaje en curso, para poder cancelarlo (Fase 125).
  const abortador = useRef<AbortController | null>(null)

  /** Cancela la exportación en curso: el viaje se corta y no se baja nada. */
  const cancelar = useCallback(() => {
    abortador.current?.abort()
  }, [])

  const exportar = useCallback(
    async (
      filtros: FiltrosCatalogo,
      elegidas: ReadonlySet<string>,
      alcance: AlcanceExportacion,
      seleccionados: readonly ProductoListado[] = [],
    ) => {
      if (!companyId) return false
      setExportando(true)
      setAvance(null)
      setError(null)
      const control = new AbortController()
      abortador.current = control
      try {
        // Los seleccionados ya están en memoria: se arma el CSV sin ir a la red.
        if (alcance === 'seleccionados') {
          const csv = catalogoACsv(seleccionados, elegidas, { esInterno, moneda })
          descargar(csv, nombreDeArchivo())
          return true
        }
        const usados = alcance === 'todo' ? FILTROS_INICIALES : filtros
        const plan = construirPlanDeConsulta(usados, companyId)
        const { productos, truncado, total } = await consultarTodosLosProductos(
          plan,
          listaPrecioId,
          esInterno,
          // Sin `onAvance` son decenas de viajes en silencio para el catálogo
          // entero; `signal` deja cancelar entre lote y lote.
          { onAvance: (traidos, t) => setAvance({ traidos, total: t }), signal: control.signal },
        )
        if (truncado) {
          throw new Error(
            `Son ${total} productos y la exportación entrega hasta ${TOPE_EXPORTACION}. ` +
              'Filtrá un poco más y volvé a intentar.',
          )
        }
        const csv = catalogoACsv(productos, elegidas, { esInterno, moneda })
        descargar(csv, nombreDeArchivo())
        return true
      } catch (e) {
        // Cancelar no es un error: se cortó a pedido, no se muestra nada.
        if (e instanceof DOMException && e.name === 'AbortError') return false
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        abortador.current = null
        setExportando(false)
        setAvance(null)
      }
    },
    [companyId, esInterno, listaPrecioId, moneda],
  )

  return { exportar, cancelar, exportando, avance, error }
}

/**
 * Cuántos productos tiene el catálogo entero, sin filtros.
 *
 * Hace falta para el radio «Todo el catálogo (n)» del modal. El legacy lo sabe
 * gratis —tiene los 21.775 productos en memoria—; acá hay que preguntarlo.
 *
 * Se pregunta **sólo cuando el modal está abierto**: es un número que sólo se
 * usa ahí, y pedirlo en cada carga del catálogo sería una consulta de más en
 * la pantalla más visitada del sistema.
 *
 * Mientras no llegó devuelve `null`, y el modal muestra el radio sin número:
 * un conteo provisorio que después cambia es peor que ninguno.
 */
export function useTotalDelCatalogo(companyId: string | null, activo: boolean) {
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    if (!activo || !companyId) return
    let vigente = true
    void contarCatalogoCompleto(companyId)
      .then((n) => {
        if (vigente) setTotal(n)
      })
      // Si falla, el radio queda sin número y el resto del modal sirve igual.
      .catch(() => {
        if (vigente) setTotal(null)
      })
    return () => {
      vigente = false
    }
  }, [companyId, activo])

  return total
}

/**
 * El archivo, con BOM.
 *
 * Sin el BOM el Excel en espanol abre el CSV en la codificacion
 * del sistema y «Válvula» se ve «VÃ¡lvula». Es la misma convención que el
 * resto de los CSV del ERP.
 *
 * Se arma con `fromCharCode` y no pegando el carácter: literal es un byte
 * invisible que el linter rechaza y que cualquiera borra sin darse cuenta.
 */
export const BOM_EXCEL = String.fromCharCode(0xfeff)

function descargar(csv: string, nombre: string) {
  const blob = new Blob([`${BOM_EXCEL}${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Sin esto la pestaña se queda con el blob en memoria hasta recargar.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
