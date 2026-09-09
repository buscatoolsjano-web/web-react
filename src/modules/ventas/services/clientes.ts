import { supabase } from '@/services/supabase/client'

export interface ClienteOpcion {
  id: string
  nombre: string
}

/**
 * Clientes para el filtro de los listados.
 *
 * Son 60 en total, así que se traen todos de una y se filtran en memoria. Si
 * algún día son miles, esto pasa a `ilike` contra el servidor — pero no se
 * complica antes de que haga falta.
 *
 * Un rol externo ve exactamente uno: el suyo. No es una decisión de esta
 * consulta, es RLS.
 */
export async function listarClientes(companyId: string): Promise<ClienteOpcion[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, legal_name, trade_name')
    .eq('company_id', companyId)
    .order('legal_name', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los clientes: ${error.message}`)

  return ((data ?? []) as { id: string; legal_name: string | null; trade_name: string | null }[])
    .map((c) => ({
      id: c.id,
      nombre: c.trade_name?.trim() || c.legal_name?.trim() || 'Sin nombre',
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
