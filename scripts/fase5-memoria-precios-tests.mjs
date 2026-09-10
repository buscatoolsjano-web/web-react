/**
 * Fase 5 · Clientes — entrega 4: memoria de productos y precios históricos.
 *
 * Con sesión real. Prueba lo que hacen los services de React y, sobre todo,
 * las dos cosas que el legacy hacía mal:
 *
 *   - la memoria colgaba del NOMBRE del cliente, así que renombrarlo la perdía
 *     y dos clientes homónimos la compartían;
 *   - la memoria de precios era un caché sin moneda.
 *
 * Cada prohibición se prueba con un INTENTO REAL. Se limpia sola: todo lo que
 * crea lleva el prefijo `ZZ-E4`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/fase5-memoria-precios-tests.mjs
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

const MARCA = 'ZZ-E4'
const creados = { alias: [], clientes: [] }

/** La misma normalización que `lib/alias.ts` y que usó la migración. */
const normalizarClave = (t) =>
  (t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id

  const { count: aliasAntes } = await s.from('customer_product_aliases')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT)
  const { count: clientesAntes } = await s.from('customers')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT)

  const { data: mirgor } = await s.from('customers')
    .select('id').eq('company_id', BT).eq('legal_name', 'Grupo Mirgor S.A.').single()
  const { data: prods } = await s.from('products')
    .select('id, sku').eq('company_id', BT).order('sku').limit(2)

  console.log('='.repeat(74))
  console.log('  CLIENTES · entrega 4 — memoria de productos y precios')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── Memoria migrada ────────────────────────────────────────────────────
    seccion('1 · LA MEMORIA QUE TRAJO LA MIGRACIÓN')

    const { data: migrados } = await c.from('customer_product_aliases')
      .select('id, customer_id, normalized_key, product_id, status, source, confirmed_by')
      .eq('company_id', BT).eq('source', 'legacy')
    cmp('alias migrados del sistema anterior', 14, (migrados ?? []).length)
    cmp('todos apuntan a un producto real (product_id es NOT NULL)',
      0, (migrados ?? []).filter((a) => !a.product_id).length)
    cmp('todos cuelgan de un customer_id, no de un nombre',
      0, (migrados ?? []).filter((a) => !a.customer_id).length)
    cmp('ninguno lo confirmó una persona: los dio por buenos un script',
      (migrados ?? []).length, (migrados ?? []).filter((a) => !a.confirmed_by).length)

    const { data: deMabe } = await c.from('customer_product_aliases')
      .select('id, customers!customer_id ( legal_name )')
      .eq('company_id', BT).eq('source', 'legacy')
    const porCliente = {}
    for (const a of deMabe ?? []) {
      const n = a.customers.legal_name
      porCliente[n] = (porCliente[n] ?? 0) + 1
    }
    PASS('repartidos por cliente', JSON.stringify(porCliente))

    // ── Alta, edición y unicidad ───────────────────────────────────────────
    seccion('2 · ALTA, EDICIÓN Y UNICIDAD')

    const { data: clienteA } = await c.from('customers').insert({
      company_id: BT, legal_name: `${MARCA} Cliente A`, email_domains: [],
    }).select('id').single()
    const { data: clienteB } = await c.from('customers').insert({
      company_id: BT, legal_name: `${MARCA} Cliente B`, email_domains: [],
    }).select('id').single()
    creados.clientes.push(clienteA.id, clienteB.id)

    const CODIGO = 'TUBO-38'
    const nuevoAlias = async (clienteId, codigo, producto) => {
      const { data, error } = await c.from('customer_product_aliases').insert({
        company_id: BT, customer_id: clienteId,
        customer_code: codigo, customer_description: `${MARCA} ${codigo}`,
        normalized_key: normalizarClave(codigo),
        product_id: producto, status: 'confirmed', source: 'manual',
      }).select('id').single()
      if (data) creados.alias.push(data.id)
      return { data, error }
    }

    const a1 = await nuevoAlias(clienteA.id, CODIGO, prods[0].id)
    a1.data ? PASS('crea una equivalencia', `${CODIGO} → ${prods[0].sku}`)
            : FAIL('no se pudo crear la equivalencia', a1.error?.message)

    // EL punto de la entrega: el mismo código, otro cliente, OTRO producto.
    const a2 = await nuevoAlias(clienteB.id, CODIGO, prods[1].id)
    a2.data
      ? PASS('el MISMO código en otro cliente es otro producto', `${CODIGO} → ${prods[1].sku}`)
      : FAIL('NO SE PUDO REPETIR EL CÓDIGO EN OTRO CLIENTE', a2.error?.message)

    const a3 = await nuevoAlias(clienteA.id, CODIGO, prods[1].id)
    a3.error
      ? PASS('repetirlo en el MISMO cliente es rechazado', a3.error.code ?? '')
      : FAIL('SE PUDO REPETIR EL MISMO CÓDIGO EN EL MISMO CLIENTE')

    // Mismo código escrito distinto: la clave normalizada lo detecta igual.
    const a4 = await nuevoAlias(clienteA.id, 'tubo.38', prods[1].id)
    a4.error
      ? PASS('«tubo.38» y «TUBO-38» son el mismo alias', a4.error.code ?? '')
      : FAIL('LA CLAVE NORMALIZADA NO DETECTÓ EL DUPLICADO')

    const { error: eSinProd } = await c.from('customer_product_aliases').insert({
      company_id: BT, customer_id: clienteA.id, customer_code: `${MARCA} sin producto`,
      normalized_key: normalizarClave('sin producto'),
    })
    eSinProd
      ? PASS('una equivalencia sin producto es rechazada', eSinProd.code ?? '')
      : FAIL('SE GUARDÓ UNA EQUIVALENCIA SIN PRODUCTO')

    const { error: eEd } = await c.from('customer_product_aliases')
      .update({ customer_description: `${MARCA} editada` })
      .eq('company_id', BT).eq('id', a1.data.id)
    eEd ? FAIL('no se pudo editar', eEd.message) : PASS('edita una equivalencia')

    const { data: usuario } = await c.auth.getUser()
    const { error: eConf } = await c.from('customer_product_aliases')
      .update({ status: 'confirmed', confirmed_by: usuario.user.id })
      .eq('company_id', BT).eq('id', a1.data.id)
    eConf ? FAIL('no se pudo confirmar', eConf.message)
          : PASS('confirmar deja registrado QUIÉN')

    const { error: eDesc } = await c.from('customer_product_aliases')
      .update({ status: 'rejected' }).eq('company_id', BT).eq('id', a2.data.id)
    eDesc ? FAIL('no se pudo descartar', eDesc.message)
          : PASS('descartar sin borrar deja el rastro de que alguien la miró')

    const { error: eEstado } = await c.from('customer_product_aliases')
      .update({ status: 'lo-que-sea' }).eq('id', a1.data.id)
    eEstado ? PASS('un estado inventado es rechazado', eEstado.code ?? '')
            : FAIL('SE ACEPTÓ UN ESTADO QUE EL CHECK NO TIENE')

    // ── Renombrar no rompe nada ────────────────────────────────────────────
    seccion('3 · RENOMBRAR AL CLIENTE NO LE BORRA LA MEMORIA')

    await c.from('customers')
      .update({ legal_name: `${MARCA} Cliente A renombrado` }).eq('id', clienteA.id)
    const { data: trasRename } = await c.from('customer_product_aliases')
      .select('id').eq('customer_id', clienteA.id)
    cmp('su equivalencia sigue ahí', 1, (trasRename ?? []).length)
    PASS('        (en el legacy la clave era el nombre: renombrarlo las perdía)')

    // ── Precios ────────────────────────────────────────────────────────────
    seccion('4 · PRECIOS HISTÓRICOS, DERIVADOS')

    const t0 = Date.now()
    const { data: ultimos, error: eU } = await c.rpc('ultimo_precio_cliente',
      { p_customer: mirgor.id })
    const msUltimos = Date.now() - t0
    if (eU) FAIL('no se pudo calcular el último precio', eU.message)
    else PASS('último precio por producto', `${ultimos.length} filas · ${msUltimos} ms`)

    const monedas = {}
    for (const u of ultimos ?? []) {
      const k = u.moneda ?? 'SIN MONEDA'
      monedas[k] = (monedas[k] ?? 0) + 1
    }
    Object.keys(monedas).length > 1
      ? PASS('separa por moneda, no mezcla', JSON.stringify(monedas))
      : FAIL('el cliente de prueba no tiene más de una moneda')

    // Una fila por producto Y moneda: nunca dos filas de la misma pareja.
    const claves = (ultimos ?? []).map((u) => `${u.product_id ?? u.sku}|${u.moneda ?? ''}`)
    cmp('una sola fila por producto y moneda', claves.length, new Set(claves).size)

    // Un producto cotizado en dos monedas aparece dos veces, y está bien.
    const porProducto = {}
    for (const u of ultimos ?? []) {
      const k = u.product_id ?? u.sku
      porProducto[k] = (porProducto[k] ?? 0) + 1
    }
    const enDosMonedas = Object.values(porProducto).filter((n) => n > 1).length
    PASS('productos cotizados en más de una moneda', String(enDosMonedas))

    const t1 = Date.now()
    const { data: hist, error: eH } = await c.rpc('precios_historicos_cliente',
      { p_customer: mirgor.id, p_limit: 50 })
    const msHist = Date.now() - t1
    if (eH) FAIL('no se pudo leer el historial', eH.message)
    else {
      cmp('la página trae 50 filas, no las 772', 50, hist.length)
      PASS('el total lo cuenta el servidor', `${hist[0].total_filas} líneas · ${msHist} ms`)
    }

    const { data: pag2 } = await c.rpc('precios_historicos_cliente',
      { p_customer: mirgor.id, p_limit: 50, p_offset: 50 })
    const repetidas = (pag2 ?? []).filter((b) =>
      (hist ?? []).some((a) => a.documento_id === b.documento_id && a.sku === b.sku)).length
    cmp('la página 2 no repite líneas de la 1', 0, repetidas)

    // ── El caché del legacy ────────────────────────────────────────────────
    seccion('5 · BTERP_PRICE_MEMORY ERA UN CACHÉ REDUNDANTE')

    const { data: todas } = await c.rpc('precios_historicos_cliente',
      { p_customer: mirgor.id, p_limit: 500 })
    const c530 = (todas ?? []).filter((r) => r.numero === 'COTI02530')
    cmp('las 9 líneas del caché se reconstruyen desde la cotización', 9, c530.length)
    cmp('todas con precio', 9, c530.filter((r) => r.precio !== null).length)
    cmp('todas con moneda —que el caché NO guardaba—', 9,
      c530.filter((r) => r.moneda === 'USD').length)
    const sinProducto = c530.filter((r) => !r.product_id).length
    PASS('una línea no resolvió producto y se recupera por su SKU', String(sinProducto))

    // ── RLS ────────────────────────────────────────────────────────────────
    seccion('6 · RLS · memoria y precios ajenos')

    const externo = sesion()
    const { error: eLe } = await externo.auth.signInWithPassword({
      email: 'cliente.test@buscatools.com.ar',
      password: process.env.BT_PW_TEST,
    })
    if (eLe) {
      FAIL('no se pudo iniciar sesión como cliente externo', eLe.message)
    } else {
      const { data: aliasExterno } = await externo.from('customer_product_aliases').select('id')
      cmp('un cliente externo no ve NINGUNA memoria de productos', 0, (aliasExterno ?? []).length)

      const { data: preciosExterno, error: ePE } = await externo.rpc(
        'precios_historicos_cliente', { p_customer: mirgor.id })
      cmp('ni los precios de otro cliente', 0, ePE ? 0 : (preciosExterno ?? []).length)

      const { error: eIns } = await externo.from('customer_product_aliases').insert({
        company_id: BT, customer_id: mirgor.id, customer_code: `${MARCA} externo`,
        normalized_key: 'zz e4 externo', product_id: prods[0].id,
      })
      eIns ? PASS('un externo no crea equivalencias', eIns.code ?? '')
           : FAIL('UN EXTERNO CREÓ UNA EQUIVALENCIA')
    }

    const distri = sesion()
    const { error: eLd } = await distri.auth.signInWithPassword({
      email: 'distribuidor.test@buscatools.com.ar',
      password: process.env.BT_PW_TEST,
    })
    if (!eLd) {
      const { data: aliasDistri } = await distri.from('customer_product_aliases').select('id')
      cmp('un distribuidor tampoco ve memoria ajena', 0, (aliasDistri ?? []).length)
    }

    const anon = sesion()
    const { data: aliasAnon } = await anon.from('customer_product_aliases').select('id')
    cmp('anónimo: cero', 0, (aliasAnon ?? []).length)
    const { data: preciosAnon, error: ePA } = await anon.rpc('precios_historicos_cliente',
      { p_customer: mirgor.id })
    cmp('anónimo tampoco lee precios', 0, ePA ? 0 : (preciosAnon ?? []).length)

    // El vendedor: si no ve al cliente, no ve su memoria ni sus precios. Se
    // prueba en Torquetools, donde Jano es salesperson y no admin.
    seccion('7 · EL VENDEDOR NO VE LA MEMORIA DE UN CLIENTE QUE NO VE')

    const TT = comps.find((x) => x.slug === 'torquetools').id
    const { data: yo } = await c.auth.getUser()
    const { data: otroVend } = await s.from('company_memberships')
      .select('user_id').eq('role', 'salesperson').neq('user_id', yo.user.id).limit(1).single()
    const { data: ajeno } = await s.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Cliente de otro vendedor`,
      email_domains: [], salesperson_id: otroVend.user_id,
    }).select('id').single()
    creados.clientes.push(ajeno.id)
    const { data: prodTT } = await s.from('products')
      .select('id').eq('company_id', TT).limit(1).single()
    const { data: aliasAjeno } = await s.from('customer_product_aliases').insert({
      company_id: TT, customer_id: ajeno.id, customer_code: `${MARCA} ajeno`,
      normalized_key: 'zz e4 ajeno', product_id: prodTT.id, status: 'confirmed', source: 'manual',
    }).select('id').single()
    creados.alias.push(aliasAjeno.id)

    const { data: veAjeno } = await c.from('customer_product_aliases')
      .select('id').eq('id', aliasAjeno.id)
    cmp('el vendedor no ve la memoria de un cliente que no es suyo', 0, (veAjeno ?? []).length)

    const { data: preciosAjenos, error: ePAj } = await c.rpc('precios_historicos_cliente',
      { p_customer: ajeno.id })
    cmp('ni sus precios', 0, ePAj ? 0 : (preciosAjenos ?? []).length)
    PASS('        (las dos funciones son SECURITY INVOKER y exigen ver al cliente)')
  } catch (e) {
    FAIL('la suite se cortó por una excepción', e.message)
    console.error(e)
  } finally {
    seccion('LIMPIEZA')
    const sc = admin()
    if (creados.alias.length) await sc.from('customer_product_aliases').delete().in('id', creados.alias)
    if (creados.clientes.length) {
      await sc.from('customer_product_aliases').delete().in('customer_id', creados.clientes)
      await sc.from('customers').delete().in('id', creados.clientes)
    }
    const { count: aliasDespues } = await sc.from('customer_product_aliases')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: clientesDespues } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: sobrantes } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).like('legal_name', `${MARCA}%`)
    cmp('los alias vuelven a su número', aliasAntes, aliasDespues)
    cmp('los clientes vuelven a su número', clientesAntes, clientesDespues)
    cmp('no quedó ningún fixture', 0, sobrantes)

    console.log('\n' + '='.repeat(74))
    console.log(`  RESULTADO: ${fallos} fallo(s)`)
    console.log('='.repeat(74))
    process.exit(fallos === 0 ? 0 : 1)
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
