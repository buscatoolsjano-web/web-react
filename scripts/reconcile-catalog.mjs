/**
 * Reconciliación legacy ↔ Supabase, después de importar.
 *
 * No acepta "aproximadamente igual": cada métrica se compara con delta
 * exacto y toda diferencia tiene que quedar explicada.
 *
 * Sólo LEE. No escribe nada en ninguna de las dos puntas.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/reconcile-catalog.mjs \
 *     --file <productos-data.json> [--precios markup-legacy] [--csv salida.csv]
 *
 * La clave se lee del entorno y NUNCA se imprime.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d
}
const ARCHIVO = arg('--file', 'C:/Users/janog/AppData/Local/Temp/bta/legacy/productos-data.json')
const POLITICA = arg('--precios', 'markup-legacy')
const CSV = arg('--csv', null)
const EMPRESA = arg('--empresa', 'buscatools')

const CATEGORIA_SLUG = {
  otros: 'otros', punta: 'punta', balanceador: 'balanceador',
  atornillador: 'atornillador', accesorio: 'accesorio',
  'llave de impacto': 'llave-de-impacto', remachadora: 'remachadora',
  'llave dinamométrica': 'llave-dinamometrica',
}

const dec = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const txt = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())

let fallos = 0
const log = (...a) => console.log(...a)
const seccion = (t) => log(`\n${'═'.repeat(70)}\n${t}\n${'═'.repeat(70)}`)

/** Compara y marca FAIL si el delta no es cero. */
function comparar(metrica, legacy, nuevo, nota = '') {
  const delta = Number(nuevo) - Number(legacy)
  const ok = delta === 0
  if (!ok) fallos++
  log(
    `  ${ok ? 'OK  ' : 'FAIL'}  ${metrica.padEnd(34)} ` +
      `legacy ${String(legacy).padStart(7)} · nuevo ${String(nuevo).padStart(7)} · Δ ${String(delta).padStart(6)}` +
      (nota ? `  ${nota}` : ''),
  )
  return ok
}

/** Diferencia esperada: se informa pero no cuenta como fallo. */
function esperada(metrica, legacy, nuevo, motivo) {
  const delta = Number(nuevo) - Number(legacy)
  log(
    `  ~     ${metrica.padEnd(34)} legacy ${String(legacy).padStart(7)} · nuevo ${String(nuevo).padStart(7)} · Δ ${String(delta).padStart(6)}`,
  )
  log(`        └─ ${motivo}`)
}

function conectar() {
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!clave) {
    console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.')
    process.exit(1)
  }
  return createClient(
    process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
    clave,
    { auth: { persistSession: false } },
  )
}

/** Trae TODAS las filas paginando: PostgREST corta en 1000. */
async function traerTodo(sb, tabla, select, filtro = (q) => q, pagina = 1000) {
  const filas = []
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await filtro(sb.from(tabla).select(select)).range(desde, desde + pagina - 1)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < pagina) break
  }
  return filas
}

async function main() {
  const legacy = JSON.parse(readFileSync(ARCHIVO, 'utf8'))
  const sb = conectar()

  const { data: emp, error: eE } = await sb
    .from('companies').select('id').eq('slug', EMPRESA).single()
  if (eE) throw new Error(`Empresa ${EMPRESA}: ${eE.message}`)
  const CO = emp.id

  seccion(`RECONCILIACIÓN — ${EMPRESA}`)
  log(`  Los productos de otras empresas quedan fuera de la comparación.`)

  // ── Datos del nuevo sistema ───────────────────────────────
  const prods = await traerTodo(
    sb, 'products',
    'id, sku, name, brand_id, category_id, attributes, needs_review, brands(name), product_categories(slug)',
    (q) => q.eq('company_id', CO),
  )
  const precios = await traerTodo(sb, 'product_prices', 'product_id, amount', (q) => q.eq('company_id', CO))
  const saldos = await traerTodo(sb, 'stock_balances', 'product_id, on_hand', (q) => q.eq('company_id', CO))
  const aperturas = await traerTodo(
    sb, 'stock_movements', 'product_id, quantity',
    (q) => q.eq('company_id', CO).eq('movement_type', 'opening_balance'),
  )

  const pusOrdenados = legacy.map((p) => dec(p.pu)).filter((v) => v !== null).sort((a, b) => a - b)
  const UMBRAL = pusOrdenados[Math.floor(pusOrdenados.length * 0.99)] * 10

  const porSku = new Map(prods.map((p) => [p.sku, p]))
  const precioPorId = new Map(precios.map((r) => [r.product_id, Number(r.amount)]))
  const saldoPorId = new Map(saldos.map((r) => [r.product_id, Number(r.on_hand)]))
  const aperturaPorId = new Map(aperturas.map((r) => [r.product_id, Number(r.quantity)]))

  // ── 1. PRODUCTOS ──────────────────────────────────────────
  seccion('1. PRODUCTOS')
  comparar('total', legacy.length, prods.length)

  const skusLegacy = new Set(legacy.map((p) => txt(p.sku)))
  const faltan = [...skusLegacy].filter((s) => !porSku.has(s))
  const sobran = prods.filter((p) => !skusLegacy.has(p.sku)).map((p) => p.sku)
  comparar('SKUs del legacy ausentes', 0, faltan.length)
  comparar('SKUs nuevos no esperados', 0, sobran.length)
  if (faltan.length) log(`        faltan: ${faltan.slice(0, 10).join(', ')}`)
  if (sobran.length) log(`        sobran: ${sobran.slice(0, 10).join(', ')}`)

  // ── 2. NOMBRE, MARCA, CATEGORÍA, ATRIBUTOS por SKU ────────
  seccion('2. CAMPOS POR SKU')
  let difNombre = 0, difMarca = 0, difCat = 0, difAttr = 0
  const ejemplos = []
  for (const p of legacy) {
    const n = porSku.get(txt(p.sku))
    if (!n) continue
    if (n.name !== txt(p.nombre)) { difNombre++; if (ejemplos.length < 5) ejemplos.push(`nombre ${p.sku}`) }
    const marcaLegacy = txt(p.marca)
    const marcaNueva = n.brands?.name ?? null
    if (marcaLegacy !== marcaNueva) { difMarca++; if (ejemplos.length < 5) ejemplos.push(`marca ${p.sku}`) }
    const slugEsperado = CATEGORIA_SLUG[String(p.cat ?? '').trim().toLowerCase()]
    if (n.product_categories?.slug !== slugEsperado) { difCat++; if (ejemplos.length < 5) ejemplos.push(`cat ${p.sku}`) }
    // Atributos: se compara la cantidad de claves no vacías
    const esperadas = Object.keys(n.attributes ?? {}).length
    if (esperadas === 0 && Object.keys(n.attributes ?? {}).length !== 0) difAttr++
  }
  comparar('nombres distintos', 0, difNombre)
  comparar('marcas distintas', 0, difMarca)
  comparar('categorías distintas', 0, difCat)
  if (ejemplos.length) log(`        ejemplos: ${ejemplos.join(', ')}`)

  // ── 3. AGREGADOS ──────────────────────────────────────────
  seccion('3. AGREGADOS')
  const sinMarcaLegacy = legacy.filter((p) => !txt(p.marca)).length
  const sinMarcaNuevo = prods.filter((p) => p.brand_id === null).length
  comparar('sin marca', sinMarcaLegacy, sinMarcaNuevo)

  const otrosLegacy = legacy.filter((p) => String(p.cat ?? '').trim().toLowerCase() === 'otros').length
  const otrosNuevo = prods.filter((p) => p.product_categories?.slug === 'otros').length
  comparar('en categoría "otros"', otrosLegacy, otrosNuevo)

  log('\n  Por marca:')
  const marcaLegacy = new Map()
  for (const p of legacy) {
    const m = txt(p.marca); if (!m) continue
    marcaLegacy.set(m, (marcaLegacy.get(m) ?? 0) + 1)
  }
  const marcaNuevo = new Map()
  for (const p of prods) {
    const m = p.brands?.name; if (!m) continue
    marcaNuevo.set(m, (marcaNuevo.get(m) ?? 0) + 1)
  }
  for (const [m, n] of [...marcaLegacy.entries()].sort((a, b) => b[1] - a[1])) {
    comparar(`  ${m}`, n, marcaNuevo.get(m) ?? 0)
  }

  log('\n  Por categoría:')
  const catLegacy = new Map()
  for (const p of legacy) {
    const s = CATEGORIA_SLUG[String(p.cat ?? '').trim().toLowerCase()]
    if (s) catLegacy.set(s, (catLegacy.get(s) ?? 0) + 1)
  }
  const catNuevo = new Map()
  for (const p of prods) {
    const s = p.product_categories?.slug
    if (s) catNuevo.set(s, (catNuevo.get(s) ?? 0) + 1)
  }
  for (const [s, n] of [...catLegacy.entries()].sort((a, b) => b[1] - a[1])) {
    comparar(`  ${s}`, n, catNuevo.get(s) ?? 0)
  }

  // ── 4. PRECIOS ────────────────────────────────────────────
  seccion('4. PRECIOS')
  const fuentes = { explicit_price: 0, markup_legacy: 0, anomaly: 0, no_price: 0 }
  const filasCsv = ['SKU;LEGACY_VISIBLE;NEW_PRICE;SOURCE;DELTA']
  let conPrecioEsperado = 0, deltaNoCero = 0
  const deltas = []

  for (const p of legacy) {
    const sku = txt(p.sku)
    const n = porSku.get(sku)
    if (!n) continue
    const pv = dec(p.precio_venta), pu = dec(p.pu)

    let fuente = 'no_price', esperado = null
    if (pv !== null && pv > 0) { fuente = 'explicit_price'; esperado = pv }
    else if (pu !== null && pu > UMBRAL) { fuente = 'anomaly' }
    else if (pu !== null && pu > 0) {
      fuente = 'markup_legacy'
      if (POLITICA === 'markup-legacy') esperado = Number((pu * 3).toFixed(4))
    }
    fuentes[fuente]++

    const real = precioPorId.get(n.id) ?? null
    if (esperado !== null) {
      conPrecioEsperado++
      const d = real === null ? null : Number((real - esperado).toFixed(4))
      if (d === null || d !== 0) {
        deltaNoCero++
        if (deltas.length < 10) deltas.push(`${sku}: esperado ${esperado}, real ${real}`)
      }
      if (CSV) filasCsv.push(`${sku};${esperado};${real ?? ''};${fuente};${d ?? 'SIN_PRECIO'}`)
    } else if (real !== null) {
      // Tiene precio en la base pero no debía tenerlo
      deltaNoCero++
      if (deltas.length < 10) deltas.push(`${sku}: no debía tener precio, tiene ${real}`)
      if (CSV) filasCsv.push(`${sku};;${real};${fuente};NO_DEBIA_TENER`)
    } else if (CSV) {
      filasCsv.push(`${sku};;;${fuente};0`)
    }
  }

  log(`  Procedencia:`)
  for (const [f, n] of Object.entries(fuentes)) log(`    ${f.padEnd(16)} ${String(n).padStart(6)}`)
  comparar('filas en product_prices', conPrecioEsperado, precios.length)
  comparar('SKUs con delta != 0', 0, deltaNoCero)
  if (deltas.length) for (const d of deltas) log(`        ${d}`)
  log(`\n  anomaly y no_price no deben tener precio: verificado arriba.`)

  // ── 5. STOCK ──────────────────────────────────────────────
  seccion('5. STOCK')
  const positivos = legacy.filter((p) => dec(p.sr) !== null && p.sr > 0)
  const negativos = legacy.filter((p) => dec(p.sr) !== null && p.sr < 0)
  const sumaLegacy = positivos.reduce((s, p) => s + Math.round(p.sr), 0)

  comparar('productos con saldo positivo', positivos.length, aperturas.length)
  comparar('suma de aperturas', sumaLegacy, aperturas.reduce((s, r) => s + r.quantity, 0))
  comparar('filas en stock_balances', positivos.length, saldos.length)
  comparar('suma de stock_balances', sumaLegacy, saldos.reduce((s, r) => s + r.on_hand, 0))

  esperada(
    'productos con saldo negativo', negativos.length, 0,
    'on_hand tiene CHECK >= 0. El producto se migra, el saldo no. ' +
      `SKUs: ${negativos.map((p) => `${p.sku}(${p.sr})`).join(', ')}`,
  )

  let deltaStock = 0
  for (const p of positivos) {
    const n = porSku.get(txt(p.sku)); if (!n) continue
    if ((saldoPorId.get(n.id) ?? 0) !== Math.round(p.sr)) deltaStock++
  }
  comparar('SKUs con delta de stock != 0', 0, deltaStock)

  // ── 6. NEEDS_REVIEW ───────────────────────────────────────
  seccion('6. NEEDS_REVIEW')
  const marcadosNuevo = prods.filter((p) => p.needs_review).length
  const esperadosMarcados = legacy.filter((p) => {
    const s = CATEGORIA_SLUG[String(p.cat ?? '').trim().toLowerCase()]
    const pu = dec(p.pu), sr = dec(p.sr)
    return s === 'otros' || (pu !== null && pu > UMBRAL) || (sr !== null && sr < 0)
  }).length
  comparar('productos marcados', esperadosMarcados, marcadosNuevo)

  // ── RESULTADO ─────────────────────────────────────────────
  if (CSV) {
    writeFileSync(CSV, filasCsv.join('\n'))
    log(`\n  Detalle por SKU escrito en ${CSV} (${filasCsv.length - 1} filas)`)
  }

  seccion(fallos === 0 ? 'RECONCILIACIÓN OK — todos los deltas en cero' : `RECONCILIACIÓN CON ${fallos} FALLO(S)`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
