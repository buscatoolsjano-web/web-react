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
  /**
   * La razón social, cuando no es lo que se muestra (Fase 40).
   *
   * El nombre visible es el comercial, y en este maestro el comercial suele
   * ser una PERSONA: «Francisco Rivas» para Mitsubishi Hitachi. Buscando «mi»
   * aparecía «Francisco Rivas» y no había forma de saber por qué. Mostrando
   * las dos, la coincidencia se explica sola.
   */
  razonSocial?: string | null | undefined
}

/** Una fila tal como la devuelve `public.buscar_clientes`. */
interface FilaBuscada {
  id: string
  nombre: string | null
  razon_social: string | null
  cuit: string | null
  referencia: string | null
  dado_de_baja: boolean
}

function aOpcion(f: FilaBuscada): ClienteOpcion {
  return {
    id: f.id,
    nombre: f.nombre ?? 'Sin nombre',
    dadoDeBaja: f.dado_de_baja,
    referencia: f.referencia,
    // Sólo cuando aporta: repetir el mismo texto dos veces es ruido.
    razonSocial: f.razon_social && f.razon_social !== f.nombre ? f.razon_social : null,
  }
}

/**
 * Clientes para el **filtro** de los listados (Fase 40).
 *
 * Es el mismo buscador contra el servidor que el del alta, con una diferencia
 * que importa: acá **sí** aparecen los dados de baja y los inactivos,
 * marcados. Filtrar es mirar el pasado, y un cliente que dejó de operar tiene
 * documentos que hay que poder encontrar por él; dar de alta es mirar el
 * futuro, y a ése no se le arma uno nuevo.
 *
 * Reemplaza a un desplegable con las primeras 500 filas alfabéticas. El
 * maestro tiene 1.010, así que faltaban 510: la lista se cortaba en
 * «Industrial Deckert S.R.L.» y no había forma de notarlo —el desplegable se
 * veía completo—. Whirlpool, que es el puesto 994 y tiene 29 cotizaciones, no
 * se podía elegir. Por eso esto es una corrección y no sólo una comodidad.
 *
 * Un rol externo ve exactamente uno: el suyo. No lo decide esta consulta, lo
 * decide RLS.
 */
export async function buscarClientesParaFiltro(
  companyId: string,
  texto: string,
): Promise<ClienteOpcion[]> {
  return pedirBusqueda(companyId, texto, true)
}

/**
 * Buscador de clientes para un documento **nuevo**.
 *
 * Un cliente dado de baja o inactivo **no se ofrece**. Sigue existiendo, sus
 * documentos lo siguen nombrando, pero no se le arma uno nuevo.
 */
export async function buscarClientes(
  companyId: string,
  texto: string,
): Promise<ClienteOpcion[]> {
  return pedirBusqueda(companyId, texto, false)
}

/**
 * La llamada, una sola vez para los dos.
 *
 * Sin texto no se busca nada: con el campo vacío la consulta salía sin filtro
 * y devolvía los primeros 20 por orden alfabético —«27 de Julio S.R.L.»,
 * «A-Evangelista S.A.»…—, que no son sugerencias de nada. Una sola letra
 * tampoco alcanza: «a» son cientos de clientes. La base aplica el mismo
 * mínimo; esto evita además el viaje.
 */
async function pedirBusqueda(
  companyId: string,
  texto: string,
  incluirInactivos: boolean,
): Promise<ClienteOpcion[]> {
  if (texto.trim().length < 2) return []

  const { data, error } = await supabase.rpc('buscar_clientes', {
    p_company: companyId,
    p_texto: texto,
    p_incluir_inactivos: incluirInactivos,
    p_limite: 15,
  })
  if (error) throw new Error(`No se pudieron buscar clientes: ${error.message}`)

  return ((data ?? []) as unknown as FilaBuscada[]).map(aOpcion)
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
