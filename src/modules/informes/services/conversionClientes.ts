import { supabase } from '@/services/supabase/client'
import type { ConversionCliente, ParametrosConversion } from '../types'
import { errorDeInforme } from './actividad'

/**
 * Comparativa cotizaciones ↔ pedidos, cliente por cliente (Fase 40).
 *
 * Todo lo agrega `informe_conversion_por_cliente`: la pantalla no baja
 * documentos, no suma y no ordena. El orden tiene que decidirse en el servidor
 * porque también vive ahí el LIMIT, y ordenar las 25 filas que ya llegaron
 * dejaría afuera justo al cliente que se estaba buscando.
 *
 * Las definiciones son las mismas que las del informe de conversión general
 * —convertida = la cotización tiene un pedido confirmado enlazado, los
 * borradores no cuentan—: dos informes que cuentan distinto no se pueden leer
 * juntos.
 */
export async function obtenerConversionPorCliente(
  companyId: string,
  mes: string | null,
  p: ParametrosConversion,
  limite: number,
  desplazamiento = 0,
): Promise<ConversionCliente[]> {
  const { data, error } = await supabase.rpc('informe_conversion_por_cliente', {
    p_company: companyId,
    p_mes: mes ? `${mes}-01` : null,
    p_periodo: p.periodo,
    p_moneda: p.moneda,
    p_orden: p.orden,
    p_minimo: p.minimo,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

/**
 * La comparativa COMPLETA para el CSV, con los mismos filtros.
 *
 * De a 500, que es el tope del servidor, y como mucho diez páginas: el maestro
 * tiene 1.010 clientes y los que cotizan en doce meses son unos pocos cientos.
 */
export async function exportarConversionPorCliente(
  companyId: string,
  mes: string | null,
  p: ParametrosConversion,
): Promise<ConversionCliente[]> {
  const POR_PAGINA = 500
  const todas: ConversionCliente[] = []
  for (let pagina = 0; pagina < 10; pagina++) {
    const filas = await obtenerConversionPorCliente(companyId, mes, p, POR_PAGINA, pagina * POR_PAGINA)
    todas.push(...filas)
    const total = Number(filas[0]?.total_filas ?? 0)
    if (filas.length < POR_PAGINA || todas.length >= total) break
  }
  return todas
}
