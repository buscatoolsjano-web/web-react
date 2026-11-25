import { supabase } from '@/services/supabase/client'

/**
 * Las consultas de cotización del sitio público, del lado del ERP
 * (Fase 87 · E4).
 *
 * «Cuando se envía la consulta, que nos llegue a nosotros en el ERP.»
 *
 * Llegan a `public_quote_requests`, que escribe la Edge Function sin sesión
 * —ver `supabase/functions/cotizar-publico`—. Acá se LEEN y se ATIENDEN, y
 * por eso es una consulta directa a la tabla y no una función: la RLS ya
 * limita las filas a la empresa de quien mira, y `authenticated` tiene
 * `select` y `update` sobre esta tabla y nada más. Insertar y borrar no: los
 * pedidos nacen afuera y no se borran, se cierran.
 */

export type EstadoConsulta = 'nueva' | 'contactada' | 'cerrada'

export interface ItemConsulta {
  sku: string
  nombre: string
  cantidad: number
}

export interface Consulta {
  id: string
  cuando: string
  nombre: string
  email: string
  empresa: string | null
  telefono: string | null
  mensaje: string | null
  items: ItemConsulta[]
  cantidadItems: number
  estado: EstadoConsulta
  notaInterna: string | null
  /** La cotización armada desde esta consulta, si la hay (2026-11). */
  cotizacion: { id: string; numero: string } | null
}

/** Texto de un valor crudo, que es de la base y podría venir mal tipado. */
const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')

function filaAConsulta(f: Record<string, unknown>): Consulta {
  const crudos = Array.isArray(f['items']) ? (f['items'] as unknown[]) : []
  return {
    id: cadena(f['id']),
    cuando: cadena(f['created_at']),
    nombre: cadena(f['nombre']),
    email: cadena(f['email']),
    empresa: (f['empresa'] as string | null) ?? null,
    telefono: (f['telefono'] as string | null) ?? null,
    mensaje: (f['mensaje'] as string | null) ?? null,
    items: crudos.map((c) => {
      const o = (c ?? {}) as Record<string, unknown>
      return {
        sku: cadena(o['sku']),
        nombre: cadena(o['nombre']) || cadena(o['sku']),
        cantidad: Number(o['cantidad']) || 0,
      }
    }),
    cantidadItems: Number(f['cantidad_items']) || 0,
    estado: (f['estado'] as EstadoConsulta) ?? 'nueva',
    notaInterna: (f['nota_interna'] as string | null) ?? null,
    cotizacion: (() => {
      const q = f['cotizacion'] as { id?: string; number?: string } | null
      return q?.id ? { id: q.id, numero: q.number ?? '' } : null
    })(),
  }
}

const COLUMNAS =
  'id, created_at, nombre, email, empresa, telefono, mensaje, items, cantidad_items, estado, nota_interna, cotizacion:sales_quotes!quote_id ( id, number )'

/** Las consultas de la empresa, las más nuevas primero. */
export async function listarConsultas(
  companyId: string,
  estado?: EstadoConsulta | 'todas',
): Promise<Consulta[]> {
  let q = supabase
    .from('public_quote_requests')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (estado && estado !== 'todas') q = q.eq('estado', estado)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer las consultas: ${error.message}`)
  return (data ?? []).map((f) => filaAConsulta(f as Record<string, unknown>))
}

/** Cuántas están sin atender. Es el número del aviso. */
export async function contarConsultasNuevas(companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('public_quote_requests')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('estado', 'nueva')
  if (error) return 0
  return count ?? 0
}

/**
 * Cambiar el estado de una consulta, y de paso dejar constancia de quién la
 * atendió y cuándo. La RLS comprueba que sea de la empresa de quien escribe.
 */
export async function marcarConsulta(
  id: string,
  estado: EstadoConsulta,
  nota?: string | null,
): Promise<void> {
  const parche = {
    estado,
    atendida_en: new Date().toISOString(),
    atendida_por: (await supabase.auth.getUser()).data.user?.id ?? null,
    ...(nota !== undefined ? { nota_interna: nota } : {}),
  }

  const { error } = await supabase.from('public_quote_requests').update(parche).eq('id', id)
  if (error) throw new Error(`No se pudo actualizar la consulta: ${error.message}`)
}

// ── De la consulta a la cotización (2026-11) ────────────────────────────────
//
// «Convertir una consulta del sitio en cotización con un clic.» El clic lleva
// a «Nueva cotización» con todo cargado: el cliente si ya existe, los
// productos con el precio de su tarifa y el mensaje en las observaciones. La
// cotización se crea en esa pantalla, la única que crea documentos de venta,
// y al guardarla queda vinculada a la consulta (`quote_id`).

export async function obtenerConsulta(id: string): Promise<Consulta | null> {
  const { data, error } = await supabase.from('public_quote_requests').select(COLUMNAS).eq('id', id).maybeSingle()
  if (error) throw new Error(`No se pudo leer la consulta: ${error.message}`)
  return data ? filaAConsulta(data) : null
}

export interface ClienteDeConsulta {
  id: string
  nombre: string
  /** Cómo se lo encontró, para decirlo en pantalla. */
  por: 'email' | 'dominio' | 'nombre'
  /** Su tarifa, para poner los precios con ella y no con la de la empresa. */
  listaPrecioId: string | null
}

/** Dominios de correo personales: compartirlos no dice nada de la empresa. */
const DOMINIOS_PERSONALES = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.ar', 'live.com', 'icloud.com',
  'hotmail.com.ar', 'outlook.com.ar', 'live.com.ar', 'msn.com', 'protonmail.com',
])

/**
 * El cliente que ya existe para esta consulta, si se lo puede reconocer sin
 * adivinar: por el email exacto (de un contacto o del cliente), por el dominio
 * del correo de la empresa, o por la razón social escrita igual. Si no, null:
 * la persona lo elige o lo da de alta. Nunca se crea un cliente solo.
 */
export async function clienteDeConsulta(
  companyId: string,
  email: string,
  empresa: string | null,
): Promise<ClienteDeConsulta | null> {
  const correo = email.trim().toLowerCase()
  type Fila = { id: string; legal_name: string | null; trade_name: string | null; default_price_list_id: string | null }
  const aCliente = (c: Fila, por: ClienteDeConsulta['por']): ClienteDeConsulta => ({
    id: c.id,
    nombre: c.trade_name || c.legal_name || 'Cliente',
    por,
    listaPrecioId: c.default_price_list_id,
  })

  if (correo) {
    const [contacto, directo] = await Promise.all([
      supabase
        .from('customer_contacts')
        .select('customer_id, customers!inner ( id, legal_name, trade_name, default_price_list_id, deleted_at )')
        .eq('company_id', companyId)
        .ilike('email', correo)
        .is('customers.deleted_at', null)
        .limit(1),
      supabase
        .from('customers')
        .select('id, legal_name, trade_name, default_price_list_id')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .contains('emails', [correo])
        .limit(1),
    ])
    const c = (contacto.data?.[0] as unknown as { customers: Fila } | undefined)?.customers
    if (c) return aCliente(c, 'email')
    const d = directo.data?.[0]
    if (d) return aCliente(d, 'email')

    const dominio = correo.split('@')[1] ?? ''
    if (dominio && !DOMINIOS_PERSONALES.has(dominio)) {
      const { data } = await supabase
        .from('customers')
        .select('id, legal_name, trade_name, default_price_list_id')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .contains('email_domains', [dominio])
        .limit(2)
      // Dos clientes con el mismo dominio: no se elige por la persona.
      if (data && data.length === 1 && data[0]) return aCliente(data[0], 'dominio')
    }
  }

  const razon = empresa?.trim()
  if (razon) {
    const { data } = await supabase
      .from('customers')
      .select('id, legal_name, trade_name, default_price_list_id')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      // Entre comillas: una razón social tiene espacios, puntos y comas.
      .or(`legal_name.ilike."${razon.replace(/"/g, '')}",trade_name.ilike."${razon.replace(/"/g, '')}"`)
      .limit(2)
    if (data && data.length === 1 && data[0]) return aCliente(data[0], 'nombre')
  }
  return null
}

/** Los productos de la consulta, por SKU (el sitio manda SKUs, no ids). */
export async function idsPorSku(companyId: string, skus: readonly string[]): Promise<Map<string, string>> {
  if (skus.length === 0) return new Map()
  const { data, error } = await supabase
    .from('products')
    .select('id, sku')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('sku', [...skus])
  if (error) throw new Error(`No se pudieron leer los productos: ${error.message}`)
  return new Map((data ?? []).map((p) => [p.sku, p.id]))
}

/**
 * Deja la consulta vinculada a la cotización. Si estaba «nueva» pasa a
 * «contactada»: ya se está respondiendo, y así deja de contar en el aviso.
 */
export async function vincularConsulta(consultaId: string, quoteId: string, estadoActual: EstadoConsulta): Promise<void> {
  const { error } = await supabase
    .from('public_quote_requests')
    .update({
      quote_id: quoteId,
      ...(estadoActual === 'nueva'
        ? {
            estado: 'contactada',
            atendida_en: new Date().toISOString(),
            atendida_por: (await supabase.auth.getUser()).data.user?.id ?? null,
          }
        : {}),
    })
    .eq('id', consultaId)
  if (error) throw new Error(`No se pudo vincular la consulta: ${error.message}`)
}
