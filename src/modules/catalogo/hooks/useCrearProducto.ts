import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { crearProducto, type AltaDeProducto, type ProductoCreado } from '../services/altaProducto'

/**
 * Crear un producto y volver a leer el catálogo (Fase 26 · E3).
 *
 * Se invalida `['catalogo']` entero y no sólo el listado: las facetas cuentan
 * productos por marca y por categoría, y un producto nuevo cambia esos números.
 * Dejar las facetas viejas haría que el filtro diga 38 y el listado muestre 39.
 *
 * Y también el catálogo del modal de ventas, que vive bajo `['ventas', …]`
 * porque consulta con la tarifa del documento (Fase 40). Sin esto, crear un
 * producto desde una cotización lo dejaba fuera de la lista que lo acababa de
 * crear: el caso exacto para el que se agregó el botón.
 */
export function useCrearProducto() {
  const qc = useQueryClient()
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useMutation<ProductoCreado, Error, AltaDeProducto>({
    mutationFn: (alta) => crearProducto(companyId!, alta),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['catalogo'] }),
        qc.invalidateQueries({ queryKey: ['ventas', companyId, 'catalogo-documento'] }),
        qc.invalidateQueries({ queryKey: ['ventas', companyId, 'facetas-documento'] }),
      ])
    },
  })
}
