/**
 * Fase 14 · Entrega 4 — auditoría de las tarifas de STEL vs las listas de React (SÓLO LECTURA).
 *
 * STEL no expone la tarifa en el documento ni en el listado de cuentas, así que el
 * "uso real" no se puede leer: se MIDE comparando el precio de cada renglón vendido
 * (`item-base-price`) con el precio que cada tarifa tiene para ese mismo artículo.
 * La tarifa que explica los renglones recientes es la que Buscatools usa de verdad.
 *
 * Llamadas a STEL: 2 (`rates` y el detalle de una cuenta, para dejar constancia de
 * si la tarifa por cliente está expuesta). Los productos y documentos salen de la
 * lectura del dry run.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-e4-tarifas-auditoria.mjs --plan-hash <sha256 del dry run>
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente, limpiar } from './lib/stel-api.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const SALIDA = path.resolve('scripts/output/e4')
const cerca = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.01 + Math.abs(b) * 1e-9

/** Cuántos renglones de venta explica cada tarifa, y desde cuándo. */
export function usoDeTarifas(docs, productos, { desde } = {}) {
  const precioPorItem = new Map() // item-id → Map(rate-id → precio)
  const ventaPorItem = new Map()  // item-id → sales-price
  for (const p of productos) {
    precioPorItem.set(p.id, new Map((p['item-rates'] ?? []).map((r) => [r['rate-id'], Number(r.price)])))
    ventaPorItem.set(p.id, Number(p['sales-price']))
  }
  const uso = new Map()
  let renglones = 0
  let sinTarifaQueExplique = 0
  for (const tipo of ['quote', 'order', 'delivery']) {
    for (const d of docs[tipo] ?? []) {
      if (desde && d.date && d.date < desde) continue
      for (const l of d.lines ?? []) {
        if (l.deleted || l['line-type'] !== 'ITEM') continue
        const tarifas = precioPorItem.get(l['item-id'])
        if (!tarifas) continue
        renglones++
        const base = Number(l['item-base-price'])
        let alguna = false
        for (const [rate, precio] of tarifas) {
          if (!cerca(base, precio)) continue
          alguna = true
          const u = uso.get(rate) ?? { renglones: 0, documentos: new Set(), ultima: null, monedas: new Set() }
          u.renglones++
          u.documentos.add(`${tipo}:${d['full-reference']}`)
          u.monedas.add(d['currency-code'] ?? '(sin)')
          if (!u.ultima || (d.date ?? '') > u.ultima) u.ultima = d.date ?? null
          uso.set(rate, u)
        }
        if (!alguna && cerca(base, ventaPorItem.get(l['item-id']))) {
          const u = uso.get('sales-price') ?? { renglones: 0, documentos: new Set(), ultima: null, monedas: new Set() }
          u.renglones++
          u.documentos.add(`${tipo}:${d['full-reference']}`)
          u.monedas.add(d['currency-code'] ?? '(sin)')
          if (!u.ultima || (d.date ?? '') > u.ultima) u.ultima = d.date ?? null
          uso.set('sales-price', u)
          alguna = true
        }
        if (!alguna) sinTarifaQueExplique++
      }
    }
  }
  return { uso, renglones, sinTarifaQueExplique }
}

async function main() {
  const hash = arg('--plan-hash')
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) { console.error('✗ falta --plan-hash'); process.exit(2) }
  const fStel = path.resolve(`scripts/output/e2/stel-dryrun-${hash.slice(0, 12)}.json`)
  if (!fs.existsSync(fStel)) { console.error(`✗ falta ${fStel}`); process.exit(2) }
  const { stel } = JSON.parse(fs.readFileSync(fStel, 'utf8'))

  const cacheDir = path.resolve(`.stel-cache/e4-tarifas-${Date.now()}`)
  const c = crearCliente({ maxLlamadas: 6, usarCache: true, cacheDir, log: () => {} })
  let tarifas = []
  let cuentaExpone = null
  try {
    tarifas = await c.todos('rates', {}, { limite: 200, maxPaginas: 2 })
    const alguna = stel.clientes.find((x) => !x.deleted)
    const detalle = await c.get(`clients/${alguna.id}`)
    const obj = Array.isArray(detalle) ? detalle[0] : detalle
    cuentaExpone = Object.keys(obj ?? {}).filter((k) => /rate/i.test(k))
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }

  const haceUnAno = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)
  const total = usoDeTarifas(stel.docs, stel.productos)
  const reciente = usoDeTarifas(stel.docs, stel.productos, { desde: haceUnAno })
  const conPrecio = new Map()
  for (const p of stel.productos) for (const r of p['item-rates'] ?? []) {
    if (Number(r.price) > 0) conPrecio.set(r['rate-id'], (conPrecio.get(r['rate-id']) ?? 0) + 1)
  }

  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const { data: listas } = await sb.from('price_lists').select('id, name, currency_code, is_default').eq('company_id', emp.id).order('name')
  const conteos = {}
  for (const l of listas ?? []) {
    const { count } = await sb.from('product_prices').select('*', { count: 'exact', head: true }).eq('price_list_id', l.id)
    conteos[l.id] = count ?? 0
  }

  const filas = tarifas.map((t) => {
    const u = total.uso.get(t.id)
    const ur = reciente.uso.get(t.id)
    return {
      STEL_RATE: `${t.id} · ${t.name ?? t['full-reference'] ?? '(sin nombre)'}`,
      id: t.id, nombre: t.name ?? null, borrada: Boolean(t.deleted),
      CURRENCY: t['currency-code'] ?? '(STEL no expone moneda por tarifa)',
      ACTIVE_PRODUCTS: conPrecio.get(t.id) ?? 0,
      RECENT_USAGE: { renglonesUltimoAno: ur?.renglones ?? 0, renglonesHistoricos: u?.renglones ?? 0, documentos: u?.documentos.size ?? 0, ultimaFecha: u?.ultima ?? null, monedasDeEsosDocumentos: [...(u?.monedas ?? [])] },
    }
  })
  const ventaDirecta = total.uso.get('sales-price')

  const informe = {
    generado: new Date().toISOString(), llamadasStel: c.llamadas(), planHash: hash,
    stelTarifas: tarifas.length,
    tarifaPorClienteExpuestaEnLaApi: cuentaExpone.length ? cuentaExpone : false,
    renglonesAnalizados: total.renglones,
    renglonesSinTarifaQueLosExplique: total.sinTarifaQueExplique,
    precioDeVentaDirecto: ventaDirecta ? { renglones: ventaDirecta.renglones, documentos: ventaDirecta.documentos.size, ultima: ventaDirecta.ultima } : null,
    tarifas: filas,
    listasReact: (listas ?? []).map((l) => ({ id: l.id, nombre: l.name, moneda: l.currency_code, porDefecto: l.is_default, productosConPrecio: conteos[l.id] })),
  }
  fs.mkdirSync(SALIDA, { recursive: true })
  const archivo = path.join(SALIDA, 'tarifas.json')
  fs.writeFileSync(archivo, JSON.stringify(informe, null, 1))
  console.log(JSON.stringify(informe, null, 1))
  console.log(`  detalle: ${path.relative(process.cwd(), archivo)}`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
}
