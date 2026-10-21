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
  }
}

const COLUMNAS =
  'id, created_at, nombre, email, empresa, telefono, mensaje, items, cantidad_items, estado, nota_interna'

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
