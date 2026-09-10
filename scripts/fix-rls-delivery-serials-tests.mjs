/**
 * Fix de seguridad · `delivery_serials.serials_select`.
 *
 * La policy anterior comparaba la fila con SU PROPIA empresa, así que era
 * equivalente a `true` para cualquier fila bien formada: cualquier usuario
 * logueado veía los seriales de todas las empresas.
 *
 * La tabla tiene 0 filas en producción, así que esto no filtró nada — pero
 * habría filtrado en cuanto Ventas empezara a registrar seriales. Como no hay
 * datos, la única forma de probar el arreglo es **crear fixtures en tres
 * empresas**, incluida una donde el usuario no tiene ninguna membresía.
 *
 * Se limpia sola: prefijo `ZZ-DS`. La empresa temporal también se borra.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fix-rls-delivery-serials-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const admin = () => createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-DS'
const HOY = new Date().toISOString().slice(0, 10)
const creados = { empresas: [], clientes: [], productos: [], entregas: [], depositos: [], rubros: [] }

const main = async () => {
  const s = admin()

  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const cuenta = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const antes = {
    empresas: await cuenta('companies'),
    clientes: await cuenta('customers'),
    productos: await cuenta('products'),
    entregas: await cuenta('deliveries'),
    lineas: await cuenta('delivery_lines'),
    seriales: await cuenta('delivery_serials'),
    depositos: await cuenta('warehouses'),
  }

  console.log('='.repeat(74))
  console.log('  FIX RLS · delivery_serials')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))
  cmp('la tabla arranca vacía, como decía la auditoría', 0, antes.seriales)

  /** Toda la cadena de una entrega con serial, en la empresa que se le pida. */
  const armarSerial = async (companyId, etiqueta) => {
    let { data: cli } = await s.from('customers')
      .select('id').eq('company_id', companyId).limit(1).maybeSingle()
    if (!cli) {
      const { data, error } = await s.from('customers').insert({
        company_id: companyId, legal_name: `${MARCA} cliente ${etiqueta}`,
      }).select('id').single()
      if (error) { FAIL(`cliente de ${etiqueta}`, error.message); return null }
      cli = data
      creados.clientes.push(data.id)
    }

    let { data: prod } = await s.from('products')
      .select('id').eq('company_id', companyId).limit(1).maybeSingle()
    if (!prod) {
      // `products.category_id` es NOT NULL y el rubro es por empresa, así que
      // una empresa nueva necesita el suyo.
      const { data: rubro, error: eRub } = await s.from('product_categories').insert({
        company_id: companyId, name: `${MARCA} rubro`, slug: `${MARCA.toLowerCase()}-rubro`,
      }).select('id').single()
      if (eRub) { FAIL(`rubro de ${etiqueta}`, eRub.message); return null }
      creados.rubros.push(rubro.id)

      const { data, error } = await s.from('products').insert({
        company_id: companyId, category_id: rubro.id,
        sku: `${MARCA}-${etiqueta}`, name: `${MARCA} producto ${etiqueta}`,
      }).select('id').single()
      if (error) { FAIL(`producto de ${etiqueta}`, error.message); return null }
      prod = data
      creados.productos.push(data.id)
    }

    let { data: dep } = await s.from('warehouses')
      .select('id').eq('company_id', companyId).limit(1).maybeSingle()
    if (!dep) {
      const { data, error } = await s.from('warehouses').insert({
        company_id: companyId, code: `${MARCA}${etiqueta}`.slice(0, 10),
        name: `${MARCA} depósito ${etiqueta}`,
      }).select('id').single()
      if (error) { FAIL(`depósito de ${etiqueta}`, error.message); return null }
      dep = data
      creados.depositos.push(data.id)
    }

    const { data: ent, error: eEnt } = await s.from('deliveries').insert({
      company_id: companyId, number: `${MARCA}-${etiqueta}-1`, customer_id: cli.id,
      delivery_date: HOY, notes: `${MARCA}`,
    }).select('id').single()
    if (eEnt) { FAIL(`entrega de ${etiqueta}`, eEnt.message); return null }
    creados.entregas.push(ent.id)

    const { data: linea, error: eLin } = await s.from('delivery_lines').insert({
      company_id: companyId, delivery_id: ent.id, product_id: prod.id,
      warehouse_id: dep.id, quantity: 1,
    }).select('id').single()
    if (eLin) { FAIL(`línea de ${etiqueta}`, eLin.message); return null }

    const { data: ser, error: eSer } = await s.from('delivery_serials').insert({
      company_id: companyId, delivery_line_id: linea.id, product_id: prod.id,
      serial_number: `${MARCA}-SERIE-${etiqueta}`, customer_id: cli.id, delivery_date: HOY,
    }).select('id, serial_number').single()
    if (eSer) { FAIL(`serial de ${etiqueta}`, eSer.message); return null }

    return { serialId: ser.id, serial: ser.serial_number, clienteId: cli.id, companyId }
  }

  try {
    // ── Fixtures en tres empresas ──────────────────────────────────────────
    seccion('FIXTURES EN TRES EMPRESAS')

    const { data: ajena, error: eAjena } = await s.from('companies').insert({
      slug: `${MARCA.toLowerCase()}-ajena`, name: `${MARCA} Empresa ajena`,
    }).select('id').single()
    if (eAjena) { FAIL('no se pudo crear la empresa ajena', eAjena.message); throw eAjena }
    creados.empresas.push(ajena.id)
    PASS('empresa ajena creada, sin ninguna membresía')

    const enBT = await armarSerial(BT, 'BT')
    const enTT = await armarSerial(TT, 'TT')
    const enAjena = await armarSerial(ajena.id, 'AJENA')
    if (!enBT || !enTT || !enAjena) throw new Error('no se pudieron armar los fixtures')
    cmp('tres seriales cargados', 3, await cuenta('delivery_serials'))

    // ── La matriz ──────────────────────────────────────────────────────────
    seccion('QUIÉN VE QUÉ, CON JWT REAL')

    /** Qué ve un cliente cualquiera sobre los tres seriales. */
    const mirar = async (cliente, etiqueta, esperados) => {
      const { data: todos } = await cliente.from('delivery_serials').select('id, company_id')
      const vistos = new Set((todos ?? []).map((x) => x.id))
      cmp(`${etiqueta}: ve ${esperados.length} de 3`, esperados.length, vistos.size)

      for (const [nombre, fx] of [['Buscatools', enBT], ['Torquetools', enTT], ['ajena', enAjena]]) {
        const deberia = esperados.includes(nombre)
        const ve = vistos.has(fx.serialId)
        ve === deberia
          ? PASS(`  ${etiqueta}: ${deberia ? 've' : 'NO ve'} el de ${nombre}`)
          : FAIL(`  ${etiqueta}: ${ve ? 'VE' : 'no ve'} el de ${nombre} y debería ${deberia ? 'verlo' : 'NO verlo'}`)
      }

      // Por identificador exacto, que es como se busca un dato puntual.
      const noPermitidos = [['Buscatools', enBT], ['Torquetools', enTT], ['ajena', enAjena]]
        .filter(([n]) => !esperados.includes(n))
      let porId = 0, porSerie = 0, porEmpresa = 0
      for (const [, fx] of noPermitidos) {
        const { data: a } = await cliente.from('delivery_serials').select('id').eq('id', fx.serialId)
        const { data: b } = await cliente.from('delivery_serials')
          .select('id').eq('serial_number', fx.serial)
        const { data: d } = await cliente.from('delivery_serials')
          .select('id').eq('company_id', fx.companyId)
        porId += (a ?? []).length; porSerie += (b ?? []).length; porEmpresa += (d ?? []).length
      }
      cmp(`  ${etiqueta}: por id ajeno`, 0, porId)
      cmp(`  ${etiqueta}: por serial ajeno`, 0, porSerie)
      cmp(`  ${etiqueta}: por empresa ajena`, 0, porEmpresa)
    }

    // Jano: admin en Buscatools, salesperson en Torquetools. Las dos son
    // internas, así que ve las dos y NO la ajena.
    await mirar(c, 'admin BT / salesperson TT', ['Buscatools', 'Torquetools'])

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: login`, error.message); continue }
      // El fixture de Buscatools es de OTRO cliente, así que no le corresponde
      // ninguno de los tres.
      await mirar(ext, rol, [])
    }

    const anon = sesion()
    await mirar(anon, 'anónimo', [])

    // ── El agujero, reproducido al revés ───────────────────────────────────
    seccion('LA POLICY VIEJA HABRÍA DEJADO PASAR ESTO')

    const { data: todosAnon } = await anon.from('delivery_serials').select('id')
    cmp('anónimo: 0 de 3 (con la vieja habría visto los 3)', 0, (todosAnon ?? []).length)
    const { data: todosCli } = await (async () => {
      const ext = sesion()
      await ext.auth.signInWithPassword({
        email: 'cliente.test@buscatools.com.ar', password: process.env.BT_PW_TEST })
      return ext.from('delivery_serials').select('id')
    })()
    cmp('customer: 0 de 3 (con la vieja habría visto los 3)', 0, (todosCli ?? []).length)

    // ── La escritura no se tocó ────────────────────────────────────────────
    seccion('LA POLICY DE ESCRITURA SIGUE COMO ESTABA')

    const { error: eEscribeAjena } = await c.from('delivery_serials').insert({
      company_id: ajena.id, delivery_line_id: null, product_id: null,
      serial_number: 'X', customer_id: null, delivery_date: HOY,
    })
    eEscribeAjena ? PASS('no se puede escribir en la empresa ajena', eEscribeAjena.code ?? '')
                  : FAIL('SE ESCRIBIÓ UN SERIAL EN UNA EMPRESA AJENA')

    const { data: escribeTT } = await c.from('delivery_serials')
      .update({ notes: 'x' }).eq('id', enTT.serialId).select('id')
    cmp('salesperson en TT: puede LEER pero no escribir', 0, (escribeTT ?? []).length)

  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.entregas) {
      await s.from('delivery_serials').delete().eq('delivery_id', id)
      const { data: lineas } = await s.from('delivery_lines').select('id').eq('delivery_id', id)
      for (const l of lineas ?? []) await s.from('delivery_serials').delete().eq('delivery_line_id', l.id)
      await s.from('delivery_lines').delete().eq('delivery_id', id)
      await s.from('deliveries').delete().eq('id', id)
    }
    await s.from('delivery_serials').delete().like('serial_number', `${MARCA}%`)
    await s.from('deliveries').delete().like('number', `${MARCA}%`)

    for (const id of creados.depositos) await s.from('warehouses').delete().eq('id', id)
    for (const id of creados.productos) await s.from('products').delete().eq('id', id)
    for (const id of creados.rubros) await s.from('product_categories').delete().eq('id', id)
    for (const id of creados.clientes) await s.from('customers').delete().eq('id', id)
    for (const id of creados.empresas) await s.from('companies').delete().eq('id', id)

    cmp('empresas', antes.empresas, await cuenta('companies'))
    cmp('clientes', antes.clientes, await cuenta('customers'))
    cmp('productos', antes.productos, await cuenta('products'))
    cmp('depósitos', antes.depositos, await cuenta('warehouses'))
    cmp('entregas', antes.entregas, await cuenta('deliveries'))
    cmp('líneas de entrega', antes.lineas, await cuenta('delivery_lines'))
    cmp('seriales', antes.seriales, await cuenta('delivery_serials'))
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
