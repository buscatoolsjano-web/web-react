import { supabase } from '@/services/supabase/client'
import type { DefaultsComerciales } from '../lib/defaults'

export interface ClienteOpcion {
  id: string
  nombre: string
  /** `true` si está dado de baja. Sólo aparece en el filtro, nunca al crear. */
  dadoDeBaja: boolean
  /**
   * La referencia del sistema anterior (`CLI00719`), cuando la tiene.
   *
   * Se muestra al lado del nombre en el desplegable, como en el legacy: es
   * lo que la gente dicta por teléfono y lo que distingue dos razones
   * sociales parecidas. Ya se podía BUSCAR por ella; lo que faltaba era
   * verla.
   */
  referencia?: string | null | undefined
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

  // Fase 22 · A8: sin texto no se busca nada.
  //
  // Antes, con el campo vacío, la consulta salía SIN filtro y devolvía los
  // primeros 20 clientes por orden alfabético: al tocar «Cliente» aparecían
  // «27 de Julio S.R.L.», «A-Evangelista S.A.»…, que no son sugerencias de
  // nada. Con 1.010 clientes, una lista que no responde a lo que se escribió
  // es ruido, y encima cuesta una consulta cada vez que se abre el campo.
  //
  // Un solo carácter tampoco alcanza: «a» son cientos de clientes.
  if (limpio.length < 2) return []

  const patron = `%${limpio}%`
  const q = supabase
    .from('customers')
    .select('id, legal_name, trade_name, tax_id, legacy_ref')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .eq('status', 'active')
    .or(
      `legal_name.ilike.${patron},trade_name.ilike.${patron},tax_id.ilike.${patron},legacy_ref.ilike.${patron}`,
    )
    .order('legal_name', { ascending: true })
    .limit(15)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron buscar clientes: ${error.message}`)

  return (
    (data ?? []) as {
      id: string
      legal_name: string | null
      trade_name: string | null
      legacy_ref: string | null
    }[]
  ).map((c) => ({
    id: c.id,
    nombre: c.trade_name?.trim() || c.legal_name?.trim() || 'Sin nombre',
    dadoDeBaja: false,
    referencia: c.legacy_ref,
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

/**
 * Los defaults comerciales del cliente (Fase 17 · E2).
 *
 * Cuatro columnas de `customers` en **una** consulta. No se trae la ficha
 * entera —ni contactos, ni direcciones, ni historial— porque para sugerir el
 * vendedor y la tarifa de un documento nuevo eso no hace falta.
 *
 * Quien decide si el default se aplica es `aplicarDefaults`, con las listas de
 * tarifas y vendedores que la pantalla ya tiene cargadas: así no hay una
 * consulta por campo ni una validación que el servidor tenga que repetir.
 */
export async function defaultsDeCliente(
  companyId: string,
  customerId: string,
): Promise<DefaultsComerciales | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('salesperson_id, default_price_list_id, payment_terms, default_currency')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (error) throw new Error(`No se pudieron leer los datos del cliente: ${error.message}`)
  if (!data) return null

  return {
    vendedorId: data.salesperson_id,
    tarifaId: data.default_price_list_id,
    formaPago: data.payment_terms,
    moneda: data.default_currency,
  }
}
