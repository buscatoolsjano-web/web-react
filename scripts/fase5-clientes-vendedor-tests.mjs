/**
 * Fase 5 · Clientes — el vendedor que crea un cliente, lo ve.
 *
 * `customers_insert` autoriza a `salesperson`, pero `customers_select` sólo le
 * muestra los que tienen `salesperson_id = auth.uid()`: un vendedor podía
 * crear un cliente y perderlo de vista en el mismo acto.
 *
 * Se resolvió en el servidor —`app.asignar_vendedor_cliente()`— y NO ampliando
 * el acceso. Acá se prueban las ocho situaciones, cada prohibición con un
 * INTENTO REAL: contar filas mide el estado, intentar la operación mide el
 * cumplimiento.
 *
 * Jano es admin en Buscatools y **salesperson en Torquetools**, así que el
 * camino del vendedor se prueba con una sesión real sin inventar cuentas.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/fase5-clientes-vendedor-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-VEND'
const creados = { clientes: [], empresas: [] }

const main = async () => {
  const s = admin()
  const c = sesion()
  const { data: login, error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }
  const YO = login.user.id

  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  // Otro vendedor de verdad, para los intentos de robo de cliente.
  const { data: otro } = await s.from('company_memberships')
    .select('user_id, profiles ( full_name )')
    .eq('role', 'salesperson').neq('user_id', YO).limit(1).single()
  const OTRO = otro.user_id

  const { count: clientesAntes } = await s.from('customers')
    .select('*', { count: 'exact', head: true })
  const { data: seqAntes } = await s.from('document_sequences')
    .select('next_number').eq('company_id', TT).eq('doc_type', 'customer').maybeSingle()

  console.log('='.repeat(74))
  console.log('  CLIENTES · el vendedor y su cartera, con sesión real')
  console.log(`  Jano: admin en Buscatools · salesperson en Torquetools`)
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    seccion('S1 · el vendedor crea un cliente')

    // El alta pide el número igual que `crearCliente`. Que el vendedor pueda
    // numerar `customer` es parte del arreglo: antes la guarda de
    // `next_document_number` era de admin y employee para todo, así que el
    // alta le fallaba antes de empezar.
    const { data: ref, error: eRef } = await c.rpc('next_document_number',
      { p_company: TT, p_doc_type: 'customer' })
    eRef ? FAIL('S1 · el vendedor no pudo obtener la referencia', eRef.message)
         : PASS('S1 · el vendedor obtiene una referencia del servidor', ref)
    const { data: creado, error: eCrear } = await c.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Cliente del vendedor`,
      legacy_ref: ref, email_domains: [], customer_type: 'business', status: 'active',
    }).select('id, salesperson_id').single()

    if (eCrear) {
      FAIL('S1 · el vendedor no pudo crear el cliente', eCrear.message)
    } else {
      creados.clientes.push(creado.id)
      PASS('S1 · el vendedor crea un cliente', ref ?? 'sin referencia')
      cmp('        y el servidor se lo asigna a él mismo', YO, creado.salesperson_id)
    }

    // Numerar un documento de Ventas sigue estando fuera de su alcance: eso
    // no cambió, y es lo que dicen `quotes_write` y las otras dos.
    const { error: eCot } = await c.rpc('next_document_number',
      { p_company: TT, p_doc_type: 'quote' })
    eCot
      ? PASS('S1 · pero NO puede numerar una cotización', eCot.code ?? '')
      : FAIL('S1 · EL VENDEDOR PUDO NUMERAR UNA COTIZACIÓN')

    seccion('S2 · y lo puede leer')

    const { data: leido } = await c.from('customers')
      .select('id, legal_name, salesperson_id').eq('id', creado.id).maybeSingle()
    leido
      ? PASS('S2 · el vendedor ve el cliente que acaba de crear', leido.legal_name)
      : FAIL('S2 · EL VENDEDOR NO VE EL CLIENTE QUE CREÓ')

    const { data: enListado } = await c.from('customers')
      .select('id').eq('company_id', TT).is('deleted_at', null)
    const listado = enListado ?? []
    listado.some((x) => x.id === creado.id)
      ? PASS('S2 · y aparece en su listado', `${listado.length} cliente(s) en Torquetools`)
      : FAIL('S2 · el cliente no aparece en el listado del vendedor')

    seccion('S3 · y lo puede editar')

    const { data: editado, error: eEd } = await c.from('customers')
      .update({ phone: '+54 11 3333-3333', trade_name: `${MARCA} editado` })
      .eq('id', creado.id).select('id, phone').single()
    eEd ? FAIL('S3 · el vendedor no pudo editar su cliente', eEd.message)
        : PASS('S3 · el vendedor edita su cliente', editado.phone)

    seccion('S4 · no puede asignárselo a otro vendedor')

    const { data: intento } = await c.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Intento de asignación ajena`,
      salesperson_id: OTRO, email_domains: [],
    }).select('id, salesperson_id').single()
    if (intento) {
      creados.clientes.push(intento.id)
      cmp('S4 · el servidor fuerza el vendedor al que inserta', YO, intento.salesperson_id)
      intento.salesperson_id !== OTRO
        ? PASS('S4 · el id que mandó el frontend fue ignorado')
        : FAIL('S4 · EL FRONTEND PUDO ELEGIR EL VENDEDOR')
    } else {
      PASS('S4 · el alta con vendedor ajeno fue rechazada de plano')
    }

    const { data: regalado } = await c.from('customers')
      .update({ salesperson_id: OTRO }).eq('id', creado.id).select('salesperson_id').single()
    cmp('S4 · editando tampoco puede cambiar de dueño', YO, regalado.salesperson_id)

    seccion('S5 · no ve los clientes de otro vendedor')

    const { data: ajeno } = await s.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Cliente de otro vendedor`,
      salesperson_id: OTRO, email_domains: [],
    }).select('id').single()
    creados.clientes.push(ajeno.id)

    const { data: verAjeno } = await c.from('customers').select('id').eq('id', ajeno.id)
    cmp('S5 · el cliente de otro vendedor no se lee por id', 0, (verAjeno ?? []).length)

    const { data: robar } = await c.from('customers')
      .update({ salesperson_id: YO }).eq('id', ajeno.id).select('id')
    cmp('S5 · tampoco se lo puede robar con un UPDATE', 0, (robar ?? []).length)
    const { data: sigueAjeno } = await s.from('customers')
      .select('salesperson_id').eq('id', ajeno.id).single()
    cmp('S5 · y sigue siendo del otro', OTRO, sigueAjeno.salesperson_id)

    seccion('S6 · no ve los clientes de una empresa ajena')

    await s.from('companies').delete().eq('slug', 'zz-vend-ajena')
    const { data: ajena } = await s.from('companies')
      .insert({ slug: 'zz-vend-ajena', name: 'ZZ Empresa ajena (prueba vendedor)' })
      .select('id').single()
    creados.empresas.push(ajena.id)
    const { data: clienteAjeno } = await s.from('customers').insert({
      company_id: ajena.id, legal_name: `${MARCA} De otra empresa`,
      salesperson_id: YO, email_domains: [],
    }).select('id').single()

    const { data: verOtraEmpresa } = await c.from('customers').select('id').eq('id', clienteAjeno.id)
    cmp('S6 · empresa sin membresía: cero filas, aun estando asignado a él',
      0, (verOtraEmpresa ?? []).length)

    const { error: eCrearAjena } = await c.from('customers')
      .insert({ company_id: ajena.id, legal_name: `${MARCA} intento en empresa ajena`, email_domains: [] })
    eCrearAjena
      ? PASS('S6 · tampoco puede crear en una empresa ajena', eCrearAjena.code ?? '')
      : FAIL('S6 · CREÓ UN CLIENTE EN UNA EMPRESA DONDE NO ES NADA')

    seccion('S6b · no ve los que no tienen vendedor')

    const { data: sinVendedor } = await s.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Sin vendedor`, email_domains: [],
    }).select('id').single()
    creados.clientes.push(sinVendedor.id)
    const { data: verSinVendedor } = await c.from('customers').select('id').eq('id', sinVendedor.id)
    cmp('S6b · un cliente con salesperson_id NULL no es de nadie', 0, (verSinVendedor ?? []).length)

    seccion('S7 · el admin sigue viendo todo lo de su empresa')

    const { count: comoAdmin } = await c.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT).is('deleted_at', null)
    cmp('S7 · en Buscatools, donde es admin, los ve a todos', 1010, comoAdmin)

    const { data: adminAsigna } = await c.from('customers').insert({
      company_id: BT, legal_name: `${MARCA} Alta de admin con vendedor`,
      salesperson_id: OTRO, email_domains: [],
    }).select('id, salesperson_id').single()
    if (adminAsigna) {
      creados.clientes.push(adminAsigna.id)
      cmp('S7 · un admin SÍ elige el vendedor', OTRO, adminAsigna.salesperson_id)
    } else {
      FAIL('S7 · el admin no pudo crear un cliente asignado')
    }

    seccion('S8 · los demás roles siguen sin poder crear')

    const externo = sesion()
    const { error: eLe } = await externo.auth.signInWithPassword({
      email: 'cliente.test@buscatools.com.ar',
      password: process.env.BT_PW_TEST,
    })
    if (eLe) {
      FAIL('S8 · no se pudo iniciar sesión como cliente externo', eLe.message)
    } else {
      const { error: eIns } = await externo.from('customers')
        .insert({ company_id: BT, legal_name: `${MARCA} externo`, email_domains: [] })
      eIns ? PASS('S8 · un cliente externo no crea clientes', eIns.code ?? '')
           : FAIL('S8 · UN EXTERNO CREÓ UN CLIENTE')
    }

    const distri = sesion()
    const { error: eLd } = await distri.auth.signInWithPassword({
      email: 'distribuidor.test@buscatools.com.ar',
      password: process.env.BT_PW_TEST,
    })
    if (eLd) {
      FAIL('S8 · no se pudo iniciar sesión como distribuidor', eLd.message)
    } else {
      const { error: eIns } = await distri.from('customers')
        .insert({ company_id: BT, legal_name: `${MARCA} distribuidor`, email_domains: [] })
      eIns ? PASS('S8 · un distribuidor no crea clientes', eIns.code ?? '')
           : FAIL('S8 · UN DISTRIBUIDOR CREÓ UN CLIENTE')
    }

    const anon = sesion()
    const { error: eAnon } = await anon.from('customers')
      .insert({ company_id: BT, legal_name: `${MARCA} anon`, email_domains: [] })
    eAnon ? PASS('S8 · anónimo no crea clientes', eAnon.code ?? '')
          : FAIL('S8 · ANÓNIMO CREÓ UN CLIENTE')

    seccion('EL HISTÓRICO NO SE REASIGNA SOLO')

    const { count: conVendedor } = await s.from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', BT).not('salesperson_id', 'is', null)
      .not('legal_name', 'like', `${MARCA}%`)
    cmp('los clientes de Buscatools con vendedor siguen siendo los mismos', 1, conVendedor)
    PASS('        (el único es «Cliente Demo S.A.», fixture de Stage 1)')
  } catch (e) {
    FAIL('la suite se cortó por una excepción', e.message)
    console.error(e)
  } finally {
    seccion('LIMPIEZA')
    const sc = admin()
    if (creados.clientes.length) await sc.from('customers').delete().in('id', creados.clientes)
    for (const e of creados.empresas) {
      await sc.from('customers').delete().eq('company_id', e)
      await sc.from('companies').delete().eq('id', e)
    }
    if (seqAntes) {
      await sc.from('document_sequences').update({ next_number: seqAntes.next_number })
        .eq('company_id', TT).eq('doc_type', 'customer')
    }
    const { count: clientesDespues } = await sc.from('customers')
      .select('*', { count: 'exact', head: true })
    const { count: sobrantes } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).like('legal_name', `${MARCA}%`)
    cmp('clientes vuelven a su número', clientesAntes, clientesDespues)
    cmp('no quedó ningún fixture', 0, sobrantes)

    console.log('\n' + '='.repeat(74))
    console.log(`  RESULTADO: ${fallos} fallo(s)`)
    console.log('='.repeat(74))
    process.exit(fallos === 0 ? 0 : 1)
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
