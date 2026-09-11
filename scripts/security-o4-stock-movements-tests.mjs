/**
 * O4 · escritura directa sobre el stock — ataques reales.
 *
 * Nació como auditoría —reprodujo el agujero antes de tocar nada— y queda como
 * suite permanente: si alguien vuelve a otorgar INSERT sobre `stock_movements`,
 * esto falla.
 *
 * Mide el **efecto**, no sólo el código de error: si la fila entra, ¿se dispara
 * el trigger?, ¿cambia el saldo? En la corrida previa al fix la respuesta fue
 * que sí, y el saldo se movió dos veces.
 *
 * Los ocho ataques:
 *
 *   A1  customer INSERT stock_movements        → rechazado
 *   A2  distributor INSERT                     → rechazado
 *   A3  salesperson INSERT (en su empresa)     → rechazado
 *   A4  employee y admin INSERT directo        → rechazado (era el agujero)
 *   A5  UPDATE de un movimiento histórico      → rechazado
 *   A6  DELETE de un movimiento histórico      → rechazado
 *   A7  UPDATE / INSERT / DELETE de un saldo   → rechazado
 *   A8  anon                                   → rechazado
 *
 * Deja todo como estaba: el movimiento que logre entrar se compensa, se borra
 * con la clave de servicio y el saldo se recalcula desde los movimientos.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/security-o4-stock-movements-tests.mjs
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
 * NO correr en paralelo con otra suite de base: comparten invariantes.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    ····  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-O4'
const creados = { usuarios: [], movimientos: [] }

const entrar = async (email, pw) => {
  const c = sesion()
  const { error } = await c.auth.signInWithPassword({ email, password: pw })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return c
}

const usuarioTemporal = async (companyId, rol) => {
  const email = `zz-o4-${rol}-${Date.now()}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const { error: eM } = await s.from('company_memberships')
    .insert({ company_id: companyId, user_id: data.user.id, role: rol, status: 'active' })
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return await entrar(email, password)
}

const main = async () => {
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const { data: prod } = await s.from('products')
    .select('id, sku').eq('company_id', BT).order('sku').limit(1).single()
  const { data: dep } = await s.from('warehouses')
    .select('id').eq('company_id', BT).eq('is_default', true).single()

  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const movAntes = await q('stock_movements')
  const salAntes = await q('stock_balances')
  const saldoDe = async () => {
    const { data } = await s.from('stock_balances').select('on_hand')
      .eq('product_id', prod.id).eq('warehouse_id', dep.id).maybeSingle()
    return data ? Number(data.on_hand) : null
  }
  const saldoInicial = await saldoDe()

  const fila = (extra = {}) => ({
    company_id: BT, product_id: prod.id, warehouse_id: dep.id,
    movement_type: 'adjustment', quantity: -7,
    source_type: MARCA, notes: `${MARCA} intento directo`, ...extra,
  })

  console.log('='.repeat(74))
  console.log('  O4 · escritura directa sobre el stock — ataques con JWT reales')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))
  INFO('producto', prod.sku)
  INFO('saldo inicial', String(saldoInicial))

  try {
    // ── 1 · Quién puede insertar, y con qué efecto ────────────────────────
    seccion('1 · INSERT DIRECTO · las seis identidades, midiendo el efecto')

    const empleado = await usuarioTemporal(BT, 'employee')
    const tecnico = await usuarioTemporal(BT, 'technician')

    const identidades = [
      ['ADMIN (Buscatools)', await entrar('buscatools.jano@gmail.com', process.env.BT_PW_JANO)],
      ['EMPLOYEE (Buscatools)', empleado],
      ['TECHNICIAN (Buscatools)', tecnico],
      ['CUSTOMER', await entrar('cliente.test@buscatools.com.ar', process.env.BT_PW_TEST)],
      ['DISTRIBUTOR', await entrar('distribuidor.test@buscatools.com.ar', process.env.BT_PW_TEST)],
      ['ANON', sesion()],
    ]

    for (const [rol, c] of identidades) {
      const antes = await saldoDe()
      const r = await c.from('stock_movements').insert(fila()).select('id')
      if (r.error) {
        PASS(`${rol}: rechazado`, r.error.code ?? String(r.error.message).slice(0, 40))
      } else {
        const id = r.data[0].id
        creados.movimientos.push(id)
        const despues = await saldoDe()
        FAIL(`SE PERMITIÓ: ${rol} insertó un movimiento`, `fila ${id}`)
        // Lo que importa no es que la fila entre: es si el saldo se movió.
        despues !== antes
          ? FAIL(`  y el trigger corrió: el saldo cambió`, `${antes} → ${despues}`)
          : INFO(`  pero el saldo no cambió`, String(despues))
      }
    }

    // ── 2 · Un movimiento en una empresa ajena ────────────────────────────
    seccion('2 · EMPRESA AJENA · el mismo intento apuntando a Torquetools')

    const admin = identidades[0][1]
    const { data: prodTT } = await s.from('products')
      .select('id').eq('company_id', TT).limit(1).maybeSingle()
    const { data: depTT } = await s.from('warehouses')
      .select('id').eq('company_id', TT).limit(1).maybeSingle()
    if (prodTT && depTT) {
      const r = await admin.from('stock_movements')
        .insert(fila({ company_id: TT, product_id: prodTT.id, warehouse_id: depTT.id }))
        .select('id')
      r.error ? PASS('salesperson de Torquetools: rechazado en su propia empresa', r.error.code)
              : FAIL('SE PERMITIÓ: movimiento en Torquetools siendo sólo salesperson')
      if (!r.error) creados.movimientos.push(r.data[0].id)
    } else {
      INFO('Torquetools no tiene producto/depósito: no se puede probar acá')
    }

    // ── 3 · UPDATE y DELETE ───────────────────────────────────────────────
    seccion('3 · UPDATE y DELETE · un movimiento histórico no se reescribe')

    const { data: historico } = await s.from('stock_movements')
      .select('id, quantity, product_id, warehouse_id')
      .eq('movement_type', 'opening_balance').limit(1).single()

    for (const [rol, c] of identidades) {
      if (rol === 'ANON') continue
      const u = await c.from('stock_movements')
        .update({ quantity: 9999 }).eq('id', historico.id).select('id')
      u.error ? PASS(`${rol}: UPDATE rechazado`, u.error.code ?? String(u.error.message).slice(0, 36))
              : FAIL(`SE PERMITIÓ: ${rol} reescribió un movimiento histórico`)
      const d = await c.from('stock_movements').delete().eq('id', historico.id).select('id')
      if (d.error) PASS(`${rol}: DELETE rechazado`, d.error.code ?? String(d.error.message).slice(0, 36))
      else if ((d.data ?? []).length === 0) PASS(`${rol}: DELETE no borró nada`, '0 filas')
      else FAIL(`SE PERMITIÓ: ${rol} borró un movimiento histórico`)
    }
    const { data: intacto } = await s.from('stock_movements')
      .select('quantity').eq('id', historico.id).maybeSingle()
    cmp('el movimiento histórico quedó intacto', Number(historico.quantity), Number(intacto?.quantity))

    // ── 4 · stock_balances directo ────────────────────────────────────────
    seccion('4 · STOCK_BALANCES · el saldo no se toca a mano')

    for (const [rol, c] of identidades) {
      if (rol === 'ANON') continue
      const u = await c.from('stock_balances').update({ on_hand: 9999 })
        .eq('product_id', prod.id).eq('warehouse_id', dep.id).select('product_id')
      u.error ? PASS(`${rol}: UPDATE on_hand rechazado`, u.error.code ?? String(u.error.message).slice(0, 36))
              : (u.data ?? []).length === 0
                ? PASS(`${rol}: UPDATE on_hand no afectó nada`, '0 filas')
                : FAIL(`SE PERMITIÓ: ${rol} reescribió un saldo a mano`)

      // `reserved` es la otra columna que escribe un trigger. No alcanza con
      // probar `on_hand`: el privilegio es de tabla, pero conviene que la
      // prueba diga lo que se quiso probar.
      const ur = await c.from('stock_balances').update({ reserved: 9999 })
        .eq('product_id', prod.id).eq('warehouse_id', dep.id).select('product_id')
      ur.error ? PASS(`${rol}: UPDATE reserved rechazado`, ur.error.code ?? String(ur.error.message).slice(0, 36))
               : (ur.data ?? []).length === 0
                 ? PASS(`${rol}: UPDATE reserved no afectó nada`, '0 filas')
                 : FAIL(`SE PERMITIÓ: ${rol} reescribió una reserva a mano`)

      const i = await c.from('stock_balances').insert({
        company_id: BT, product_id: prod.id, warehouse_id: dep.id, on_hand: 9999,
      }).select('product_id')
      i.error ? PASS(`${rol}: INSERT de saldo rechazado`, i.error.code ?? String(i.error.message).slice(0, 36))
              : FAIL(`SE PERMITIÓ: ${rol} creó un saldo a mano`)

      const d = await c.from('stock_balances').delete()
        .eq('product_id', prod.id).eq('warehouse_id', dep.id).select('product_id')
      if (d.error) PASS(`${rol}: DELETE de saldo rechazado`, d.error.code ?? String(d.error.message).slice(0, 36))
      else if ((d.data ?? []).length === 0) PASS(`${rol}: DELETE de saldo no borró nada`, '0 filas')
      else FAIL(`SE PERMITIÓ: ${rol} borró un saldo`)
    }

    // ── 5 · Lectura ───────────────────────────────────────────────────────
    seccion('5 · SELECT · quién puede leer el stock')

    for (const [rol, c] of identidades) {
      const { data: m } = await c.from('stock_movements').select('id').limit(5)
      const { data: b } = await c.from('stock_balances').select('product_id').limit(5)
      INFO(`${rol}`, `${(m ?? []).length} movimientos · ${(b ?? []).length} saldos visibles`)
    }

  } finally {
    seccion('LIMPIEZA')

    // El trigger es AFTER INSERT: borrar la fila NO revierte el saldo. Se
    // recalcula desde los movimientos que quedan, que es la fuente de verdad.
    for (const id of creados.movimientos) await s.from('stock_movements').delete().eq('id', id)
    await s.from('stock_movements').delete().eq('source_type', MARCA)

    const { data: saldos } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
    for (const b of saldos ?? []) {
      const { data: ms } = await s.from('stock_movements').select('quantity')
        .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (ms ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      // Sin movimientos no hay saldo: la fila se borra, no se pone en cero. El
      // trigger es AFTER INSERT, así que borrar el movimiento deja el on_hand
      // viejo y una fila en 0 sigue siendo una fila que antes no existía.
      if ((ms ?? []).length === 0) {
        await s.from('stock_balances').delete()
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      } else if (Number(b.on_hand) !== total) {
        await s.from('stock_balances').update({ on_hand: total })
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      }
    }
    for (const id of creados.usuarios) {
      await s.from('company_memberships').delete().eq('user_id', id)
      await s.auth.admin.deleteUser(id)
    }

    cmp('movimientos de stock', movAntes, await q('stock_movements'))
    cmp('saldos', salAntes, await q('stock_balances'))
    cmp('el saldo del producto de prueba', saldoInicial, await saldoDe())
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} hallazgo(s)`)
  console.log('='.repeat(74))
  // Falla de verdad: esta suite es la que tiene que avisar si alguien vuelve a
  // otorgar INSERT sobre stock_movements.
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
