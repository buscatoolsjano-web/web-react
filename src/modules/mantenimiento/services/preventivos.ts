import { supabase } from '@/services/supabase/client'
import { preventivosAAvisar, type OrdenParaPreventivo, type PreventivoAAvisar } from '../lib/preventivos'

export interface PreventivoDelPanel extends PreventivoAAvisar {
  equipo: string
  cliente: string | null
}

/** Una página de órdenes por vez: PostgREST corta en 1.000 filas sin avisar. */
const PAGINA = 1000

/**
 * Los preventivos vencidos o por vencer de la empresa, para el aviso del
 * inicio. Dos lecturas livianas: las órdenes (sólo las cinco columnas que
 * deciden) y, de los equipos que avisan, con qué se los nombra.
 */
export async function preventivosDelPanel(companyId: string, hoy: string): Promise<PreventivoDelPanel[]> {
  const ordenes: OrdenParaPreventivo[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from('maintenance_orders')
      .select('asset_id, created_at, closed_at, next_preventive_date')
      .eq('company_id', companyId)
      .not('asset_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(desde, desde + PAGINA - 1)
    if (error) throw new Error(`No se pudieron leer las órdenes de mantenimiento: ${error.message}`)
    const filas = data ?? []
    for (const f of filas) {
      if (!f.asset_id) continue
      ordenes.push({
        assetId: f.asset_id,
        creada: f.created_at,
        cerrada: f.closed_at !== null,
        proximoPreventivo: f.next_preventive_date,
      })
    }
    if (filas.length < PAGINA) break
  }

  const avisos = preventivosAAvisar(ordenes, hoy)
  if (avisos.length === 0) return []

  const { data, error } = await supabase
    .from('maintenance_assets')
    .select('id, reference, name, brand_text, model_text, serial_number, deleted_at, dueno:customers!owner_customer_id ( legal_name )')
    .in(
      'id',
      avisos.map((a) => a.assetId),
    )
  if (error) throw new Error(`No se pudieron leer los equipos: ${error.message}`)

  type Fila = {
    id: string
    reference: string | null
    name: string | null
    brand_text: string | null
    model_text: string | null
    serial_number: string | null
    deleted_at: string | null
    dueno: { legal_name: string | null } | null
  }
  const porId = new Map(((data ?? []) as unknown as Fila[]).map((a) => [a.id, a]))

  return avisos.flatMap((a) => {
    const eq = porId.get(a.assetId)
    // Un equipo dado de baja no necesita preventivo.
    if (!eq || eq.deleted_at) return []
    const modelo = [eq.brand_text, eq.model_text].filter(Boolean).join(' ')
    const equipo =
      [eq.reference ?? eq.name ?? modelo, eq.serial_number ? `N/S ${eq.serial_number}` : null]
        .filter(Boolean)
        .join(' · ') || 'Equipo sin nombre'
    return [{ ...a, equipo, cliente: eq.dueno?.legal_name ?? null }]
  })
}
