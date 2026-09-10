import { supabase } from '@/services/supabase/client'

export interface ClienteOpcion {
  id: string
  nombre: string
  /** `true` si está dado de baja. Sólo aparece en el filtro, nunca al crear. */
  dadoDeBaja: boolean
}

/**
 * Clientes para el **filtro** de los listados.
 *
 * Incluye los dados de baja, marcados: si no, un documento histórico de un
 * cliente que ya no opera no se podría filtrar por su cliente.
 *
 * Tope de 500. El maestro pasó de 60 a 1.010 al migrar la Fase 5 y un
 * desplegable con mil opciones no se usa; para elegir un cliente al crear un
 * documento está `buscarClientes`, que pregunta al servidor.
 *
 * Un rol externo ve exactamente uno: el suyo. No lo decide esta consulta, lo
 * decide RLS.
 */
export async function listarClientes(companyId: string): Promise<ClienteOpcion[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, legal_name, trade_name, deleted_at')
    .eq('company_id', companyId)
    .order('legal_name', { ascending: true })
    .limit(500)
  if (error) throw new Error(`No se pudieron leer los clientes: ${error.message}`)

  return (
    (data ?? []) as {
      id: string
      legal_name: string | null
      trade_name: string | null
      deleted_at: string | null
    }[]
  )
    .map((c) => ({
      id: c.id,
      nombre: c.trade_name?.trim() || c.legal_name?.trim() || 'Sin nombre',
      dadoDeBaja: c.deleted_at !== null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Buscador de clientes para un documento **nuevo**.
 *
 * Contra el servidor y de a 20, igual que el buscador de productos: el legacy
 * tenía los 988 clientes en un array global y filtraba en memoria.
 *
 * Un cliente dado de baja o inactivo **no se ofrece**. Sigue existiendo, sus
 * documentos lo siguen nombrando, pero no se le arma uno nuevo.
 */
export async function buscarClientes(
  companyId: string,
  texto: string,
): Promise<ClienteOpcion[]> {
  const limpio = texto.trim().replace(/[,()*]/g, '')
  let q = supabase
    .from('customers')
    .select('id, legal_name, trade_name, tax_id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('legal_name', { ascending: true })
    .limit(20)

  if (limpio !== '') {
    const patron = `%${limpio}%`
    q = q.or(
      `legal_name.ilike.${patron},trade_name.ilike.${patron},tax_id.ilike.${patron},legacy_ref.ilike.${patron}`,
    )
  }

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron buscar clientes: ${error.message}`)

  return (
    (data ?? []) as { id: string; legal_name: string | null; trade_name: string | null }[]
  ).map((c) => ({
    id: c.id,
    nombre: c.trade_name?.trim() || c.legal_name?.trim() || 'Sin nombre',
    dadoDeBaja: false,
  }))
}

/** El nombre de un cliente ya elegido, para mostrarlo sin volver a buscarlo. */
export async function nombreDeCliente(
  companyId: string,
  id: string,
): Promise<ClienteOpcion | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, legal_name, trade_name, deleted_at')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el cliente: ${error.message}`)
  if (!data) return null
  return {
    id: data.id,
    nombre: data.trade_name?.trim() || data.legal_name?.trim() || 'Sin nombre',
    dadoDeBaja: data.deleted_at !== null,
  }
}
