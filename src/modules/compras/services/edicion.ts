import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'
import { normalizarPais, type DatosProveedor } from '../lib/validacion'

/**
 * Escrituras del maestro de proveedores.
 *
 * Nada de esto decide quién puede hacerlo: eso es RLS. `suppliers` tiene una
 * sola policy, `FOR ALL` sobre `app.current_writer_company_ids()`, o sea
 * admin y employee. Un salesperson que llegue hasta acá recibe un 42501, no
 * un botón escondido.
 */

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

function fila(datos: DatosProveedor) {
  return {
    legal_name: datos.razonSocial.trim(),
    trade_name: vacioANulo(datos.nombreComercial),
    tax_id: vacioANulo(datos.cuit),
    email: vacioANulo(datos.email.toLowerCase()),
    phone: vacioANulo(datos.telefono),
    // La dirección se guarda en UNA línea, como en el legacy. No se parte.
    address_text: vacioANulo(datos.direccion),
    country_code: vacioANulo(normalizarPais(datos.pais)),
    activity: vacioANulo(datos.actividad),
    agent: vacioANulo(datos.agente),
    payment_terms: vacioANulo(datos.formaPago),
    default_currency: vacioANulo(datos.monedaPorDefecto),
    notes: vacioANulo(datos.notas),
  }
}

/**
 * Registra el evento en `purchases_audit`.
 *
 * Va aparte del insert/update y **no** hace fallar la operación si falla: el
 * proveedor ya se guardó, y perder una línea de auditoría es peor que
 * mostrarle a la persona un error por algo que sí funcionó. Si alguna vez
 * hace falta que sea atómico, el lugar es un trigger, no el navegador.
 */
async function auditar(
  entidadId: string,
  accion: 'create' | 'update' | 'status_change',
  extra: { desde?: string | null; hasta?: string | null; diff?: Json } = {},
): Promise<void> {
  const { error } = await supabase.rpc('registrar_evento_compra', {
    p_entity_type: 'supplier',
    p_entity_id: entidadId,
    p_action: accion,
    p_from_status: extra.desde ?? null,
    p_to_status: extra.hasta ?? null,
    p_diff: extra.diff ?? null,
  })
  if (error) console.warn('No se pudo auditar el evento de proveedor:', error.message)
}

/**
 * Alta de proveedor.
 *
 * La referencia `PROV00146` la da el servidor con `next_document_number`, la
 * misma función que numera pedidos, recepciones y facturas: un UPDATE con
 * bloqueo de fila, no un `MAX+1`. El uuid sigue siendo la identidad; la
 * referencia es un dato más.
 *
 * El número se pide **antes** del insert. Si el insert falla, ese número se
 * pierde —queda un hueco— y está bien: repetir una referencia es peor que
 * saltearla.
 */
export async function crearProveedor(
  companyId: string,
  datos: DatosProveedor,
): Promise<{ id: string; referencia: string | null }> {
  const { data: referencia, error: eNum } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'supplier',
  })
  if (eNum) throw new Error(`No se pudo asignar la referencia: ${traducir(eNum.message, eNum.code)}`)

  const { data, error } = await supabase
    .from('suppliers')
    .insert({ company_id: companyId, legacy_ref: referencia, status: 'active', ...fila(datos) })
    .select('id, legacy_ref')
    .single()

  if (error) throw new Error(traducir(error.message, error.code))
  await auditar(data.id, 'create', { hasta: 'active' })
  return { id: data.id, referencia: data.legacy_ref }
}

/**
 * Edición.
 *
 * `legacy_ref` NO se toca: es la referencia con la que el proveedor figura en
 * los papeles del sistema anterior. `needs_review` y `review_reason` tampoco:
 * editar un teléfono no resuelve que haya un email escondido en las notas.
 */
export async function actualizarProveedor(
  companyId: string,
  id: string,
  datos: DatosProveedor,
): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update(fila(datos))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
  await auditar(id, 'update')
}

/**
 * Baja lógica.
 *
 * Nunca un DELETE. La policy de `suppliers` es `FOR ALL`, así que un admin
 * técnicamente PODRÍA borrar —lo descubrió el test de esta entrega, después de
 * que la entrega 1 diera por sentado que no—, pero un proveedor con pedidos,
 * recepciones, facturas o adjuntos lo frena `app.proteger_borrado_proveedor()`
 * con un `restrict_violation`. Desde la UI no hay ningún camino al DELETE: se
 * da de baja, para que deje de ofrecerse al armar un pedido de compra y sus
 * documentos lo sigan nombrando igual.
 *
 * Se escriben las dos columnas juntas y a propósito: `deleted_at` es la baja
 * y `status` es el estado comercial. Dejar `status = 'active'` en un proveedor
 * dado de baja sería guardar una contradicción.
 */
export async function darDeBajaProveedor(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
  await auditar(id, 'status_change', { desde: 'active', hasta: 'inactive' })
}

export async function reactivarProveedor(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ deleted_at: null, status: 'active' })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
  await auditar(id, 'status_change', { desde: 'inactive', hasta: 'active' })
}

/**
 * Dar por revisado.
 *
 * Compras no tiene una RPC como `resolver_revision_cliente` porque tampoco
 * tiene el trigger que allá recalcula la marca: acá `needs_review` y
 * `review_reason` son dos columnas comunes que la policy de escritura ya
 * protege. Se limpian las dos juntas.
 */
export async function resolverRevision(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ needs_review: false, review_reason: null })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
  await auditar(id, 'update', { diff: { needs_review: false } })
}

/**
 * El error de Postgres, en castellano.
 *
 * Un 23505 sobre el índice del CUIT no es «duplicate key value violates
 * unique constraint»: es «ese CUIT ya lo tiene otro proveedor».
 */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23505') {
    if (mensaje.includes('cuit_norm')) {
      return 'Ese CUIT ya lo tiene otro proveedor de esta empresa.'
    }
    if (mensaje.includes('legacy_ref')) {
      return 'Esa referencia PROV ya está en uso.'
    }
    return `Ese dato ya existe: ${mensaje}`
  }
  if (codigo === '23514' && mensaje.includes('country_code')) {
    return 'El país va con su código de dos letras en mayúsculas: AR, ES, IT…'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Compras es de administradores y empleados.'
  }
  return mensaje
}
