import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { obtenerDocumentosInforme, type FilaDocumentoInforme } from '@/modules/informes/services/documentos'
import type { Moneda, TipoActividad } from '@/modules/informes/types'
import { rangoDelMes, SERIES } from '../lib/evolucion'

/** Cuántos documentos se listan por tipo antes de mandar al listado completo. */
export const TOPE_POR_TIPO = 5

export interface DesglosePorTipo {
  tipo: TipoActividad
  documentos: FilaDocumentoInforme[]
}

/**
 * Los documentos de UN mes, separados por tipo (Fase 63).
 *
 * «Toco octubre y abajo del gráfico se me desglosa qué es lo que hay».
 *
 * SALE DE LA MISMA FUENTE QUE EL GRÁFICO. `informe_documentos` y
 * `informe_actividad_comercial` agregan las dos sobre `documentos_comerciales`,
 * así que lo que lista el desglose es exactamente lo que mide la barra — no es
 * una coincidencia que haya que mantener, es la misma consulta contada de dos
 * maneras. Un desglose que no sumara la barra sería peor que no tenerlo.
 *
 * UNA CONSULTA POR TIPO, LAS TRES EN PARALELO. Una sola con un tope de quince
 * no sirve: el servidor ordena por fecha, así que un mes con muchas
 * cotizaciones devolvería quince cotizaciones y ninguna entrega. Y en paralelo
 * porque ninguna depende de las otras: desde Argentina son ~220 ms cada una, y
 * en fila serían tres cuartos de segundo para abrir un panel.
 *
 * Y SE FILTRA POR MONEDA, la misma que está mirando el gráfico: si la barra
 * dice USD, el desglose no puede traer los documentos en pesos.
 */
export function useDesgloseDelMes(mes: string | null, moneda: Moneda | null) {
  const companyId = useEmpresa().activa?.companyId ?? null
  const rango = mes ? rangoDelMes(mes) : null

  return useQuery<DesglosePorTipo[]>({
    queryKey: ['dashboard', companyId, 'desglose-mes', mes, moneda],
    queryFn: () =>
      Promise.all(
        SERIES.map(async ({ tipo }) => ({
          tipo,
          documentos: (
            await obtenerDocumentosInforme(
              companyId!,
              { desde: rango!.desde, hasta: rango!.hasta, tipo, moneda },
              TOPE_POR_TIPO,
              0,
            )
          ).filas,
        })),
      ),
    enabled: companyId !== null && rango !== null,
    // Un mes cerrado no cambia, y el actual cambia poco en lo que dura una
    // mirada al panel: volver a tocar el mismo mes no sale a la red.
    staleTime: 5 * 60_000,
  })
}
