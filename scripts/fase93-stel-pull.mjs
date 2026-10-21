/*
 * Fase 93 · traer el histórico de Torquetools desde StelOrder. SÓLO LEE STEL.
 *
 * Baja a JSON local (scratchpad) clientes, proveedores y los documentos de
 * venta y compra. El listado ya incluye las LÍNEAS y el account-id, así que
 * alcanza con paginar: pocas llamadas, dentro del límite de 60/min.
 *
 * La clave es la de Torquetools (.env.torquetools.local, gitignored). Sólo GET.
 * No escribe en la base; el mapeo e inserción van en el paso siguiente.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const KEY = readFileSync('.env.torquetools.local', 'utf8').match(/STEL_API_KEY=(.*)/)[1].trim()
const BASE = 'https://app.stelorder.com/app'
const OUT = process.argv[2] || 'scripts/.stel-tt'
mkdirSync(OUT, { recursive: true })
const red = (t) => String(t).split(KEY).join('[RED]')
const PAUSA = 1200
let ultima = 0
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(ruta, params = {}) {
  const esp = ultima + PAUSA - Date.now()
  if (esp > 0) await esperar(esp)
  ultima = Date.now()
  const qs = new URLSearchParams(params)
  for (let intento = 1; ; intento++) {
    const r = await fetch(`${BASE}/${ruta}?${qs}`, { headers: { APIKEY: KEY, Accept: 'application/json' } }).catch((e) => ({ ok: false, status: 0, _e: e }))
    if (r.status === 429 || r.status >= 500) { if (intento < 4) { await esperar(r.status === 429 ? 61000 : 4000); continue } }
    if (!r.ok) throw new Error(`STEL ${ruta} HTTP ${r.status}: ${red((await r.text?.().catch(() => '')) || r._e?.message || '')}`.slice(0, 160))
    return r.json()
  }
}
async function todos(ruta, { limite = 200, maxPag = 400 } = {}) {
  const out = []
  for (let p = 0; p < maxPag; p++) {
    const pag = await get(ruta, { limit: limite, start: p * limite })
    const arr = Array.isArray(pag) ? pag : []
    out.push(...arr)
    if (p % 5 === 0) process.stdout.write(`\r  ${ruta}: ${out.length}   `)
    if (arr.length < limite) break
  }
  console.log(`\r  ${ruta}: ${out.length}        `)
  return out
}

const recursos = ['clients', 'suppliers', 'ordinaryInvoices', 'refundInvoices', 'purchaseInvoices']
for (const r of recursos) {
  const f = join(OUT, `${r}.json`)
  if (existsSync(f)) { console.log(`  ${r}: ya está (${JSON.parse(readFileSync(f, 'utf8')).length})`); continue }
  const datos = await todos(r)
  writeFileSync(f, JSON.stringify(datos))
}
console.log('[pull] listo →', OUT)
