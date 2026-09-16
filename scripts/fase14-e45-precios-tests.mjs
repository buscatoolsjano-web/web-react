/**
 * Fase 14 · E4.5 — alineación de precios: clasificación, escritura acotada,
 * sync incremental de precio y prueba funcional de cotización (base real, fixture).
 *
 *   1  clasificación pura: cada caso cae donde tiene que caer;
 *   2  escritura: alinea el precio de la lista por defecto y NO toca las otras
 *      listas, ni el precio de las líneas de documentos, ni los totales;
 *   3  sync incremental: STEL cambia un precio → se actualiza, el checkpoint
 *      avanza y una segunda corrida no hace nada (sin full scan);
 *   4  funcional: cotización USD toma el precio alineado, sobrevive a
 *      guardar/reabrir y el pedido lo conserva; si después cambia el catálogo,
 *      los documentos ya emitidos no se mueven;
 *   5  limpieza total y datos reales intactos.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-e45-precios-tests.mjs
 *
 * NO correr en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { clasificarPrecio } from './fase14-e45-precios-alineacion.mjs'
import { huellaEmpresa } from './lib/stel-reconciliacion.mjs'
import { sincronizarProductos } from './lib/stel-sync.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-f14e45'
const HOY = new Date().toISOString().slice(0, 10)

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const ok = (r, que) => { if (r.error) throw new Error(`${que}: ${r.error.message}`); return r.data }
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const num = (v) => (v === null || v === undefined ? null : Number(v))

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return c
}
const usuario = async (companyId, rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  ok(await s.from('company_memberships').insert({ company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }), `membresía ${rol}`)
  return login(email, password)
}

async function huellaReal() {
  const { data: c } = await s.from('companies').select('id').not('slug', 'like', 'zz-%')
  const out = {}
  for (const { id } of c) for (const [t, v] of Object.entries(await huellaEmpresa(s, id))) out[`${id.slice(0, 4)}.${t}`] = v.hash
  return hash(out)
}

async function barrer() {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  for (const { id } of emp ?? []) {
    for (const t of ['stock_reservations', 'stock_movements', 'stock_balances', 'sales_audit']) ok(await s.from(t).delete().eq('company_id', id), `limpiar ${t}`)
    ok(await s.from('sales_orders').update({ quote_id: null }).eq('company_id', id).not('imported_at', 'is', null), 'desvincular')
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) ok(await s.from(t).update({ imported_at: null }).eq('company_id', id).not('imported_at', 'is', null), `desmarcar ${t}`)
    // Las líneas de cotización y pedido se van con el documento: borrarlas a mano
    // choca con el trigger de documento cerrado.
    ok(await s.from('delivery_lines').delete().eq('company_id', id), 'limpiar delivery_lines')
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) ok(await s.from(t).delete().eq('company_id', id), `limpiar ${t}`)
    ok(await s.from('stel_sync_state').delete().eq('company_id', id), 'limpiar sync_state')
    ok(await s.from('stel_reconciliation_log').delete().eq('company_id', id), 'limpiar bitácora')
    ok(await s.from('stel_reconciliation_runs').delete().eq('company_id', id), 'limpiar runs')
    for (const t of ['product_prices', 'price_lists', 'products', 'product_categories', 'company_memberships', 'customers', 'warehouses',
      'document_numbering_authority_series', 'document_numbering_authority', 'document_numbering_authority_audit', 'document_sequences']) {
      ok(await s.from(t).delete().eq('company_id', id), `limpiar ${t}`)
    }
    ok(await s.from('companies').delete().eq('id', id), 'limpiar empresa')
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
}

/** Cliente de STEL simulado: devuelve páginas fijas y cuenta llamadas. */
function clienteFalso(paginas) {
  let llamadas = 0
  return {
    llamadas: () => llamadas,
    async get(ruta, params) {
      llamadas++
      const clave = `${ruta}:${params.start ?? 0}`
      return paginas[clave] ?? []
    },
    async todos() { throw new Error('no se usa') },
  }
}

async function main() {
  await barrer()
  const huellaAntes = await huellaReal()
  PASS('huella real tomada', huellaAntes)

  // ── 1 · Clasificación ──────────────────────────────────────────────────────
  seccion('1 · Clasificación de cada producto vinculado')
  const caso = (p) => clasificarPrecio({ stelEncontrado: true, idDistinto: false, stelInactivo: false, precioStel: 10, precioReact: 30, preciosEnLista: 1, ...p }).clase
  cmp('React al triple de STEL → SAFE_TO_ALIGN', 'SAFE_TO_ALIGN', caso({}))
  cmp('ratio cualquiera, sin ambigüedad → SAFE_TO_ALIGN', 'SAFE_TO_ALIGN', caso({ precioReact: 4 }))
  cmp('React sin precio en la lista → SAFE_TO_ALIGN (se crea)', 'SAFE_TO_ALIGN', caso({ precioReact: null, preciosEnLista: 0 }))
  cmp('precios iguales → ALREADY_EQUAL', 'ALREADY_EQUAL', caso({ precioReact: 10 }))
  cmp('diferencia de centavos → ALREADY_EQUAL', 'ALREADY_EQUAL', caso({ precioReact: 10.004 }))
  cmp('STEL sin precio → NO_STEL_PRICE', 'NO_STEL_PRICE', caso({ precioStel: 0 }))
  cmp('dos precios vigentes en la lista → MULTIPLE_PRICE_SOURCE', 'MULTIPLE_PRICE_SOURCE', caso({ preciosEnLista: 2 }))
  cmp('la referencia devuelve otro ítem → DATA_CONFLICT', 'DATA_CONFLICT', caso({ idDistinto: true }))
  cmp('ítem inactivo en STEL → HUMAN_REVIEW', 'HUMAN_REVIEW', caso({ stelInactivo: true }))
  cmp('id STEL ilegible → HUMAN_REVIEW', 'HUMAN_REVIEW', caso({ stelEncontrado: false }))
  cmp('el conflicto de id gana sobre el precio', 'DATA_CONFLICT', caso({ idDistinto: true, precioStel: 0 }))

  // ── Fixture ────────────────────────────────────────────────────────────────
  seccion('2 · Escritura acotada a la lista por defecto')
  const E = ok(await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ F14 E4.5', default_currency: 'USD' }).select('id').single(), 'empresa').id
  ok(await s.from('document_sequences').insert([
    { company_id: E, doc_type: 'quote', series_code: 'COTI', prefix: 'COTI', padding: 5, next_number: 1, is_default: true },
    { company_id: E, doc_type: 'sales_order', series_code: 'PDV', prefix: 'PDV', padding: 5, next_number: 1, is_default: true },
  ]), 'secuencias')
  const cli = ok(await s.from('customers').insert({ company_id: E, legal_name: 'ZZ E4.5 Cliente', status: 'active' }).select('id').single(), 'cliente').id
  const cat = ok(await s.from('product_categories').insert({ company_id: E, name: 'ZZ E4.5 revisión', slug: `${MARCA}-rev-${Date.now()}`, needs_review: true }).select('id').single(), 'rubro').id
  const base = ok(await s.from('price_lists').insert({ company_id: E, name: 'ZZ E4.5 Lista base', currency_code: 'USD', is_default: true }).select('id').single(), 'lista base').id
  const otra = ok(await s.from('price_lists').insert({ company_id: E, name: 'ZZ E4.5 Distribuidores', currency_code: 'USD', is_default: false }).select('id').single(), 'otra lista').id
  const P = ok(await s.from('products').insert({ company_id: E, category_id: cat, sku: 'ZZE45-A', name: 'ZZ E4.5 producto', external_source: 'stel', external_id: '770001' }).select('id').single(), 'producto').id
  // React al triple (el patrón real) y la otra lista con su propio precio.
  ok(await s.from('product_prices').insert([
    { company_id: E, price_list_id: base, product_id: P, amount: 300 },
    { company_id: E, price_list_id: otra, product_id: P, amount: 250 },
  ]), 'precios')

  const run = ok(await s.rpc('stel_sync_tomar', { p_company: E, p_entidad: 'products', p_owner: 'test-e45' }), 'tomar').run
  const r1 = await s.rpc('stel_sync_precio', { p_run: run, p: { stel_id: '770001', price_list_id: base, amount: 100 } })
  cmp('alinea el precio de la lista por defecto', ['actualizado', 100], [r1.data?.resultado, num(ok(await s.from('product_prices').select('amount').eq('price_list_id', base).eq('product_id', P).single(), 'precio base').amount)])
  cmp('la otra lista queda intacta', 250, num(ok(await s.from('product_prices').select('amount').eq('price_list_id', otra).eq('product_id', P).single(), 'precio otra').amount))
  const r2 = await s.rpc('stel_sync_precio', { p_run: run, p: { stel_id: '770001', price_list_id: base, amount: 100 } })
  cmp('repetir la alineación no cambia nada', 'sin_cambios', r2.data?.resultado)
  cmp('quedó un solo precio vigente', 1, (await s.from('product_prices').select('*', { count: 'exact', head: true }).eq('price_list_id', base).eq('product_id', P)).count)
  cmp('el cambio quedó en bitácora y es revertible', 1, (await s.from('stel_reconciliation_log').select('*', { count: 'exact', head: true }).eq('run_id', run).eq('entity_type', 'product_price')).count)
  ok(await s.rpc('stel_sync_cerrar', { p_run: run, p_estado: 'finished', p_cursor: null, p_cursor_id: null, p_llamadas: 0, p_resumen: {}, p_error: null }), 'cerrar')

  // ── 3 · Sync incremental de precio ─────────────────────────────────────────
  seccion('3 · Sync incremental: STEL cambia un precio')
  const item = (precio, modificado) => ({ id: 770001, 'full-reference': 'ZZE45-A', name: 'ZZ E4.5 producto', description: '', inactive: false, deleted: false, 'sales-price': precio, 'utc-last-modification-date': modificado })
  const correr = async (paginas, desde) => {
    const c = clienteFalso(paginas)
    const { resumen } = await sincronizarProductos(s, c, {
      company: E, owner: 'test-e45', categoriaRevisionId: cat, listaPreciosId: base,
      crearNuevos: false, desde, incluirServicios: false, log: () => {},
    })
    return { resumen, llamadas: c.llamadas() }
  }
  const a = await correr({ 'products:0': [item(80, '2026-09-20T10:00:00+0000')] }, '2026-09-01T00:00:00Z')
  cmp('el precio nuevo de STEL se escribe en la lista', [1, 80], [a.resumen.precios.actualizados, num(ok(await s.from('product_prices').select('amount').eq('price_list_id', base).eq('product_id', P).single(), 'precio').amount)])
  const est1 = ok(await s.from('stel_sync_state').select('cursor_modified_at, last_status').eq('company_id', E).eq('entity', 'products').single(), 'estado')
  cmp('el checkpoint avanzó a la fecha del ítem', ['finished', true], [est1.last_status, est1.cursor_modified_at?.startsWith('2026-09-20')])
  const b = await correr({ 'products:0': [item(80, '2026-09-20T10:00:00+0000')] })
  cmp('segunda corrida: no lee nada y no escribe nada', [0, 0, 0], [b.resumen.leidos, b.resumen.actualizados, b.resumen.precios.actualizados])
  cmp('y le alcanzó con una página (sin full scan)', 1, b.llamadas)
  const c3 = await correr({ 'products:0': [item(95, '2026-09-21T10:00:00+0000')] })
  cmp('un cambio posterior sí se toma', [1, 95], [c3.resumen.precios.actualizados, num(ok(await s.from('product_prices').select('amount').eq('price_list_id', base).eq('product_id', P).single(), 'precio').amount)])

  // ── 4 · Funcional ──────────────────────────────────────────────────────────
  seccion('4 · Cotización USD con el precio alineado')
  const admin = await usuario(E, 'admin')
  const precioLista = num(ok(await s.from('product_prices').select('amount').eq('price_list_id', base).eq('product_id', P).single(), 'precio').amount)
  cmp('la lista por defecto tiene el precio actual de STEL', 95, precioLista)
  cmp('y no es el triple del de STEL', true, precioLista !== 285)
  const nq = ok(await admin.rpc('next_document_number', { p_company: E, p_doc_type: 'quote' }), 'número')
  const q = ok(await admin.from('sales_quotes').insert({ company_id: E, number: nq, series_code: 'COTI', customer_id: cli, quote_date: HOY, currency_code: 'USD', status: 'draft' }).select('id').single(), 'cotización')
  ok(await admin.from('sales_quote_lines').insert({ company_id: E, quote_id: q.id, line_no: 1, line_type: 'item', product_id: P, sku_snapshot: 'ZZE45-A', name_snapshot: 'ZZ E4.5 producto', quantity: 2, unit_price: precioLista, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea')
  const linea = ok(await admin.from('sales_quote_lines').select('unit_price, quantity').eq('quote_id', q.id).single(), 'línea guardada')
  cmp('la línea guarda el precio de la lista', 95, num(linea.unit_price))
  cmp('el total de la línea es cantidad × precio', 190, num(linea.quantity) * num(linea.unit_price))
  await admin.from('sales_quotes').update({ status: 'sent' }).eq('id', q.id)
  await admin.from('sales_quotes').update({ status: 'accepted' }).eq('id', q.id)
  const o = ok(await admin.from('sales_orders').insert({ company_id: E, number: ok(await admin.rpc('next_document_number', { p_company: E, p_doc_type: 'sales_order' }), 'número pedido'), series_code: 'PDV', customer_id: cli, quote_id: q.id, origin: 'quote', order_date: HOY, currency_code: 'USD', commercial_status: 'draft' }).select('id').single(), 'pedido')
  ok(await admin.from('sales_order_lines').insert({ company_id: E, order_id: o.id, line_no: 1, line_type: 'item', product_id: P, sku_snapshot: 'ZZE45-A', name_snapshot: 'ZZ E4.5 producto', quantity_ordered: 2, unit_price: num(linea.unit_price), discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea pedido')
  cmp('el pedido conserva el precio de la cotización', 95, num(ok(await admin.from('sales_order_lines').select('unit_price').eq('order_id', o.id).single(), 'línea pedido').unit_price))

  // El catálogo vuelve a cambiar: el documento ya emitido no se mueve.
  const antesDoc = hash([ok(await s.from('sales_quote_lines').select('unit_price, quantity').eq('quote_id', q.id), 'líneas cot'), ok(await s.from('sales_order_lines').select('unit_price').eq('order_id', o.id), 'líneas ped')])
  await correr({ 'products:0': [item(500, '2026-09-22T10:00:00+0000')] })
  cmp('el catálogo cambia a 500', 500, num(ok(await s.from('product_prices').select('amount').eq('price_list_id', base).eq('product_id', P).single(), 'precio').amount))
  const despuesDoc = hash([ok(await s.from('sales_quote_lines').select('unit_price, quantity').eq('quote_id', q.id), 'líneas cot'), ok(await s.from('sales_order_lines').select('unit_price').eq('order_id', o.id), 'líneas ped')])
  cmp('los documentos ya emitidos NO cambian de precio', antesDoc, despuesDoc)
  cmp('el sync de precios no generó movimientos de stock', 0, (await s.from('stock_movements').select('*', { count: 'exact', head: true }).eq('company_id', E)).count)
  cmp('ni eventos de venta', 0, (await s.from('sales_audit').select('*', { count: 'exact', head: true }).eq('company_id', E)).count)

  // ── 5 · Limpieza ───────────────────────────────────────────────────────────
  seccion('5 · Limpieza y datos reales intactos')
  await barrer()
  cmp('no quedan empresas fixture', 0, (await s.from('companies').select('*', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  cmp('datos reales intactos', huellaAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? 'TODO PASA' : `${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error('✗', e.message); try { await barrer() } catch { /* ya reportado */ } process.exit(1) })
