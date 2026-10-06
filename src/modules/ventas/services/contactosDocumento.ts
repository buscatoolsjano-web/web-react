import { supabase } from '@/services/supabase/client'
import type { TipoDocumento } from '../types'

/**
 * Los contactos de un documento de venta: principal y secundarios (Fase 40).
 *
 * Una venta la siguen dos o tres personas del cliente —el de compras que pide,
 * el ingeniero que especifica, el de pagos que recibe la factura— y hasta hoy
 * había que elegir a una y escribir las otras en las observaciones.
 *
 * El principal sigue viviendo en `contact_id` del documento. Las tablas nuevas
 * guardan SÓLO los secundarios, y eso es deliberado: todo lo que ya lee
 * `contact_id` —la impresión, el sync de STEL, el módulo de emails, los
 * informes— sigue funcionando sin tocar una línea, y no hay dos fuentes de
 * verdad para «quién es el principal».
 *
 * Los dos lados se escriben en UNA transacción, del lado del servidor, porque
 * cambiar el principal es un intercambio —el viejo baja, el nuevo sube— y a
 * mitad de camino el documento tendría dos principales o ninguno.
 */

export const MENSAJES_CONTACTOS: Record<string, string> = {
  CONTACTO_DE_OTRO_CLIENTE: 'Ese contacto es de otro cliente.',
  CONTACTO_YA_ES_PRINCIPAL: 'Ese contacto ya es el principal del documento.',
  DOCUMENTO_INEXISTENTE: 'El documento ya no está.',
  SIN_PERMISO: 'No tenés permiso para editar este documento.',
  TIPO_DESCONOCIDO: 'Ese tipo de documento no lleva contactos.',
}

export function mensajeDeContactos(e: unknown): string {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const codigo = Object.keys(MENSAJES_CONTACTOS).find((c) => texto.includes(c))
  if (codigo) return MENSAJES_CONTACTOS[codigo]!
  return texto || 'No se pudieron guardar los contactos.'
}

/**
 * Guarda el equipo completo del documento.
 *
 * `secundarios` va en orden: es el que se muestra y el que se imprime. Los
 * repetidos y el principal repetido entre los secundarios los limpia el
 * servidor —una lista mal armada se arregla, no se rechaza—.
 */
export async function guardarContactosDocumento(
  tipo: TipoDocumento,
  documentoId: string,
  principal: string | null,
  secundarios: readonly string[],
): Promise<void> {
  const { error } = await supabase.rpc('guardar_contactos_documento', {
    p_tipo: tipo,
    p_documento: documentoId,
    p_principal: principal,
    p_secundarios: [...secundarios],
  })
  if (error) throw new Error(error.message)
}
