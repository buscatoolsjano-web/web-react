import { supabase } from '@/services/supabase/client'
import type { TablesUpdate } from '@/types/database.types'
import type { CatalogoParseado, ColumnaDetectada } from '../lib/importarCatalogo'

/**
 * Aplica una importación de catálogo (Fase 111).
 *
 * Matchea por SKU contra los productos de la empresa activa y actualiza las
 * columnas elegidas: nombre, serie, tipo, marca (por nombre → id), categoría
 * (por nombre → id) y los atributos. NO toca precio (lo administra STEL), stock
 * ni la pertenencia al catálogo. Un SKU que no existe se informa, no se crea.
 *
 * Cada producto se actualiza con su propio `update` bajo la RLS de quien
 * importa —así respeta los permisos de edición—; para unos cientos de filas es
 * un viaje por fila y alcanza. Las celdas vacías NO borran: se saltean, para que
 * una planilla con columnas a medio llenar no vacíe datos sin querer.
 */
export interface ResultadoImport {
  actualizados: number
  sinCambios: number
  /** SKUs del archivo que no existen en el catálogo. */
  noEncontrados: string[]
  errores: { sku: string; motivo: string }[]
  /** Las claves que efectivamente se aplicaron. */
  columnasAplicadas: string[]
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export async function aplicarImportacion(
  companyId: string,
  parseado: CatalogoParseado,
  clavesElegidas: ReadonlySet<string>,
  onAvance?: (hechas: number, total: number) => void,
): Promise<ResultadoImport> {
  const aplicar = parseado.columnas.filter((c) => c.elegible && clavesElegidas.has(c.clave))
  const campos = aplicar.filter((c) => c.destino.tipo === 'campo')
  const atributos = aplicar.filter((c) => c.destino.tipo === 'atributo')
  const usaMarca = aplicar.some((c) => c.destino.tipo === 'marca')
  const usaCategoria = aplicar.some((c) => c.destino.tipo === 'categoria')

  const skus = [...new Set(parseado.filas.map((f) => f.sku))]
  // Productos existentes por SKU (paginado: `.in()` con miles de valores revienta la URL).
  const porSku = new Map<string, { id: string; attributes: Record<string, unknown> }>()
  for (let i = 0; i < skus.length; i += 300) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, attributes')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .in('sku', skus.slice(i, i + 300))
    if (error) throw new Error(`No se pudieron leer los productos: ${error.message}`)
    for (const p of data ?? []) porSku.set(p.sku, { id: p.id, attributes: (p.attributes as Record<string, unknown>) ?? {} })
  }

  // Mapas nombre → id, sólo si hacen falta.
  const marcaPorNombre = new Map<string, string>()
  if (usaMarca) {
    const { data } = await supabase.from('brands').select('id, name').eq('company_id', companyId)
    for (const b of data ?? []) marcaPorNombre.set(norm(b.name), b.id)
  }
  const categoriaPorNombre = new Map<string, string>()
  if (usaCategoria) {
    const { data } = await supabase.from('product_categories').select('id, name').eq('company_id', companyId)
    for (const c of data ?? []) categoriaPorNombre.set(norm(c.name), c.id)
  }

  const res: ResultadoImport = {
    actualizados: 0, sinCambios: 0, noEncontrados: [], errores: [],
    columnasAplicadas: aplicar.map((c) => c.clave),
  }

  let hechas = 0
  for (const fila of parseado.filas) {
    const prod = porSku.get(fila.sku)
    if (!prod) { res.noEncontrados.push(fila.sku); hechas++; onAvance?.(hechas, parseado.filas.length); continue }

    const patch: Record<string, unknown> = {}
    // Campos de texto (vacío = no tocar).
    for (const c of campos) {
      const v = fila.valores[c.clave]?.trim() ?? ''
      if (v !== '' && c.destino.tipo === 'campo') patch[c.destino.campo] = v
    }
    // Marca / categoría: resolver nombre → id; nombre que no existe = error de fila.
    let errorFila: string | null = null
    if (usaMarca) {
      const v = (fila.valores['marca'] ?? '').trim()
      if (v !== '') {
        const id = marcaPorNombre.get(norm(v))
        if (!id) errorFila = `Marca «${v}» no existe en el catálogo.`
        else patch['brand_id'] = id
      }
    }
    if (!errorFila && usaCategoria) {
      const v = (fila.valores['categoria'] ?? '').trim()
      if (v !== '') {
        const id = categoriaPorNombre.get(norm(v))
        if (!id) errorFila = `Categoría «${v}» no existe en el catálogo.`
        else patch['category_id'] = id
      }
    }
    // Atributos: se mergean sobre los existentes (vacío = no tocar esa clave).
    if (!errorFila && atributos.length > 0) {
      const attrs = { ...prod.attributes }
      let cambio = false
      for (const c of atributos) {
        if (c.destino.tipo !== 'atributo') continue
        const v = (fila.valores[c.clave] ?? '').trim()
        // El valor actual sólo cuenta como «igual» si ya es un string igual; un
        // objeto u otro tipo se considera distinto y se pisa con el del archivo.
        const actual = attrs[c.destino.key]
        if (v !== '' && (typeof actual !== 'string' || actual !== v)) { attrs[c.destino.key] = v; cambio = true }
      }
      if (cambio) patch['attributes'] = attrs
    }

    if (errorFila) { res.errores.push({ sku: fila.sku, motivo: errorFila }); hechas++; onAvance?.(hechas, parseado.filas.length); continue }
    if (Object.keys(patch).length === 0) { res.sinCambios++; hechas++; onAvance?.(hechas, parseado.filas.length); continue }

    const { error } = await supabase.from('products').update(patch as TablesUpdate<'products'>).eq('id', prod.id)
    if (error) res.errores.push({ sku: fila.sku, motivo: error.message })
    else res.actualizados++
    hechas++
    onAvance?.(hechas, parseado.filas.length)
  }

  return res
}

/** Las columnas que se van a aplicar, para el resumen del modal. */
export function resumenColumnas(columnas: readonly ColumnaDetectada[], elegidas: ReadonlySet<string>): string {
  const n = columnas.filter((c) => c.elegible && elegidas.has(c.clave)).map((c) => c.etiqueta)
  return n.length > 0 ? n.join(', ') : 'ninguna'
}
