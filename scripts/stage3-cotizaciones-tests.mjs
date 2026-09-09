/**
 * Fase 4 · Stage 3 · entrega 3 — crear y editar cotizaciones.
 *
 * Hace lo mismo que hace la pantalla, con una sesión REAL (no con la Secret):
 * pide el número por RPC, inserta, edita, cambia de estado y comprueba que
 * los totales los calculó el servidor. Todo lo que crea, lo borra.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/stage3-cotizaciones-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

const creadas = []

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: mem } = await c.from('company_memberships').select('company_id, companies ( slug )')
  const BT = mem.find((m) => m.companies.slug === 'buscatools').company_id
  const { data: cli } = await c.from('customers').select('id').eq('company_id', BT).limit(2)
  const { data: prod } = await c.from('products')
    .select('id, sku, name').eq('company_id', BT).order('sku').limit(1).single()

  const s = admin()
  const { data: seqAntes } = await s.from('document_sequences')
    .select('next_number').eq('company_id', BT).eq('doc_type', 'quote').single()
  const { count: cotAntes } = await s.from('sales_quotes').select('*', { count: 'exact', head: true })
  const { count: auditAntes } = await s.from('sales_audit').select('*', { count: 'exact', head: true })

  console.log('='.repeat(74))
  console.log('  COTIZACIONES · crear y editar, con sesión real')
  console.log('='.repeat(74))

  // ── Helpers que imitan a los services de React ──────────────────────────
  const nuevaCot = async (cliente, moneda, extra = {}) => {
    const { data: numero, error: eN } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'quote' })
    if (eN) throw new Error('numeración: ' + eN.message)
    const { data, error } = await c.from('sales_quotes').insert({
      company_id: BT, number: numero, series_code: 'COTI', customer_id: cliente,
      quote_date: '2026-09-09', currency_code: moneda, status: 'draft', ...extra,
    }).select('id, number').single()
    if (error) throw new Error('insert: ' + error.message)
    creadas.push(data.id)
    await c.rpc('registrar_evento_venta',
      { p_entity_type: 'sales_quote', p_entity_id: data.id, p_action: 'created', p_to_status: 'draft' })
    return data
  }
  const linea = (quoteId, l) => c.from('sales_quote_lines').insert({
    company_id: BT, quote_id: quoteId, ...l,
  })
  const totales = async (quoteId) => {
    const { data } = await c.from('sales_quotes')
      .select('subtotal, tax_amount, total').eq('id', quoteId).single()
    return [data.subtotal, data.tax_amount, data.total].map(Number).join('/')
  }

  // ── 1 · Una cotización con todo ─────────────────────────────────────────
  seccion('CREAR — producto del catálogo, línea libre, capítulo')
  const q1 = await nuevaCot(cli[0].id, 'USD')
  const formatoOk = /^COTI\d{5}$/.test(q1.number)
  formatoOk ? PASS('el número vino del servidor', q1.number)
            : FAIL('formato de número', q1.number)

  const { error: e1 } = await linea(q1.id, {
    line_no: 1, line_type: 'item', product_id: prod.id, sku_snapshot: prod.sku,
    name_snapshot: prod.name, quantity: 10, unit_price: 100, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })
  e1 ? FAIL('línea de catálogo', e1.message) : PASS('línea de producto del catálogo', prod.sku)
  cmp('totales tras la primera línea', '1000/210/1210', await totales(q1.id))

  const { error: e2 } = await linea(q1.id, {
    line_no: 2, line_type: 'chapter', name_snapshot: 'Accesorios',
    quantity: 1, unit_price: 0, discount_pct: 0, tax_treatment: 'not_taxed', tax_rate_snapshot: 0,
  })
  e2 ? FAIL('capítulo', e2.message) : PASS('capítulo agregado')
  cmp('el capítulo NO suma', '1000/210/1210', await totales(q1.id))

  const { error: e3 } = await linea(q1.id, {
    line_no: 3, line_type: 'item', sku_snapshot: 'SERVICIO', name_snapshot: 'Puesta en marcha',
    quantity: 2, unit_price: 50, discount_pct: 10, tax_treatment: 'not_taxed', tax_rate_snapshot: 0,
  })
  e3 ? FAIL('línea libre', e3.message) : PASS('línea libre, sin producto del catálogo')
  cmp('línea libre con 10 % de descuento', '1090/210/1300', await totales(q1.id))

  // ── 2 · Descuento global y percepción ───────────────────────────────────
  seccion('DESCUENTO GLOBAL Y PERCEPCIÓN — los calcula el servidor')
  await c.from('sales_quotes').update({ discount_pct: 10 }).eq('id', q1.id)
  cmp('descuento global del 10 %', '981/189/1170', await totales(q1.id))
  await c.from('sales_quotes').update({ perception_pct: 2.5 }).eq('id', q1.id)
  cmp('percepción IIBB del 2,5 %', '981/213.53/1194.53', await totales(q1.id))

  // El navegador NO puede imponer un total.
  await c.from('sales_quotes').update({ total: 1, subtotal: 1, tax_amount: 1 }).eq('id', q1.id)
  cmp('un total mandado desde el cliente se ignora', '981/213.53/1194.53', await totales(q1.id))

  // ── 3 · Producto sin precio y otra moneda ───────────────────────────────
  seccion('MONEDA')
  const q2 = await nuevaCot(cli[0].id, 'ARS', { exchange_rate: 1450 })
  await linea(q2.id, {
    line_no: 1, line_type: 'item', quantity: 1, unit_price: 100000, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })
  cmp('cotización en ARS con tipo de cambio', '100000/21000/121000', await totales(q2.id))
  const { data: dq2 } = await c.from('sales_quotes')
    .select('currency_code, exchange_rate').eq('id', q2.id).single()
  dq2.currency_code === 'ARS' && Number(dq2.exchange_rate) === 1450
    ? PASS('el tipo de cambio queda como snapshot', String(dq2.exchange_rate))
    : FAIL('tipo de cambio', JSON.stringify(dq2))

  const q3 = await nuevaCot(cli[0].id, 'EUR')
  const { data: dq3 } = await c.from('sales_quotes')
    .select('exchange_rate').eq('id', q3.id).single()
  dq3.exchange_rate === null
    ? PASS('sin tipo de cambio queda NULL', 'no se inventa ninguno')
    : FAIL('tipo de cambio inventado', String(dq3.exchange_rate))

  // Un producto sin precio entra en 0 y se completa a mano.
  const { error: e4 } = await linea(q3.id, {
    line_no: 1, line_type: 'item', product_id: prod.id, sku_snapshot: prod.sku,
    name_snapshot: prod.name, quantity: 1, unit_price: 0, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })
  e4 ? FAIL('producto sin precio', e4.message)
     : PASS('un producto sin precio entra en 0', 'y se completa a mano')

  // ── 4 · Dos cotizaciones a la vez ───────────────────────────────────────
  seccion('SIN BORRADOR GLOBAL — dos documentos a la vez')
  await c.from('sales_quotes').update({ title: 'Primera' }).eq('id', q1.id)
  await c.from('sales_quotes').update({ title: 'Segunda' }).eq('id', q2.id)
  const { data: dos } = await c.from('sales_quotes')
    .select('id, title, total').in('id', [q1.id, q2.id])
  const t1 = dos.find((x) => x.id === q1.id)
  const t2 = dos.find((x) => x.id === q2.id)
  t1.title === 'Primera' && t2.title === 'Segunda' && Number(t1.total) !== Number(t2.total)
    ? PASS('editar la segunda no pisó la primera', `${t1.title} ${t1.total} · ${t2.title} ${t2.total}`)
    : FAIL('una pisó a la otra', JSON.stringify(dos))

  // ── 5 · Editar un draft: orden de líneas y borrado ──────────────────────
  seccion('EDITAR UN BORRADOR')
  const { data: ls } = await c.from('sales_quote_lines')
    .select('id, line_no, name_snapshot').eq('quote_id', q1.id).order('line_no')
  const [l1, l2] = ls
  // Hay un `unique (quote_id, line_no)`: el intercambio pasa por un número
  // libre, igual que hace intercambiarOrden() en el service.
  const provisorio = Math.max(l1.line_no, l2.line_no) + 1000
  const swap = [
    await c.from('sales_quote_lines').update({ line_no: provisorio }).eq('id', l1.id),
    await c.from('sales_quote_lines').update({ line_no: l1.line_no }).eq('id', l2.id),
    await c.from('sales_quote_lines').update({ line_no: l2.line_no }).eq('id', l1.id),
  ]
  const errorSwap = swap.find((r) => r.error)
  const { data: ls2 } = await c.from('sales_quote_lines')
    .select('id, line_no').eq('quote_id', q1.id).order('line_no')
  !errorSwap && ls2[0].id === l2.id
    ? PASS('reordenar cambia line_no, no la identidad de la línea',
           `${l2.line_no} ↔ ${l1.line_no}`)
    : FAIL('reordenar', errorSwap?.error.message ?? 'el orden no cambió')

  const { error: e5 } = await c.from('sales_quote_lines').delete().eq('id', ls[2].id)
  e5 ? FAIL('borrar línea', e5.message) : PASS('línea borrada')
  cmp('los totales se recalculan al borrar', '900/211.5/1111.5', await totales(q1.id))

  // ── 6 · Estados y bloqueo ───────────────────────────────────────────────
  seccion('ESTADOS — qué se puede editar y qué no')
  await c.from('sales_quotes').update({ status: 'sent' }).eq('id', q1.id)
  await c.rpc('registrar_evento_venta', {
    p_entity_type: 'sales_quote', p_entity_id: q1.id, p_action: 'sent',
    p_from_status: 'draft', p_to_status: 'sent',
  })
  const { error: e6 } = await c.from('sales_quote_lines')
    .update({ unit_price: 90 }).eq('id', l1.id)
  e6 ? FAIL('editar una enviada', e6.message)
     : PASS('una cotización enviada todavía se puede corregir')

  await c.rpc('registrar_evento_venta', {
    p_entity_type: 'sales_quote', p_entity_id: q1.id, p_action: 'updated_sensitive_fields',
    p_diff: { unit_price: { from: 100, to: 90 } },
  })

  await c.from('sales_quotes').update({ status: 'accepted' }).eq('id', q1.id)
  const { error: e7 } = await c.from('sales_quotes').update({ total: 1 }).eq('id', q1.id)
  e7 ? PASS('una aceptada NO se puede modificar', e7.code)
     : FAIL('se modificó una cotización aceptada')
  const { error: e8 } = await c.from('sales_quote_lines')
    .update({ unit_price: 1 }).eq('id', l1.id)
  e8 ? PASS('tampoco sus líneas', e8.code) : FAIL('se modificó una línea de una aceptada')
  const { error: e9 } = await c.from('sales_quote_lines').delete().eq('id', l1.id)
  e9 ? PASS('ni se pueden borrar', e9.code) : FAIL('se borró una línea de una aceptada')

  // ── 7 · Auditoría ───────────────────────────────────────────────────────
  seccion('AUDITORÍA — sólo acciones de negocio')
  const { data: eventos } = await c.from('sales_audit')
    .select('action, from_status, to_status, diff').eq('entity_id', q1.id).order('id')
  const acciones = eventos.map((e) => e.action)
  JSON.stringify(acciones) === JSON.stringify(['created', 'sent', 'updated_sensitive_fields'])
    ? PASS('un evento por acción', acciones.join(' → '))
    : FAIL('eventos registrados', acciones.join(' → '))
  const diff = eventos.find((e) => e.action === 'updated_sensitive_fields')?.diff
  JSON.stringify(diff) === JSON.stringify({ unit_price: { to: 90, from: 100 } })
    ? PASS('el diff es acotado', JSON.stringify(diff))
    : FAIL('diff', JSON.stringify(diff))

  const { error: e10 } = await c.rpc('registrar_evento_venta',
    { p_entity_type: 'sales_quote', p_entity_id: q1.id, p_action: 'tecleo' })
  e10 ? PASS('una acción desconocida es rechazada') : FAIL('acción desconocida aceptada')

  const { error: e11 } = await c.from('sales_audit').insert({
    company_id: BT, entity_type: 'sales_quote', entity_id: q1.id, action: 'created',
  })
  e11 ? PASS('nadie escribe sales_audit directamente', e11.code)
      : FAIL('se insertó en sales_audit sin pasar por la función')

  // Los UPDATE técnicos no generan auditoría.
  const { count: antesTecnico } = await c.from('sales_audit')
    .select('*', { count: 'exact', head: true }).eq('entity_id', q2.id)
  await c.from('sales_quotes').update({ notes: 'una nota' }).eq('id', q2.id)
  await c.from('sales_quotes').update({ notes: 'otra nota' }).eq('id', q2.id)
  const { count: despuesTecnico } = await c.from('sales_audit')
    .select('*', { count: 'exact', head: true }).eq('entity_id', q2.id)
  cmp('dos UPDATE técnicos no generan auditoría', antesTecnico, despuesTecnico)

  // ── 8 · Numeración concurrente desde el flujo real ──────────────────────
  seccion('NUMERACIÓN CONCURRENTE')
  const N = 30
  const numeros = await Promise.all(
    Array.from({ length: N }, () =>
      c.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' })),
  )
  const emitidos = numeros.map((r) => r.data).filter(Boolean)
  const errores = numeros.filter((r) => r.error).length
  cmp(`${N} llamadas en paralelo, todas responden`, N, emitidos.length)
  cmp('sin errores', 0, errores)
  cmp('todos distintos', N, new Set(emitidos).size)
  const nums = emitidos.map((x) => Number(x.replace('COTI', ''))).sort((a, b) => a - b)
  nums[nums.length - 1] - nums[0] === N - 1
    ? PASS('sin huecos', `${nums[0]}…${nums[nums.length - 1]}`)
    : FAIL('la serie tiene huecos', nums.join(','))
  // Se devuelven al pozo: no se usaron.
  await s.from('document_sequences').update({ next_number: nums[0] })
    .eq('company_id', BT).eq('doc_type', 'quote').eq('series_code', 'COTI')

  await c.auth.signOut()

  // ── 9 · RLS ─────────────────────────────────────────────────────────────
  seccion('RLS — un externo no crea ni edita cotizaciones')
  for (const [rol, email] of [
    ['CUSTOMER', 'cliente.test@buscatools.com.ar'],
    ['DISTRIBUTOR', 'distribuidor.test@buscatools.com.ar'],
  ]) {
    const e = sesion()
    const { error } = await e.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
    if (error) { FAIL(`login ${rol}`, error.message); continue }
    const { data: cliProp } = await e.from('customers').select('id').limit(1).maybeSingle()
    const r1 = await e.from('sales_quotes').insert({
      company_id: BT, number: 'ZZ-HACK-' + Date.now(), customer_id: cliProp?.id ?? cli[0].id,
      quote_date: '2026-09-09', currency_code: 'USD', status: 'draft',
    }).select('id')
    r1.error ? PASS(`${rol} NO puede crear una cotización`, r1.error.code)
             : FAIL(`${rol} creó una cotización`)
    const r2 = await e.from('sales_quotes').update({ title: 'hackeado' }).eq('id', q2.id).select('id')
    !r2.error && r2.data?.length === 0
      ? PASS(`${rol} NO puede editar una ajena`, 'RLS filtró todo')
      : r2.error ? PASS(`${rol} NO puede editar una ajena`, r2.error.code)
                 : FAIL(`${rol} editó una cotización ajena`)
    const r3 = await e.rpc('next_document_number', { p_company: BT, p_doc_type: 'quote' })
    r3.error ? PASS(`${rol} NO puede numerar`, r3.error.code) : FAIL(`${rol} obtuvo un número`)
    const r4 = await e.rpc('registrar_evento_venta',
      { p_entity_type: 'sales_quote', p_entity_id: q2.id, p_action: 'approved' })
    r4.error ? PASS(`${rol} NO puede auditar`, r4.error.code) : FAIL(`${rol} escribió auditoría`)
    await e.auth.signOut()
  }

  const anon = sesion()
  const ra = await anon.from('sales_quotes').insert({
    company_id: BT, number: 'ZZ-ANON', customer_id: cli[0].id,
    quote_date: '2026-09-09', currency_code: 'USD',
  }).select('id')
  ra.error ? PASS('anon NO puede crear', ra.error.code) : FAIL('anon creó una cotización')

  // ── 10 · Limpieza ───────────────────────────────────────────────────────
  seccion('LIMPIEZA')
  await s.from('sales_audit').delete().in('entity_id', creadas)
  await s.from('sales_quotes').update({ status: 'draft' }).in('id', creadas)
  await s.from('sales_quote_lines').delete().in('quote_id', creadas)
  await s.from('sales_quotes').delete().in('id', creadas)
  await s.from('document_sequences').update({ next_number: seqAntes.next_number })
    .eq('company_id', BT).eq('doc_type', 'quote').eq('series_code', 'COTI')

  const { count: cotDespues } = await s.from('sales_quotes').select('*', { count: 'exact', head: true })
  const { count: auditDespues } = await s.from('sales_audit').select('*', { count: 'exact', head: true })
  const { data: seqDespues } = await s.from('document_sequences')
    .select('next_number').eq('company_id', BT).eq('doc_type', 'quote').single()
  cmp('sales_quotes vuelve a su estado previo', cotAntes, cotDespues)
  cmp('sales_audit vuelve a su estado previo', auditAntes, auditDespues)
  cmp('la secuencia queda donde estaba', seqAntes.next_number, seqDespues.next_number)

  console.log(`\n${'='.repeat(74)}\n  RESULTADO: ${fallos} fallo(s)\n${'='.repeat(74)}`)
  process.exit(fallos ? 1 : 0)
}

main().catch(async (e) => {
  console.error('✗ ' + e.message)
  try {
    const s = admin()
    await s.from('sales_audit').delete().in('entity_id', creadas)
    await s.from('sales_quotes').update({ status: 'draft' }).in('id', creadas)
    await s.from('sales_quote_lines').delete().in('quote_id', creadas)
    await s.from('sales_quotes').delete().in('id', creadas)
    console.error('  (se limpiaron ' + creadas.length + ' cotizaciones de prueba)')
  } catch { /* nada que hacer */ }
  process.exit(1)
})
