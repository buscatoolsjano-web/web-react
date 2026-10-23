import { useCallback, useEffect, useRef, useState } from 'react'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import { construirLibroExcel, type MetadatosExcel } from '../lib/libroExcel'
import { consultarTodosLosProductos, contarCatalogoCompleto, TOPE_EXPORTACION } from '../services/productos'
import {
  listarAtributosPorCategoria,
  listarCategorias,
  listarDefinicionesDeAtributos,
  listarMarcas,
} from '../services/facetas'
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
        // Los metadatos para el Excel guiado (categorías y marcas para los
        // desplegables, atributos por categoría para las columnas de cada hoja).
        // Van en paralelo con lo demás: son cuatro consultas chicas.
        const metaProm = cargarMetadatos(companyId)

        // Los seleccionados ya están en memoria: no se va a buscar la página.
        let productos: readonly ProductoListado[]
        if (alcance === 'seleccionados') {
          productos = seleccionados
        } else {
          const usados = alcance === 'todo' ? FILTROS_INICIALES : filtros
          const plan = construirPlanDeConsulta(usados, companyId)
          const r = await consultarTodosLosProductos(plan, listaPrecioId, esInterno, {
            // Sin `onAvance` son decenas de viajes en silencio para el catálogo
            // entero; `signal` deja cancelar entre lote y lote.
            onAvance: (traidos, t) => setAvance({ traidos, total: t }),
            signal: control.signal,
          })
          if (r.truncado) {
            throw new Error(
              `Son ${r.total} productos y la exportación entrega hasta ${TOPE_EXPORTACION}. ` +
                'Filtrá un poco más y volvé a intentar.',
            )
          }
          productos = r.productos
        }

        if (control.signal.aborted) return false
        const blob = await construirLibroExcel(productos, elegidas, { esInterno, moneda }, await metaProm)
        if (control.signal.aborted) return false
        descargarBlob(blob, nombreDeArchivoXlsx())
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

/** `catalogo_buscatools_2026-10-23.xlsx`. */
function nombreDeArchivoXlsx(hoy = new Date()): string {
  return `catalogo_buscatools_${hoy.toISOString().slice(0, 10)}.xlsx`
}

/** Los datos de apoyo para el Excel guiado, las cuatro consultas en paralelo. */
async function cargarMetadatos(companyId: string): Promise<MetadatosExcel> {
  const [categorias, marcas, atributosPorCategoria, definiciones] = await Promise.all([
    listarCategorias(companyId),
    listarMarcas(companyId),
    listarAtributosPorCategoria(companyId),
    listarDefinicionesDeAtributos(companyId),
  ])
  return {
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre })),
    marcas: marcas.map((m) => m.nombre),
    atributosPorCategoria,
    definiciones,
  }
}

function descargarBlob(blob: Blob, nombre: string) {
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
