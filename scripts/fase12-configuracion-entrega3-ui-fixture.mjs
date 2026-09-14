/**
 * Fase 12 · Configuración — Entrega 3: fixture para ver Listas de precios,
 * Marcas, Categorías y Atributos en el navegador, sin tocar empresas reales.
 *
 *   node scripts/fase12-configuracion-entrega3-ui-fixture.mjs preparar <salida.json> [origen]
 *       empresa zz-e3ui con marcas (una usada, una libre, una inactiva),
 *       categorías, 3 atributos, una lista USD con 120 precios (uno en 0 y uno
 *       futuro) y un cliente; empresa zz-e3ui-vacia sin nada. Un admin miembro
 *       de las dos. Escribe en <salida.json> (ignorado) un magic link de un solo uso.
 *   node scripts/fase12-configuracion-entrega3-ui-fixture.mjs limpiar
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
const MARCA = 'zz-e3ui'
const MANANA = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').update({ default_price_list_id: null }).in('company_id', ids)
    await s.from('product_prices').delete().in('company_id', ids)
    await s.from('price_lists').delete().in('company_id', ids)
    await s.from('products').delete().in('company_id', ids)
    await s.from('product_attribute_categories').delete().in('company_id', ids)
    await s.from('product_attribute_definitions').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
    await s.from('brands').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('catalog_audit').delete().in('company_id', ids)
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

const ok = (r, t) => { if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data }
const emp = ok(await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ Catálogo UI', default_currency: 'USD' }).select('id').single(), 'empresa')
const vacia = ok(await s.from('companies').insert({ slug: `${MARCA}-vacia-${Date.now()}`, name: 'ZZ Vacía UI', default_currency: 'USD' }).select('id').single(), 'empresa vacía')
const id = emp.id

const marcas = ok(await s.from('brands').insert([
  { company_id: id, name: 'ZZ SPEEDRILL', is_active: true },
  { company_id: id, name: 'ZZ Marca sin productos', is_active: true },
  { company_id: id, name: 'ZZ Marca inactiva de nombre bastante largo para probar el ajuste', is_active: false },
]).select('id, name'), 'marcas')
const cats = ok(await s.from('product_categories').insert([
  { company_id: id, name: 'Puntas y tubos', slug: 'punta', position: 1, needs_review: false },
  { company_id: id, name: 'Otros', slug: 'otros', position: 2, needs_review: true },
  { company_id: id, name: 'Categoría sin uso', slug: 'sin-uso', position: 3, needs_review: false },
]).select('id, slug'), 'categorías')
const cat = (slug) => cats.find((c) => c.slug === slug).id
const attrs = ok(await s.from('product_attribute_definitions').insert([
  { company_id: id, key: 'encastre', label: 'Encastre', data_type: 'text', unit: null, is_filterable: true, position: 1 },
  { company_id: id, key: 'torq_max', label: 'Torque máximo', data_type: 'number', unit: 'Nm', is_filterable: true, position: 2 },
  { company_id: id, key: 'catalogo_pagina', label: 'Página de catálogo', data_type: 'text', unit: null, is_filterable: false, position: 3 },
]).select('id, key'), 'atributos')
ok(await s.from('product_attribute_categories').insert([
  { company_id: id, attribute_definition_id: attrs[0].id, category_id: cat('punta') },
  { company_id: id, attribute_definition_id: attrs[1].id, category_id: cat('punta') },
]), 'pac')

const productos = ok(await s.from('products').insert(Array.from({ length: 120 }, (_, i) => ({
  company_id: id,
  sku: `ZZUI-${String(i + 1).padStart(4, '0')}`,
  name: i === 0 ? 'Punta Phillips PH2 x 50 mm con un nombre muy largo para ver el ajuste en mobile' : `Producto de prueba ${i + 1}`,
  brand_id: i % 3 === 0 ? marcas[0].id : null,
  category_id: i % 2 === 0 ? cat('punta') : cat('otros'),
  attributes: i % 2 === 0 ? { encastre: '1/4' } : {},
  status: 'active',
}))).select('id, sku'), 'productos')
const lista = ok(await s.from('price_lists').insert({ company_id: id, name: 'ZZ Lista base', currency_code: 'USD', is_default: true }).select('id').single(), 'lista')
ok(await s.from('price_lists').insert({ company_id: id, name: 'ZZ Lista vacía', currency_code: 'ARS' }), 'lista vacía')
ok(await s.from('product_prices').insert([
  ...productos.map((p, i) => ({ company_id: id, price_list_id: lista.id, product_id: p.id, amount: i === 1 ? 0 : 617765.91 / (i + 1), valid_from: '2026-01-01' })),
  { company_id: id, price_list_id: lista.id, product_id: productos[0].id, amount: 12.5, valid_from: MANANA },
]), 'precios')
ok(await s.from('customers').insert({ company_id: id, legal_name: 'ZZ Cliente con lista UI', default_price_list_id: lista.id }), 'cliente')

const email = `${MARCA}-admin-${Date.now()}@buscatools.test`
const { data: u } = await s.auth.admin.createUser({ email, password: `Zz${randomUUID()}!`, email_confirm: true, user_metadata: { full_name: 'ZZ admin catálogo' } })
ok(await s.from('company_memberships').insert([
  { company_id: id, user_id: u.user.id, role: 'admin', status: 'active' },
  { company_id: vacia.id, user_id: u.user.id, role: 'admin', status: 'active' },
]), 'membresías')
const { data: link } = await s.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${origen}/` } })
writeFileSync(salida, JSON.stringify({ empresa: id, vacia: vacia.id, lista: lista.id, admin: link.properties.action_link }))
console.log('    preparado (el enlace quedó en el archivo de salida; no se imprime)')
