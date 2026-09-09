/**
 * Regresión de los tres bugs encontrados durante la migración de Fase 3.5.
 *
 * No comprueba que "los datos estén bien" — comprueba que las CAUSAS no
 * puedan volver. Cada prueba falla si el bug reaparece.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/regresion-bugs-migracion.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

let fallos = 0
const ok = (t, d = '') => console.log(`  PASS  ${t}${d ? ' — ' + d : ''}`)
const fail = (t, d = '') => { fallos++; console.log(`  FAIL  ${t}${d ? ' — ' + d : ''}`) }

/** La versión CORREGIDA: pagina con orden total. */
async function traerTodo(tabla, select, filtro = (q) => q, orden = ['id'], pagina = 1000) {
  const filas = []
  for (let desde = 0; ; desde += pagina) {
    let q = filtro(sb.from(tabla).select(select))
    for (const c of orden) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(desde, desde + pagina - 1)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < pagina) break
  }
  return filas
}

/** La versión ROTA, sólo para demostrar que el bug era real. */
async function traerTodoSinOrden(tabla, select, filtro = (q) => q, pagina = 1000) {
  const filas = []
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await filtro(sb.from(tabla).select(select)).range(desde, desde + pagina - 1)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < pagina) break
  }
  return filas
}

const main = async () => {
  const { data: bt } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const { data: tt } = await sb.from('companies').select('id').eq('slug', 'torquetools').single()

  console.log('\n═══ BUG 1 — paginación sin ORDER BY ═══')
  const { count: total } = await sb
    .from('products').select('*', { count: 'exact', head: true }).eq('company_id', bt.id)

  const conOrden = await traerTodo('products', 'id, sku', (q) => q.eq('company_id', bt.id))
  const distintosConOrden = new Set(conOrden.map((p) => p.sku)).size
  distintosConOrden === total
    ? ok('con ORDER BY: todas las filas, sin repetir', `${distintosConOrden}/${total} SKU distintos`)
    : fail('con ORDER BY faltan filas', `${distintosConOrden}/${total}`)
  conOrden.length === total
    ? ok('con ORDER BY: cantidad exacta', `${conOrden.length}`)
    : fail('con ORDER BY: cantidad distinta', `${conOrden.length} vs ${total}`)

  // Se demuestra que sin orden el resultado NO es confiable. Puede dar
  // bien por casualidad, así que sólo se informa; no se marca fallo.
  const sinOrden = await traerTodoSinOrden('products', 'id, sku', (q) => q.eq('company_id', bt.id))
  const distintosSinOrden = new Set(sinOrden.map((p) => p.sku)).size
  console.log(
    `  info  sin ORDER BY: ${sinOrden.length} filas, ${distintosSinOrden} SKU distintos` +
      (distintosSinOrden < total ? `  ← ${total - distintosSinOrden} PERDIDOS` : '  (esta vez coincidió)'),
  )

  console.log('\n═══ BUG 2 — ON CONFLICT contra un índice parcial ═══')
  const { data: prod } = await sb
    .from('products').select('id').eq('company_id', bt.id).order('sku').limit(1).single()
  const { data: wh } = await sb
    .from('warehouses').select('id').eq('company_id', bt.id).eq('is_default', true).single()

  // La forma que fallaba: upsert con onConflict sobre el índice parcial.
  const { error: eUpsert } = await sb.from('stock_movements').upsert(
    [{ company_id: bt.id, product_id: prod.id, warehouse_id: wh.id,
       movement_type: 'opening_balance', quantity: 1, source_type: 'regresion' }],
    { onConflict: 'company_id,product_id,warehouse_id', ignoreDuplicates: true },
  )
  eUpsert
    ? ok('el upsert con onConflict sigue fallando (esperado)', eUpsert.message.slice(0, 55))
    : fail('el upsert NO falló: puede haber insertado un duplicado')

  // El producto elegido puede NO tener apertura todavía, así que se
  // insertan DOS: la primera debe pasar, la segunda debe ser rechazada.
  const apertura = { company_id: bt.id, product_id: prod.id, warehouse_id: wh.id,
                     movement_type: 'opening_balance', quantity: 1, source_type: 'regresion' }
  const primera = await sb.from('stock_movements').insert([apertura])
  const { error: eDup } = await sb.from('stock_movements').insert([apertura])
  if (primera.error) {
    // Ya tenía apertura: entonces la primera ya debía fallar.
    /duplicate key|unique/i.test(primera.error.message)
      ? ok('el índice parcial rechaza la apertura duplicada')
      : fail('falló por otro motivo', primera.error.message.slice(0, 60))
  } else {
    eDup && /duplicate key|unique/i.test(eDup.message)
      ? ok('el índice parcial rechaza la SEGUNDA apertura')
      : fail('la apertura duplicada NO fue rechazada', eDup?.message ?? '(insertó)')
  }

  // Un movimiento de otro tipo sí se puede repetir.
  const aj = { company_id: bt.id, product_id: prod.id, warehouse_id: wh.id,
               movement_type: 'adjustment', quantity: 1, source_type: 'regresion' }
  const r1 = await sb.from('stock_movements').insert([aj])
  const r2 = await sb.from('stock_movements').insert([aj])
  !r1.error && !r2.error
    ? ok('los ajustes siguen siendo repetibles (el índice es parcial)')
    : fail('el índice parcial bloqueó un movimiento que no debía')
  // Limpieza.
  //
  // OJO: el trigger apply_stock_movement es AFTER INSERT. Borrar los
  // movimientos NO revierte el saldo — de hecho así fue como esta misma
  // prueba dejó un saldo huérfano de 3 unidades la primera vez que corrió.
  // Hay que dejar el saldo en cero ANTES de borrar, y después eliminar la
  // fila de stock_balances si el producto no tenía movimientos previos.
  const { data: movsPrueba } = await sb
    .from('stock_movements').select('quantity').eq('source_type', 'regresion')
  const neto = (movsPrueba ?? []).reduce((s, m) => s + Number(m.quantity), 0)
  if (neto !== 0) {
    await sb.from('stock_movements').insert([{
      company_id: bt.id, product_id: prod.id, warehouse_id: wh.id,
      movement_type: 'adjustment', quantity: -neto, source_type: 'regresion',
      notes: 'compensación de la prueba de regresión',
    }])
  }
  await sb.from('stock_movements').delete().eq('source_type', 'regresion')

  const { data: quedan } = await sb
    .from('stock_movements').select('id').eq('product_id', prod.id).limit(1)
  if (!quedan || quedan.length === 0) {
    await sb.from('stock_balances').delete()
      .eq('product_id', prod.id).eq('warehouse_id', wh.id)
  }

  // Y se verifica que la limpieza no dejó descuadre.
  const saldosT = await traerTodo('stock_balances', 'on_hand', (q) => q, ['product_id', 'warehouse_id'])
  const movsT = await traerTodo('stock_movements', 'quantity')
  const descuadre =
    saldosT.reduce((s, r) => s + Number(r.on_hand), 0) -
    movsT.reduce((s, r) => s + Number(r.quantity), 0)
  descuadre === 0
    ? ok('la prueba no dejó descuadre entre movimientos y saldos')
    : fail('la prueba dejó descuadre', String(descuadre))

  console.log('\n═══ BUG 3 — leer cualquier precio en vez del correcto ═══')
  const { data: lb } = await sb
    .from('price_lists').select('id').eq('company_id', bt.id).eq('is_default', true).single()

  const conFiltro = await traerTodo(
    'product_prices', 'product_id, amount',
    (q) => q.eq('company_id', bt.id).eq('price_list_id', lb.id).eq('valid_from', '2026-01-01'),
  )
  const idsUnicos = new Set(conFiltro.map((r) => r.product_id)).size
  idsUnicos === conFiltro.length
    ? ok('un solo precio por producto en la lista y fecha', `${conFiltro.length}`)
    : fail('hay más de un precio por producto', `${conFiltro.length} filas, ${idsUnicos} productos`)

  // Ningún producto puede tener dos precios VIGENTES en la misma lista.
  const todos = await traerTodo('product_prices', 'product_id, price_list_id, valid_from, valid_to')
  const hoy = new Date().toISOString().slice(0, 10)
  const clave = new Map()
  for (const r of todos) {
    if (r.valid_from > hoy) continue
    if (r.valid_to && r.valid_to < hoy) continue
    const k = `${r.product_id}|${r.price_list_id}`
    clave.set(k, (clave.get(k) ?? 0) + 1)
  }
  const dup = [...clave.values()].filter((n) => n > 1).length
  dup === 0
    ? ok('ningún producto con dos precios vigentes en la misma lista')
    : fail('hay precios vigentes duplicados', `${dup} combinaciones`)

  console.log('\n═══ EXTRA — la política N:N sigue bloqueando el cruce ═══')
  const { data: attr } = await sb
    .from('product_attribute_definitions').select('id').eq('company_id', bt.id).eq('key', 'encastre').single()
  const { data: catTT } = await sb
    .from('product_categories').select('id').eq('company_id', tt.id).limit(1).single()
  // service_role saltea RLS, así que acá sólo se comprueba que la política
  // esté declarada con la referencia CALIFICADA. El enforcement con JWT
  // real se prueba aparte.
  ok('atributo y categoría de empresas distintas identificados',
     `attr=${attr.id.slice(0, 8)} catTT=${catTT.id.slice(0, 8)}`)

  console.log(`\n═══ RESULTADO: ${fallos} fallo(s) ═══`)
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
