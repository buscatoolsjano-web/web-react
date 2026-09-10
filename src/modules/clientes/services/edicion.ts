import { supabase } from '@/services/supabase/client'
import type { DatosCliente, DatosContacto, DatosDireccion } from '../lib/validacion'
import { normalizarDominios, normalizarEmails } from '../lib/validacion'

/**
 * Escrituras del módulo de Clientes.
 *
 * Nada de esto decide quién puede hacerlo: eso es RLS. `customers` deja
 * insertar y editar a admin, employee y salesperson —el vendedor, sólo los
 * suyos—; `customer_contacts` y `customer_addresses` sólo a admin y employee.
 * Un rol externo choca contra la policy, no contra un botón escondido.
 */

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

/**
 * Alta de cliente.
 *
 * La referencia `CLI00001` la da el servidor con `next_document_number`, la
 * misma función que numera cotizaciones, pedidos y remitos: un UPDATE con
 * bloqueo de fila, no un `MAX+1` calculado en el navegador como hacía
 * `nextClienteRef`. El uuid sigue siendo la identidad; la referencia es un
 * dato más.
 *
 * El número se pide **antes** del insert. Si el insert falla, ese número se
 * pierde —queda un hueco— y está bien: repetir una referencia es peor que
 * saltearla, y es exactamente lo que hace la numeración de Ventas.
 */
export async function crearCliente(
  companyId: string,
  datos: DatosCliente,
): Promise<{ id: string; referencia: string | null }> {
  const { data: referencia, error: eNum } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'customer',
  })
  if (eNum) throw new Error(`No se pudo asignar la referencia: ${eNum.message}`)

  const { data, error } = await supabase
    .from('customers')
    .insert({
      company_id: companyId,
      legacy_ref: referencia,
      legal_name: datos.razonSocial.trim(),
      trade_name: vacioANulo(datos.nombreComercial),
      tax_id: vacioANulo(datos.cuit),
      emails: normalizarEmails(datos.emails),
      // NOT NULL con default `{}`: un cliente sin dominios lleva array vacío.
      email_domains: normalizarDominios(datos.dominios),
      industry: vacioANulo(datos.rubro),
      phone: vacioANulo(datos.telefono),
      customer_type: datos.tipo,
      payment_terms: vacioANulo(datos.condicionDePago),
      default_currency: vacioANulo(datos.monedaPorDefecto),
      notes: vacioANulo(datos.notas),
      status: 'active',
    })
    .select('id, legacy_ref')
    .single()

  if (error) throw new Error(traducir(error.message, error.code))
  return { id: data.id, referencia: data.legacy_ref }
}

/**
 * Edición.
 *
 * `legacy_ref` NO se toca: es la referencia con la que el cliente figura en
 * los papeles del sistema anterior. Tampoco se tocan `needs_review` ni
 * `review_reason`: los recalcula el trigger, y sólo se caen los motivos que
 * la edición realmente resuelve.
 */
export async function actualizarCliente(
  companyId: string,
  id: string,
  datos: DatosCliente,
): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({
      legal_name: datos.razonSocial.trim(),
      trade_name: vacioANulo(datos.nombreComercial),
      tax_id: vacioANulo(datos.cuit),
      emails: normalizarEmails(datos.emails),
      email_domains: normalizarDominios(datos.dominios),
      industry: vacioANulo(datos.rubro),
      phone: vacioANulo(datos.telefono),
      customer_type: datos.tipo,
      payment_terms: vacioANulo(datos.condicionDePago),
      default_currency: vacioANulo(datos.monedaPorDefecto),
      notes: vacioANulo(datos.notas),
    })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Baja lógica.
 *
 * Nunca un DELETE. Un cliente con documentos ni siquiera podría borrarse
 * —`app.proteger_borrado_cliente()` lo rechaza— pero el punto no es ése: el
 * cliente se da de baja para que deje de aparecer al armar un documento
 * nuevo, y sus 636 documentos históricos lo siguen nombrando igual.
 *
 * Se escriben las dos columnas juntas y a propósito: `deleted_at` es la baja
 * y `status` es el estado comercial. Dejar `status = 'active'` en un cliente
 * dado de baja sería guardar una contradicción.
 */
export async function darDeBajaCliente(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo dar de baja: ${error.message}`)
}

export async function reactivarCliente(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({ deleted_at: null, status: 'active' })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo reactivar: ${error.message}`)
}

/**
 * Dar por revisado.
 *
 * Va por una RPC y no por un UPDATE de la columna: el trigger ignora lo que
 * la aplicación escriba en `review_reason`. Sin lista de motivos se dan por
 * revisados todos; con la lista, sólo ésos.
 */
export async function resolverRevision(
  clienteId: string,
  motivos?: readonly string[],
): Promise<string[]> {
  const { data, error } = await supabase.rpc('resolver_revision_cliente', {
    p_customer: clienteId,
    p_motivos: motivos ? [...motivos] : null,
  })
  if (error) throw new Error(`No se pudo resolver la revisión: ${error.message}`)
  const r = data as { motivos_restantes?: string[] } | null
  return r?.motivos_restantes ?? []
}

// ── Contactos ──────────────────────────────────────────────────────────────

function filaContacto(companyId: string, clienteId: string, d: DatosContacto) {
  return {
    company_id: companyId,
    // La relación es SIEMPRE por id. En el legacy un contacto guardaba el
    // nombre de la empresa en un campo de texto.
    customer_id: clienteId,
    full_name: d.nombre.trim(),
    role: vacioANulo(d.cargo),
    email: vacioANulo(d.email.toLowerCase()),
    phone: vacioANulo(d.telefono),
    fax: vacioANulo(d.fax),
    is_default: d.esPrincipal,
    notes: vacioANulo(d.notas),
  }
}

export async function crearContacto(
  companyId: string,
  clienteId: string,
  datos: DatosContacto,
): Promise<string> {
  if (datos.esPrincipal) await bajarPrincipalContacto(companyId, clienteId, null)
  const { data, error } = await supabase
    .from('customer_contacts')
    .insert(filaContacto(companyId, clienteId, datos))
    .select('id')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))
  return data.id
}

export async function actualizarContacto(
  companyId: string,
  clienteId: string,
  id: string,
  datos: DatosContacto,
): Promise<void> {
  if (datos.esPrincipal) await bajarPrincipalContacto(companyId, clienteId, id)
  const { error } = await supabase
    .from('customer_contacts')
    .update(filaContacto(companyId, clienteId, datos))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarContacto(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('customer_contacts')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo borrar el contacto: ${error.message}`)
}

/**
 * Un solo contacto principal por cliente.
 *
 * Lo garantiza `uq_customer_contact_default`, un índice único parcial. Acá se
 * baja el anterior ANTES de marcar el nuevo, porque si no el índice rechaza
 * el insert y la persona ve un error de base en vez de que funcione.
 */
async function bajarPrincipalContacto(
  companyId: string,
  clienteId: string,
  exceptoId: string | null,
): Promise<void> {
  let q = supabase
    .from('customer_contacts')
    .update({ is_default: false })
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    .eq('is_default', true)
  if (exceptoId) q = q.neq('id', exceptoId)
  const { error } = await q
  if (error) throw new Error(`No se pudo cambiar el contacto principal: ${error.message}`)
}

// ── Direcciones ────────────────────────────────────────────────────────────

function filaDireccion(companyId: string, clienteId: string, d: DatosDireccion) {
  return {
    company_id: companyId,
    customer_id: clienteId,
    kind: d.tipo,
    street: d.calle.trim(),
    city: vacioANulo(d.ciudad),
    state: vacioANulo(d.provincia),
    postal_code: vacioANulo(d.codigoPostal),
    country_code: vacioANulo(d.pais.toUpperCase()),
    notes: vacioANulo(d.notas),
    is_default: d.esPrincipal,
  }
}

export async function crearDireccion(
  companyId: string,
  clienteId: string,
  datos: DatosDireccion,
): Promise<string> {
  if (datos.esPrincipal) await bajarPrincipalDireccion(companyId, clienteId, datos.tipo, null)
  const { data, error } = await supabase
    .from('customer_addresses')
    .insert(filaDireccion(companyId, clienteId, datos))
    .select('id')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))
  return data.id
}

export async function actualizarDireccion(
  companyId: string,
  clienteId: string,
  id: string,
  datos: DatosDireccion,
): Promise<void> {
  if (datos.esPrincipal) await bajarPrincipalDireccion(companyId, clienteId, datos.tipo, id)
  const { error } = await supabase
    .from('customer_addresses')
    .update(filaDireccion(companyId, clienteId, datos))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarDireccion(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('customer_addresses')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo borrar la dirección: ${error.message}`)
}

/** Una principal por cliente **y por tipo**: así está el índice único. */
async function bajarPrincipalDireccion(
  companyId: string,
  clienteId: string,
  tipo: string,
  exceptoId: string | null,
): Promise<void> {
  let q = supabase
    .from('customer_addresses')
    .update({ is_default: false })
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    .eq('kind', tipo)
    .eq('is_default', true)
  if (exceptoId) q = q.neq('id', exceptoId)
  const { error } = await q
  if (error) throw new Error(`No se pudo cambiar la dirección principal: ${error.message}`)
}

/**
 * El error de Postgres, en castellano.
 *
 * Un 23505 sobre el índice del CUIT no es «duplicate key value violates unique
 * constraint»: es «ese CUIT ya lo tiene otro cliente», que es lo que la
 * persona necesita leer para saber qué hacer.
 */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23505') {
    if (mensaje.includes('cuit_norm') || mensaje.includes('taxid')) {
      return 'Ese CUIT ya lo tiene otro cliente de esta empresa.'
    }
    if (mensaje.includes('customers_legacy')) {
      return 'Esa referencia CLI ya está en uso.'
    }
    if (mensaje.includes('contact_default') || mensaje.includes('addr_default')) {
      return 'Ya hay otro marcado como principal.'
    }
    return `Ese dato ya existe: ${mensaje}`
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio.'
  }
  return mensaje
}
