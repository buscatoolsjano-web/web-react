import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { crearProducto, type AltaDeProducto, type ProductoCreado } from '../services/altaProducto'

/**
 * Crear un producto y volver a leer el catálogo (Fase 26 · E3).
 *
 * Se invalida `['catalogo']` entero y no sólo el listado: las facetas cuentan
 * productos por marca y por categoría, y un producto nuevo cambia esos números.
 * Dejar las facetas viejas haría que el filtro diga 38 y el listado muestre 39.
 */
export function useCrearProducto() {
  const qc = useQueryClient()
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useMutation<ProductoCreado, Error, AltaDeProducto>({
    mutationFn: (alta) => crearProducto(companyId!, alta),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['catalogo'] })
    },
  })
}
