import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { listarDefinicionesDeAtributos } from '@/modules/catalogo/services/facetas'
import { datosDeProductosImpresos } from '../services/documentos'
import type { DatosProductoImpreso } from '../lib/descripcionProducto'
import type { LineaDocumento } from '../types'

const VACIO = new Map<string, DatosProductoImpreso>()

/**
 * La foto y los datos de descripción de los productos de un documento.
 *
 * Lo usan la hoja y la ventana de impresión: la hoja ES el documento, así que
 * no puede mostrar menos que lo que se imprime (Fase 28 · E9).
 *
 * La clave lleva los ids ordenados, no el documento: dos documentos con los
 * mismos productos comparten la respuesta, y reordenar las líneas no vuelve a
 * pedir nada.
 */
export function useDatosDeProductos(lineas: readonly LineaDocumento[]) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const ids = [...new Set(lineas.map((l) => l.productId).filter((id): id is string => id !== null))].sort()

  const datos = useQuery({
    queryKey: ['ventas', companyId, 'datos-productos', ids],
    queryFn: () => datosDeProductosImpresos(companyId!, ids),
    enabled: companyId !== null && ids.length > 0,
    staleTime: 5 * 60_000,
  })

  // Las definiciones son 26 filas de la empresa y no cambian por documento:
  // se piden una vez y se comparten con el catálogo.
  const definiciones = useQuery({
    queryKey: ['catalogo', companyId, 'definiciones-atributos'],
    queryFn: () => listarDefinicionesDeAtributos(companyId!),
    enabled: companyId !== null,
    staleTime: 10 * 60_000,
  })

  /*
   * Si todavía están viajando (Fase 84).
   *
   * `isLoading` y no `isPending`: una consulta apagada —un documento sin
   * ningún producto del catálogo— se queda en `pending` para siempre, y quien
   * espere eso no arranca nunca.
   *
   * Lo mira el PDF que se adjunta al mail: la hoja se fotografía una sola vez,
   * y sacarle la foto antes de que lleguen las fotos de los productos y los
   * atributos daría un PDF con los huecos vacíos. La hoja de la pantalla no lo
   * necesita: se redibuja sola cuando llegan.
   */
  return {
    datos: datos.data ?? VACIO,
    definiciones: definiciones.data ?? [],
    cargando: datos.isLoading || definiciones.isLoading,
  }
}
