import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'
import type { DatosCliente, DatosContacto, DatosDireccion } from '../lib/validacion'
import { normalizarDominios, normalizarEmails } from '../lib/validacion'

/**
 * Escrituras del módulo de Clientes.
 *
 * Nada de esto decide quién puede hacerlo: eso es RLS. `customers` deja
 * insertar y editar a admin, employee y salesperson —el vendedor, sólo los
 * suyos—, y desde la entrega 3 `customer_contacts` y `customer_addresses`
 * siguen exactamente la misma regla: quien puede editar al cliente administra
 * su agenda. Un rol externo choca contra la policy, no contra un botón
 * escondido.
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

/** Lo que dice el servidor → lo que lee una persona (Fase 17 · E1). */
export const MOTIVOS_CLIENTE: Record<string, string> = {
  CONFLICTO_DE_EDICION:
    'Alguien más guardó este cliente mientras lo editabas. Recargá para ver los cambios; lo tuyo no se perdió.',
  CLIENTE_DADO_DE_BAJA: 'El cliente está dado de baja: primero reactivalo.',
  CLIENTE_INEXISTENTE: 'No encontramos el cliente.',
  SIN_PERMISO: 'Tu rol no edita este cliente.',
  CAMPO_NO_EDITABLE: 'Se intentó cambiar un campo que no se edita.',
  RAZON_SOCIAL_REQUERIDA: 'La razón social no puede quedar vacía.',
  TIPO_INVALIDO: 'El tipo de cliente no es válido.',
  CUIT_INVALIDO: 'El CUIT tiene que tener 11 dígitos.',
  VENDEDOR_INVALIDO: 'Ese usuario no puede ser vendedor de esta empresa.',
  VENDEDOR_NO_EDITABLE: 'Un vendedor no puede reasignar su propio cliente.',
  TARIFA_INVALIDA: 'Esa tarifa no es de esta empresa.',
  MONEDA_INVALIDA: 'Esa moneda no existe.',
  uq_customers_cuit_norm: 'Ese CUIT ya lo tiene otro cliente de la empresa.',
  idx_customers_taxid: 'Ese CUIT ya lo tiene otro cliente de la empresa.',
}

/** Un fallo con su código, para que la pantalla sepa si fue un conflicto. */
export class FalloDeCliente extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloDeCliente'
  }
  /** Un conflicto se resuelve recargando, no reintentando. */
  get esConflicto(): boolean {
    return this.codigo === 'CONFLICTO_DE_EDICION'
  }
}

function falloDeCliente(mensaje: string): FalloDeCliente {
  const codigo = Object.keys(MOTIVOS_CLIENTE).find((c) => mensaje.includes(c))
  return new FalloDeCliente(
    codigo ?? 'error_interno',
    codigo ? MOTIVOS_CLIENTE[codigo]! : 'No se pudo guardar el cliente.',
  )
}

export interface ResultadoGuardadoCliente {
  /** El nuevo testigo de concurrencia: se guarda para la próxima edición. */
  actualizadoEn: string
  campos: number
  sinCambios: boolean
}

/**
 * Guarda el cliente en UNA transacción (Fase 17 · E1).
 *
 * Es el único camino de escritura de la ficha. Antes era un `update` armado en
 * el navegador: sin testigo de concurrencia —gana el último que guarda—, sin
 * validar el vendedor ni la tarifa, y sin dejar rastro de qué cambió.
 *
 * `esperado` es el `updated_at` que se leyó al entrar en edición. Si alguien
 * guardó en el medio, el servidor corta con `CONFLICTO_DE_EDICION` en vez de
 * pisarlo, y el borrador queda intacto en pantalla.
 *
 * Se manda la whitelist completa y el servidor calcula qué cambió: guardar sin
 * cambios contesta `sinCambios` y no toca ni `updated_at` ni la auditoría.
 */
export async function guardarCliente(
  clienteId: string,
  esperado: string,
  datos: DatosCliente,
): Promise<ResultadoGuardadoCliente> {
  const { data, error } = await supabase.rpc('guardar_cliente', {
    p_customer: clienteId,
    p_esperado: esperado,
    p_datos: {
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
      salesperson_id: vacioANulo(datos.vendedorId),
      default_price_list_id: vacioANulo(datos.tarifaId),
      notes: vacioANulo(datos.notas),
    } as unknown as Json,
  })
  if (error) throw falloDeCliente(error.message)

  const r = data as unknown as {
    actualizado_en: string
    campos: number
    sin_cambios: boolean
  }
  return { actualizadoEn: r.actualizado_en, campos: r.campos, sinCambios: r.sin_cambios }
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

// ── La agenda del cliente: contactos y direcciones ─────────────────────────

/**
 * Lo que dice el servidor sobre la agenda → lo que lee una persona.
 *
 * Va aparte de `MOTIVOS_CLIENTE` porque hay códigos que significan otra cosa
 * acá: `TIPO_INVALIDO` en un cliente es el tipo de cliente y en una dirección
 * es el tipo de dirección.
 */
export const MOTIVOS_AGENDA: Record<string, string> = {
  CONFLICTO_DE_EDICION:
    'Alguien más lo guardó mientras lo editabas. Recargá para ver los cambios; lo tuyo no se perdió.',
  SIN_PERMISO: 'Tu rol no administra la agenda de este cliente.',
  CAMPO_NO_EDITABLE: 'Se intentó cambiar un campo que no se edita.',
  CLIENTE_INEXISTENTE: 'No encontramos el cliente.',
  CONTACTO_INEXISTENTE: 'Ese contacto ya no existe: recargá la ficha.',
  DIRECCION_INEXISTENTE: 'Esa dirección ya no existe: recargá la ficha.',
  CONTACTO_DE_OTRO_CLIENTE: 'Ese contacto no es de este cliente.',
  DIRECCION_DE_OTRO_CLIENTE: 'Esa dirección no es de este cliente.',
  CONTACTO_REFERENCIADO:
    'Este contacto figura en documentos ya emitidos, así que no se borra. Desactivalo: deja de ofrecerse en documentos nuevos y los viejos lo siguen nombrando.',
  DIRECCION_REFERENCIADA:
    'Esta dirección figura en pedidos ya emitidos, así que no se borra. Desactivala: deja de ofrecerse y los pedidos viejos la siguen nombrando.',
  NOMBRE_REQUERIDO: 'El nombre del contacto no puede quedar vacío.',
  CALLE_REQUERIDA: 'La calle no puede quedar vacía.',
  TIPO_INVALIDO: 'Ese tipo de dirección no es válido.',
  PAIS_INVALIDO: 'El país va con su código de dos letras: AR, BR, UY…',
}

/** Un fallo de la agenda, con su código: la pantalla decide qué ofrecer. */
export class FalloDeAgenda extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloDeAgenda'
  }
  /** Un conflicto se resuelve recargando, no reintentando. */
  get esConflicto(): boolean {
    return this.codigo === 'CONFLICTO_DE_EDICION'
  }
  /** Referenciado: no se borra, se desactiva. La pantalla lo ofrece. */
  get esReferenciado(): boolean {
    return this.codigo === 'CONTACTO_REFERENCIADO' || this.codigo === 'DIRECCION_REFERENCIADA'
  }
}

function falloDeAgenda(mensaje: string, porDefecto: string): FalloDeAgenda {
  const codigo = Object.keys(MOTIVOS_AGENDA).find((c) => mensaje.includes(c))
  return new FalloDeAgenda(codigo ?? 'error_interno', codigo ? MOTIVOS_AGENDA[codigo]! : porDefecto)
}

export interface ResultadoAgenda {
  id: string
  /** El nuevo testigo de concurrencia. */
  actualizadoEn: string
  campos: number
  sinCambios: boolean
}

function leerResultado(data: unknown): ResultadoAgenda {
  const r = data as { id: string; actualizado_en: string; campos: number; sin_cambios: boolean }
  return {
    id: r.id,
    actualizadoEn: r.actualizado_en,
    campos: r.campos,
    sinCambios: r.sin_cambios,
  }
}

/**
 * Guarda un contacto en UNA transacción (Fase 17 · E3).
 *
 * Antes eran dos escrituras desde el navegador: primero bajar el principal
 * anterior y después insertar el nuevo. Entre las dos, el cliente podía quedar
 * **sin ningún principal** —si la segunda fallaba— o con dos, si dos personas
 * marcaban a la vez. Ahora el principal se resuelve dentro de la misma
 * transacción que el alta.
 *
 * `esperado` es el `updated_at` que se leyó al abrir el formulario: null en un
 * alta. Si alguien guardó en el medio, el servidor corta con
 * `CONFLICTO_DE_EDICION` en vez de pisarlo.
 */
export async function guardarContacto(
  clienteId: string,
  contactoId: string | null,
  esperado: string | null,
  datos: DatosContacto,
): Promise<ResultadoAgenda> {
  const { data, error } = await supabase.rpc('guardar_contacto', {
    p_customer: clienteId,
    p_contacto: contactoId,
    p_esperado: esperado,
    p_datos: {
      full_name: datos.nombre.trim(),
      role: vacioANulo(datos.cargo),
      email: vacioANulo(datos.email.toLowerCase()),
      phone: vacioANulo(datos.telefono),
      fax: vacioANulo(datos.fax),
      notes: vacioANulo(datos.notas),
      is_default: datos.esPrincipal,
      active: datos.activo,
    } as unknown as Json,
  })
  if (error) throw falloDeAgenda(error.message, 'No se pudo guardar el contacto.')
  return leerResultado(data)
}

/**
 * Borra un contacto, si nadie lo nombra.
 *
 * El servidor mira cotizaciones, pedidos, remitos, órdenes de compra del
 * cliente, conversaciones de WhatsApp e hilos de email. Si aparece en alguno,
 * corta con `CONTACTO_REFERENCIADO`: un documento emitido no puede quedar
 * apuntando a una fila que ya no existe. Para eso está desactivarlo.
 */
export async function borrarContacto(contactoId: string): Promise<void> {
  const { error } = await supabase.rpc('borrar_contacto', { p_contacto: contactoId })
  if (error) throw falloDeAgenda(error.message, 'No se pudo borrar el contacto.')
}

/** Igual que el contacto, con la principal resuelta **por tipo**. */
export async function guardarDireccion(
  clienteId: string,
  direccionId: string | null,
  esperado: string | null,
  datos: DatosDireccion,
): Promise<ResultadoAgenda> {
  const { data, error } = await supabase.rpc('guardar_direccion', {
    p_customer: clienteId,
    p_direccion: direccionId,
    p_esperado: esperado,
    p_datos: {
      kind: datos.tipo,
      street: datos.calle.trim(),
      city: vacioANulo(datos.ciudad),
      state: vacioANulo(datos.provincia),
      postal_code: vacioANulo(datos.codigoPostal),
      country_code: vacioANulo(datos.pais.toUpperCase()),
      notes: vacioANulo(datos.notas),
      is_default: datos.esPrincipal,
      active: datos.activo,
    } as unknown as Json,
  })
  if (error) throw falloDeAgenda(error.message, 'No se pudo guardar la dirección.')
  return leerResultado(data)
}

export async function borrarDireccion(direccionId: string): Promise<void> {
  const { error } = await supabase.rpc('borrar_direccion', { p_direccion: direccionId })
  if (error) throw falloDeAgenda(error.message, 'No se pudo borrar la dirección.')
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
    return `Ese dato ya existe: ${mensaje}`
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio.'
  }
  return mensaje
}
