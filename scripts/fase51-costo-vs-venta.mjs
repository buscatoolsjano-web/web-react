/*
 * ¿Cuánto multiplica hoy el precio de venta al costo del proveedor? (Fase 51)
 *
 *   set -a; . ./.env.local; . ./.env.migration; set +a
 *   node scripts/fase51-costo-vs-venta.mjs
 *
 * PARA QUÉ. Se decidió que el PVP sea costo × 3. Antes de cambiar el precio
 * que se sugiere al cotizar hay que saber qué relación tienen HOY las dos
 * cosas: si STEL ya está cerca de ×3, poner la fórmula no mueve nada y es
 * seguro; si está lejos, cambiarla de golpe cambia lo que se le cobra a la
 * gente, y eso se mira antes y no después.
 *
 * SÓLO LEE. No escribe una sola fila.
 *
 * LA MONEDA NO SE CONVIERTE. La lista del proveedor puede estar en EUR y la
 * tarifa de STEL en USD; dividir una por otra sin tipo de cambio da un número
 * que parece un markup y no lo es. Se agrupa por par de monedas y cada par se
 * informa por separado. Es la misma regla que el resto del ERP: el legacy dejó
 * 104 documentos sin tipo de cambio por inventarlos.
 *
 * Se usa el costo de la lista MÁS RECIENTE de cada fuente: comparar el precio
 * de venta de hoy contra un costo de 2024 mediría la inflación, no el markup.
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()

// La tarifa por defecto: es la que ve el catálogo y la que sugiere una línea.
const { data: tarifa } = await sb
  .from('price_lists')
  .select('id, name, currency_code')
  .eq('company_id', emp.id)
  .eq('is_default', true)
  .single()

const { data: fuentes } = await sb
  .from('price_list_sources')
  .select('id, name, price_list_versions ( id, issued_on, currency )')
  .eq('company_id', emp.id)

const hoy = new Date().toISOString().slice(0, 10)

/** La misma regla que `precioVigenteDe` del Catálogo, en una línea. */
function vigente(filas) {
  const empezadas = filas
    .filter((f) => (f.valid_from ?? '') <= hoy)
    .sort((a, b) => (b.valid_from ?? '').localeCompare(a.valid_from ?? ''))
  return empezadas.find((f) => f.valid_to === null || f.valid_to >= hoy) ?? empezadas[0] ?? null
}

const cuantil = (xs, q) => {
  if (xs.length === 0) return null
  const o = [...xs].sort((a, b) => a - b)
  const i = (o.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? o[lo] : o[lo] + (o[hi] - o[lo]) * (i - lo)
}

const n2 = (x) => (x === null ? '—' : x.toFixed(2))

console.log(`Tarifa por defecto: ${tarifa.name} (${tarifa.currency_code})\n`)

for (const f of fuentes ?? []) {
  const versiones = [...(f.price_list_versions ?? [])].sort((a, b) =>
    b.issued_on.localeCompare(a.issued_on),
  )
  const ultima = versiones[0]
  if (!ultima) continue

  // Sólo los renglones que cruzaron con el catálogo: sin producto no hay
  // precio de venta contra el cual comparar.
  const items = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from('price_list_items')
      .select('reference, product_id, anchor')
      .eq('version_id', ultima.id)
      .not('product_id', 'is', null)
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    items.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }

  const ids = [...new Set(items.map((i) => i.product_id))]
  const precios = new Map()
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb
      .from('product_prices')
      .select('product_id, amount, valid_from, valid_to')
      .eq('company_id', emp.id)
      .eq('price_list_id', tarifa.id)
      .in('product_id', ids.slice(i, i + 500))
    for (const p of data ?? []) {
      if (!precios.has(p.product_id)) precios.set(p.product_id, [])
      precios.get(p.product_id).push(p)
    }
  }

  const multiplos = []
  let sinVenta = 0
  let sinCosto = 0
  for (const it of items) {
    const costo = Number(it.anchor)
    if (!Number.isFinite(costo) || costo <= 0) {
      sinCosto += 1
      continue
    }
    const v = vigente(precios.get(it.product_id) ?? [])
    if (!v) {
      sinVenta += 1
      continue
    }
    const venta = Number(v.amount)
    if (!Number.isFinite(venta) || venta <= 0) {
      sinVenta += 1
      continue
    }
    multiplos.push(venta / costo)
  }

  const mismaMoneda = ultima.currency === tarifa.currency_code

  console.log(`── ${f.name} · lista del ${ultima.issued_on} en ${ultima.currency}`)
  console.log(`   renglones con producto: ${items.length}`)
  console.log(`   sin costo usable: ${sinCosto} · sin precio de venta: ${sinVenta}`)
  console.log(`   comparables: ${multiplos.length}`)
  if (!mismaMoneda) {
    console.log(
      `   ⚠ la lista está en ${ultima.currency} y la tarifa en ${tarifa.currency_code}:`,
    )
    console.log(`     el múltiplo de abajo MEZCLA MONEDAS y no es un markup.`)
  }
  if (multiplos.length > 0) {
    console.log(
      `   múltiplo venta/costo → p10 ${n2(cuantil(multiplos, 0.1))} · p25 ${n2(cuantil(multiplos, 0.25))} · MEDIANA ${n2(cuantil(multiplos, 0.5))} · p75 ${n2(cuantil(multiplos, 0.75))} · p90 ${n2(cuantil(multiplos, 0.9))}`,
    )
    const cerca3 = multiplos.filter((m) => m >= 2.7 && m <= 3.3).length
    const bajo = multiplos.filter((m) => m < 1).length
    console.log(
      `   entre 2,7 y 3,3: ${cerca3} (${((cerca3 / multiplos.length) * 100).toFixed(1)} %) · por DEBAJO del costo: ${bajo}`,
    )
  }
  console.log()
}
