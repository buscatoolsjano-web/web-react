/**
 * Fase 14 — qué números existen realmente en STEL, preguntando por referencia.
 *
 *   node scripts/fase14-auditoria-por-referencia.mjs --desde-quote 2555 --desde-order 1318 --desde-delivery 1432 [--margen 12]
 *
 * El listado de STEL (`sort=creation-date:desc` + `start-date`) demostró estar
 * atrasado: el 16/09 omitió durante más de dos horas documentos ya emitidos
 * (PDV01320 creado 11:52 no aparecía a las 14:32). La consulta por
 * `full-reference=in:` sí los devolvió.
 *
 * Por eso, para decidir si un número está libre, esta auditoría pregunta por el
 * número exacto y avanza hasta encontrar un tramo de referencias inexistentes
 * lo bastante largo. Un número sólo se considera libre si la consulta directa
 * dice que no existe.
 *
 * Sólo lectura. La clave sale de .env.stel.local y nunca se imprime.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente, limpiar } from './lib/stel-api.mjs'

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const SALIDA = path.resolve('scripts/output/auditoria')
const EMPRESA = arg('--empresa', 'buscatools')
/** Cuántas referencias inexistentes seguidas hacen falta para dar por cerrado el rango. */
const MARGEN = Number(arg('--margen', '12'))
const LOTE = 20

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const SERIES = [
  { tipo: 'quote', ruta: 'salesEstimates', tabla: 'sales_quotes', prefijo: 'COTI', padding: 5, desde: Number(arg('--desde-quote', '2555')) },
  { tipo: 'order', ruta: 'salesOrders', tabla: 'sales_orders', prefijo: 'PDV', padding: 5, desde: Number(arg('--desde-order', '1318')) },
  { tipo: 'delivery', ruta: 'salesDeliveryNotes', tabla: 'deliveries', prefijo: 'RT', padding: 10, desde: Number(arg('--desde-delivery', '1432')) },
]

const referencia = (s, n) => `${s.prefijo}${String(n).padStart(s.padding, '0')}`

/**
 * Avanza por números consecutivos preguntando por referencia, hasta juntar
 * `margen` inexistentes seguidos. Devuelve qué existe y qué no.
 */
export async function barrerSerie(c, s, { margen = MARGEN, maxNumeros = 200 } = {}) {
  const existen = []
  const faltan = []
  let n = s.desde
  let seguidosSinExistir = 0
  while (seguidosSinExistir < margen && existen.length + faltan.length < maxNumeros) {
    const lote = []
    for (let i = 0; i < LOTE; i++) lote.push(referencia(s, n + i))
    const hallados = await c.get(s.ruta, { 'full-reference': `in:${lote.join(',')}`, limit: 100 })
    const porRef = new Map((Array.isArray(hallados) ? hallados : []).map((d) => [d['full-reference'], d]))
    for (const ref of lote) {
      const d = porRef.get(ref)
      if (d) {
        existen.push({ ref, id: String(d.id), creado: d['creation-date'], fecha: (d.date ?? '').slice(0, 10), total: d['total-amount'], moneda: d['currency-code'] ?? null, borrado: Boolean(d.deleted) })
        seguidosSinExistir = 0
      } else {
        faltan.push(ref)
        seguidosSinExistir++
        if (seguidosSinExistir >= margen) break
      }
    }
    n += LOTE
  }
  return { existen, faltan, ultimoExistente: existen.at(-1)?.ref ?? null, primerLibre: faltan[0] ?? null, seguidosSinExistir }
}

async function main() {
  const cacheDir = path.resolve(`.stel-cache/ref-${Date.now()}`)
  const c = crearCliente({ maxLlamadas: Number(arg('--max-llamadas', '40')), usarCache: false, cacheDir, log: () => {} })
  const { data: emp } = await sb.from('companies').select('id').eq('slug', EMPRESA).single()
  const out = { generado: new Date().toISOString(), metodo: 'full-reference=in: (existencia por número, no listado por fecha)', margen: MARGEN, series: {} }

  try {
    for (const s of SERIES) {
      const r = await barrerSerie(c, s)
      // Qué tiene React de esos mismos números.
      const refs = [...r.existen.map((x) => x.ref), ...r.faltan]
      const { data: enReact } = await sb.from(s.tabla).select('number, external_id, imported_at, total, currency_code').eq('company_id', emp.id).in('number', refs)
      const reactPorNum = new Map((enReact ?? []).map((d) => [d.number, d]))
      const colisiones = []
      const faltanEnReact = []
      for (const e of r.existen) {
        const rr = reactPorNum.get(e.ref)
        if (!rr) { faltanEnReact.push(e.ref); continue }
        // Mismo número en los dos lados pero distinto documento: colisión.
        if (!rr.imported_at || rr.external_id !== e.id) {
          colisiones.push({ ref: e.ref, stel: { id: e.id, total: e.total, creado: e.creado }, react: { total: Number(rr.total), importado: Boolean(rr.imported_at), ext: rr.external_id } })
        }
      }
      const soloEnReact = (enReact ?? []).filter((d) => !r.existen.some((e) => e.ref === d.number)).map((d) => ({ ref: d.number, importado: Boolean(d.imported_at), total: Number(d.total) }))
      out.series[s.tipo] = {
        desde: referencia(s, s.desde), existenEnStel: r.existen.length, ultimoExistente: r.ultimoExistente,
        primerLibre: r.primerLibre, librosSeguidos: r.seguidosSinExistir,
        documentos: r.existen, faltanEnReact, soloEnReact, colisiones,
      }
    }
    out.llamadasStel = c.llamadas()
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }

  fs.mkdirSync(SALIDA, { recursive: true })
  const f = path.join(SALIDA, 'por-referencia.json')
  fs.writeFileSync(f, JSON.stringify(out, null, 1))
  for (const [tipo, s] of Object.entries(out.series)) {
    console.log(`\n== ${tipo} (desde ${s.desde}) ==`)
    for (const d of s.documentos) console.log(`   ${d.ref.padEnd(14)} id ${String(d.id).padEnd(10)} creado ${d.creado} total ${d.total}`)
    console.log(`   último que existe: ${s.ultimoExistente} · primer libre: ${s.primerLibre} (${s.librosSeguidos} libres seguidos)`)
    console.log(`   faltan en React: ${s.faltanEnReact.join(', ') || 'ninguno'}`)
    console.log(`   sólo en React:   ${s.soloEnReact.map((x) => x.ref).join(', ') || 'ninguno'}`)
    console.log(`   COLISIONES:      ${s.colisiones.length ? s.colisiones.map((x) => x.ref).join(', ') : 'ninguna'}`)
  }
  console.log(`\n  llamadas a STEL: ${out.llamadasStel} · detalle: ${path.relative(process.cwd(), f)}`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
}
