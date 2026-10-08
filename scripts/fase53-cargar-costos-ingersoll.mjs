/*
 * Carga los COSTOS de Ingersoll-Rand desde sus facturas de compra (Fase 53).
 *
 *   node scripts/fase53-cargar-costos-ingersoll.mjs            (ensayo)
 *   node scripts/fase53-cargar-costos-ingersoll.mjs --aplicar
 *
 * ENTRADA: scripts/input/facturas-ingersoll-2025T4.json, con el texto crudo de
 * la zona de renglones de cada factura.
 *
 * POR QUÉ FACTURAS Y NO UNA LISTA. Ingersoll Rand no manda lista de precios:
 * se buscó en todo el Drive y en el Gmail y no existe. Lo único con costos son
 * las facturas de compra en PDF. Cada factura entra como una VERSIÓN con la
 * fecha de la factura, así que la pantalla de Listas de precios la muestra como
 * una columna más y se ve la progresión del costo igual que con SPEEDRILL.
 *
 * ES UNA FUENTE INCOMPLETA Y HAY QUE DECIRLO: sólo cubre lo que se compró, no
 * el catálogo entero. A cambio es el costo REAL pagado, con fecha.
 *
 * EL CÓDIGO LO DECIDE EL CATÁLOGO. El lector no sabe reconstruir el código
 * partido del PDF, así que devuelve CANDIDATOS y acá se busca cuál existe. Si
 * no existe ninguno, el producto no está cargado y el renglón se guarda sin
 * `product_id`. Si existen DOS, el renglón NO se carga: preferimos perder un
 * costo antes que ponerle a un producto el costo de otro, que con PVP = costo
 * × 3 sería un precio de venta equivocado.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { leerFactura } from './lib/facturas-ingersoll.mjs'

const aplicar = process.argv.includes('--aplicar')
const ENTRADA = 'scripts/input/facturas-ingersoll-2025T4.json'
const entrada = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'))

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
const { data: marca } = await sb
  .from('brands')
  .select('id, name, sku_prefix')
  .eq('company_id', emp.id)
  .eq('name', entrada.proveedor)
  .single()

if (!marca?.sku_prefix) {
  console.error(`✗ La marca ${entrada.proveedor} no tiene sku_prefix.`)
  process.exit(1)
}

// ── 1 · leer las facturas ───────────────────────────────────────────────────

const leidas = []
for (const f of entrada.facturas) {
  const r = leerFactura(f.texto, f.total)
  leidas.push({ ...f, ...r })
  const aviso = r.valida ? '' : '  ⚠ NO VÁLIDA'
  console.log(
    `${f.numero} · ${f.fecha} · ${r.renglones.length} renglones · ${r.suma} de ${f.total} EUR (${r.cobertura} %)${aviso}`,
  )
  if (r.sinImporte.length) console.log(`   sin importe legible: ${r.sinImporte.join(', ')}`)
  for (const d of r.descartados) console.log(`   ${d}`)
}

const invalidas = leidas.filter((f) => !f.valida)
if (invalidas.length) {
  console.error(`\n✗ ${invalidas.length} facturas no válidas. No se escribe nada.`)
  process.exit(1)
}

// ── 2 · resolver cada código contra el catálogo ─────────────────────────────

const todos = [...new Set(leidas.flatMap((f) => f.renglones.flatMap((r) => r.candidatos)))]
const existe = new Set()
for (let i = 0; i < todos.length; i += 150) {
  const skus = todos.slice(i, i + 150).map((c) => `${marca.sku_prefix}.${c}`)
  const { data, error } = await sb
    .from('products')
    .select('id, sku')
    .eq('company_id', emp.id)
    .is('deleted_at', null)
    .in('sku', skus)
  if (error) throw new Error(`productos: ${error.message}`)
  for (const p of data ?? []) existe.add(p.sku)
}

const idPorSku = new Map()
{
  const skus = [...existe]
  for (let i = 0; i < skus.length; i += 150) {
    const { data } = await sb
      .from('products')
      .select('id, sku')
      .eq('company_id', emp.id)
      .in('sku', skus.slice(i, i + 150))
    for (const p of data ?? []) idPorSku.set(p.sku, p.id)
  }
}

/** El candidato que existe en el catálogo. Cero o más de uno: se informa. */
function resolver(candidatos) {
  const hallados = candidatos.filter((c) => existe.has(`${marca.sku_prefix}.${c}`))
  // Sin duplicados: los candidatos progresivos pueden repetir el mismo código.
  const unicos = [...new Set(hallados)]
  return { elegido: unicos.length === 1 ? unicos[0] : null, cuantos: unicos.length, hallados: unicos }
}

let sinProducto = 0
let ambiguos = 0
const resueltas = leidas.map((f) => ({
  ...f,
  renglones: f.renglones.map((r) => {
    const { elegido, cuantos, hallados } = resolver(r.candidatos)
    if (cuantos === 0) sinProducto += 1
    if (cuantos > 1) {
      ambiguos += 1
      console.log(`   ⚠ ${f.numero} renglón ${r.linea}: ambiguo (${hallados.join(' / ')}). No se carga.`)
    }
    return { ...r, codigo: elegido, productId: elegido ? (idPorSku.get(`${marca.sku_prefix}.${elegido}`) ?? null) : null, ambiguo: cuantos > 1 }
  }),
}))

const utiles = resueltas.flatMap((f) => f.renglones.filter((r) => !r.ambiguo))
const conProducto = utiles.filter((r) => r.productId !== null)

console.log(`\nRenglones leídos: ${utiles.length + ambiguos} · ambiguos descartados: ${ambiguos}`)
console.log(`Cruzan con el catálogo: ${conProducto.length} · sin producto cargado: ${sinProducto}`)
console.log(`Productos distintos con costo: ${new Set(conProducto.map((r) => r.productId)).size}`)

if (!aplicar) {
  console.log('\n(ensayo: no se escribió nada. Agregá --aplicar para cargar.)')
  process.exit(0)
}

// ── 3 · la fuente y una versión por factura ─────────────────────────────────

let { data: fuente } = await sb
  .from('price_list_sources')
  .select('id')
  .eq('company_id', emp.id)
  .eq('name', entrada.proveedor)
  .maybeSingle()

if (!fuente) {
  const r = await sb
    .from('price_list_sources')
    .insert({ company_id: emp.id, name: entrada.proveedor, brand_id: marca.id, kind: 'proveedor' })
    .select('id')
    .single()
  if (r.error) throw new Error(`fuente: ${r.error.message}`)
  fuente = r.data
}

for (const f of resueltas) {
  let { data: version } = await sb
    .from('price_list_versions')
    .select('id')
    .eq('company_id', emp.id)
    .eq('source_id', fuente.id)
    .eq('issued_on', f.fecha)
    .maybeSingle()

  if (version) {
    await sb.from('price_list_items').delete().eq('version_id', version.id)
  } else {
    const r = await sb
      .from('price_list_versions')
      .insert({
        company_id: emp.id,
        source_id: fuente.id,
        issued_on: f.fecha,
        currency: entrada.moneda,
        anchor_column: 'Precio (lista)',
        origin: 'factura',
        file_name: f.archivo,
        file_url: `https://drive.google.com/file/d/${f.driveId}/view`,
        notes: `Factura de compra ${f.numero}. El costo es el neto unitario (neto del renglon / cantidad), con el descuento de distribuidor ya aplicado. Cobertura del total: ${f.cobertura} %.`,
      })
      .select('id')
      .single()
    if (r.error) throw new Error(`version ${f.numero}: ${r.error.message}`)
    version = r.data
  }

  /* Un mismo código puede repetirse en una factura; la unique es versión +
     referencia, así que se queda el primero y se avisa. */
  const vistos = new Set()
  const items = []
  for (const r of f.renglones) {
    if (r.ambiguo) continue
    const ref = r.codigo ?? r.base
    if (vistos.has(ref)) continue
    vistos.add(ref)
    items.push({
      company_id: emp.id,
      version_id: version.id,
      reference: ref,
      description: null,
      anchor: r.lista,
      prices: {
        lista_eur: r.lista,
        descuento_pct: r.descuentoPct,
        neto_renglon_eur: r.neto,
        costo_unitario_eur: r.unitario,
        cantidad: r.cantidad,
        origen_pais: r.pais,
        factura: f.numero,
      },
      product_id: r.productId,
    })
  }

  if (items.length > 0) {
    const { error } = await sb.from('price_list_items').insert(items)
    if (error) throw new Error(`items ${f.numero}: ${error.message}`)
  }
  console.log(`${f.numero}: ${items.length} renglones cargados.`)
}

// ── 4 · la fórmula ──────────────────────────────────────────────────────────

const FORMULA = {
  multiplier: 3,
  base_key: 'costo_unitario_eur',
  base_is_cost: true,
  notes: 'Costo real pagado, del neto unitario de la factura de compra. IR no publica lista de precios.',
}

const { data: yaHay } = await sb
  .from('price_formulas')
  .select('id')
  .eq('company_id', emp.id)
  .eq('source_id', fuente.id)
  .maybeSingle()

const eF = yaHay
  ? (await sb.from('price_formulas').update({ ...FORMULA, updated_at: new Date().toISOString() }).eq('id', yaHay.id)).error
  : (await sb.from('price_formulas').insert({ company_id: emp.id, source_id: fuente.id, ...FORMULA })).error
if (eF) throw new Error(`formula: ${eF.message}`)

console.log('\nFórmula cargada: PVP = costo_unitario_eur × 3.')
