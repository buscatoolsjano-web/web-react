/**
 * Fase 184 — dry run (SÓLO LECTURA) del sync STEL→ERP para Torquetools.
 *
 * Lee la StelOrder de Torquetools (su PROPIA key, `.env.torquetools.local`) y el
 * estado actual de la empresa Torquetools en la base, y arma el plan con
 * `planificarE2` para ver QUÉ haría un sync — sin escribir NADA (ni en la base
 * ni en `stel_sync_state`). Todo acotado a Torquetools: la key es de su cuenta y
 * el react se lee por su company_id, así que no se mezcla con Buscatools.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase184-dryrun-torquetools.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel } from './fase14-stel-api-auditoria.mjs'
import { crearCliente } from './lib/stel-api.mjs'
import { CATEGORIA_REVISION, planificarE2, resumirPlan } from './lib/stel-reconciliacion.mjs'

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
const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', react.BT).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
const { data: listas } = await sb.from('price_lists').select('id, name, currency_code, is_default').eq('company_id', react.BT)
const base = (listas ?? []).filter((l) => l.is_default)
console.log(`  empresa react: ${react.BT} · listas: ${(listas ?? []).length} · por defecto: ${base.length}`)
if (base.length !== 1) { console.error('✗ Torquetools no tiene exactamente una lista de precios por defecto'); process.exit(1) }
console.log(`  lista base: ${base[0].name} (${base[0].currency_code})`)

const { plan } = planificarE2(stel, react, { categoriaRevisionId: cat?.id ?? null, listaBaseId: base[0].id, aprobados: { borrados: [] } })
console.log('\n  GATE (sólo lectura, NADA escrito):')
console.log(JSON.stringify(resumirPlan(plan), null, 1))
console.log('\n  (nada se escribió)')
