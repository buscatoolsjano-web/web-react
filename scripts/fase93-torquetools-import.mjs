/*
 * Fase 93 · import del catálogo y los clientes de Torquetools. ESCRIBE.
 *
 * Carga la base de Torquetools (export tipo Holded) en la empresa Torquetools:
 * marcas, una lista de precio (USD), productos, precios, stock y clientes.
 * Todo con company_id de Torquetools, separado de Buscatools.
 *
 * Decidido con el usuario: se carga el catálogo COMPLETO (14.519, todas las
 * marcas — Torquetools es distribuidor multimarca) y los 880 clientes.
 *
 * Las 8 columnas de lista de precio del export son idénticas en 14.500 de
 * 14.519, así que se usa UNA lista (el precio base de venta). Las ventas y el
 * histórico vienen después por API.
 *
 * Idempotente: productos por (company_id, sku); precios/stock por producto;
 * clientes por legacy_ref. Se puede reanudar.
 *
 *   node scripts/fase93-torquetools-import.mjs <Productos.xlsx> <Clientes.xlsx> [--limit N] [--solo-productos|--solo-clientes]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import xlsx from 'xlsx'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const CID = '492a0ee9-220f-4dc8-9eaa-ec914ea10907' // Torquetools
const CAT = '445a5203-5c11-49b1-a107-9dbdea36e18d' // categoría «Herramientas»
const WH = '496c1e74-c7f0-4ab6-a3bc-09b7394094ce' // «Depósito principal»
const CREATED_BY = 'e9844579-f700-4255-83a8-d9580e1024ee' // admin

const args = process.argv.slice(2)
const files = args.filter((a) => !a.startsWith('--'))
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
const soloProd = args.includes('--solo-productos')
const soloCli = args.includes('--solo-clientes')
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const campos = (d) => { const o = {}; for (const m of String(d ?? '').matchAll(/^([A-ZÁÉÍÓÚÑ ]+):\s*(.*)$/gm)) o[m[1].trim()] = m[2].trim(); return o }
const limpiarMarca = (m) => {
  let s = String(m ?? '').trim().toUpperCase().replace(/\.REP\b|\sREP\b|\sREPUESTO\b/g, '').split(/\s+[-/]\s+/)[0].trim()
  return s === '' ? null : s
}
async function enLotes(filas, tam, fn) {
  for (let i = 0; i < filas.length; i += tam) { await fn(filas.slice(i, i + tam), i); if ((i / tam) % 10 === 0) console.log(`  ${Math.min(i + tam, filas.length)}/${filas.length}`) }
}

async function main() {
  const prodWb = xlsx.readFile(files[0])
  const cliWb = files[1] ? xlsx.readFile(files[1]) : null
  const prods = xlsx.utils.sheet_to_json(prodWb.Sheets[prodWb.SheetNames[0]], { defval: '' }).slice(0, LIMIT)
  const clis = cliWb ? xlsx.utils.sheet_to_json(cliWb.Sheets[cliWb.SheetNames[0]], { defval: '' }).slice(0, LIMIT) : []

  if (!soloCli) {
    // ── 1. Marcas ─────────────────────────────────────────────────────────────
    const marcas = new Set()
    for (const p of prods) { const m = limpiarMarca(campos(p['Descripción'])['MARCA']); if (m) marcas.add(m) }
    const { data: exist } = await sb.from('brands').select('id, name').eq('company_id', CID)
    const marcaId = new Map((exist ?? []).map((b) => [b.name.toUpperCase(), b.id]))
    const nuevas = [...marcas].filter((m) => !marcaId.has(m))
    if (nuevas.length) {
      const { data, error } = await sb.from('brands').insert(nuevas.map((name) => ({ company_id: CID, name }))).select('id, name')
      if (error) throw error
      for (const b of data) marcaId.set(b.name.toUpperCase(), b.id)
    }
    console.log(`[tt] marcas: ${marcaId.size}`)

    // ── 2. Lista de precio (USD) ──────────────────────────────────────────────
    let { data: lista } = await sb.from('price_lists').select('id').eq('company_id', CID).eq('name', 'Lista base').maybeSingle()
    if (!lista) {
      const { data, error } = await sb.from('price_lists').insert({ company_id: CID, name: 'Lista base', currency_code: 'USD', is_default: true }).select('id').single()
      if (error) throw error
      lista = data
    }
    const LISTA = lista.id

    // ── 3. Productos ──────────────────────────────────────────────────────────
    const filasProd = prods.map((p) => {
      const c = campos(p['Descripción'])
      const marca = limpiarMarca(c['MARCA'])
      return {
        company_id: CID, sku: String(p['Referencia']).trim(), name: txt(p['Nombre']) ?? String(p['Referencia']).trim(),
        model_code: txt(c['MODELO']), brand_id: marca ? (marcaId.get(marca) ?? null) : null, category_id: CAT,
        product_type: txt(c['TIPO']), origin_country: txt(c['ORIGEN']), ncm_code: txt(c['NCM']),
        description: txt(c['DESCRIPCION']) ?? txt(p['Descripción']),
        status: /^s[ií]$/i.test(String(p['Descatalogado'])) ? 'discontinued' : 'active',
        is_kit: false, legacy_ref: String(p['Referencia']).trim(), created_by: CREATED_BY,
      }
    }).filter((r) => r.sku && r.sku !== 'undefined')
    console.log(`[tt] productos a cargar: ${filasProd.length}`)
    await enLotes(filasProd, 500, async (lote) => {
      const { error } = await sb.from('products').upsert(lote, { onConflict: 'company_id,sku', ignoreDuplicates: true })
      if (error) throw error
    })

    // mapa sku → id
    const idDeSku = new Map()
    let desde = 0
    for (;;) {
      const { data, error } = await sb.from('products').select('id, sku').eq('company_id', CID).range(desde, desde + 999)
      if (error) throw error
      for (const r of data) idDeSku.set(r.sku, r.id)
      if (data.length < 1000) break
      desde += 1000
    }

    // ── 4. Precios ────────────────────────────────────────────────────────────
    const precios = prods.map((p) => {
      const id = idDeSku.get(String(p['Referencia']).trim())
      const amount = num(p['Precio base de venta'])
      return id && amount > 0 ? { company_id: CID, price_list_id: LISTA, product_id: id, amount, valid_from: '2025-10-01' } : null
    }).filter(Boolean)
    // El archivo tiene SKUs repetidos → mismo product_id. Un lote no puede tocar
    // el mismo producto dos veces: se deja uno por producto.
    { const v = new Set(); for (let i = precios.length - 1; i >= 0; i--) { if (v.has(precios[i].product_id)) precios.splice(i, 1); else v.add(precios[i].product_id) } }
    console.log(`[tt] precios: ${precios.length}`)
    await enLotes(precios, 500, async (lote) => {
      const { error } = await sb.from('product_prices').upsert(lote, { onConflict: 'price_list_id,product_id,valid_from', ignoreDuplicates: false })
      if (error) throw error
    })

    // ── 5. Stock ──────────────────────────────────────────────────────────────
    const stock = prods.map((p) => {
      const id = idDeSku.get(String(p['Referencia']).trim())
      if (!id) return null
      const real = num(p['Stock real Almacén Principal']), virt = num(p['Stock virtual Almacén Principal'])
      return { company_id: CID, product_id: id, warehouse_id: WH, on_hand: real, reserved: Math.max(0, real - virt) }
    }).filter(Boolean)
    { const v = new Set(); for (let i = stock.length - 1; i >= 0; i--) { if (v.has(stock[i].product_id)) stock.splice(i, 1); else v.add(stock[i].product_id) } }
    console.log(`[tt] stock: ${stock.length}`)
    await enLotes(stock, 500, async (lote) => {
      const { error } = await sb.from('stock_balances').upsert(lote, { onConflict: 'product_id,warehouse_id', ignoreDuplicates: false })
      if (error) throw error
    })
  }

  // ── 6. Clientes ─────────────────────────────────────────────────────────────
  if (!soloProd && clis.length) {
    const filasCli = clis.map((x) => {
      const email = txt(x['Email'])
      return {
        company_id: CID, legal_name: txt(x['Nombre jurídico']) ?? txt(x['Nombre']) ?? 'Sin nombre',
        trade_name: txt(x['Nombre']), tax_id: txt(x['CifNif']), emails: email ? [email] : [],
        phone: txt(x['Teléfono 1']), payment_terms: txt(x['Forma de pago']), discount_pct: num(x['Descuento (%)']),
        customer_type: 'business', status: 'active', default_currency: 'USD', legacy_ref: txt(x['Referencia']),
        notes: txt(x['Observaciones']), industry: txt(x['Familia de clientes']), legacy_source: 'torquetools-xlsx',
      }
    }).filter((r) => r.legacy_ref)
    // La única por legacy_ref es PARCIAL (no se puede upsert): se filtran los
    // que ya están y se insertan los nuevos.
    const yaCli = new Set()
    let d2 = 0
    for (;;) {
      const { data } = await sb.from('customers').select('legacy_ref').eq('company_id', CID).range(d2, d2 + 999)
      for (const r of data ?? []) yaCli.add(r.legacy_ref)
      if (!data || data.length < 1000) break
      d2 += 1000
    }
    const nuevosCli = filasCli.filter((r) => !yaCli.has(r.legacy_ref))
    // La única por tax_id (CUIT) es parcial: el archivo trae CUITs repetidos.
    // El primero con ese CUIT lo conserva; los repetidos entran sin tax_id.
    const normCuit = (s) => String(s ?? '').replace(/\D/g, '')
    const vistosTax = new Set()
    let d3 = 0
    for (;;) {
      const { data } = await sb.from('customers').select('tax_id').eq('company_id', CID).not('tax_id', 'is', null).range(d3, d3 + 999)
      for (const r of data ?? []) { const n = normCuit(r.tax_id); if (n) vistosTax.add(n) }
      if (!data || data.length < 1000) break
      d3 += 1000
    }
    for (const r of nuevosCli) {
      const n = r.tax_id ? normCuit(r.tax_id) : ''
      if (n && vistosTax.has(n)) r.tax_id = null
      else if (n) vistosTax.add(n)
    }
    console.log(`[tt] clientes a cargar: ${nuevosCli.length} (nuevos de ${filasCli.length})`)
    await enLotes(nuevosCli, 300, async (lote) => {
      const { error } = await sb.from('customers').insert(lote)
      if (error) throw error
    })
  }
  console.log('[tt] LISTO')
}
main().catch((e) => { console.error('[tt]', e.message || e); process.exit(1) })
