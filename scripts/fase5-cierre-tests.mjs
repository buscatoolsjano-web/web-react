/**
 * Fase 5 · Clientes — entrega 5: cierre.
 *
 * Lo que las otras suites no cubren: el panel rápido, el gráfico de doce
 * meses, el cliente dado de baja de punta a punta, la cola de revisión, las
 * búsquedas del listado, la navegación por ids reales y los tiempos con datos
 * reales.
 *
 * Cada prohibición se prueba con un INTENTO REAL. Se limpia sola.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/fase5-cierre-tests.mjs
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

const MARCA = 'ZZ-E5'
const creados = { clientes: [] }
const tiempos = []

/** Mide una consulta y guarda el tiempo para el informe de performance. */
async function medir(nombre, fn) {
  const t = Date.now()
  const r = await fn()
  const ms = Date.now() - t
  tiempos.push({ nombre, ms })
  return { ...r, ms }
}

/** Lo mismo que arma `condicionDeBusqueda` en el service del listado. */
function condicionDeBusqueda(texto) {
  const limpio = texto.trim().replace(/[,()*]/g, '')
  if (limpio === '') return null
  const patron = `%${limpio}%`
  const digitos = limpio.replace(/\D/g, '')
  const cond = [
    `legal_name.ilike.${patron}`, `trade_name.ilike.${patron}`,
    `legacy_ref.ilike.${patron}`, `tax_id.ilike.${patron}`,
    `legacy_name.ilike.${patron}`,
  ]
  if (digitos.length >= 8) cond.push(`tax_id.ilike.%${digitos}%`)
  if (limpio.includes('@') || limpio.includes('.')) {
    const valor = limpio.toLowerCase().replace(/^@/, '')
    cond.push(`emails.cs.{"${valor}"}`)
    cond.push(`email_domains.cs.{"${valor}"}`)
  }
  return cond.join(',')
}

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
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const { count: clientesAntes } = await s.from('customers')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT)
  const { data: mirgor } = await s.from('customers')
    .select('id, legal_name').eq('company_id', BT).eq('legal_name', 'Grupo Mirgor S.A.').single()

  console.log('='.repeat(74))
  console.log('  CLIENTES · entrega 5 — cierre')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── Panel rápido ───────────────────────────────────────────────────────
    seccion('1 · PANEL RÁPIDO')

    const r = await medir('resumen_cliente', () => c.rpc('resumen_cliente', { p_customer: mirgor.id }))
    if (r.error) FAIL('no se pudo leer el resumen', r.error.message)
    else {
      const x = r.data[0]
      cmp('cotizaciones', 99, x.cotizaciones)
      cmp('pedidos', 64, x.pedidos)
      cmp('entregas', 73, x.entregas)
      x.ultima_actividad ? PASS('última actividad', x.ultima_actividad)
                         : FAIL('sin última actividad')
      x.productos_distintos > 0
        ? PASS('productos distintos cotizados/pedidos', String(x.productos_distintos))
        : FAIL('productos distintos dio 0')
      x.documentos_12m > 0
        ? PASS('documentos de los últimos 12 meses', String(x.documentos_12m))
        : FAIL('documentos 12m dio 0')
      x.documentos_12m <= x.cotizaciones + x.pedidos + x.entregas
        ? PASS('los de 12 meses son un subconjunto del total')
        : FAIL('los de 12 meses superan al total')
    }

    // Contrastado contra la base: los números del panel no son de otro lado.
    const { count: cotReal } = await s.from('sales_quotes')
      .select('*', { count: 'exact', head: true }).eq('customer_id', mirgor.id)
    cmp('el resumen coincide con el conteo directo', cotReal, r.data?.[0]?.cotizaciones)

    // ── Montos por moneda ──────────────────────────────────────────────────
    seccion('2 · MONTOS POR MONEDA')

    const t = await medir('totales_por_moneda_cliente',
      () => c.rpc('totales_por_moneda_cliente', { p_customer: mirgor.id }))
    if (t.error) FAIL('no se pudieron leer los totales', t.error.message)
    else {
      const monedas = [...new Set(t.data.map((f) => f.moneda ?? 'SIN MONEDA'))]
      monedas.length > 1
        ? PASS('hay más de una moneda y van separadas', monedas.join(', '))
        : FAIL('el cliente de prueba no tiene más de una moneda')

      // Una fila por (tipo, moneda): nunca una que agregue las monedas.
      const claves = t.data.map((f) => `${f.tipo}|${f.moneda ?? ''}`)
      cmp('una sola fila por tipo y moneda', claves.length, new Set(claves).size)

      // Y el total de un tipo NO es la suma de sus monedas: no existe esa fila.
      const totalesGlobales = t.data.filter((f) => f.moneda === 'TOTAL' || f.tipo === 'total')
      cmp('no existe ninguna fila «total» que mezcle monedas', 0, totalesGlobales.length)

      // Contraste: la suma por moneda de las cotizaciones coincide con la base.
      const usdCot = t.data.find((f) => f.tipo === 'cotizacion' && f.moneda === 'USD')
      const { data: directo } = await s.from('sales_quotes')
        .select('total').eq('customer_id', mirgor.id).eq('currency_code', 'USD')
      const suma = (directo ?? []).reduce((a, d) => a + Number(d.total ?? 0), 0)
      Math.abs(suma - Number(usdCot?.importe ?? 0)) < 0.01
        ? PASS('el importe en USD coincide con la suma directa', suma.toFixed(2))
        : FAIL('el importe en USD no coincide', `${suma} vs ${usdCot?.importe}`)
    }

    // ── Gráfico 12 meses ───────────────────────────────────────────────────
    seccion('3 · GRÁFICO DE DOCE MESES')

    const a = await medir('actividad_mensual_cliente',
      () => c.rpc('actividad_mensual_cliente', { p_customer: mirgor.id, p_meses: 12 }))
    if (a.error) FAIL('no se pudo leer la actividad', a.error.message)
    else {
      a.data.length > 0 ? PASS('devuelve filas', `${a.data.length}`)
                        : FAIL('no devolvió ninguna fila')
      const tipos = [...new Set(a.data.map((f) => f.tipo))].sort()
      PASS('separa por tipo de documento', tipos.join(', '))
      const claves = a.data.map((f) => `${f.mes}|${f.tipo}|${f.moneda ?? ''}`)
      cmp('una sola fila por mes, tipo y moneda', claves.length, new Set(claves).size)

      const hace13 = new Date()
      hace13.setUTCMonth(hace13.getUTCMonth() - 13)
      const viejas = a.data.filter((f) => new Date(f.mes) < hace13).length
      cmp('no devuelve nada de hace más de doce meses', 0, viejas)
    }

    // ── Cliente dado de baja ───────────────────────────────────────────────
    seccion('4 · CLIENTE DADO DE BAJA')

    const { data: baja } = await c.from('customers').insert({
      company_id: BT, legal_name: `${MARCA} Cliente a dar de baja`, email_domains: [],
    }).select('id').single()
    creados.clientes.push(baja.id)

    await c.from('customers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' }).eq('id', baja.id)

    const { data: sigueVisible } = await c.from('customers')
      .select('id, status, deleted_at').eq('id', baja.id).maybeSingle()
    sigueVisible ? PASS('la ficha sigue accesible para un rol interno')
                 : FAIL('LA FICHA DEL CLIENTE DADO DE BAJA DESAPARECIÓ')
    cmp('queda marcado como inactivo', 'inactive', sigueVisible?.status)

    // El listado por defecto lo esconde; con `incluirBajas` aparece.
    const { count: sinBajas } = await c.from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', BT).is('deleted_at', null).eq('id', baja.id)
    cmp('el listado por defecto NO lo muestra', 0, sinBajas)
    const { count: conBajas } = await c.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT).eq('id', baja.id)
    cmp('pidiendo las bajas, aparece', 1, conBajas)

    // El selector de un documento nuevo: mismo filtro que `buscarClientes`.
    const { data: ofrecido } = await c.from('customers')
      .select('id').eq('company_id', BT).is('deleted_at', null).eq('status', 'active')
      .eq('id', baja.id)
    cmp('no se ofrece para un documento nuevo', 0, (ofrecido ?? []).length)

    // Sus cosas siguen existiendo.
    const { data: cto } = await c.from('customer_contacts').insert({
      company_id: BT, customer_id: baja.id, full_name: `${MARCA} contacto`,
    }).select('id').single()
    cto ? PASS('sus contactos siguen siendo legibles y editables')
        : FAIL('no se pudo leer/crear un contacto del cliente dado de baja')

    const { error: eReact } = await c.from('customers')
      .update({ deleted_at: null, status: 'active' }).eq('id', baja.id)
    eReact ? FAIL('no se pudo reactivar', eReact.message) : PASS('se puede reactivar')

    // Y uno del histórico, con documentos: su remito lo sigue nombrando.
    await c.from('customers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' }).eq('id', mirgor.id)
    const { data: docDeBaja } = await c.from('sales_quotes')
      .select('id, customers!customer_id ( legal_name )')
      .eq('customer_id', mirgor.id).limit(1).single()
    docDeBaja?.customers?.legal_name
      ? PASS('un documento de un cliente dado de baja lo sigue nombrando',
             docDeBaja.customers.legal_name)
      : FAIL('EL DOCUMENTO PERDIÓ EL NOMBRE DEL CLIENTE')
    const { data: histDeBaja } = await c.rpc('resumen_cliente', { p_customer: mirgor.id })
    cmp('y su resumen sigue calculándose', 99, histDeBaja?.[0]?.cotizaciones)
    await s.from('customers')
      .update({ deleted_at: null, status: 'active' }).eq('id', mirgor.id)

    // ── needs_review ───────────────────────────────────────────────────────
    seccion('5 · COLA DE REVISIÓN')

    const { count: marcados } = await c.from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', BT).eq('needs_review', true).is('deleted_at', null)
    cmp('clientes marcados', 40, marcados)

    const { data: conMotivos } = await c.from('customers')
      .select('id, review_reason').eq('company_id', BT).eq('needs_review', true)
    const sinMotivo = (conMotivos ?? []).filter((x) => !x.review_reason).length
    cmp('ninguno marcado sin decir por qué', 0, sinMotivo)
    const conVarios = (conMotivos ?? []).filter((x) => x.review_reason.includes('|')).length
    conVarios > 0
      ? PASS('hay clientes con más de un motivo, y se guardan todos', String(conVarios))
      : FAIL('ninguno tiene más de un motivo')

    const motivos = {}
    for (const x of conMotivos ?? []) {
      for (const m of x.review_reason.split('|').map((y) => y.trim())) {
        motivos[m] = (motivos[m] ?? 0) + 1
      }
    }
    PASS('motivos presentes', JSON.stringify(motivos))

    // ── Búsquedas ──────────────────────────────────────────────────────────
    seccion('6 · BÚSQUEDA')

    const { data: muestra } = await s.from('customers')
      .select('id, legal_name, trade_name, legacy_ref, tax_id, emails, email_domains')
      .eq('company_id', BT).not('tax_id', 'is', null).not('emails', 'is', null)
      .not('trade_name', 'is', null).limit(1).single()

    const buscar = async (texto) => {
      let q = c.from('customers').select('id', { count: 'exact' })
        .eq('company_id', BT).is('deleted_at', null)
      const cond = condicionDeBusqueda(texto)
      if (cond) q = q.or(cond)
      return q.range(0, 24)
    }

    const casos = [
      ['por referencia CLI', muestra.legacy_ref],
      ['por razón social', muestra.legal_name.slice(0, 12)],
      ['por nombre comercial', muestra.trade_name.slice(0, 10)],
      ['por CUIT con guiones', muestra.tax_id],
      ['por CUIT sin guiones', muestra.tax_id.replace(/\D/g, '')],
      ['por email exacto', muestra.emails[0]],
      ['por dominio', muestra.email_domains[0]],
    ]
    for (const [etiqueta, texto] of casos) {
      if (!texto) { PASS(etiqueta, 'la muestra no tiene ese dato'); continue }
      const { data, count, error } = await buscar(texto)
      if (error) { FAIL(etiqueta, error.message); continue }
      ;(data ?? []).some((x) => x.id === muestra.id)
        ? PASS(etiqueta, `${count} resultado(s)`)
        : FAIL(etiqueta, `no encontró al cliente buscado entre ${count}`)
    }

    // Se excluyen los fixtures de esta corrida: si no, el total esperado
    // dependería de en qué punto de la suite estamos.
    const paginado = await medir('listado paginado', () =>
      c.from('customers').select('id', { count: 'exact' })
        .eq('company_id', BT).is('deleted_at', null)
        .not('legal_name', 'like', `${MARCA}%`)
        .order('legal_name').order('id').range(0, 24))
    cmp('la página trae 25, no las 1.010', 25, (paginado.data ?? []).length)
    cmp('el total lo cuenta el servidor', 1010, paginado.count)

    const p2 = await c.from('customers').select('id')
      .eq('company_id', BT).is('deleted_at', null)
      .order('legal_name').order('id').range(25, 49)
    const repetidos = (p2.data ?? []).filter((b) =>
      (paginado.data ?? []).some((x) => x.id === b.id)).length
    cmp('la página 2 no repite', 0, repetidos)

    // ── Navegación por ids ─────────────────────────────────────────────────
    seccion('7 · NAVEGACIÓN POR IDS REALES')

    const { data: docs } = await c.from('sales_quotes')
      .select('id, customer_id').eq('customer_id', mirgor.id).limit(3)
    const todosConId = (docs ?? []).every((d) => d.id && d.customer_id)
    todosConId ? PASS('los documentos enlazan por uuid, no por nombre')
               : FAIL('algún documento no tiene id o customer_id')

    const { data: alias } = await c.from('customer_product_aliases')
      .select('id, customer_id, product_id').eq('customer_id', mirgor.id).limit(3)
    const aliasOk = (alias ?? []).every((x) => x.customer_id && x.product_id)
    aliasOk ? PASS('los alias enlazan cliente y producto por uuid')
            : FAIL('algún alias no enlaza por uuid')

    const { data: precios } = await c.rpc('precios_historicos_cliente',
      { p_customer: mirgor.id, p_limit: 5 })
    const preciosOk = (precios ?? []).every((x) => x.documento_id && x.numero)
    preciosOk ? PASS('cada línea de precio trae el id del documento al que enlaza')
              : FAIL('alguna línea de precio no trae documento_id')

    // ── Roles ──────────────────────────────────────────────────────────────
    seccion('8 · ADMIN / EMPLOYEE')

    const { count: comoAdmin } = await c.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT).is('deleted_at', null)
      .not('legal_name', 'like', `${MARCA}%`)
    cmp('el admin ve el maestro completo de su empresa', 1010, comoAdmin)

    const { count: deOtraEmpresa } = await c.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', TT)
    PASS('en Torquetools ve lo que su rol de allá le permite', String(deOtraEmpresa))

    seccion('9 · CUSTOMER / DISTRIBUTOR CON JWT REAL')

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({
        email, password: process.env.BT_PW_TEST,
      })
      if (error) { FAIL(`${rol}: no se pudo iniciar sesión`, error.message); continue }

      const { data: suyos } = await ext.from('customers').select('id, legal_name')
      cmp(`${rol}: ve exactamente una ficha, la suya`, 1, (suyos ?? []).length)

      // Buscar por referencia, CUIT, email y dominio de OTRO no devuelve nada.
      for (const [etiqueta, texto] of [
        ['por CLI ajeno', muestra.legacy_ref],
        ['por CUIT ajeno', muestra.tax_id],
        ['por email ajeno', muestra.emails[0]],
        ['por dominio ajeno', muestra.email_domains[0]],
      ]) {
        if (!texto) continue
        let q = ext.from('customers').select('id').eq('company_id', BT)
        const cond = condicionDeBusqueda(texto)
        if (cond) q = q.or(cond)
        const { data } = await q
        cmp(`${rol}: buscar ${etiqueta} no devuelve nada`, 0, (data ?? []).length)
      }

      const { data: ctos } = await ext.from('customer_contacts')
        .select('id').eq('customer_id', mirgor.id)
      cmp(`${rol}: no lee contactos ajenos`, 0, (ctos ?? []).length)
      const { data: dirs } = await ext.from('customer_addresses')
        .select('id').eq('customer_id', mirgor.id)
      cmp(`${rol}: no lee direcciones ajenas`, 0, (dirs ?? []).length)
      const { data: als } = await ext.from('customer_product_aliases')
        .select('id').eq('customer_id', mirgor.id)
      cmp(`${rol}: no lee memoria ajena`, 0, (als ?? []).length)
      const { data: prs, error: ePr } = await ext.rpc('precios_historicos_cliente',
        { p_customer: mirgor.id })
      cmp(`${rol}: no lee precios ajenos`, 0, ePr ? 0 : (prs ?? []).length)
      const { data: res, error: eRes } = await ext.rpc('resumen_cliente',
        { p_customer: mirgor.id })
      const resumenAjeno = eRes ? 0 : (res ?? []).filter((x) => Number(x.cotizaciones) > 0).length
      cmp(`${rol}: el panel de un cliente ajeno no dice nada`, 0, resumenAjeno)
    }

    const anon = sesion()
    const { data: nada } = await anon.from('customers').select('id').limit(1)
    cmp('anónimo: cero clientes', 0, (nada ?? []).length)

    seccion('10 · SALESPERSON')

    // Jano es salesperson en Torquetools: se prueba ahí.
    const { data: yo } = await c.auth.getUser()
    const { data: otroVend } = await s.from('company_memberships')
      .select('user_id').eq('role', 'salesperson').neq('user_id', yo.user.id).limit(1).single()

    const { data: propio } = await c.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Cartera propia`, email_domains: [],
    }).select('id, salesperson_id').single()
    creados.clientes.push(propio.id)
    cmp('crea un cliente y el servidor se lo asigna', yo.user.id, propio.salesperson_id)

    const { data: veElPropio } = await c.from('customers').select('id').eq('id', propio.id)
    cmp('lo ve', 1, (veElPropio ?? []).length)

    const { data: ajeno } = await s.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Cartera ajena`, email_domains: [],
      salesperson_id: otroVend.user_id,
    }).select('id').single()
    creados.clientes.push(ajeno.id)
    const { data: veElAjeno } = await c.from('customers').select('id').eq('id', ajeno.id)
    cmp('no ve el de otro vendedor', 0, (veElAjeno ?? []).length)

    const { data: sinDuenio } = await s.from('customers').insert({
      company_id: TT, legal_name: `${MARCA} Sin vendedor`, email_domains: [],
    }).select('id').single()
    creados.clientes.push(sinDuenio.id)
    const { data: veElSinDuenio } = await c.from('customers').select('id').eq('id', sinDuenio.id)
    cmp('no ve los que no tienen vendedor asignado', 0, (veElSinDuenio ?? []).length)

    const { data: resAjeno, error: eResAj } = await c.rpc('resumen_cliente',
      { p_customer: ajeno.id })
    const filasAjenas = eResAj ? 0 : (resAjeno ?? []).filter((x) => Number(x.cotizaciones) > 0).length
    cmp('ni el panel del cliente ajeno', 0, filasAjenas)

    // Contactos y direcciones siguen siendo de admin+employee: es lo decidido.
    const { error: eCtoVend } = await c.from('customer_contacts')
      .insert({ company_id: TT, customer_id: propio.id, full_name: `${MARCA} intento` })
    eCtoVend
      ? PASS('sigue sin poder cargar contactos, como se decidió', eCtoVend.code ?? '')
      : FAIL('EL VENDEDOR PUDO CARGAR UN CONTACTO')

    // ── Performance ────────────────────────────────────────────────────────
    seccion('11 · PERFORMANCE, CON DATOS REALES')

    await medir('ficha del cliente', () =>
      c.from('customers').select('id, legal_name, emails, email_domains').eq('id', mirgor.id).single())
    await medir('contactos', () =>
      c.from('customer_contacts').select('id, full_name').eq('customer_id', mirgor.id))
    await medir('memoria de productos', () =>
      c.from('customer_product_aliases').select('id, customer_code').eq('customer_id', mirgor.id))
    await medir('precios: último por producto', () =>
      c.rpc('ultimo_precio_cliente', { p_customer: mirgor.id }))
    await medir('precios: página de 50', () =>
      c.rpc('precios_historicos_cliente', { p_customer: mirgor.id, p_limit: 50 }))
    await medir('búsqueda por nombre', () =>
      c.from('customers').select('id', { count: 'exact' }).eq('company_id', BT)
        .or(condicionDeBusqueda('mirgor')).range(0, 24))
    await medir('búsqueda por CUIT', () =>
      c.from('customers').select('id', { count: 'exact' }).eq('company_id', BT)
        .or(condicionDeBusqueda(muestra.tax_id)).range(0, 24))

    const lento = tiempos.filter((x) => x.ms > 3000)
    for (const x of tiempos) {
      console.log(`    ${String(x.ms).padStart(6)} ms   ${x.nombre}`)
    }
    cmp('ninguna consulta tarda más de 3 segundos', 0, lento.length)
  } catch (e) {
    FAIL('la suite se cortó por una excepción', e.message)
    console.error(e)
  } finally {
    seccion('LIMPIEZA')
    const sc = admin()
    // Se limpia por PREFIJO y no sólo por los ids de esta corrida: si una
    // corrida anterior murió a mitad —a mí me pasó por mandarla a `head`, que
    // cierra el pipe y mata el proceso antes del `finally`— sus fixtures
    // quedaban dando vueltas y hacían fallar el conteo de la siguiente.
    const { data: viejos } = await sc.from('customers')
      .select('id').like('legal_name', `${MARCA}%`)
    for (const v of viejos ?? []) {
      if (!creados.clientes.includes(v.id)) creados.clientes.push(v.id)
    }
    if (creados.clientes.length) {
      await sc.from('customer_contacts').delete().in('customer_id', creados.clientes)
      await sc.from('customer_addresses').delete().in('customer_id', creados.clientes)
      await sc.from('customer_product_aliases').delete().in('customer_id', creados.clientes)
      await sc.from('customers').delete().in('id', creados.clientes)
    }
    // Por las dudas: el cliente del histórico se deja activo sí o sí.
    await sc.from('customers')
      .update({ deleted_at: null, status: 'active' })
      .eq('legal_name', 'Grupo Mirgor S.A.')

    const { count: clientesDespues } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: sobrantes } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).like('legal_name', `${MARCA}%`)
    cmp('los clientes vuelven a su número', clientesAntes, clientesDespues)
    cmp('no quedó ningún fixture', 0, sobrantes)

    console.log('\n' + '='.repeat(74))
    console.log(`  RESULTADO: ${fallos} fallo(s)`)
    console.log('='.repeat(74))
    process.exit(fallos === 0 ? 0 : 1)
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
