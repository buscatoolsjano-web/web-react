/**
 * Fase 12 · Configuración — Entrega 4: fixture para recorrer TODA Configuración
 * en el navegador (Usuarios, Empresa, Numeración, Listas, Marcas, Categorías,
 * Atributos, Auditoría) como admin y como employee, sin tocar empresas reales
 * y sin enviar correos.
 *
 *   node scripts/fase12-configuracion-entrega4-ui-fixture.mjs preparar <salida.json> [origen]
 *       empresa zz-e4ui con secuencias, autoridad STEL en cotizaciones, marca,
 *       categoría, atributo, lista con precios, un admin y un employee, y
 *       eventos de auditoría generados con las RPC reales (rol, marca,
 *       categoría, empresa). Escribe en <salida.json> (ignorado) dos magic
 *       links de un solo uso (admin y employee).
 *   node scripts/fase12-configuracion-entrega4-ui-fixture.mjs limpiar
 *
 *   set -a; source .env; source .env.migration; set +a
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-e4ui'

async function limpiar() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  for (const id of ids) {
    const { data: objs } = await s.storage.from('empresa-logos').list(id)
    if (objs?.length) await s.storage.from('empresa-logos').remove(objs.map((o) => `${id}/${o.name}`))
  }
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
    await s.from('document_numbering_authority').delete().in('company_id', ids)
    for (const t of ['users_audit', 'company_audit', 'catalog_audit', 'document_numbering_authority_audit']) await s.from(t).delete().in('company_id', ids)
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
const emp = ok(await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ Configuración UI', legal_name: 'ZZ Configuración SA', default_currency: 'USD' }).select('id').single(), 'empresa')
const id = emp.id
ok(await s.from('document_sequences').insert([
  { company_id: id, doc_type: 'quote', prefix: 'COTI', padding: 5, next_number: 8, series_code: 'COTI', is_default: true },
  { company_id: id, doc_type: 'customer', prefix: 'CLI', padding: 5, next_number: 2, series_code: 'CLI', is_default: true },
]), 'secuencias')
ok(await s.from('document_numbering_authority').insert({ company_id: id, doc_type: 'quote', authority: 'STEL', reason: 'ZZ UI: STEL numera cotizaciones' }), 'autoridad')
ok(await s.from('brands').insert({ company_id: id, name: 'ZZ Marca UI', is_active: true }), 'marca')
const cat = ok(await s.from('product_categories').insert({ company_id: id, name: 'ZZ Categoría UI', slug: 'zz-categoria-ui', position: 1, needs_review: false }).select('id').single(), 'cat')
const attr = ok(await s.from('product_attribute_definitions').insert({ company_id: id, key: 'encastre', label: 'Encastre', data_type: 'text', unit: null, is_filterable: true, position: 1 }).select('id').single(), 'attr')
ok(await s.from('product_attribute_categories').insert({ company_id: id, attribute_definition_id: attr.id, category_id: cat.id }), 'pac')
const prod = ok(await s.from('products').insert({ company_id: id, sku: 'ZZUI4-1', name: 'ZZ Producto UI', category_id: cat.id, attributes: { encastre: '1/4' }, status: 'active' }).select('id').single(), 'producto')
const lista = ok(await s.from('price_lists').insert({ company_id: id, name: 'ZZ Lista UI', currency_code: 'USD', is_default: true }).select('id').single(), 'lista')
ok(await s.from('product_prices').insert({ company_id: id, price_list_id: lista.id, product_id: prod.id, amount: 10, valid_from: '2026-01-01' }), 'precio')

const crear = async (rol, nombre) => {
  const email = `${MARCA}-${rol}-${Date.now()}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data } = await s.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: nombre } })
  await s.from('profiles').update({ full_name: nombre }).eq('id', data.user.id)
  ok(await s.from('company_memberships').insert({ company_id: id, user_id: data.user.id, role: rol, status: 'active' }), `membresía ${rol}`)
  return { email, password, userId: data.user.id }
}
const admin = await crear('admin', 'ZZ Admin Configuración')
const employee = await crear('employee', 'ZZ Empleado Configuración')

// Eventos reales con el JWT del admin del fixture (contraseña aleatoria, sólo de este script).
const c = createClient(BASE, PUB, { auth: { persistSession: false } })
ok(await c.auth.signInWithPassword({ email: admin.email, password: admin.password }), 'login admin')
const { data: mem } = await s.from('company_memberships').select('id').eq('user_id', employee.userId).eq('company_id', id).single()
ok(await c.rpc('config_cambiar_rol', { p_membership: mem.id, p_rol: 'salesperson' }), 'rol')
ok(await c.rpc('config_cambiar_rol', { p_membership: mem.id, p_rol: 'employee' }), 'rol vuelta')
const nueva = ok(await c.rpc('config_marca_crear', { p_company: id, p_datos: { name: 'ZZ Marca creada en UI' } }), 'marca crear')[0]
ok(await c.rpc('config_marca_estado', { p_company: id, p_marca: nueva.id, p_activa: false }), 'marca off')
ok(await c.rpc('config_categoria_renombrar', { p_company: id, p_categoria: cat.id, p_esperado: 'ZZ Categoría UI', p_datos: { name: 'ZZ Categoría renombrada UI' } }), 'renombrar')
const { data: e } = await s.from('companies').select('updated_at').eq('id', id).single()
ok(await c.rpc('config_empresa_actualizar', { p_company: id, p_esperado: e.updated_at, p_datos: { phone: '011 5555-0000' } }), 'empresa')
await c.auth.signOut()

const link = async (email) => (await s.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${origen}/` } })).data.properties.action_link
writeFileSync(salida, JSON.stringify({ empresa: id, lista: lista.id, admin: await link(admin.email), employee: await link(employee.email) }))
console.log('    preparado (los enlaces quedaron en el archivo de salida; no se imprimen)')
