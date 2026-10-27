/**
 * Fase 183 — importar a mano las 2 cotizaciones de CORVEN MOTOS.
 *
 * STEL no tiene CUIT para CORVEN, así que la sync no lo matchea solo (sólo por
 * nombre, y no lo confía). El usuario confirmó que CORVEN MOTOS = el cliente
 * `b80ddf86…` del ERP, así que acá se fuerza ese match (aprobados.clientesPorNombre,
 * Fase 183 en la lib) y se importan SÓLO esas 2 cotizaciones, por el mismo
 * camino que la reconciliación (planificarE2 → ejecutarPlan → RPC), así las
 * líneas, totales y auditoría salen bien.
 *
 * Usa la lectura de STEL cacheada del dry-run (no gasta llamadas de STEL) y el
 * estado ACTUAL de la base (leerReactEmpresa). Es reversible: abre su propio run.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase183-importar-corven.mjs            # dry run (no escribe)
 *   node scripts/fase183-importar-corven.mjs aplicar    # escribe
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { leerReactEmpresa } from './fase14-stel-api-auditoria.mjs'
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, planificarE2 } from './lib/stel-reconciliacion.mjs'

const APLICAR = process.argv.includes('aplicar')
const EMPRESA = 'buscatools'
const CORVEN_CUSTOMER = 'b80ddf86-abf3-4462-a1cf-ed7604445441'
const CORVEN_ACCOUNT = '7565272'
const DOCS = ['COTI02603', 'COTI02606']
const CACHE = 'scripts/output/e2/stel-dryrun-84f6af63f0a5.json'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const stel = JSON.parse(fs.readFileSync(CACHE, 'utf8')).stel
const react = await leerReactEmpresa(sb, EMPRESA)
const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', react.BT).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
const { data: listas } = await sb.from('price_lists').select('id, is_default').eq('company_id', react.BT)
const base = (listas ?? []).filter((l) => l.is_default)
if (base.length !== 1) { console.error('✗ la empresa no tiene exactamente una lista de precios por defecto'); process.exit(1) }

const { plan } = planificarE2(stel, react, {
  categoriaRevisionId: cat?.id ?? null,
  listaBaseId: base[0].id,
  aprobados: { borrados: [], clientesPorNombre: [{ customer_id: CORVEN_CUSTOMER, stel_account_id: CORVEN_ACCOUNT }] },
})

const soloCorven = plan.documentos.filter((d) => DOCS.includes(d.numero))
console.log(`\n  productos pendientes en el plan completo: ${plan.productos.length} (crear: ${plan.productos.filter((p) => p.op === 'crear').length})`)
console.log(`  documentos CORVEN resueltos: ${soloCorven.length} / ${DOCS.length}`)
for (const d of soloCorven) console.log(`    ${d.numero} · op=${d.operacion} · cliente=${d.cabecera?.customer_id} · líneas=${d.lineas?.length}`)
const aunBloqueado = (plan.bloqueados ?? []).filter((b) => DOCS.includes(b.numero))
if (aunBloqueado.length) console.log('  ✗ AÚN BLOQUEADOS:', JSON.stringify(aunBloqueado))

if (!APLICAR) { console.log('\n  (dry run — no se escribió nada). Pasá "aplicar" para escribir.\n'); process.exit(0) }
if (soloCorven.length !== DOCS.length) { console.error('\n  ✗ no se resolvieron las 2 de CORVEN; no se aplica.'); process.exit(2) }

// Sólo CORVEN: los productos ya existen (0 a crear tras la reconciliación), así
// que no se tocan otros documentos ni productos.
const planCorven = { ...plan, documentos: soloCorven, productos: [], clientes: [] }
const hash = hashPlan(planCorven)
const hechos = await ejecutarPlan(sb, planCorven, { autorizacion: { planHash: hash, confirmado: true }, log: (m) => console.log('   ', m) })
console.log('\n  HECHOS:', JSON.stringify(hechos))
