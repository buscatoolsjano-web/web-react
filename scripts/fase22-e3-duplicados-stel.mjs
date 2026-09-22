/**
 * Fase 22 · Data Quality E3 — Auditoría de los 226 duplicados STEL ↔ catálogo.
 *
 * El hallazgo de la auditoría anterior: esos 226 productos «sin marca» no son
 * productos mal clasificados. Son el MISMO producto cargado dos veces — una
 * por el catálogo técnico (`AP.EX-508-18`) y otra por la API de STEL
 * (`PRO00249`) —, y la evidencia que prueba la marca es, literalmente, el otro
 * producto.
 *
 * Esto decide cuál de los dos registros debe quedar operativo. No aplica nada:
 * propone, con la evidencia de los dos lados a la vista.
 *
 *   node scripts/fase22-e3-duplicados-stel.mjs <pares.json> [--json out.json] [--csv out.csv]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

/** Lo que se mira de cada lado para decidir. */
const COLUMNAS = `
  id, sku, name, model_code, status, needs_review, attributes, series,
  product_type, description, description_long, origin_country, ncm_code,
  weight_g, volume_cm3, created_at, external_source, external_id, legacy_ref,
  brand_id, category_id,
  brands ( name, is_active ),
  product_categories ( name, slug ),
  product_images ( id, kind, is_primary ),
  product_prices ( amount, price_list_id ),
  stock_balances ( on_hand, reserved )
`

async function porSkus(sb, skus) {
  const filas = []
  for (let i = 0; i < skus.length; i += 200) {
    const { data, error } = await sb.from('products').select(COLUMNAS).in('sku', skus.slice(i, i + 200)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
  }
  return new Map(filas.map((f) => [f.sku, f]))
}

/**
 * Cuántas veces aparece cada producto en documentos.
 *
 * Es el dato que cambia la estrategia: un duplicado sin historia se puede
 * retirar sin más; uno con veinte cotizaciones encima no.
 */
async function historia(sb, ids) {
  const cuenta = new Map(ids.map((id) => [id, { cotizaciones: 0, pedidos: 0, remitos: 0, movimientos: 0 }]))
  const tablas = [
    ['sales_quote_lines', 'cotizaciones'],
    ['sales_order_lines', 'pedidos'],
    ['delivery_lines', 'remitos'],
    ['stock_movements', 'movimientos'],
  ]
  for (const [tabla, clave] of tablas) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from(tabla).select('product_id').in('product_id', ids.slice(i, i + 200))
      if (error) throw new Error(`${tabla}: ${error.message}`)
      for (const r of data ?? []) {
        const c = cuenta.get(r.product_id)
        if (c) c[clave]++
      }
    }
  }
  return cuenta
}

/** Suma de saldos. `null` = sin saldo registrado, que NO es cero. */
export function stockDe(p) {
  const filas = p?.stock_balances ?? []
  if (filas.length === 0) return null
  return filas.reduce((a, f) => ({ real: a.real + f.on_hand, reservado: a.reservado + f.reserved }), { real: 0, reservado: 0 })
}

/** Cuántas señales de ficha técnica tiene un producto. */
export function riquezaTecnica(p) {
  if (!p) return 0
  const attrs = p.attributes && typeof p.attributes === 'object' ? Object.keys(p.attributes).length : 0
  return (
    (p.brand_id ? 2 : 0) +
    (attrs > 0 ? 2 : 0) +
    (p.series ? 1 : 0) +
    (p.product_type ? 1 : 0) +
    ((p.product_images ?? []).length > 0 ? 2 : 0) +
    (p.description_long ? 1 : 0) +
    (p.ncm_code ? 1 : 0)
  )
}

/**
 * Cuál de los dos debería quedar operativo.
 *
 * El técnico gana por ficha: marca, atributos, imagen, serie. Pero la decisión
 * NO es automática cuando el de STEL es el que tiene la historia comercial o
 * el stock: ahí hay que mirar el par a mano, porque retirar el registro al que
 * apuntan veinte documentos es otra conversación.
 */
export function decidir(stel, tecnico, hStel, hTec) {
  if (!stel || !tecnico) return { canonico: null, motivo: 'falta un lado del par', revisar: true }

  const rStel = riquezaTecnica(stel)
  const rTec = riquezaTecnica(tecnico)
  const stockStel = stockDe(stel)
  const docsStel = hStel.cotizaciones + hStel.pedidos + hStel.remitos

  if (rTec <= rStel) {
    return { canonico: null, motivo: `el de STEL no tiene menos ficha (${rStel} vs ${rTec})`, revisar: true }
  }

  // El técnico tiene mejor ficha. La pregunta es qué pasa con el otro.
  if (stockStel !== null && stockStel.real !== 0) {
    return { canonico: tecnico.sku, motivo: 'el técnico tiene la ficha, pero el de STEL tiene SALDO de stock', revisar: true }
  }
  if (docsStel > 0) {
    return {
      canonico: tecnico.sku,
      motivo: `el técnico tiene la ficha; el de STEL tiene ${docsStel} documento(s) y hay que conservarlos`,
      revisar: false,
      conHistoria: true,
    }
  }
  return { canonico: tecnico.sku, motivo: 'el técnico tiene la ficha y el de STEL no tiene historia ni stock', revisar: false }
}

async function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null)
  const rutaPares = process.argv[2]
  if (!rutaPares || rutaPares.startsWith('--')) throw new Error('falta la ruta de pares.json')

  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const pares = JSON.parse(readFileSync(rutaPares, 'utf8'))
  const skus = [...new Set(pares.flatMap((p) => [p.stel_sku, p.tecnico_sku]))]
  const porSku = await porSkus(sb, skus)
  const ids = [...porSku.values()].map((p) => p.id)
  const hist = await historia(sb, ids)

  const vacia = { cotizaciones: 0, pedidos: 0, remitos: 0, movimientos: 0 }
  const analizados = pares.map((par) => {
    const stel = porSku.get(par.stel_sku)
    const tecnico = porSku.get(par.tecnico_sku)
    const hStel = (stel && hist.get(stel.id)) || vacia
    const hTec = (tecnico && hist.get(tecnico.id)) || vacia
    const d = decidir(stel, tecnico, hStel, hTec)
    return {
      stel_sku: par.stel_sku,
      stel_id: stel?.id ?? null,
      tecnico_sku: par.tecnico_sku,
      tecnico_id: tecnico?.id ?? null,
      marca: tecnico?.brands?.name ?? par.marca_propuesta,
      ficha: { stel: riquezaTecnica(stel), tecnico: riquezaTecnica(tecnico) },
      historia: { stel: hStel, tecnico: hTec },
      stock: { stel: stockDe(stel), tecnico: stockDe(tecnico) },
      creado: { stel: stel?.created_at?.slice(0, 10) ?? null, tecnico: tecnico?.created_at?.slice(0, 10) ?? null },
      origen: { stel: stel?.external_source ?? null, tecnico: tecnico?.external_source ?? null },
      ...d,
    }
  })

  const docs = (h) => h.cotizaciones + h.pedidos + h.remitos
  const conHistoria = analizados.filter((a) => docs(a.historia.stel) > 0)
  const conStock = analizados.filter((a) => a.stock.stel !== null)
  const sinUso = analizados.filter((a) => docs(a.historia.stel) === 0 && a.stock.stel === null && a.historia.stel.movimientos === 0)

  // Un producto técnico puede ser canónico de VARIOS duplicados de STEL.
  const porCanonico = new Map()
  for (const a of analizados) {
    if (!a.canonico) continue
    porCanonico.set(a.canonico, (porCanonico.get(a.canonico) ?? 0) + 1)
  }
  const canonicosMultiples = [...porCanonico.entries()].filter(([, n]) => n > 1)

  const informe = {
    generado: new Date().toISOString(),
    DUPLICATE_PAIRS: analizados.length,
    CANONICAL_TECHNICAL: analizados.filter((a) => a.canonico && !a.revisar).length,
    CANONICAL_STEL: 0,
    UNDECIDABLE: analizados.filter((a) => a.revisar).length,
    DUPLICATES_WITH_HISTORY: conHistoria.length,
    DUPLICATES_WITH_STOCK: conStock.length,
    DUPLICATES_UNUSED: sinUso.length,
    CANONICOS_CON_VARIOS_DUPLICADOS: canonicosMultiples.length,
    DOCUMENTOS_QUE_APUNTAN_AL_DUPLICADO: conHistoria.reduce((n, a) => n + docs(a.historia.stel), 0),
    MOVIMIENTOS_DEL_DUPLICADO: analizados.reduce((n, a) => n + a.historia.stel.movimientos, 0),
    MOTIVOS_DE_REVISION: Object.fromEntries(
      Object.entries(
        analizados
          .filter((a) => a.revisar)
          .reduce((m, a) => ({ ...m, [a.motivo]: (m[a.motivo] ?? 0) + 1 }), {}),
      ).sort((x, y) => y[1] - x[1]),
    ),
    EJEMPLOS: analizados.slice(0, 5).map((a) => ({
      par: `${a.stel_sku} → ${a.tecnico_sku}`,
      ficha: `${a.ficha.stel} vs ${a.ficha.tecnico}`,
      docsDelDuplicado: docs(a.historia.stel),
      stockDelDuplicado: a.stock.stel,
      decision: a.canonico ? `canónico ${a.canonico}` : 'revisar',
      motivo: a.motivo,
    })),
    DB_CHANGES_APPLIED: 0,
    PRODUCTS_CHANGED: 0,
  }

  console.log(JSON.stringify(informe, null, 2))

  const salidaJson = arg('--json')
  if (salidaJson) writeFileSync(salidaJson, JSON.stringify({ informe, analizados }, null, 2))
  const salidaCsv = arg('--csv')
  if (salidaCsv) {
    const cols = ['stel_sku', 'stel_id', 'tecnico_sku', 'tecnico_id', 'marca', 'ficha_stel', 'ficha_tecnico',
      'docs_stel', 'movimientos_stel', 'stock_stel', 'docs_tecnico', 'stock_tecnico',
      'canonico', 'requiere_revision', 'motivo']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const filas = analizados.map((a) => ({
      stel_sku: a.stel_sku, stel_id: a.stel_id, tecnico_sku: a.tecnico_sku, tecnico_id: a.tecnico_id,
      marca: a.marca, ficha_stel: a.ficha.stel, ficha_tecnico: a.ficha.tecnico,
      docs_stel: docs(a.historia.stel), movimientos_stel: a.historia.stel.movimientos,
      stock_stel: a.stock.stel === null ? 'sin saldo registrado' : a.stock.stel.real,
      docs_tecnico: docs(a.historia.tecnico),
      stock_tecnico: a.stock.tecnico === null ? 'sin saldo registrado' : a.stock.tecnico.real,
      canonico: a.canonico ?? '', requiere_revision: a.revisar ? 'SI' : 'no', motivo: a.motivo,
    }))
    writeFileSync(salidaCsv, [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n'))
    console.error(`\n${filas.length} pares → ${salidaCsv}. NADA aplicado.`)
  }
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (esteArchivo.endsWith(invocado)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
