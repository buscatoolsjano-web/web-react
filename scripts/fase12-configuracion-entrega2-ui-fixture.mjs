/**
 * Fase 12 · Configuración — Entrega 2: fixture para probar Empresa y Numeración
 * en el navegador, sin tocar empresas reales y sin enviar correos.
 *
 *   node scripts/fase12-configuracion-entrega2-ui-fixture.mjs preparar <salida.json> [origen]
 *       empresa zz-cfg2ui con dirección incompleta y sin logo, admin y employee,
 *       secuencias con un caso atrasado (colisión), uno al día, uno adelantado y
 *       uno sin documentos. Escribe en <salida.json> (FUERA del repo) magic links
 *       generados con generateLink: son de un solo uso y se borran al terminar.
 *   node scripts/fase12-configuracion-entrega2-ui-fixture.mjs limpiar
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
const MARCA = 'zz-cfg2ui'

async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  for (const id of ids) {
    const { data: objs } = await s.storage.from('empresa-logos').list(id)
    if (objs?.length) await s.storage.from('empresa-logos').remove(objs.map((o) => `${id}/${o.name}`))
  }
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('suppliers').delete().in('company_id', ids)
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) await s.auth.admin.deleteUser(u.id)
  if (ids.length) {
    await s.from('document_sequences').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
  console.log(`    limpio: ${ids.length} empresa(s) zz-cfg2ui`)
}

const cmd = process.argv[2]
if (cmd === 'limpiar') { await limpiar(); process.exit(0) }
if (cmd !== 'preparar') { console.error('uso: preparar <salida.json> [origen] | limpiar'); process.exit(1) }

const salida = process.argv[3]
const origen = process.argv[4] ?? 'http://localhost:5173'
if (!salida) { console.error('✗ falta salida'); process.exit(1) }
await limpiar()
const { data: emp, error } = await s.from('companies').insert({
  slug: `${MARCA}-${Date.now()}`, name: 'ZZ Empresa UI', legal_name: 'ZZ Empresa de Prueba SL', tax_id: 'B18123456',
  address: 'Ctra. de prueba s/n', phone: null, email: null, website: null, brand_color: '#2563EB', default_currency: 'ARS',
}).select('id').single()
if (error) throw error
const usuario = async (rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}@buscatools.test`
  const { data } = await s.auth.admin.createUser({ email, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: `ZZ ${rol}` } })
  await s.from('company_memberships').insert({ company_id: emp.id, user_id: data.user.id, role: rol, status: 'active' })
  const { data: link } = await s.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${origen}/` } })
  return link.properties.action_link
}
await s.from('document_sequences').insert([
  { company_id: emp.id, doc_type: 'customer', prefix: 'CLI', padding: 5, next_number: 3, series_code: 'CLI', is_default: true },
  { company_id: emp.id, doc_type: 'supplier', prefix: 'PROV', padding: 5, next_number: 2, series_code: 'PROV', is_default: true },
  { company_id: emp.id, doc_type: 'purchase_order', prefix: 'PC', padding: 5, next_number: 10, series_code: 'PC', is_default: true },
  { company_id: emp.id, doc_type: 'goods_receipt', prefix: 'NTEP', padding: 5, next_number: 1, series_code: 'NTEP', is_default: true },
])
await s.from('customers').insert([
  { company_id: emp.id, legal_name: 'ZZ c5', legacy_ref: 'CLI00005' },
  { company_id: emp.id, legal_name: 'ZZ fuera', legacy_ref: 'TEST-CLI' },
])
await s.from('suppliers').insert({ company_id: emp.id, legal_name: 'ZZ p1', legacy_ref: 'PROV00001' })
await s.from('suppliers').insert({ company_id: emp.id, legal_name: 'ZZ p2', legacy_ref: 'PROV00000' })

const admin = await usuario('admin')
const employee = await usuario('employee')
writeFileSync(salida, JSON.stringify({ empresa: emp.id, admin, employee }))
const r = await fetch(admin, { redirect: 'manual' })
console.log(`    preparado · el enlace redirige a: ${(r.headers.get('location') ?? '').split('#')[0]} (${r.status})`)
// Se consumió al medir: se regenera.
const nuevo = await (async () => {
  const { data: m } = await s.from('company_memberships').select('user_id').eq('company_id', emp.id).eq('role', 'admin').single()
  const { data: u } = await s.auth.admin.getUserById(m.user_id)
  const { data: link } = await s.auth.admin.generateLink({ type: 'magiclink', email: u.user.email, options: { redirectTo: `${origen}/` } })
  return link.properties.action_link
})()
writeFileSync(salida, JSON.stringify({ empresa: emp.id, admin: nuevo, employee }))
