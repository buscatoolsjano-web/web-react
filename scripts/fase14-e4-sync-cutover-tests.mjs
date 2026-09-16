/**
 * Fase 14 · Entrega 4 — sync, excepciones, autoridad por serie y ENSAYO DE CORTE
 * (base real, empresas fixture zz-f14e4-*).
 *
 *   1  excepciones: estado regresivo sin aprobación / con aprobación / con
 *      derivados; identidad fuerte de cliente (alta, repetida, en conflicto,
 *      inválida); vínculo de producto por id STEL;
 *   2  sync de productos: alta, actualización, inactivo → discontinued, SKU ya
 *      existente, idempotencia, y lo que NO toca (categoría, marca, stock, SKU);
 *   3  precios: alta, cambio, sin cambio, lista inválida, producto no vinculado;
 *   4  checkpoint y candado: dos sync a la vez, fallo que no avanza el
 *      checkpoint, resume desde el checkpoint;
 *   5  autoridad por serie: sin filas manda el tipo; serie STEL sobre tipo ERP
 *      bloquea sólo esa serie; serie ERP sobre tipo STEL habilita sólo esa;
 *      RT-ML import-only; importar en una serie que ya emite el ERP → rechazo;
 *   6  delta de documentos: importa, es idempotente, no mueve stock y no consume
 *      secuencia;
 *   7  ENSAYO DE CORTE completo en la fixture (13 pasos) → scripts/output/e4/ensayo.json;
 *   8  funciones puras del preflight y del gate;
 *   9  limpieza total y datos reales intactos.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-e4-sync-cutover-tests.mjs
 *
 * NO correr en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { decidir } from './fase14-e4-gate-excepciones.mjs'
import { ES_ATIPICO, mayorDeSerie, proximoNumero } from './fase14-cutover-preflight.mjs'
import { huellaEmpresa } from './lib/stel-reconciliacion.mjs'
import { productoDeStel } from './lib/stel-sync.mjs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-f14e4'
const HOY = new Date().toISOString().slice(0, 10)
const SALIDA = path.resolve('scripts/output/e4')

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, JSON.stringify(real).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const ok = (r, que) => { if (r.error) throw new Error(`${que}: ${r.error.message}`); return r.data }
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const num = (v) => (v === null || v === undefined ? null : Number(v))

/** Código semántico del error, o OK. */
const clase = (r) => {
  if (!r.error) return 'OK'
  const m = `${r.error.message ?? ''}`
  for (const c of ['estado_regresivo_con_derivados', 'estado_regresivo_solo_cotizaciones', 'estado_regresivo', 'cuit_en_conflicto',
    'cliente_con_otro_cuit', 'cuit_invalido', 'cliente_inexistente', 'serie_emitida_por_el_erp', 'sync_en_curso',
    'producto_vinculado_a_otro', 'sku_no_coincide', 'lista_de_precios_invalida', 'monto_invalido', 'categoria_no_es_de_revision',
    'estado_producto_invalido', 'run_no_activo', 'DELIVERY_ALREADY_DISPATCHED', 'external_numbering_authority']) {
    if (m.includes(c)) return c
  }
  if (/permission denied|Sin permiso|42501|row-level security|insufficient_privilege/i.test(`${m} ${r.error.code}`)) return 'PERMISO'
  return `OTRO(${r.error.code}: ${m.slice(0, 70)})`
}

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
    ok(await s.from('sales_orders').update({ quote_id: null }).eq('company_id', id).not('imported_at', 'is', null), 'desvincular históricos')
    for (const t of ['deliveries', 'sales_orders', 'sales_quotes']) ok(await s.from(t).update({ imported_at: null }).eq('company_id', id).not('imported_at', 'is', null), `desmarcar ${t}`)
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

/** Empresa fixture con secuencias, cliente, rubro de revisión, lista y depósito. */
async function empresa(etiqueta, { autoridadStel = true } = {}) {
  const E = ok(await s.from('companies').insert({ slug: `${MARCA}-${etiqueta}-${Date.now()}`, name: `ZZ F14 E4 ${etiqueta}`, default_currency: 'USD' }).select('id').single(), 'empresa').id
  ok(await s.from('document_sequences').insert([
    { company_id: E, doc_type: 'quote', series_code: 'COTI', prefix: 'COTI', padding: 5, next_number: 1, is_default: true },
    { company_id: E, doc_type: 'sales_order', series_code: 'PDV', prefix: 'PDV', padding: 5, next_number: 1, is_default: true },
    { company_id: E, doc_type: 'delivery', series_code: 'RT', prefix: 'RT', padding: 10, next_number: 1, is_default: true },
  ]), 'secuencias')
  if (autoridadStel) {
    ok(await s.from('document_numbering_authority').insert(['quote', 'sales_order', 'delivery'].map((d) => ({ company_id: E, doc_type: d, authority: 'STEL', reason: 'ZZ fixture E4: STEL numera' }))), 'autoridad')
  }
  const cli = ok(await s.from('customers').insert({ company_id: E, legal_name: `ZZ E4 Cliente ${etiqueta}`, status: 'active' }).select('id').single(), 'cliente').id
  const cat = ok(await s.from('product_categories').insert({ company_id: E, name: 'ZZ E4 revisión', slug: `${MARCA}-rev-${etiqueta}-${Date.now()}`, needs_review: true }).select('id').single(), 'rubro revisión').id
  const catNormal = ok(await s.from('product_categories').insert({ company_id: E, name: 'ZZ E4 rubro', slug: `${MARCA}-rubro-${etiqueta}-${Date.now()}` }).select('id').single(), 'rubro').id
  const lista = ok(await s.from('price_lists').insert({ company_id: E, name: `ZZ E4 base ${etiqueta}`, currency_code: 'USD', is_default: true }).select('id').single(), 'lista').id
  const W = ok(await s.from('warehouses').insert({ company_id: E, code: `ZZE4${etiqueta}`.slice(0, 10), name: 'ZZ E4 depósito', is_default: true }).select('id').single(), 'depósito').id
  return { E, cli, cat, catNormal, lista, W }
}

const iniciarRun = async (E) => ok(await s.rpc('stel_reconciliacion_iniciar', { p_company: E, p_plan_hash: 'a'.repeat(64), p_stel_read_at: new Date().toISOString() }), 'iniciar run')
const cerrarRun = async (run) => ok(await s.rpc('stel_reconciliacion_cerrar', { p_run: run, p_estado: 'finished', p_resumen: {} }), 'cerrar run')

/** Documento histórico importado, como lo deja la reconciliación. */
async function cotizacionImportada(F, { numero, estadoStel, stelId, estado }) {
  const run = await iniciarRun(F.E)
  ok(await s.rpc('stel_reconciliar_documento', {
    p_run: run,
    p: {
      tipo: 'quote', stel_id: stelId, numero, estado_stel: estadoStel, operacion: 'insert',
      cabecera: { customer_id: F.cli, quote_date: HOY, currency_code: 'USD', subtotal: 100, tax_amount: 21, total: 121, series_code: 'COTI', status: estado },
      lineas: { insertar: [{ line_no: 1, line_type: 'item', sku_snapshot: 'ZZE4-X', name_snapshot: 'ZZ E4 ítem', quantity: 1, unit_price: 100, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }], actualizar: [], borrar: [] },
    },
  }), `importar ${numero}`)
  await cerrarRun(run)
  return ok(await s.from('sales_quotes').select('id, status').eq('company_id', F.E).eq('number', numero).single(), 'leer importada')
}

async function main() {
  await barrer()
  const huellaAntes = await huellaReal()
  PASS('huella real tomada', huellaAntes)
  const ensayo = { generado: new Date().toISOString(), pasos: [], resultado: 'FAIL' }

  // ── 1 · Excepciones ────────────────────────────────────────────────────────
  seccion('1 · Excepciones autorizadas (estado regresivo, cliente, vínculo)')
  const F = await empresa('exc')
  const q1 = await cotizacionImportada(F, { numero: 'COTI90001', estadoStel: 'Cerrada', stelId: '900001', estado: 'accepted' })

  const bajar = async (run, numero, id, extra = {}) => s.rpc('stel_reconciliar_documento', {
    p_run: run,
    p: { tipo: 'quote', stel_id: '900001', numero, estado_stel: 'Pendiente', operacion: 'update', react_id: id, cabecera: { status: { old: 'accepted', new: 'sent' } }, lineas: { insertar: [], actualizar: [], borrar: [] }, ...extra },
  })
  let run = await iniciarRun(F.E)
  cmp('estado regresivo sin aprobación → estado_regresivo', 'estado_regresivo', clase(await bajar(run, 'COTI90001', q1.id)))
  cmp('estado regresivo con aprobación y sin derivados → OK', 'OK', clase(await bajar(run, 'COTI90001', q1.id, { aprobar_estado_regresivo: true })))
  cmp('quedó en sent', 'sent', ok(await s.from('sales_quotes').select('status').eq('id', q1.id).single(), 'estado').status)
  await cerrarRun(run)

  // Con un pedido colgando, la base lo rechaza aunque venga aprobado.
  const q2 = await cotizacionImportada(F, { numero: 'COTI90002', estadoStel: 'Cerrada', stelId: '900002', estado: 'accepted' })
  run = await iniciarRun(F.E)
  ok(await s.rpc('stel_reconciliar_documento', {
    p_run: run,
    p: { tipo: 'order', stel_id: '900012', numero: 'PDV90002', estado_stel: 'Pendiente', operacion: 'insert', cabecera: { customer_id: F.cli, order_date: HOY, quote_id: q2.id, currency_code: 'USD', subtotal: 100, tax_amount: 21, total: 121, series_code: 'PDV', commercial_status: 'confirmed', fulfillment_status: 'pending' }, lineas: { insertar: [], actualizar: [], borrar: [] } },
  }), 'pedido hijo')
  const conHijo = await s.rpc('stel_reconciliar_documento', {
    p_run: run,
    p: { tipo: 'quote', stel_id: '900002', numero: 'COTI90002', estado_stel: 'Pendiente', operacion: 'update', react_id: q2.id, cabecera: { status: { old: 'accepted', new: 'sent' } }, lineas: { insertar: [], actualizar: [], borrar: [] }, aprobar_estado_regresivo: true },
  })
  cmp('estado regresivo con un pedido derivado → estado_regresivo_con_derivados', 'estado_regresivo_con_derivados', clase(conHijo))
  cmp('la cotización con derivados sigue accepted', 'accepted', ok(await s.from('sales_quotes').select('status').eq('id', q2.id).single(), 'estado').status)

  // Identidad fuerte de cliente.
  const CUIT = '30712345674'
  const otroCli = ok(await s.from('customers').insert({ company_id: F.E, legal_name: 'ZZ E4 Otro cliente', status: 'active' }).select('id').single(), 'otro cliente').id
  cmp('CUIT inválido → cuit_invalido', 'cuit_invalido', clase(await s.rpc('stel_reconciliar_cliente', { p_run: run, p: { customer_id: F.cli, tax_id: '123' } })))
  cmp('identidad fuerte se carga', 'OK', clase(await s.rpc('stel_reconciliar_cliente', { p_run: run, p: { customer_id: F.cli, stel_account_id: '17453791', tax_id: CUIT } })))
  const rep = await s.rpc('stel_reconciliar_cliente', { p_run: run, p: { customer_id: F.cli, tax_id: CUIT } })
  cmp('repetir la misma identidad es idempotente (0 cambios)', [true, 0], [!rep.error, rep.data?.cambios ?? null])
  cmp('otro cliente con el mismo CUIT → cuit_en_conflicto', 'cuit_en_conflicto', clase(await s.rpc('stel_reconciliar_cliente', { p_run: run, p: { customer_id: otroCli, tax_id: CUIT } })))
  cmp('cambiar el CUIT de un cliente que ya tiene otro → cliente_con_otro_cuit', 'cliente_con_otro_cuit', clase(await s.rpc('stel_reconciliar_cliente', { p_run: run, p: { customer_id: F.cli, tax_id: '30712345675' } })))

  // Vínculo de producto por id STEL.
  const pReact = ok(await s.from('products').insert({ company_id: F.E, category_id: F.catNormal, sku: 'ZZE4-VINC', name: 'ZZ E4 nombre distinto' }).select('id').single(), 'producto').id
  cmp('vincular producto existente al id de STEL', 'OK', clase(await s.rpc('stel_reconciliar_producto', { p_run: run, p: { op: 'vincular', stel_id: '24934825', sku: 'ZZE4-VINC', product_id: pReact } })))
  cmp('vincular con SKU que no coincide → sku_no_coincide', 'sku_no_coincide', clase(await s.rpc('stel_reconciliar_producto', { p_run: run, p: { op: 'vincular', stel_id: '24934826', sku: 'OTRO', product_id: pReact } })))
  cmp('vincular a un segundo id STEL → producto_vinculado_a_otro', 'producto_vinculado_a_otro', clase(await s.rpc('stel_reconciliar_producto', { p_run: run, p: { op: 'vincular', stel_id: '24934827', sku: 'ZZE4-VINC', product_id: pReact } })))
  await cerrarRun(run)

  // ── 2 · Sync de productos ──────────────────────────────────────────────────
  seccion('2 · Sync incremental de productos')
  const S = await empresa('sync')
  const tomar = async (entidad, owner = 'test') => ok(await s.rpc('stel_sync_tomar', { p_company: S.E, p_entidad: entidad, p_owner: owner }), `tomar ${entidad}`)
  const cerrarSync = async (run, estado, cursor) => ok(await s.rpc('stel_sync_cerrar', { p_run: run, p_estado: estado, p_cursor: cursor ?? null, p_cursor_id: null, p_llamadas: 1, p_resumen: { test: true }, p_error: null }), 'cerrar sync')

  let t = await tomar('products')
  cmp('primer sync: sin checkpoint', null, t.cursor_modified_at)
  const item = { id: 555001, 'full-reference': 'ZZE4-SYNC-1', name: 'ZZ E4 sync uno', description: 'Marca: ZZ', inactive: false, deleted: false, clase: 'products' }
  const payload = (extra = {}) => ({ ...productoDeStel(item, { categoriaRevisionId: S.cat }), ...extra })
  const r1 = await s.rpc('stel_sync_producto', { p_run: t.run, p: payload({ crear: false }) })
  cmp('producto nuevo sin --crear-nuevos → nuevo_no_creado', ['OK', 'nuevo_no_creado'], [clase(r1), r1.data?.resultado])
  const r2 = await s.rpc('stel_sync_producto', { p_run: t.run, p: payload({ crear: true }) })
  cmp('con crear=true se crea en el rubro de revisión', ['OK', 'creado'], [clase(r2), r2.data?.resultado])
  const creado = ok(await s.from('products').select('id, sku, name, status, category_id, needs_review, external_source, external_id').eq('company_id', S.E).eq('sku', 'ZZE4-SYNC-1').single(), 'creado')
  cmp('nace vinculado, en revisión y en el rubro de revisión', ['stel', '555001', true, true], [creado.external_source, creado.external_id, creado.needs_review, creado.category_id === S.cat])
  const r3 = await s.rpc('stel_sync_producto', { p_run: t.run, p: payload({ crear: true }) })
  cmp('repetir el mismo producto: idempotente', 'sin_cambios', r3.data?.resultado)
  const r4 = await s.rpc('stel_sync_producto', { p_run: t.run, p: { ...payload(), name: 'ZZ E4 sync uno (nuevo nombre)' } })
  cmp('STEL cambia el nombre → se actualiza', ['actualizado', 1], [r4.data?.resultado, r4.data?.cambios])
  const r5 = await s.rpc('stel_sync_producto', { p_run: t.run, p: { ...payload(), status: 'discontinued' } })
  cmp('STEL lo desactiva → discontinued (nunca borrado)', ['actualizado', 'discontinued'], [r5.data?.resultado, ok(await s.from('products').select('status').eq('id', creado.id).single(), 'estado').status])
  // Movemos el producto de rubro y marca: el sync no puede pisarlos.
  ok(await s.from('products').update({ category_id: S.catNormal }).eq('id', creado.id), 'mover de rubro')
  await s.rpc('stel_sync_producto', { p_run: t.run, p: { ...payload(), name: 'ZZ E4 otro nombre más' } })
  cmp('el sync no toca el rubro que puso React', true, ok(await s.from('products').select('category_id').eq('id', creado.id).single(), 'rubro').category_id === S.catNormal)
  const otroSku = await s.rpc('stel_sync_producto', { p_run: t.run, p: { ...productoDeStel({ ...item, id: 555002 }, { categoriaRevisionId: S.cat }), crear: true } })
  cmp('otro id STEL con un SKU que ya existe → sku_existente (revisión humana)', 'sku_existente', otroSku.data?.resultado)
  cmp('estado inválido → estado_producto_invalido', 'estado_producto_invalido', clase(await s.rpc('stel_sync_producto', { p_run: t.run, p: { ...payload(), status: 'vendido' } })))

  // ── 3 · Precios ────────────────────────────────────────────────────────────
  seccion('3 · Precio de catálogo')
  const precio = async (monto, lista = S.lista) => s.rpc('stel_sync_precio', { p_run: t.run, p: { stel_id: '555001', price_list_id: lista, amount: monto } })
  const p1 = await precio(100)
  cmp('precio nuevo', ['OK', 'creado'], [clase(p1), p1.data?.resultado])
  const p2 = await precio(100)
  cmp('mismo precio: sin cambios', 'sin_cambios', p2.data?.resultado)
  const p3 = await precio(80)
  cmp('precio distinto: se actualiza', ['actualizado', 80], [p3.data?.resultado, num(ok(await s.from('product_prices').select('amount').eq('product_id', creado.id).eq('price_list_id', S.lista).single(), 'precio').amount)])
  cmp('lista de otra empresa → lista_de_precios_invalida', 'lista_de_precios_invalida', clase(await precio(50, F.lista)))
  cmp('monto inválido → monto_invalido', 'monto_invalido', clase(await precio(0)))
  const pSin = await s.rpc('stel_sync_precio', { p_run: t.run, p: { stel_id: '999999', price_list_id: S.lista, amount: 10 } })
  cmp('producto no vinculado → no se inventa nada', 'producto_no_vinculado', pSin.data?.resultado)

  // ── 4 · Checkpoint y candado ───────────────────────────────────────────────
  seccion('4 · Checkpoint, candado y resume')
  cmp('un segundo sync de la misma entidad → sync_en_curso', 'sync_en_curso', clase(await s.rpc('stel_sync_tomar', { p_company: S.E, p_entidad: 'products', p_owner: 'otro' })))
  await cerrarSync(t.run, 'failed', '2026-09-01T00:00:00Z')
  let est = ok(await s.from('stel_sync_state').select('*').eq('company_id', S.E).eq('entity', 'products').single(), 'estado')
  cmp('un sync que falla NO avanza el checkpoint y suelta el candado', [null, 'failed', false], [est.cursor_modified_at, est.last_status, Boolean(est.locked_at)])
  t = await tomar('products')
  await cerrarSync(t.run, 'finished', '2026-09-10T00:00:00Z')
  est = ok(await s.from('stel_sync_state').select('*').eq('company_id', S.E).eq('entity', 'products').single(), 'estado')
  cmp('un sync que termina bien avanza el checkpoint', ['finished', true], [est.last_status, est.cursor_modified_at?.startsWith('2026-09-10')])
  t = await tomar('products')
  cmp('el siguiente arranca del checkpoint (resume)', true, t.cursor_modified_at?.startsWith('2026-09-10'))
  await cerrarSync(t.run, 'finished', '2026-09-11T00:00:00Z')
  cmp('documentos y productos son candados independientes', 'OK', clase(await s.rpc('stel_sync_tomar', { p_company: S.E, p_entidad: 'documents', p_owner: 'test' })))
  const tDoc = ok(await s.from('stel_sync_state').select('last_run_id').eq('company_id', S.E).eq('entity', 'documents').single(), 'run doc').last_run_id
  await cerrarSync(tDoc, 'finished', '2026-09-11T00:00:00Z')
  const adminSync = await usuario(S.E, 'admin')
  const vista = await adminSync.rpc('stel_sync_estado', { p_company: S.E })
  cmp('el admin ve el estado del sync', ['documents', 'products'], (vista.data ?? []).map((x) => x.entity))
  cmp('y ese estado no trae nada de la clave de STEL', true, !JSON.stringify(vista.data ?? []).toLowerCase().includes('apikey'))
  const empleado = await usuario(S.E, 'employee')
  cmp('un empleado no ve el estado del sync', 'PERMISO', clase(await empleado.rpc('stel_sync_estado', { p_company: S.E })))

  // ── 5 · Autoridad por serie ────────────────────────────────────────────────
  seccion('5 · Autoridad por serie (RT vs RT-ML)')
  const A = await empresa('serie', { autoridadStel: false })
  const admin = await usuario(A.E, 'admin')
  const numero = async (c, tipo, serie = '') => c.rpc('next_document_number', { p_company: A.E, p_doc_type: tipo, p_series: serie })
  cmp('sin filas de autoridad: el ERP numera', 'OK', clase(await numero(admin, 'delivery')))
  ok(await s.from('document_numbering_authority').insert({ company_id: A.E, doc_type: 'delivery', authority: 'STEL', reason: 'ZZ E4: STEL numera los remitos' }), 'autoridad tipo')
  cmp('autoridad de tipo STEL: el ERP no numera remitos', 'external_numbering_authority', clase(await numero(admin, 'delivery')))
  ok(await s.from('document_numbering_authority_series').insert({ company_id: A.E, doc_type: 'delivery', series_code: 'RT', authority: 'ERP', reason: 'ZZ E4: la serie RT pasa al ERP' }), 'serie ERP')
  cmp('la serie RT en ERP habilita sólo esa serie', 'OK', clase(await numero(admin, 'delivery')))
  ok(await s.from('document_sequences').insert({ company_id: A.E, doc_type: 'delivery', series_code: 'RT-ML', prefix: 'RT-ML', padding: 10, next_number: 62, is_default: false }), 'secuencia RT-ML de prueba')
  ok(await s.from('document_numbering_authority_series').insert({ company_id: A.E, doc_type: 'delivery', series_code: 'RT-ML', authority: 'STEL', reason: 'ZZ E4: MercadoLibre sigue en STEL' }), 'serie RT-ML STEL')
  cmp('RT-ML sigue siendo de STEL aunque RT ya sea del ERP', 'external_numbering_authority', clase(await numero(admin, 'delivery', 'RT-ML')))
  cmp('y RT sigue funcionando', 'OK', clase(await numero(admin, 'delivery', 'RT')))
  // Guard de post-freeze: importar de STEL en una serie que ya emite el ERP.
  const rtAntes = num(ok(await s.from('document_sequences').select('next_number').eq('company_id', A.E).eq('series_code', 'RT').single(), 'secuencia RT antes').next_number)
  const runA = ok(await s.rpc('stel_sync_tomar', { p_company: A.E, p_entidad: 'documents', p_owner: 'test' }), 'run serie').run
  const importarRt = await s.rpc('stel_reconciliar_documento', {
    p_run: runA,
    p: { tipo: 'delivery', stel_id: '910001', numero: 'RT0000000999', estado_stel: 'Entregado', operacion: 'insert', cabecera: { customer_id: A.cli, delivery_date: HOY, currency_code: 'USD', subtotal: 1, tax_amount: 0, total: 1, series_code: 'RT' }, lineas: { insertar: [], actualizar: [], borrar: [] } },
  })
  cmp('importar de STEL en una serie que ya emite el ERP → rechazo', 'serie_emitida_por_el_erp', clase(importarRt))
  const importarMl = await s.rpc('stel_reconciliar_documento', {
    p_run: runA,
    p: { tipo: 'delivery', stel_id: '910002', numero: 'RT-ML2025000062', estado_stel: 'Entregado', operacion: 'insert', cabecera: { customer_id: A.cli, delivery_date: HOY, currency_code: 'ARS', subtotal: 1, tax_amount: 0, total: 1, series_code: 'RT-ML' }, lineas: { insertar: [], actualizar: [], borrar: [] } },
  })
  cmp('y RT-ML se sigue importando (import-only)', 'OK', clase(importarMl))
  await s.rpc('stel_sync_cerrar', { p_run: runA, p_estado: 'finished', p_cursor: null, p_cursor_id: null, p_llamadas: 0, p_resumen: {}, p_error: null })
  cmp('el remito RT-ML importado no consumió la secuencia RT', rtAntes, num(ok(await s.from('document_sequences').select('next_number').eq('company_id', A.E).eq('series_code', 'RT').single(), 'secuencia RT').next_number))

  // ── 6 · Delta de documentos ────────────────────────────────────────────────
  seccion('6 · Delta de documentos: idempotente, sin stock, sin secuencias')
  const D = await empresa('delta')
  const secAntes = ok(await s.from('document_sequences').select('doc_type, next_number').eq('company_id', D.E), 'secuencias antes')
  const runD = await iniciarRun(D.E)
  const insertar = () => s.rpc('stel_reconciliar_documento', {
    p_run: runD,
    p: { tipo: 'quote', stel_id: '920001', numero: 'COTI91001', estado_stel: 'Pendiente', operacion: 'insert', cabecera: { customer_id: D.cli, quote_date: HOY, currency_code: 'USD', subtotal: 10, tax_amount: 2.1, total: 12.1, series_code: 'COTI', status: 'sent' }, lineas: { insertar: [{ line_no: 1, line_type: 'item', sku_snapshot: 'ZZE4-D', name_snapshot: 'ZZ', quantity: 1, unit_price: 10, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }], actualizar: [], borrar: [] } },
  })
  cmp('el delta inserta el documento que faltaba', 'OK', clase(await insertar()))
  const repetido = await insertar()
  cmp('repetir el mismo delta no duplica', [true, '23505'], [`${repetido.error?.message}`.includes('documento_ya_existe:COTI91001'), repetido.error?.code])
  cmp('y quedó un solo documento', 1, (await s.from('sales_quotes').select('*', { count: 'exact', head: true }).eq('company_id', D.E).eq('number', 'COTI91001')).count)
  await cerrarRun(runD)
  const secDespues = ok(await s.from('document_sequences').select('doc_type, next_number').eq('company_id', D.E), 'secuencias después')
  cmp('el delta no consumió secuencias', JSON.stringify(secAntes), JSON.stringify(secDespues))
  cmp('el delta no movió stock', 0, (await s.from('stock_movements').select('*', { count: 'exact', head: true }).eq('company_id', D.E)).count)
  cmp('el delta no dejó eventos de usuario', 0, (await s.from('sales_audit').select('*', { count: 'exact', head: true }).eq('company_id', D.E)).count)

  // ── 7 · Ensayo de corte ────────────────────────────────────────────────────
  seccion('7 · ENSAYO DE CORTE en la fixture (no toca Buscatools)')
  const C = await empresa('corte')
  const cAdmin = await usuario(C.E, 'admin')
  const paso = (n, t, okBool, d = '') => { ensayo.pasos.push({ n, paso: t, ok: okBool, detalle: d }); okBool ? PASS(`${n}. ${t}`, d) : FAIL(`${n}. ${t}`, d) }
  const numeroC = (tipo) => cAdmin.rpc('next_document_number', { p_company: C.E, p_doc_type: tipo })

  paso(1, 'STEL es la autoridad: el ERP no puede emitir', clase(await numeroC('quote')) === 'external_numbering_authority')
  // 2 · delta final: se importa un histórico como lo haría el delta
  const runC = await iniciarRun(C.E)
  ok(await s.rpc('stel_reconciliar_documento', {
    p_run: runC,
    p: { tipo: 'quote', stel_id: '930001', numero: 'COTI02555', estado_stel: 'Pendiente', operacion: 'insert', cabecera: { customer_id: C.cli, quote_date: HOY, currency_code: 'USD', subtotal: 10, tax_amount: 0, total: 10, series_code: 'COTI', status: 'sent' }, lineas: { insertar: [], actualizar: [], borrar: [] } },
  }), 'delta final')
  await cerrarRun(runC)
  paso(2, 'delta final importado', true, 'COTI02555')
  // 3 · últimos números
  const ultimos = ok(await s.from('sales_quotes').select('number').eq('company_id', C.E).order('number', { ascending: false }).limit(1).single(), 'último').number
  const plan = proximoNumero({ actual: 1, ultimoStel: ultimos, mayorReact: ultimos })
  paso(3, 'último número leído y próximo calculado', plan.propuesto === 2556, `${ultimos} → ${plan.propuesto}`)
  // 4 · alinear secuencia (nunca baja)
  ok(await s.from('document_sequences').update({ next_number: plan.propuesto }).eq('company_id', C.E).eq('doc_type', 'quote'), 'alinear')
  paso(4, 'secuencia alineada sin bajar', plan.propuesto > 1, `next=${plan.propuesto}`)
  // 5 · autoridad → ERP
  ok(await s.from('document_numbering_authority').update({ authority: 'ERP', reason: 'ZZ E4 ensayo: corte a ERP' }).eq('company_id', C.E), 'autoridad ERP')
  paso(5, 'autoridad cambiada a ERP', true)
  // 6-8 · cotización → pedido → remito
  const nq = ok(await numeroC('quote'), 'número cotización')
  const qC = ok(await cAdmin.from('sales_quotes').insert({ company_id: C.E, number: nq, series_code: 'COTI', customer_id: C.cli, quote_date: HOY, currency_code: 'USD', status: 'draft' }).select('id').single(), 'cotización')
  paso(6, 'cotización nueva con el número correcto', nq === 'COTI02556', nq)
  const prodC = ok(await s.from('products').insert({ company_id: C.E, category_id: C.catNormal, sku: 'ZZE4-CORTE', name: 'ZZ E4 corte' }).select('id').single(), 'producto').id
  ok(await s.from('stock_movements').insert({ company_id: C.E, product_id: prodC, warehouse_id: C.W, movement_type: 'adjustment', quantity: 10, source_type: MARCA, notes: 'ZZ E4 stock' }), 'stock inicial')
  ok(await cAdmin.from('sales_quote_lines').insert({ company_id: C.E, quote_id: qC.id, line_no: 1, line_type: 'item', product_id: prodC, sku_snapshot: 'ZZE4-CORTE', quantity: 2, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea')
  await cAdmin.from('sales_quotes').update({ status: 'sent' }).eq('id', qC.id)
  await cAdmin.from('sales_quotes').update({ status: 'accepted' }).eq('id', qC.id)
  const oC = ok(await cAdmin.from('sales_orders').insert({ company_id: C.E, number: ok(await numeroC('sales_order'), 'número pedido'), series_code: 'PDV', customer_id: C.cli, quote_id: qC.id, origin: 'quote', order_date: HOY, currency_code: 'USD', commercial_status: 'confirmed' }).select('id').single(), 'pedido')
  ok(await cAdmin.from('sales_order_lines').insert({ company_id: C.E, order_id: oC.id, line_no: 1, line_type: 'item', product_id: prodC, sku_snapshot: 'ZZE4-CORTE', quantity_ordered: 2, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea pedido')
  paso(7, 'pedido generado desde la cotización', true)
  const dC = ok(await cAdmin.from('deliveries').insert({ company_id: C.E, number: ok(await numeroC('delivery'), 'número remito'), series_code: 'RT', customer_id: C.cli, order_id: oC.id, delivery_date: HOY, currency_code: 'USD', status: 'draft' }).select('id, number').single(), 'remito')
  ok(await cAdmin.from('delivery_lines').insert({ company_id: C.E, delivery_id: dC.id, product_id: prodC, warehouse_id: C.W, sku_snapshot: 'ZZE4-CORTE', name_snapshot: 'ZZ E4 corte', quantity: 2, unit_price: 50, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea remito')
  paso(8, 'remito creado en borrador', dC.number === 'RT0000000001', dC.number)
  // 9-10 · despacho y stock
  const desp = await cAdmin.rpc('confirmar_entrega', { p_delivery: dC.id })
  const saldo = num(ok(await s.from('stock_balances').select('on_hand').eq('product_id', prodC).eq('warehouse_id', C.W).single(), 'saldo').on_hand)
  paso(9, 'despacho confirmado', !desp.error, desp.error ? desp.error.message : 'ok')
  paso(10, 'stock descontado una sola vez', saldo === 8, `saldo=${saldo}`)
  // 11 · cancelar despachado → BLOQUEADO
  const cancelar = await cAdmin.from('deliveries').update({ status: 'cancelled' }).eq('id', dC.id).select('id')
  paso(11, 'cancelar un remito despachado queda bloqueado', clase(cancelar) === 'DELIVERY_ALREADY_DISPATCHED', clase(cancelar))
  // 12 · reintento / segunda ejecución
  const desp2 = await cAdmin.rpc('confirmar_entrega', { p_delivery: dC.id })
  const saldo2 = num(ok(await s.from('stock_balances').select('on_hand').eq('product_id', prodC).eq('warehouse_id', C.W).single(), 'saldo').on_hand)
  paso(12, 'reintento del despacho es idempotente', !desp2.error && saldo2 === 8, `saldo=${saldo2}`)
  // 13 · rollback de autoridad
  ok(await s.from('document_numbering_authority').update({ authority: 'STEL', reason: 'ZZ E4 ensayo: rollback del corte' }).eq('company_id', C.E), 'rollback autoridad')
  const trasRollback = clase(await numeroC('quote'))
  const secFinal = num(ok(await s.from('document_sequences').select('next_number').eq('company_id', C.E).eq('doc_type', 'quote').single(), 'secuencia final').next_number)
  paso(13, 'rollback: vuelve a bloquear y la secuencia NO baja', trasRollback === 'external_numbering_authority' && secFinal >= plan.propuesto, `${trasRollback}, next=${secFinal}`)
  ensayo.resultado = ensayo.pasos.every((p) => p.ok) ? 'PASS' : 'FAIL'
  fs.mkdirSync(SALIDA, { recursive: true })
  fs.writeFileSync(path.join(SALIDA, 'ensayo.json'), JSON.stringify(ensayo, null, 1))
  cmp('ENSAYO DE CORTE', 'PASS', ensayo.resultado)

  // ── 8 · Funciones puras ────────────────────────────────────────────────────
  seccion('8 · Funciones puras (preflight y gate)')
  cmp('next = max(actual, STEL+1, React+1)', 1433, proximoNumero({ actual: 1424, ultimoStel: 'RT0000001432', mayorReact: 'RT0000001430' }).propuesto)
  cmp('nunca baja una secuencia', 2629, proximoNumero({ actual: 2629, ultimoStel: 'COTI02555', mayorReact: 'COTI02555' }).propuesto)
  cmp('los PDV11xxx no empujan la serie PDV', 'PDV01318', mayorDeSerie(['PDV01318', 'PDV11292', 'PDV01200'], 'PDV', 5, ES_ATIPICO.sales_order).mayor)
  cmp('y quedan listados como atípicos', ['PDV11292'], mayorDeSerie(['PDV01318', 'PDV11292'], 'PDV', 5, ES_ATIPICO.sales_order).atipicos)
  cmp('RT-ML no es un RT atípico: es otra serie', [null, []], (() => { const r = mayorDeSerie(['RT-ML2025000061'], 'RT', 10); return [r.mayor, r.atipicos] })())
  cmp('gate: COTI02530 con un derivado → RETENER', 'RETENER', decidir('coti02530', { estadoStel: 'Pendiente', derivadosStel: 1, derivadosReact: 0, eventos: 0, reactImportado: true, estadoReact: 'accepted' }).decision)
  cmp('gate: COTI02530 sin derivados → APLICAR', 'APLICAR', decidir('coti02530', { estadoStel: 'Pendiente', derivadosStel: 0, derivadosReact: 0, eventos: 0, reactImportado: true, estadoReact: 'accepted' }).decision)
  cmp('gate: STEL reincorporó la línea → RETENER', 'RETENER', decidir('lineas', { referencias: 0, movimientos: 0, eventos: 0, stelLaReincorporo: true, intactaDesdeE2: true }).decision)
  cmp('gate: CUIT en conflicto → RETENER', 'RETENER', decidir('coti02452', { cuitStel: '30712345674', cuitValido: true, otrosClientesConEseCuit: 1, cuitReactActual: null, clienteUnico: true }).decision)
  cmp('gate: SP.2007VPM/80 siempre RETENER', 'RETENER', decidir('sp2007', {}).decision)

  // ── 9 · Limpieza ───────────────────────────────────────────────────────────
  seccion('9 · Limpieza y datos reales intactos')
  await barrer()
  const { count: quedan } = await s.from('companies').select('*', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)
  cmp('no quedan empresas fixture', 0, quedan)
  cmp('datos reales intactos', huellaAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? 'TODO PASA' : `${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error('✗', e.message); try { await barrer() } catch { /* ya reportado */ } process.exit(1) })
