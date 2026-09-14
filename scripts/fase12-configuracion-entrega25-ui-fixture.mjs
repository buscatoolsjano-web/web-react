/**
 * Fase 12 · Configuración — Entrega 2.5: fixture para ver en el navegador el
 * bloqueo de emisión por autoridad STEL, sin tocar empresas reales.
 *
 *   node scripts/fase12-configuracion-entrega25-ui-fixture.mjs preparar <salida.json> [origen]
 *       empresa zz-e25ui con quote/sales_order/delivery → STEL, un admin y
 *       documentos IMPORTADOS (cotización borrador, pedido borrador, pedido
 *       confirmado, remito borrador con una línea). Escribe en <salida.json>
 *       (FUERA del repo o ignorado) un magic link de un solo uso.
 *   node scripts/fase12-configuracion-entrega25-ui-fixture.mjs limpiar
 *
 *   set -a; source .env; source .env.migration; set +a
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-e25ui'
const HOY = new Date().toISOString().slice(0, 10)

async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) {
      await s.from(t).update({ imported_at: null }).in('company_id', ids).not('imported_at', 'is', null)
    }
    await s.from('stock_movements').delete().in('company_id', ids)
    await s.from('stock_balances').delete().in('company_id', ids)
    const { data: dels } = await s.from('deliveries').select('id').in('company_id', ids)
    for (const d of dels ?? []) await s.from('delivery_lines').delete().eq('delivery_id', d.id)
    await s.from('deliveries').delete().in('company_id', ids)
    await s.from('sales_orders').delete().in('company_id', ids)
    await s.from('sales_quotes').delete().in('company_id', ids)
    await s.from('sales_audit').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('products').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('warehouses').delete().in('company_id', ids)
    await s.from('document_numbering_authority').delete().in('company_id', ids)
    await s.from('document_numbering_authority_audit').delete().in('company_id', ids)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) await s.auth.admin.deleteUser(u.id)
  if (ids.length) {
    await s.from('document_sequences').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
  console.log(`    limpio: ${ids.length} empresa(s) ${MARCA}`)
}

const cmd = process.argv[2]
if (cmd === 'limpiar') { await limpiar(); process.exit(0) }
if (cmd !== 'preparar') { console.error('uso: preparar <salida.json> [origen] | limpiar'); process.exit(1) }

const salida = process.argv[3]
const origen = process.argv[4] ?? 'http://localhost:5173'
if (!salida) { console.error('✗ falta salida'); process.exit(1) }
await limpiar()

const { data: emp, error } = await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ Empresa STEL UI', default_currency: 'ARS' }).select('id').single()
if (error) throw error
const id = emp.id
await s.from('document_sequences').insert([
  { company_id: id, doc_type: 'quote', prefix: 'COTI', padding: 5, next_number: 10, series_code: 'COTI', is_default: true },
  { company_id: id, doc_type: 'sales_order', prefix: 'PDV', padding: 5, next_number: 10, series_code: 'PDV', is_default: true },
  { company_id: id, doc_type: 'delivery', prefix: 'RT', padding: 10, next_number: 10, series_code: 'RT', is_default: true },
])
await s.from('document_numbering_authority').insert(['quote', 'sales_order', 'delivery'].map((t) => ({ company_id: id, doc_type: t, authority: 'STEL', reason: 'ZZ E25 UI fixture' })))
const { data: cli } = await s.from('customers').insert({ company_id: id, legal_name: 'ZZ Cliente STEL UI' }).select('id').single()
const { data: rubro } = await s.from('product_categories').insert({ company_id: id, name: 'ZZ rubro', slug: `${MARCA}-rubro` }).select('id').single()
const { data: prod } = await s.from('products').insert({ company_id: id, category_id: rubro.id, sku: `${MARCA}-1`, name: 'ZZ Producto UI' }).select('id').single()
const { data: dep } = await s.from('warehouses').insert({ company_id: id, code: 'ZZUI', name: 'ZZ depósito UI' }).select('id').single()

const AHORA = new Date().toISOString()
const imp = { imported_at: AHORA, legacy_source: MARCA, customer_id: cli.id, company_id: id }
const { data: q } = await s.from('sales_quotes').insert({ ...imp, number: 'COTI00007', quote_date: HOY, status: 'draft', title: 'Cotización importada de STEL' }).select('id').single()
const { data: oBorr } = await s.from('sales_orders').insert({ ...imp, number: 'PDV00008', order_date: HOY, commercial_status: 'draft' }).select('id').single()
const { data: oConf } = await s.from('sales_orders').insert({ ...imp, number: 'PDV00009', order_date: HOY, commercial_status: 'confirmed' }).select('id').single()
const { data: d } = await s.from('deliveries').insert({ ...imp, number: 'RT0000000009', order_id: oConf.id, delivery_date: HOY, status: 'draft' }).select('id').single()
await s.from('delivery_lines').insert({ company_id: id, delivery_id: d.id, product_id: prod.id, warehouse_id: dep.id, quantity: 1 })

const email = `${MARCA}-admin-${Date.now()}@buscatools.test`
const { data: u } = await s.auth.admin.createUser({ email, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ admin STEL' } })
await s.from('company_memberships').insert({ company_id: id, user_id: u.user.id, role: 'admin', status: 'active' })
const { data: link } = await s.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${origen}/` } })
writeFileSync(salida, JSON.stringify({ empresa: id, admin: link.properties.action_link, cotizacion: q.id, pedidoBorrador: oBorr.id, pedidoConfirmado: oConf.id, remito: d.id }))
console.log('    preparado (el enlace quedó en el archivo de salida; no se imprime)')
