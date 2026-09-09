/**
 * Regresión de RLS con JWT reales, para los cinco roles.
 *
 * La regla que sigue este script: **no alcanza con que una consulta devuelva
 * lo esperado**. Cada prohibición se prueba con un INTENTO REAL —leer una
 * fila ajena por su id exacto, escribir donde no corresponde— y sólo se marca
 * PASS si el intento es RECHAZADO. Contar filas existentes mide el ESTADO;
 * intentar la operación mide el CUMPLIMIENTO.
 *
 * Usa la clave publicable y sesiones reales. La Secret se usa SÓLO para
 * preparar y limpiar el producto inactivo de prueba, que no se puede crear
 * de otra forma.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   BT_PW_JANO=… BT_PW_TEST=… node scripts/regresion-rls-roles.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY

if (!URL || !PUB) { console.error('✗ Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1) }

const anon = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }

/** Un intento PROHIBIDO: pasa sólo si NO devuelve datos ni tiene éxito. */
async function debeSerRechazado(titulo, fn) {
  const { data, error } = await fn()
  const filas = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error) return PASS(titulo, 'rechazado: ' + (error.code ?? error.message.slice(0, 34)))
  if (filas === 0) return PASS(titulo, 'RLS filtró todo (0 filas)')
  FAIL(titulo, `DEVOLVIÓ ${filas} fila(s) — no debía`)
}

/** Un intento PERMITIDO: pasa sólo si devuelve datos sin error. */
async function debeSerPermitido(titulo, fn, min = 1) {
  const { data, error } = await fn()
  const filas = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error) return FAIL(titulo, 'error: ' + error.message.slice(0, 44))
  if (filas < min) return FAIL(titulo, `devolvió ${filas}, esperaba >= ${min}`)
  PASS(titulo, `${filas} fila(s)`)
}

const main = async () => {
  const sbAdmin = admin()

  // ── Preparación: ids reales y un producto INACTIVO de prueba ─────────────
  const { data: comps } = await sbAdmin.from('companies').select('id, slug')
  const BT = comps.find((c) => c.slug === 'buscatools').id
  const TT = comps.find((c) => c.slug === 'torquetools').id

  // Jano es admin en Buscatools Y salesperson en Torquetools, así que TT no
  // le es ajena. Para probar de verdad el aislamiento entre empresas hace
  // falta una a la que NADIE pertenezca: se crea, se prueba y se borra.
  const SLUG_AJENA = 'zz-rls-ajena-test'
  await sbAdmin.from('companies').delete().eq('slug', SLUG_AJENA)
  const { data: ajena, error: eAj } = await sbAdmin.from('companies')
    .insert({ slug: SLUG_AJENA, name: 'Empresa ajena (prueba RLS)' })
    .select('id').single()
  if (eAj) { console.error('✗ No se pudo crear la empresa ajena: ' + eAj.message); process.exit(1) }
  const { data: catAjena } = await sbAdmin.from('product_categories')
    .insert({ company_id: ajena.id, slug: 'otros', name: 'Otros' }).select('id').single()
  const { data: listaAjena } = await sbAdmin.from('price_lists')
    .insert({ company_id: ajena.id, name: 'Lista ajena', currency_code: 'ARS', is_default: true })
    .select('id').single()
  const { data: prodAjeno } = await sbAdmin.from('products').insert({
    company_id: ajena.id, sku: 'ZZ-AJENO-001', name: 'Producto de empresa ajena',
    category_id: catAjena.id, status: 'active', attributes: {},
  }).select('id').single()
  const { data: listasBT } = await sbAdmin.from('price_lists')
    .select('id, name, is_default').eq('company_id', BT)
  const listaInterna = listasBT.find((l) => l.is_default)
  const { data: catBT } = await sbAdmin.from('product_categories')
    .select('id, slug').eq('company_id', BT)
  const idCat = (s) => catBT.find((c) => c.slug === s)?.id ?? null

  // Producto inactivo: hoy no hay ninguno, y sin uno no se puede probar
  // "productos inactivos según rol". Se crea, se prueba y se borra.
  const SKU_PRUEBA = 'ZZ-RLS-INACTIVO-TEST'
  await sbAdmin.from('products').delete().eq('company_id', BT).eq('sku', SKU_PRUEBA)
  const { data: inactivo, error: eIna } = await sbAdmin.from('products').insert({
    company_id: BT, sku: SKU_PRUEBA, name: 'Producto inactivo de prueba RLS',
    category_id: idCat('otros'), status: 'discontinued', attributes: {},
  }).select('id').single()
  if (eIna) { console.error('✗ No se pudo crear el producto de prueba: ' + eIna.message); process.exit(1) }

  const limpiar = async () => {
    await sbAdmin.from('products').delete().eq('id', inactivo.id)
    await sbAdmin.from('products').delete().eq('company_id', ajena.id)
    await sbAdmin.from('price_lists').delete().eq('company_id', ajena.id)
    await sbAdmin.from('product_categories').delete().eq('company_id', ajena.id)
    await sbAdmin.from('companies').delete().eq('id', ajena.id)
  }

  try {
    console.log('═'.repeat(74))
    console.log('  REGRESIÓN RLS · 5 roles · intentos prohibidos reales')
    console.log('  ' + new Date().toISOString())
    console.log('═'.repeat(74))

    const escenarios = [
      { rol: 'ADMIN · Buscatools',       email: 'buscatools.jano@gmail.com',
        pw: process.env.BT_PW_JANO, propia: BT, ajena: ajena.id, interno: true },
      { rol: 'SALESPERSON · Torquetools', email: 'buscatools.jano@gmail.com',
        pw: process.env.BT_PW_JANO, propia: TT, ajena: ajena.id, interno: true,
        tambienVe: BT },
      { rol: 'DISTRIBUTOR · Buscatools',  email: 'distribuidor.test@buscatools.com.ar',
        pw: process.env.BT_PW_TEST, propia: BT, ajena: ajena.id, interno: false, ajenaTT: TT },
      { rol: 'CUSTOMER · Buscatools',     email: 'cliente.test@buscatools.com.ar',
        pw: process.env.BT_PW_TEST, propia: BT, ajena: ajena.id, interno: false, ajenaTT: TT },
    ]

    for (const e of escenarios) {
      console.log(`\n  ${e.rol}`)
      console.log('  ' + '-'.repeat(70))
      const sb = anon()
      const { error: eL } = await sb.auth.signInWithPassword({ email: e.email, password: e.pw })
      if (eL) { FAIL('login', eL.message); continue }

      // — PERMITIDO: su propia empresa
      await debeSerPermitido('lee productos de su empresa', () =>
        sb.from('products').select('id').eq('company_id', e.propia).limit(5))

      // — PROHIBIDO: empresa ajena, pidiendo la fila POR SU ID exacto
      if (e.ajena) {
        await debeSerRechazado('NO lee un producto de otra empresa (por id exacto)', () =>
          sb.from('products').select('id, sku').eq('id', prodAjeno.id))
        await debeSerRechazado('NO lee listas de precios de otra empresa', () =>
          sb.from('price_lists').select('id').eq('id', listaAjena.id))
        await debeSerRechazado('NO lee precios de otra empresa', () =>
          sb.from('product_prices').select('id').eq('company_id', e.ajena).limit(5))
      }

      // — Multiempresa: Jano pertenece a las dos empresas y debe ver ambas.
      if (e.tambienVe) {
        await debeSerPermitido('multiempresa: ve también su otra empresa', () =>
          sb.from('products').select('id').eq('company_id', e.tambienVe).limit(3))
      }
      // — Un externo de Buscatools NO debe ver Torquetools.
      if (e.ajenaTT) {
        await debeSerRechazado('NO lee productos de Torquetools', () =>
          sb.from('products').select('id').eq('company_id', e.ajenaTT).limit(5))
      }

      // — Productos inactivos: los internos sí, los externos no
      if (e.interno && e.propia === BT) {
        await debeSerPermitido('interno SÍ ve el producto inactivo', () =>
          sb.from('products').select('id, status').eq('id', inactivo.id))
      } else if (!e.interno) {
        await debeSerRechazado('externo NO ve el producto inactivo', () =>
          sb.from('products').select('id, status').eq('id', inactivo.id))
      }

      // — Stock interno: sólo internos
      if (e.interno) {
        await debeSerPermitido('interno lee stock_balances', () =>
          sb.from('stock_balances').select('on_hand').limit(3), 0)
      } else {
        await debeSerRechazado('externo NO lee stock_balances', () =>
          sb.from('stock_balances').select('on_hand').limit(3))
        await debeSerRechazado('externo NO lee stock_movements', () =>
          sb.from('stock_movements').select('id').limit(3))
        await debeSerRechazado('externo NO lee warehouses', () =>
          sb.from('warehouses').select('id').limit(3))
      }

      // — Lista de precios ajena: un externo no puede leer la interna
      if (!e.interno && listaInterna) {
        await debeSerRechazado('externo NO lee precios de la lista interna', () =>
          sb.from('product_prices').select('id')
            .eq('company_id', BT).eq('price_list_id', listaInterna.id).limit(3))
      }

      // — ESCRITURAS PROHIBIDAS: intento real, no ausencia de filas
      if (!e.interno) {
        await debeSerRechazado('externo NO puede insertar un producto', () =>
          sb.from('products').insert({ company_id: e.propia, sku: 'ZZ-HACK-' + Date.now(),
            name: 'intento prohibido', category_id: idCat('otros'), attributes: {} }).select('id'))
        await debeSerRechazado('externo NO puede modificar un producto', () =>
          sb.from('products').update({ name: 'modificado' })
            .eq('company_id', e.propia).select('id').limit(1))
      }
      if (e.ajena) {
        await debeSerRechazado('NO puede insertar en otra empresa', () =>
          sb.from('products').insert({ company_id: e.ajena, sku: 'ZZ-CROSS-' + Date.now(),
            name: 'intento cruzado', category_id: idCat('otros'), attributes: {} }).select('id'))
      }

      // — RPC: search_products y catalog_facets respetan RLS
      await debeSerRechazado('search_products contra otra empresa devuelve vacío', () =>
        sb.rpc('search_products', { p_company: e.ajena ?? TT, p_query: 'punta', p_limit: 5,
          p_offset: 0, p_category: null, p_brand: null, p_attrs: null }))
      const { data: fac, error: eFac } = await sb.rpc('catalog_facets', {
        p_company: e.ajena ?? TT, p_query: null, p_category: null,
        p_brand: null, p_type: null, p_attrs: null })
      if (eFac) PASS('catalog_facets contra otra empresa rechazado', eFac.code ?? '')
      else if ((fac?.total ?? 0) === 0) PASS('catalog_facets contra otra empresa: total 0')
      else FAIL('catalog_facets FILTRÓ datos ajenos', 'total=' + fac.total)

      // — catalog_facets sobre la propia sí funciona
      const { data: facOk, error: eOk } = await sb.rpc('catalog_facets', {
        p_company: e.propia, p_query: null, p_category: null,
        p_brand: null, p_type: null, p_attrs: null })
      eOk ? FAIL('catalog_facets sobre su empresa', eOk.message.slice(0, 40))
          : PASS('catalog_facets sobre su empresa', 'total=' + facOk.total)

      // — El total de facetas coincide con el count real bajo la MISMA RLS
      const { count } = await sb.from('products')
        .select('*', { count: 'exact', head: true }).eq('company_id', e.propia)
      const totalFac = facOk?.total ?? -1
      // El count incluye inactivos para internos; facetas también. Deben coincidir.
      totalFac === count
        ? PASS('total de facetas coincide con count(*) real', String(count))
        : FAIL('total de facetas NO coincide', `facetas=${totalFac} count=${count}`)

      await sb.auth.signOut()
    }

    // ── ANON ────────────────────────────────────────────────────────────────
    console.log('\n  ANON (sin sesión)')
    console.log('  ' + '-'.repeat(70))
    const sbAnon = anon()
    for (const t of ['products', 'product_prices', 'price_lists', 'stock_balances',
                     'stock_movements', 'warehouses', 'companies', 'company_memberships',
                     'profiles', 'customers', 'brands', 'product_categories']) {
      await debeSerRechazado(`anon NO lee ${t}`, () => sbAnon.from(t).select('*').limit(1))
    }
    await debeSerRechazado('anon NO puede insertar un producto', () =>
      sbAnon.from('products').insert({ company_id: BT, sku: 'ZZ-ANON-' + Date.now(),
        name: 'intento anon', category_id: idCat('otros'), attributes: {} }).select('id'))
    await debeSerRechazado('anon NO ejecuta search_products', () =>
      sbAnon.rpc('search_products', { p_company: BT, p_query: 'punta', p_limit: 5,
        p_offset: 0, p_category: null, p_brand: null, p_attrs: null }))
    await debeSerRechazado('anon NO ejecuta catalog_facets', () =>
      sbAnon.rpc('catalog_facets', { p_company: BT, p_query: null, p_category: null,
        p_brand: null, p_type: null, p_attrs: null }))
  } finally {
    await limpiar()
    const { data: quedo } = await admin().from('products').select('id').eq('id', inactivo.id)
    console.log(`\n  limpieza del producto de prueba: ${(quedo ?? []).length === 0 ? 'OK' : '*** QUEDÓ ***'}`)
  }

  console.log('\n' + '═'.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('═'.repeat(74))
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
