import { supabase } from '@/services/supabase/client'
import type { TipoDocumento } from '../types'

/**
 * Los vendedores de un documento: principal y acompañantes (Fase 40).
 *
 * Pasa seguido que una venta la lleven dos: uno abre la cuenta y otro la
 * sigue, o la parte técnica es de uno y la comercial de otro. Hasta ahora el
 * documento tenía UN vendedor y el otro no figuraba en ningún lado.
 *
 * El principal sigue viviendo en `salesperson_id`, que es el que cuenta en los
 * rankings y en los informes; la tabla nueva guarda sólo a los que acompañan.
 * Los dos lados se escriben en UNA transacción, del lado del servidor, porque
 * ascender a alguien es un intercambio y a mitad de camino el documento
 * tendría dos principales o ninguno.
 *
 * El remito no lleva vendedor: el vendedor es del pedido, y el remito sólo
 * entrega lo que el pedido vendió.
 */

export const MENSAJES_VENDEDORES: Record<string, string> = {
  VENDEDOR_NO_HABILITADO: 'Esa persona no vende en esta empresa.',
  VENDEDOR_YA_ES_PRINCIPAL: 'Esa persona ya es el vendedor principal.',
  DOCUMENTO_INEXISTENTE: 'El documento ya no está.',
  SIN_PERMISO: 'No tenés permiso para editar este documento.',
  TIPO_DESCONOCIDO: 'Ese tipo de documento no lleva vendedores.',
}

export function mensajeDeVendedores(e: unknown): string {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const codigo = Object.keys(MENSAJES_VENDEDORES).find((c) => texto.includes(c))
  if (codigo) return MENSAJES_VENDEDORES[codigo]!
  return texto || 'No se pudieron guardar los vendedores.'
}

export async function guardarVendedoresDocumento(
  tipo: TipoDocumento,
  documentoId: string,
  principal: string | null,
  acompanan: readonly string[],
): Promise<void> {
  // El remito no tiene vendedor y la RPC lo rechazaría: no se la llama.
  if (tipo === 'entrega') return

  const { error } = await supabase.rpc('guardar_vendedores_documento', {
    p_tipo: tipo,
    p_documento: documentoId,
    p_principal: principal,
    p_acompanantes: [...acompanan],
  })
  if (error) throw new Error(error.message)
}
