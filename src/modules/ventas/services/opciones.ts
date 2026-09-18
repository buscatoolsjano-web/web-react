import { supabase } from '@/services/supabase/client'

/**
 * Las opciones de los desplegables del editor.
 *
 * Tres consultas chicas y acotadas. Ninguna trae el catálogo entero: los
 * contactos son los de UN cliente, las listas son las de la empresa (hay 4) y
 * los usuarios asignables salen de las membresías activas.
 */

export interface OpcionContacto {
  id: string
  nombre: string
  rol: string | null
  /** Fase 17 · E3: el que se sugiere en un documento nuevo. */
  esPrincipal: boolean
  /**
   * Fase 17 · E3. Los desactivados **se traen igual**: si un documento ya
   * emitido nombra a uno, el desplegable tiene que poder mostrarlo. Lo que no
   * se hace es ofrecerlo para elegir; de eso se ocupa la pantalla.
   */
  activo: boolean
}

/**
 * Los contactos de un cliente.
 *
 * Se piden por cliente y no todos juntos: son 87 hoy, pero la consulta que
 * escala es ésta, no la que trae todo y filtra en el navegador.
 */
export async function contactosDeCliente(companyId: string, customerId: string): Promise<OpcionContacto[]> {
  const { data, error } = await supabase
    .from('customer_contacts')
    .select('id, full_name, role, is_default, active')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .order('active', { ascending: false })
    .order('is_default', { ascending: false })
    .order('full_name')
  if (error) throw new Error(`No se pudieron leer los contactos: ${error.message}`)
  return (data ?? []).map((c) => ({
    id: c.id,
    nombre: c.full_name,
    rol: c.role,
    esPrincipal: c.is_default,
    activo: c.active,
  }))
}

export interface OpcionDireccion {
  id: string
  /** La dirección en una línea: es como se elige y como se lee. */
  texto: string
  esPrincipal: boolean
  activa: boolean
}

/**
 * Los domicilios a los que se le puede entregar a un cliente (Fase 17 · E3).
 *
 * Sólo los de tipo entrega —o los dos— porque un domicilio de facturación no
 * es un lugar donde se descarga mercadería; `app.validar_direccion_envio` lo
 * rechaza y acá no se ofrece. Las desactivadas se traen para poder mostrar la
 * que un pedido viejo ya nombra, no para elegirla.
 */
export async function direccionesDeEntrega(
  companyId: string,
  customerId: string,
): Promise<OpcionDireccion[]> {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select('id, street, city, state, postal_code, country_code, is_default, active')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .in('kind', ['shipping', 'both'])
    .order('active', { ascending: false })
    .order('is_default', { ascending: false })
  if (error) throw new Error(`No se pudieron leer las direcciones: ${error.message}`)
  return (data ?? []).map((d) => ({
    id: d.id,
    texto:
      [d.street, d.city, d.state, d.postal_code, d.country_code]
        .map((p) => (p ?? '').trim())
        .filter((p) => p !== '')
        .join(', ') || 'Sin detalle',
    esPrincipal: d.is_default,
    activa: d.active,
  }))
}

export interface OpcionTarifa {
  id: string
  nombre: string
  moneda: string
}

/** Las listas de precios de la empresa, con su moneda: sin ella no se puede validar. */
export async function tarifasDeEmpresa(companyId: string): Promise<OpcionTarifa[]> {
  const { data, error } = await supabase
    .from('price_lists')
    .select('id, name, currency_code')
    .eq('company_id', companyId)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) throw new Error(`No se pudieron leer las tarifas: ${error.message}`)
  return (data ?? []).map((p) => ({ id: p.id, nombre: p.name, moneda: p.currency_code }))
}

export interface OpcionVendedor {
  id: string
  nombre: string
}

/**
 * A quién se le puede asignar una venta.
 *
 * Los roles internos que venden, activos, de ESTA empresa. No es «cualquier
 * usuario de auth»: la base rechaza un vendedor que no sea miembro activo
 * (`VENDEDOR_INVALIDO`), y acá se ofrece exactamente ese conjunto.
 */
export async function vendedoresDeEmpresa(companyId: string): Promise<OpcionVendedor[]> {
  const { data, error } = await supabase
    .from('company_memberships')
    .select('user_id, role, profiles!user_id ( full_name )')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .in('role', ['admin', 'employee', 'salesperson'])
  if (error) throw new Error(`No se pudieron leer los vendedores: ${error.message}`)

  return ((data ?? []) as unknown as { user_id: string; profiles: { full_name: string | null } | null }[])
    .map((m) => ({ id: m.user_id, nombre: m.profiles?.full_name ?? 'Sin nombre' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
