import { supabase } from '@/services/supabase/client'

export type DocumentoEnviable = 'cotizacion' | 'pedido' | 'entrega' | 'pedido_compra' | 'orden_mantenimiento' | 'lote_mantenimiento'

/**
 * Deja constancia en el documento de que se mandó por mail: a quién, con copia
 * a quién y con qué asunto. Queda como evento «emailed» en su auditoría, que es
 * lo que muestra la trazabilidad del documento.
 *
 * Si falla no se le avisa a nadie con un error: el mail YA salió, y perder la
 * constancia es menos grave que hacer creer que el envío falló.
 */
export async function registrarEnvioDocumento(
  tipo: DocumentoEnviable,
  id: string,
  envio: { para: readonly string[]; cc: readonly string[]; asunto: string },
): Promise<void> {
  const { error } = await supabase.rpc('registrar_envio_documento', {
    p_tipo: tipo,
    p_id: id,
    p_para: [...envio.para],
    p_cc: [...envio.cc],
    p_asunto: envio.asunto,
  })
  if (error) console.warn('No se pudo registrar el envío en el documento:', error.message)
}
