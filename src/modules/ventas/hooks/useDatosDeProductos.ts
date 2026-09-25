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

  return { datos: datos.data ?? VACIO, definiciones: definiciones.data ?? [] }
}
