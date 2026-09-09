/**
 * Fase 4 · Stage 2.5 — series_code en los documentos históricos.
 *
 * Un tipo de documento puede tener varias series a la vez: `delivery` se emite
 * como RT… y como RT-ML… en paralelo. Este script registra de qué serie salió
 * cada documento histórico, SIN tocar `original_number` ni `number`.
 *
 * La serie se reconoce por el prefijo del número original, y sólo si es una de
 * las series conocidas de ese tipo. Un número que no encaje en ninguna queda
 * con series_code = NULL y se reporta: no se inventa una serie nueva.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/backfill-series-code.mjs            # dry run
 *   node scripts/backfill-series-code.mjs --apply
 */
import { createClient } from '@supabase/supabase-js'

const APLICAR = process.argv.includes('--apply')

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

// Series conocidas por tipo. Las más largas primero: 'RT-ML' antes que 'RT',
// o RT-ML2025000058 se leería como serie 'RT'.
const SERIES = {
  sales_quotes: { doc_type: 'quote', codigos: ['COTI'] },
  sales_orders: { doc_type: 'sales_order', codigos: ['PDV'] },
  deliveries: { doc_type: 'delivery', codigos: ['RT-ML', 'RT'] },
}

async function traerTodo(tabla, select, filtro = (q) => q, orden = ['id']) {
  const filas = []
  for (let d = 0; ; d += 1000) {
    let q = filtro(sb.from(tabla).select(select))
    for (const c of orden) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(d, d + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return filas
}

const main = async () => {
  console.log('='.repeat(74))
  console.log(`  SERIES_CODE  ·  ${APLICAR ? 'APLICAR' : 'DRY RUN (no escribe)'}`)
  console.log('='.repeat(74))

  const { data: secuencias, error: e1 } = await sb.from('document_sequences')
    .select('company_id, doc_type, series_code, prefix, padding, next_number, is_default')
  if (e1) throw new Error(`document_sequences: ${e1.message}`)

  console.log('\n  -- secuencias activas --')
  console.log('     doc_type      series   prefix  pad  próximo  default')
  for (const s of secuencias.sort((a, b) => a.doc_type.localeCompare(b.doc_type))) {
    console.log(`     ${s.doc_type.padEnd(13)} ${s.series_code.padEnd(8)} ${s.prefix.padEnd(7)} ` +
      `${String(s.padding).padStart(3)} ${String(s.next_number).padStart(8)}  ${s.is_default ? 'sí' : 'no'}`)
  }

  let totalEscritas = 0
  for (const [tabla, { doc_type, codigos }] of Object.entries(SERIES)) {
    const filas = await traerTodo(tabla, 'id, original_number, number, series_code',
      (q) => q, ['original_number'])
    const conteo = {}, sinSerie = []
    const aEscribir = []
    for (const r of filas) {
      const num = r.original_number ?? r.number ?? ''
      const code = codigos.find((c) => num.startsWith(c)) ?? null
      if (!code) { sinSerie.push(num); continue }
      conteo[code] = (conteo[code] ?? 0) + 1
      if (r.series_code !== code) aEscribir.push({ id: r.id, code })
    }
    console.log(`\n  -- ${tabla} (${doc_type}) --`)
    for (const [c, n] of Object.entries(conteo)) console.log(`     ${c.padEnd(8)} ${String(n).padStart(5)}`)
    if (sinSerie.length) {
      console.log(`     SIN SERIE RECONOCIDA  ${sinSerie.length}   ${sinSerie.slice(0, 5).join(', ')}`)
      console.log('     (quedan en NULL: no se inventa una serie)')
    }
    console.log(`     a actualizar          ${aEscribir.length}` +
      (aEscribir.length === 0 ? '   <- idempotente: ya estaba' : ''))

    if (!APLICAR) continue
    for (let i = 0; i < aEscribir.length; i += 25) {
      await Promise.all(aEscribir.slice(i, i + 25).map(async (x) => {
        const { error } = await sb.from(tabla).update({ series_code: x.code }).eq('id', x.id)
        if (error) throw new Error(`${tabla} ${x.id}: ${error.message}`)
        totalEscritas++
      }))
    }
  }

  console.log(`\n  documentos actualizados          ${APLICAR ? totalEscritas : '(dry run)'}`)
  console.log('='.repeat(74))
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
