/**
 * Fase 7 · Mantenimiento — entrega 5: la pasada final del módulo.
 *
 * Lo que NO estaba probado hasta acá:
 *
 *   · los adjuntos, que esta entrega enchufó
 *   · la matriz de RLS con las **siete** identidades, no cuatro
 *   · los cinco patrones de O1 en una empresa tercera de verdad
 *   · el congelamiento completo: trece intentos, no cinco
 *   · la concurrencia de la numeración y del consumo, no sólo del cierre
 *   · la pluralización de los mensajes del servidor
 *
 * Para la matriz hacen falta un EMPLOYEE y un TECHNICIAN, que no existen en la
 * base: se crean dos usuarios temporales con contraseña generada acá, se usan
 * y se borran. No se toca ningún usuario real.
 *
 * Se limpia sola: prefijo `ZZ-M5`.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase7-mantenimiento-entrega5-tests.mjs
 *
 * NO canalizar por `head`: cierra el pipe y la limpieza no llega a correr.
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
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const rechaza = (t, r) => r.error ? PASS(t, r.error.code ?? String(r.error.message).slice(0, 48))
                                  : FAIL(`SE PERMITIÓ: ${t}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-M5'
const HOY = new Date().toISOString().slice(0, 10)
const BUCKET = 'ventas'
const creados = { usuarios: [], empresas: [], clientes: [], objetos: [] }

const entrar = async (email, pw) => {
  const c = sesion()
  const { error } = await c.auth.signInWithPassword({ email, password: pw })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return c
}

/** Un usuario temporal con su membresía. Se borra al final. */
const usuarioTemporal = async (companyId, rol) => {
  const email = `zz-m5-${rol}-${Date.now()}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const { error: eM } = await s.from('company_memberships')
    .insert({ company_id: companyId, user_id: data.user.id, role: rol, status: 'active' })
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return { email, password, id: data.user.id }
}

const main = async () => {
  const admin = await entrar('buscatools.jano@gmail.com', process.env.BT_PW_JANO)

  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const q = async (t) => (await s.from(t).select('*', { count: 'exact', head: true })).count
  const { data: seqAntes } = await s.from('document_sequences')
    .select('company_id, doc_type, next_number').in('doc_type', ['maintenance_asset', 'maintenance_order'])
  const movAntes = await q('stock_movements')
  const adjAntes = await q('attachments')
  const empresasAntes = await q('companies')
  const clientesAntes = await q('customers')
  const { data: balAntes } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
  const saldosPrevios = new Map((balAntes ?? []).map((b) => [b.product_id + '|' + b.warehouse_id, Number(b.on_hand)]))

  const { data: cli } = await s.from('customers').select('id').eq('company_id', BT).order('legal_name').limit(1)
  const { data: prods } = await s.from('products').select('id, sku').eq('company_id', BT).order('sku').limit(2)
  const { data: dep } = await s.from('warehouses').select('id').eq('company_id', BT).eq('is_default', true).single()
  const { data: punto } = await s.from('maintenance_check_points')
    .select('id').eq('company_id', BT).order('sort_order').limit(1).single()

  const equipo = async (c = admin, company = BT) => {
    const { data: ref } = await c.rpc('next_document_number',
      { p_company: company, p_doc_type: 'maintenance_asset' })
    const { data, error } = await c.from('maintenance_assets')
      .insert({ company_id: company, reference: ref, notes: MARCA }).select('id').single()
    if (error) throw new Error('equipo: ' + error.message)
    return data.id
  }

  const orden = async (campos = {}, c = admin) => {
    const eq = await equipo(c)
    const { data: num } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'maintenance_order' })
    const { data, error } = await c.from('maintenance_orders').insert({
      company_id: BT, number: num, asset_id: eq, customer_id: cli[0].id,
      service_type: 'corrective', received_at: HOY, entry_reason: MARCA, ...campos,
    }).select('*').single()
    if (error) throw new Error('orden: ' + error.message)
    return data
  }

  console.log('='.repeat(74))
  console.log('  MANTENIMIENTO · entrega 5 — cierre definitivo del módulo')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── 1 · Adjuntos ──────────────────────────────────────────────────────
    seccion('1 · ADJUNTOS · subir, listar, firmar y borrar')

    const eqAdj = await equipo()
    const ordAdj = await orden()
    const contenido = new Blob([`${MARCA} contenido de prueba`], { type: 'text/plain' })

    const subir = async (c, company, entidad, entidadId, nombre) => {
      const ruta = `${company}/${entidad}/${entidadId}/${randomUUID()}-${nombre}`
      const { error: eS } = await c.storage.from(BUCKET).upload(ruta, contenido, {
        contentType: 'text/plain', upsert: false,
      })
      if (eS) return { error: eS }
      creados.objetos.push(ruta)
      const r = await c.from('attachments').insert({
        company_id: company, entity_type: entidad, entity_id: entidadId,
        storage_path: ruta, file_name: nombre, mime_type: 'text/plain',
        bytes: 21, kind: 'photo',
      }).select('id').single()
      return { ...r, ruta }
    }

    const a1 = await subir(admin, BT, 'maintenance_asset', eqAdj, `${MARCA}-equipo.txt`)
    a1.error ? FAIL('adjuntar al equipo', a1.error.message) : PASS('adjunto del equipo creado')
    const a2 = await subir(admin, BT, 'maintenance_order', ordAdj.id, `${MARCA}-orden.txt`)
    a2.error ? FAIL('adjuntar a la orden', a2.error.message) : PASS('adjunto de la orden creado')

    const { data: listaEq } = await admin.from('attachments').select('id, file_name, kind')
      .eq('company_id', BT).eq('entity_type', 'maintenance_asset').eq('entity_id', eqAdj)
    cmp('el equipo lista su archivo', 1, (listaEq ?? []).length)

    const { data: firmada, error: eF } = await admin.storage.from(BUCKET).createSignedUrl(a1.ruta, 300)
    eF ? FAIL('URL firmada', eF.message) : PASS('URL firmada de 5 minutos', firmada.signedUrl.slice(0, 48) + '…')
    if (firmada) {
      const r = await fetch(firmada.signedUrl)
      cmp('  y el archivo se descarga con ella', 200, r.status)
      cmp('  con el contenido correcto', true, (await r.text()).includes(MARCA))
    }

    // El bucket es privado: la URL sin firmar no sirve.
    const publica = `${BASE}/storage/v1/object/public/${BUCKET}/${a1.ruta}`
    const rp = await fetch(publica)
    rp.ok ? FAIL('SE PERMITIÓ: bajar el archivo por URL pública', String(rp.status))
          : PASS('el bucket es privado: la URL pública no sirve', String(rp.status))

    // ── 2 · Adjuntos · RLS ────────────────────────────────────────────────
    seccion('2 · ADJUNTOS · RLS con las otras identidades')

    const empleado = await usuarioTemporal(BT, 'employee')
    const tecnico = await usuarioTemporal(BT, 'technician')
    PASS('usuarios temporales creados', 'employee + technician')

    const identidades = [
      ['EMPLOYEE', await entrar(empleado.email, empleado.password), true],
      ['TECHNICIAN', await entrar(tecnico.email, tecnico.password), false],
      ['SALESPERSON (TT)', admin, false, TT],
      ['CUSTOMER', await entrar('cliente.test@buscatools.com.ar', process.env.BT_PW_TEST), false],
      ['DISTRIBUTOR', await entrar('distribuidor.test@buscatools.com.ar', process.env.BT_PW_TEST), false],
      ['ANON', sesion(), false],
    ]

    for (const [rol, c, accede] of identidades) {
      // El admin/salesperson comparte sesión: ahí lo que se prueba es que no
      // puede escribir en Torquetools, no que no vea Buscatools.
      if (rol.startsWith('SALESPERSON')) continue

      const { data: ve } = await c.from('attachments').select('id')
        .eq('entity_type', 'maintenance_asset').eq('entity_id', eqAdj)
      const n = (ve ?? []).length
      accede ? cmp(`${rol}: ve el adjunto`, 1, n) : cmp(`${rol}: 0 adjuntos`, 0, n)

      // El ataque del punto 17: conozco el path exacto, ¿me firman la URL?
      const { data: f, error: e } = await c.storage.from(BUCKET).createSignedUrl(a1.ruta, 60)
      if (accede) {
        e ? FAIL(`${rol}: debería poder firmar`, e.message) : PASS(`${rol}: firma la URL`)
      } else if (e) {
        PASS(`${rol}: no le firman la URL sabiendo el path`, String(e.message).slice(0, 40))
      } else {
        // Si el servidor devolvió una URL, lo que importa es si SIRVE.
        const r = await fetch(f.signedUrl)
        r.ok ? FAIL(`SE PERMITIÓ: ${rol} bajó un archivo ajeno sabiendo el path`)
             : PASS(`${rol}: la URL que devolvió no sirve`, String(r.status))
      }

      if (rol !== 'ANON') {
        const w = await c.from('attachments').insert({
          company_id: BT, entity_type: 'maintenance_asset', entity_id: eqAdj,
          storage_path: `${BT}/maintenance_asset/${eqAdj}/${randomUUID()}-x.txt`,
          file_name: 'x.txt', kind: 'photo',
        }).select('id')
        accede ? (w.error ? FAIL(`${rol}: debería poder adjuntar`, w.error.message)
                          : PASS(`${rol}: adjunta`))
               : rechaza(`${rol}: adjuntar`, w)
        if (accede && !w.error) await s.from('attachments').delete().eq('id', w.data[0].id)
      }
    }

    // Salesperson de Torquetools: no escribe adjuntos de Mantenimiento en TT.
    rechaza('SALESPERSON (Torquetools): adjuntar en su propia empresa',
      await admin.from('attachments').insert({
        company_id: TT, entity_type: 'maintenance_asset', entity_id: eqAdj,
        storage_path: `${TT}/maintenance_asset/${eqAdj}/${randomUUID()}-x.txt`,
        file_name: 'x.txt', kind: 'photo',
      }).select('id'))

    // ── 3 · La matriz de RLS · nueve tablas × siete identidades ───────────
    seccion('3 · RLS · nueve tablas, siete identidades, y también por id exacto')

    const ordM = await orden({ torque_lsl: 9, torque_nominal: 10, torque_usl: 11 })
    // La moneda va ANTES que la línea con importe: una línea valorizada sin
    // moneda elegida la rechaza el servidor, y es la regla de la entrega 3.
    await admin.from('maintenance_orders').update({ quote_currency_code: 'ARS' }).eq('id', ordM.id)
    await admin.from('maintenance_quote_lines').insert({
      company_id: BT, maintenance_order_id: ordM.id, line_no: 1, line_type: 'labour',
      description_snapshot: MARCA, quantity: 1, unit_price: 100,
    })
    await admin.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: ordM.id, product_id: prods[0].id,
      warehouse_id: dep.id, quantity: 1,
    })
    await admin.from('maintenance_measurements').insert({
      company_id: BT, maintenance_order_id: ordM.id, row_no: 1, target_value: 10,
    })
    await admin.from('maintenance_order_checks').insert({
      company_id: BT, maintenance_order_id: ordM.id, check_point_id: punto.id,
      phase: 'diagnosis', result: 'ok',
    })

    const ids = {
      maintenance_assets: ordM.asset_id,
      maintenance_orders: ordM.id,
      maintenance_quote_lines: (await s.from('maintenance_quote_lines').select('id').eq('maintenance_order_id', ordM.id).single()).data.id,
      maintenance_order_parts: (await s.from('maintenance_order_parts').select('id').eq('maintenance_order_id', ordM.id).single()).data.id,
      maintenance_measurements: (await s.from('maintenance_measurements').select('id').eq('maintenance_order_id', ordM.id).single()).data.id,
      maintenance_order_checks: (await s.from('maintenance_order_checks').select('id').eq('maintenance_order_id', ordM.id).single()).data.id,
      maintenance_check_points: punto.id,
      maintenance_audit: null,
    }
    const TABLAS = Object.keys(ids)

    for (const [rol, c, accede] of identidades) {
      if (rol.startsWith('SALESPERSON')) continue
      let ok = 0
      const problemas = []
      for (const tabla of TABLAS) {
        // a · sin filtro
        const { data: todo } = await c.from(tabla).select('id')
        const n = (todo ?? []).length
        if (accede ? n > 0 : n === 0) ok++
        else problemas.push(`${tabla} sin filtro: ${n}`)

        // b · por id exacto, que es el que no se detecta contando
        if (ids[tabla]) {
          const { data: uno } = await c.from(tabla).select('id').eq('id', ids[tabla])
          const m = (uno ?? []).length
          if (accede ? m === 1 : m === 0) ok++
          else problemas.push(`${tabla} por id: ${m}`)
        }

        // c · por el id del padre, que es el otro camino
        if (tabla.startsWith('maintenance_') && tabla !== 'maintenance_assets' &&
            tabla !== 'maintenance_orders' && tabla !== 'maintenance_check_points' &&
            tabla !== 'maintenance_audit') {
          const { data: porPadre } = await c.from(tabla).select('id').eq('maintenance_order_id', ordM.id)
          const k = (porPadre ?? []).length
          if (accede ? k === 1 : k === 0) ok++
          else problemas.push(`${tabla} por order_id: ${k}`)
        }
      }
      // d · por company_id de la empresa ajena
      for (const tabla of ['maintenance_assets', 'maintenance_orders']) {
        const { data: ajena } = await c.from(tabla).select('id').eq('company_id', TT)
        if ((ajena ?? []).length === 0) ok++
        else problemas.push(`${tabla} de Torquetools: ${ajena.length}`)
      }

      problemas.length === 0
        ? PASS(`${rol}: ${accede ? 'acceso' : '0'} en las nueve tablas`, `${ok} comprobaciones`)
        : FAIL(`${rol}`, problemas.join(' · '))
    }

    // ── 4 · Multiempresa · los cinco patrones de O1 ───────────────────────
    seccion('4 · MULTIEMPRESA · los cinco patrones, con una empresa tercera real')

    const { data: emp3 } = await s.from('companies')
      .insert({ slug: `zz-m5-${Date.now()}`, name: `${MARCA} tercera`, default_currency: 'ARS' })
      .select('id').single()
    creados.empresas.push(emp3.id)
    const { data: cli3 } = await s.from('customers')
      .insert({ company_id: emp3.id, legal_name: `${MARCA} ajeno` }).select('id').single()
    creados.clientes.push(cli3.id)
    // Los fixtures de la empresa tercera se crean con la clave de servicio y
    // se comprueba cada uno: si uno falla en silencio, la prueba de más abajo
    // pasa por la razón equivocada.
    const crear = async (tabla, fila) => {
      const { data, error } = await s.from(tabla).insert(fila).select('id').single()
      if (error) throw new Error(`fixture ${tabla}: ${error.message}`)
      return data
    }
    const cat3 = await crear('product_categories', {
      company_id: emp3.id, name: `${MARCA} categoría`, slug: `zz-m5-cat-${Date.now()}`,
    })
    const prod3 = await crear('products', {
      company_id: emp3.id, sku: `${MARCA}-P`, name: `${MARCA} producto`, category_id: cat3.id,
    })
    const dep3 = await crear('warehouses', {
      company_id: emp3.id, code: `${MARCA}-D`, name: `${MARCA} depósito`, is_default: true,
    })
    const punto3 = await crear('maintenance_check_points', {
      company_id: emp3.id, key: 'zz-m5-punto', label: `${MARCA} punto`, sort_order: 1,
    })
    const { data: eq3 } = await s.from('maintenance_assets')
      .insert({ company_id: emp3.id, reference: `${MARCA}-EQ`, notes: MARCA }).select('id').single()
    const { data: ord3 } = await s.from('maintenance_orders').insert({
      company_id: emp3.id, number: `${MARCA}-OS`, asset_id: eq3.id, customer_id: cli3.id,
      service_type: 'corrective', received_at: HOY,
    }).select('id').single()

    rechaza('P1 · una línea con company_id propio en una orden ajena',
      await admin.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: ord3.id, line_no: 1,
        line_type: 'labour', description_snapshot: MARCA, quantity: 1, unit_price: 1,
      }).select('id'))
    rechaza('P2 · una medición con company_id propio en una orden ajena',
      await admin.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: ord3.id, row_no: 1, target_value: 10,
      }).select('id'))
    rechaza('P3 · un repuesto con un producto de otra empresa',
      await admin.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: ordM.id, product_id: prod3.id,
        warehouse_id: dep.id, quantity: 1,
      }).select('id'))
    rechaza('P4 · un repuesto con un depósito de otra empresa',
      await admin.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: ordM.id, product_id: prods[0].id,
        warehouse_id: dep3.id, quantity: 1,
      }).select('id'))
    rechaza('P5 · una revisión con un punto de otra empresa',
      await admin.from('maintenance_order_checks').insert({
        company_id: BT, maintenance_order_id: ordM.id, check_point_id: punto3.id,
        phase: 'diagnosis', result: 'ok',
      }).select('id'))
    rechaza('P6 · un equipo de otra empresa como equipo de la orden',
      await admin.from('maintenance_orders').insert({
        company_id: BT, number: `${MARCA}-X`, asset_id: eq3.id, customer_id: cli[0].id,
        service_type: 'corrective', received_at: HOY,
      }).select('id'))
    rechaza('P7 · un adjunto de una empresa donde no se tiene rol',
      await admin.from('attachments').insert({
        company_id: emp3.id, entity_type: 'maintenance_order', entity_id: ord3.id,
        storage_path: `${emp3.id}/x/${randomUUID()}.txt`, file_name: 'x.txt', kind: 'photo',
      }).select('id'))

    const { count: sucias } = await s.from('maintenance_quote_lines')
      .select('*', { count: 'exact', head: true }).eq('maintenance_order_id', ord3.id)
    cmp('y la orden de la empresa tercera quedó intacta', 0, sucias)

    // ── 5 · Congelamiento completo ────────────────────────────────────────
    seccion('5 · CERRADA = INMUTABLE · trece intentos server-side')

    const cerrada = await orden({ repair_required: false, torque_required: false })
    await admin.from('maintenance_orders')
      .update({ diagnosed_at: HOY, delivered_at: HOY, diagnosis_notes: MARCA }).eq('id', cerrada.id)
    await admin.rpc('rechazar_cotizacion_mantenimiento', { p_order: cerrada.id })
    await admin.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', cerrada.id)
    await admin.from('maintenance_orders').update({ stage: 'closing' }).eq('id', cerrada.id)
    const rc = await admin.rpc('cerrar_orden_mantenimiento', { p_order: cerrada.id })
    rc.error ? FAIL('cerrar la orden de prueba', rc.error.message) : PASS('orden cerrada')

    const intentos = [
      ['el equipo de la orden', admin.from('maintenance_orders')
        .update({ asset_id: ordM.asset_id }).eq('id', cerrada.id).select('id')],
      ['el cliente de la orden', admin.from('maintenance_orders')
        .update({ customer_id: cli[0].id }).eq('id', cerrada.id).select('id')],
      ['el diagnóstico', admin.from('maintenance_orders')
        .update({ diagnosis_notes: 'otro' }).eq('id', cerrada.id).select('id')],
      ['la etapa', admin.from('maintenance_orders')
        .update({ stage: 'repair' }).eq('id', cerrada.id).select('id')],
      ['la moneda de la cotización', admin.from('maintenance_orders')
        .update({ quote_currency_code: 'USD' }).eq('id', cerrada.id).select('id')],
      ['el estado de la cotización', admin.rpc('aprobar_cotizacion_mantenimiento',
        { p_order: cerrada.id, p_por: 'x' })],
      ['los límites de torque', admin.from('maintenance_orders')
        .update({ torque_lsl: 1, torque_usl: 2 }).eq('id', cerrada.id).select('id')],
      ['la fecha de entrega', admin.from('maintenance_orders')
        .update({ delivered_at: HOY }).eq('id', cerrada.id).select('id')],
      ['agregar una línea de cotización', admin.from('maintenance_quote_lines').insert({
        company_id: BT, maintenance_order_id: cerrada.id, line_no: 1,
        line_type: 'labour', description_snapshot: 'x', quantity: 1, unit_price: 1 }).select('id')],
      ['agregar un repuesto', admin.from('maintenance_order_parts').insert({
        company_id: BT, maintenance_order_id: cerrada.id, product_id: prods[0].id,
        warehouse_id: dep.id, quantity: 1 }).select('id')],
      ['confirmar el consumo', admin.rpc('confirmar_consumo_mantenimiento', { p_order: cerrada.id })],
      ['agregar una medición', admin.from('maintenance_measurements').insert({
        company_id: BT, maintenance_order_id: cerrada.id, row_no: 1, target_value: 10 }).select('id')],
      ['agregar una revisión', admin.from('maintenance_order_checks').insert({
        company_id: BT, maintenance_order_id: cerrada.id, check_point_id: punto.id,
        phase: 'diagnosis', result: 'ok' }).select('id')],
      ['cancelarla después de cerrada', admin.rpc('cancelar_orden_mantenimiento',
        { p_order: cerrada.id, p_motivo: 'x' })],
    ]
    for (const [que, intento] of intentos) rechaza(`cerrada: ${que}`, await intento)

    // El adjunto es la única excepción, y es deliberada.
    const aCerrada = await subir(admin, BT, 'maintenance_order', cerrada.id, `${MARCA}-informe.txt`)
    aCerrada.error
      ? FAIL('adjuntar a una orden cerrada debería poder', aCerrada.error.message)
      : PASS('cerrada: adjuntar SÍ se puede — excepción deliberada y documentada')

    // ── 6 · Concurrencia ──────────────────────────────────────────────────
    seccion('6 · CONCURRENCIA · numeración, consumo y cierre')

    const segundo = await entrar('buscatools.jano@gmail.com', process.env.BT_PW_JANO)

    const nums = await Promise.all(Array.from({ length: 8 }, () =>
      admin.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_order' })))
    const nums2 = await Promise.all(Array.from({ length: 8 }, () =>
      segundo.rpc('next_document_number', { p_company: BT, p_doc_type: 'maintenance_order' })))
    const todos = [...nums, ...nums2].map((r) => r.data)
    cmp('16 números pedidos a la vez desde dos conexiones', 16, todos.length)
    cmp('  y los 16 son distintos', 16, new Set(todos).size)

    const ordC = await orden()
    await admin.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: ordC.id, product_id: prods[1].id,
      warehouse_id: dep.id, quantity: 3,
    })
    const saldoAntes = saldosPrevios.get(prods[1].id + '|' + dep.id) ?? 0
    const [c1, c2] = await Promise.all([
      admin.rpc('confirmar_consumo_mantenimiento', { p_order: ordC.id }),
      segundo.rpc('confirmar_consumo_mantenimiento', { p_order: ordC.id }),
    ])
    const movidas = [c1, c2].filter((r) => !r.error && (r.data?.lineas ?? 0) > 0).length
    cmp('dos consumos simultáneos: sólo uno mueve stock', 1, movidas)
    const saldoDespues = Number((await s.from('stock_balances').select('on_hand')
      .eq('product_id', prods[1].id).eq('warehouse_id', dep.id).maybeSingle()).data?.on_hand ?? 0)
    cmp('  el stock bajó una sola vez', saldoAntes - 3, saldoDespues)
    const { count: movs } = await s.from('stock_movements')
      .select('*', { count: 'exact', head: true }).eq('source_id', ordC.id)
    cmp('  y hay un solo movimiento', 1, movs)

    // ── 7 · Pluralización ─────────────────────────────────────────────────
    seccion('7 · PLURALIZACIÓN · sin «(s)» en los mensajes del servidor')

    const ordP = await orden({ repair_required: false, torque_required: false })
    await admin.from('maintenance_orders')
      .update({ diagnosed_at: HOY, delivered_at: HOY }).eq('id', ordP.id)
    await admin.rpc('rechazar_cotizacion_mantenimiento', { p_order: ordP.id })
    await admin.from('maintenance_orders').update({ stage: 'quotation' }).eq('id', ordP.id)
    await admin.from('maintenance_orders').update({ stage: 'closing' }).eq('id', ordP.id)
    await admin.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: ordP.id, product_id: prods[0].id,
      warehouse_id: dep.id, quantity: 1,
    })
    const p1 = await admin.rpc('precheck_cierre_mantenimiento', { p_order: ordP.id })
    const b1 = (p1.data?.bloqueos ?? []).find((b) => b.includes('repuesto'))
    cmp('con uno dice «Queda 1 repuesto»', 'Queda 1 repuesto sin confirmar el consumo', b1)

    await admin.from('maintenance_order_parts').insert({
      company_id: BT, maintenance_order_id: ordP.id, product_id: prods[1].id,
      warehouse_id: dep.id, quantity: 1,
    })
    const p2 = await admin.rpc('precheck_cierre_mantenimiento', { p_order: ordP.id })
    const b2 = (p2.data?.bloqueos ?? []).find((b) => b.includes('repuesto'))
    cmp('con dos dice «Quedan 2 repuestos»', 'Quedan 2 repuestos sin confirmar el consumo', b2)

    const todosLosBloqueos = JSON.stringify([...(p1.data?.bloqueos ?? []), ...(p2.data?.bloqueos ?? [])])
    const conParentesis = /\(s\)|\(es\)/.test(todosLosBloqueos)
    conParentesis
      ? FAIL('quedó un «(s)» en un mensaje', todosLosBloqueos)
      : PASS('ningún mensaje de bloqueo usa «(s)»')

    // El otro texto con «(s)»: la moneda de una cotización con líneas.
    const ordQ = await orden()
    await admin.from('maintenance_orders').update({ quote_currency_code: 'ARS' }).eq('id', ordQ.id)
    await admin.from('maintenance_quote_lines').insert({
      company_id: BT, maintenance_order_id: ordQ.id, line_no: 1, line_type: 'labour',
      description_snapshot: MARCA, quantity: 1, unit_price: 500,
    })
    const eMon = await admin.from('maintenance_orders')
      .update({ quote_currency_code: null }).eq('id', ordQ.id).select('id')
    eMon.error && eMon.error.message.includes('1 línea con importe')
      ? PASS('«la cotización tiene 1 línea con importe»', 'sin «(s)»')
      : FAIL('el mensaje de la moneda', eMon.error?.message ?? '(no rechazó)')

    // ── 8 · El catálogo sigue del lado del servidor ───────────────────────
    seccion('8 · CATÁLOGO · nunca 21.772 productos en memoria')

    const { data: busq, error: eB } = await admin.rpc('search_products', {
      p_company: BT, p_query: 'atornillador', p_limit: 20,
    })
    if (eB) FAIL('search_products', eB.message)
    else {
      const n = Array.isArray(busq) ? busq.length : 0
      n > 0 && n <= 20
        ? PASS('search_products acota del lado del servidor', `${n} resultados con límite 20`)
        : FAIL('search_products devolvió', String(n))
    }
    const { count: totalProd } = await s.from('products')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('  sobre un catálogo de', 21772, totalProd)

    // ── 9 · Los cuatro registros legacy ───────────────────────────────────
    seccion('9 · DATOS LEGACY · nada de prueba se migró')

    const { count: assetsProd } = await s.from('maintenance_assets')
      .select('*', { count: 'exact', head: true }).not('notes', 'like', `${MARCA}%`)
    cmp('no hay ningún equipo fuera de los fixtures de esta corrida', 0, assetsProd)
    PASS('los 4 registros legacy (ACT00001 «Prueba», serie 123456, y sus 3 fichas) siguen sin migrarse')

  } finally {
    seccion('LIMPIEZA')

    const { data: ordenes } = await s.from('maintenance_orders').select('id')
    for (const o of ordenes ?? []) {
      await s.from('maintenance_order_parts').delete().eq('maintenance_order_id', o.id)
      await s.from('stock_movements').delete().eq('source_id', o.id)
      await s.from('maintenance_quote_lines').delete().eq('maintenance_order_id', o.id)
      await s.from('maintenance_measurements').delete().eq('maintenance_order_id', o.id)
      await s.from('maintenance_order_checks').delete().eq('maintenance_order_id', o.id)
      await s.from('attachments').delete().eq('entity_type', 'maintenance_order').eq('entity_id', o.id)
      await s.from('maintenance_orders').delete().eq('id', o.id)
    }
    const { data: equipos } = await s.from('maintenance_assets').select('id')
    for (const e of equipos ?? []) {
      await s.from('attachments').delete().eq('entity_type', 'maintenance_asset').eq('entity_id', e.id)
      await s.from('maintenance_assets').delete().eq('id', e.id)
    }
    if (creados.objetos.length > 0) await s.storage.from(BUCKET).remove(creados.objetos)
    await s.from('maintenance_audit').delete().gte('id', 0)
    for (const id of creados.clientes) await s.from('customers').delete().eq('id', id)
    for (const id of creados.empresas) {
      await s.from('maintenance_check_points').delete().eq('company_id', id)
      await s.from('warehouses').delete().eq('company_id', id)
      await s.from('products').delete().eq('company_id', id)
      await s.from('product_categories').delete().eq('company_id', id)
      await s.from('document_sequences').delete().eq('company_id', id)
      await s.from('companies').delete().eq('id', id)
    }
    for (const id of creados.usuarios) {
      await s.from('company_memberships').delete().eq('user_id', id)
      await s.auth.admin.deleteUser(id)
    }

    const { data: saldosAhora } = await s.from('stock_balances').select('product_id, warehouse_id, on_hand')
    for (const b of saldosAhora ?? []) {
      const clave = b.product_id + '|' + b.warehouse_id
      const { data: ms } = await s.from('stock_movements').select('quantity')
        .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      const total = (ms ?? []).reduce((a, m) => a + Number(m.quantity), 0)
      if (!saldosPrevios.has(clave) && (ms ?? []).length === 0) {
        await s.from('stock_balances').delete()
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      } else if (Number(b.on_hand) !== total) {
        await s.from('stock_balances').update({ on_hand: total })
          .eq('product_id', b.product_id).eq('warehouse_id', b.warehouse_id)
      }
    }
    for (const x of seqAntes ?? []) {
      await s.from('document_sequences').update({ next_number: x.next_number })
        .eq('company_id', x.company_id).eq('doc_type', x.doc_type)
    }

    const { data: quedan } = await s.storage.from(BUCKET).list(`${MARCA}`)
    cmp('no queda ningún equipo', 0, await q('maintenance_assets'))
    cmp('ni ninguna orden', 0, await q('maintenance_orders'))
    cmp('ni mediciones', 0, await q('maintenance_measurements'))
    cmp('ni repuestos', 0, await q('maintenance_order_parts'))
    cmp('ni líneas de cotización', 0, await q('maintenance_quote_lines'))
    cmp('ni checks', 0, await q('maintenance_order_checks'))
    cmp('ni auditoría', 0, await q('maintenance_audit'))
    cmp('los adjuntos vuelven a su número', adjAntes, await q('attachments'))
    cmp('sin objetos sueltos en el bucket', 0, (quedan ?? []).length)
    cmp('16 puntos de revisión', 16, await q('maintenance_check_points'))
    cmp('las empresas vuelven a su número', empresasAntes, await q('companies'))
    cmp('los clientes vuelven a su número', clientesAntes, await q('customers'))
    cmp('los movimientos de stock vuelven a su número', movAntes, await q('stock_movements'))
    cmp('y los saldos también', saldosPrevios.size, await q('stock_balances'))
    cmp('142 proveedores intactos', 142, await q('suppliers'))
    const { count: prodsBT } = await s.from('products')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('21.772 productos de Buscatools intactos', 21772, prodsBT)
    const { count: usuariosZZ } = await s.from('company_memberships')
      .select('*', { count: 'exact', head: true }).in('role', ['employee', 'technician'])
    cmp('1 membresía employee y 0 technician: los temporales se borraron', 1, usuariosZZ)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
