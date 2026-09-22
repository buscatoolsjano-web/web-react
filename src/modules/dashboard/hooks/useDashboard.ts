import { useQueries, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { listarDocumentos } from '@/modules/ventas/services/documentos'
import { FILTROS_INICIALES as FILTROS_VENTAS, type TipoDocumento } from '@/modules/ventas/types'
import { documentosEnAtencion } from '../services/atencion'
import { ultimosDocumentos } from '../lib/documentos'

/**
 * Los datos propios del Dashboard (Fase 21 · E2).
 *
 * Lo comercial —el mes, la comparación y los doce meses— NO está acá: sale de
 * `useActividad` y `usePipeline`, las mismas consultas y las mismas claves de
 * caché que Informes. Entrar al Dashboard y después a Informes no vuelve a
 * pedir nada.
 */

const UN_MINUTO = 60_000

/** Los documentos que requieren atención hoy, con su lista para poder abrirlos. */
export function useAtencion() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: ['dashboard', companyId, 'atencion'],
    queryFn: () => documentosEnAtencion(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * UN_MINUTO,
    refetchOnWindowFocus: false,
  })
}

const TIPOS: readonly TipoDocumento[] = ['cotizacion', 'pedido', 'entrega']

/**
 * Los últimos documentos de los tres tipos, por fecha de documento.
 *
 * Son tres consultas y no una porque cada tipo vive en su tabla y el listado
 * de Ventas ya sabe leerlas con su RLS, sus joins y su orden. Una RPC nueva
 * ahorraría dos requests y agregaría un lugar más donde la misma regla podría
 * quedar distinta; con tres páginas de diez filas no vale la pena.
 *
 * El orden final —y el desempate del mismo día— se resuelve en `lib/documentos`.
 */
export function useUltimosDocumentos(limite = 8) {
  const companyId = useEmpresa().activa?.companyId ?? null
  const filtros = { ...FILTROS_VENTAS, porPagina: limite, orden: 'fecha' as const, direccion: 'desc' as const }

  const consultas = useQueries({
    queries: TIPOS.map((tipo) => ({
      queryKey: ['ventas', companyId, tipo, 'listado', filtros],
      queryFn: () => listarDocumentos(tipo, companyId!, filtros),
      enabled: companyId !== null,
      staleTime: UN_MINUTO,
    })),
  })

  return {
    documentos: ultimosDocumentos(consultas.map((c) => c.data?.filas ?? []), limite),
    cargando: consultas.some((c) => c.isPending),
    // Un tipo que falla no tira el bloque entero: se muestra lo que sí llegó.
    error: consultas.every((c) => c.error) ? (consultas[0]?.error ?? null) : null,
    parcial: consultas.some((c) => c.error) && !consultas.every((c) => c.error),
    reintentar: () => consultas.forEach((c) => void c.refetch()),
  }
}
