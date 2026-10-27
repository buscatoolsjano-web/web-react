/**
 * Fase 185 — reconciliación inicial del pipeline de ventas de Torquetools
 * (cotizaciones/pedidos/remitos), MISMA lógica que Buscatools pero para TT.
 *
 * Acotado 100% a Torquetools, no se mezcla con Buscatools:
 *   · la StelOrder se lee con la key de TT (`.env.torquetools.local`);
 *   · el react se lee por el company_id de TT; `planificarE2` matchea sólo esa
 *     empresa; `ejecutarPlan` valida que el plan sea de esa empresa.
 *
 * El catálogo de TT es un clon por SKU con nombres propios, así que muchos ítems
 * de STEL matchean un producto por SKU pero con nombre distinto (NAME_MISMATCH).
 * El usuario confirmó vincularlos por SKU: se agregan a `vinculosProducto`.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase185-sync-torquetools.mjs            # dry run (no escribe)
 *   node scripts/fase185-sync-torquetools.mjs aplicar    # escribe (en TT)
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel } from './fase14-stel-api-auditoria.mjs'
import { crearCliente } from './lib/stel-api.mjs'
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, planificarE2, resumirPlan } from './lib/stel-reconciliacion.mjs'

const APLICAR = process.argv.includes('aplicar')
const EMPRESA = 'torquetools'
const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const cacheDir = path.resolve(`.stel-cache/tt-${Date.now()}`)
const c = crearCliente({ maxLlamadas: 250, usarCache: true, cacheDir, archivoClave: '.env.torquetools.local', log: () => {} })
let stel
try { stel = await leerStel(c, { conMaestro: false, loteReferencias: 80 }) }
finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
console.log(`  llamadas a STEL (Torquetools): ${c.llamadas()}`)
console.log('  STEL ahora:', JSON.stringify({ quote: stel.docs.quote.length, order: stel.docs.order.length, delivery: stel.docs.delivery.length }))

const react = await leerReactEmpresa(sb, EMPRESA)
if (react.BT !== '492a0ee9-220f-4dc8-9eaa-ec914ea10907') { console.error('✗ el react NO es Torquetools; abortando por seguridad'); process.exit(1) }
const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', react.BT).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
const { data: listas } = await sb.from('price_lists').select('id, name, currency_code, is_default').eq('company_id', react.BT)
const base = (listas ?? []).filter((l) => l.is_default)
if (base.length !== 1) { console.error('✗ TT no tiene exactamente una lista de precios por defecto'); process.exit(1) }
console.log(`  empresa: ${react.BT} · lista base: ${base[0].name} (${base[0].currency_code})`)
const ctx = { categoriaRevisionId: cat?.id ?? null, listaBaseId: base[0].id }

// Pass 1: sin confirmaciones, para encontrar los productos SKU-igual/nombre-distinto.
const { plan: plan0 } = planificarE2(stel, react, { ...ctx, aprobados: { borrados: [] } })
const nameMismatch = (plan0.bloqueados ?? []).filter((b) => b.tipo === 'product' && b.motivo === 'NAME_MISMATCH').map((b) => String(b.stel_id))
console.log(`\n  productos SKU-igual/nombre-distinto a confirmar por SKU: ${nameMismatch.length}`)

// Las series COV/PDV/PL/NRV de TT ahora tienen a STEL como autoridad
// (document_numbering_authority_series, Fase 185), así que entran sin aprobación
// por documento. Las series con número inválido (PACKING_LIST/PckList/Packing
// List_) no importan por formato: se dejan afuera y se miran aparte.
const SERIES_INVALIDAS = ['PACKING_LIST', 'PckList', 'Packing List_', 'Packing List']
const serieDe = (n) => (n ?? '').replace(/[0-9]+$/, '')

// Pass 2: confirmando los productos por SKU.
const { plan: planCompleto } = planificarE2(stel, react, { ...ctx, aprobados: { borrados: [], vinculosProducto: nameMismatch } })
const plan = { ...planCompleto, documentos: planCompleto.documentos.filter((d) => !SERIES_INVALIDAS.includes(serieDe(d.numero))) }
console.log('\n  GATE (con los 69 confirmados por SKU):')
console.log(JSON.stringify(resumirPlan(plan), null, 1))
const bloq = plan.bloqueados ?? []
if (bloq.length) console.log('\n  bloqueados que quedan:', JSON.stringify(bloq.slice(0, 20)))

if (!APLICAR) { console.log('\n  (dry run — NADA escrito). Pasá "aplicar" para escribir en TT.\n'); process.exit(0) }

const hash = hashPlan(plan)
const hechos = await ejecutarPlan(sb, plan, { autorizacion: { planHash: hash, confirmado: true }, log: (m) => console.log('   ', m) })
console.log('\n  HECHOS:', JSON.stringify({ ...hechos, fallidos: hechos.fallidos.length, salteados: hechos.salteados.length }))
if (hechos.fallidos.length) console.log('  FALLIDOS:', JSON.stringify(hechos.fallidos.slice(0, 20)))
