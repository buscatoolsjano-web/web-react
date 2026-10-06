import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorInforme } from '../services/actividad'
import { obtenerConversionPorCliente } from '../services/conversionClientes'
import type { ConversionCliente, ParametrosConversion } from '../types'

export const POR_PAGINA_CONVERSION = 25

export const claveConversion = (
  companyId: string | null,
  mes: string | null,
  p: ParametrosConversion,
  pagina: number,
) =>
  [
    'informes',
    companyId,
    'conversion-clientes',
    mes ?? 'actual',
    p.periodo,
    p.moneda,
    p.orden,
    p.minimo,
    pagina,
  ] as const

/**
 * La comparativa cotizaciones ↔ pedidos por cliente (Fase 40).
 *
 * `placeholderData` mantiene la página anterior mientras llega la nueva: sin
 * eso, cambiar de orden o de página vacía la tabla y la pantalla salta.
 */
export function useConversionClientes(mes: string | null, p: ParametrosConversion, pagina: number) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<ConversionCliente[]>({
    queryKey: claveConversion(companyId, mes, p, pagina),
    queryFn: () =>
      obtenerConversionPorCliente(companyId!, mes, p, POR_PAGINA_CONVERSION, pagina * POR_PAGINA_CONVERSION),
    enabled: companyId !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Sin permiso, mes futuro o parámetro inválido no se arreglan reintentando.
    retry: (intentos, error) =>
      !(error instanceof ErrorInforme && error.codigo !== 'desconocido') && intentos < 2,
  })
}
