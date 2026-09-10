/**
 * Fase 5 · Clientes — entrega 1, contra los datos reales.
 *
 * Prueba las MISMAS consultas que hacen los services de React, con una sesión
 * real: listado paginado del lado del servidor, búsqueda, orden, ficha,
 * contactos, historial y relacionados. Y lo que un rol externo NO puede leer,
 * con un intento real: contar filas mide el estado, intentar la operación
 * mide el cumplimiento.
 *
 * No escribe nada. La entrega 1 es de sólo lectura y la suite también.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/fase5-clientes-tests.mjs
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

/** Lo mismo que arma `condicionDeBusqueda` en el service. */
function condicionDeBusqueda(texto) {
  const limpio = texto.trim().replace(/[,()*]/g, '')
  if (limpio === '') return null
  const patron = `%${limpio}%`
  const digitos = limpio.replace(/\D/g, '')
  const cond = [
    `legal_name.ilike.${patron}`,
    `trade_name.ilike.${patron}`,
    `legacy_ref.ilike.${patron}`,
    `tax_id.ilike.${patron}`,
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

const COLUMNAS = `
  id, legacy_ref, legal_name, trade_name, tax_id, emails, email_domains,
  industry, phone, imported_at, needs_review, review_reason, deleted_at
`

async function listar(c, BT, filtros = {}) {
  const f = {
    q: '', rubro: null, soloRevision: false, incluirBajas: false,
    pagina: 1, porPagina: 25, orden: 'nombre', direccion: 'asc', ...filtros,
  }
  let q = c.from('customers').select(COLUMNAS, { count: 'exact' }).eq('company_id', BT)
  const busqueda = condicionDeBusqueda(f.q)
  if (busqueda) q = q.or(busqueda)
  if (f.rubro) q = q.eq('industry', f.rubro)
  if (f.soloRevision) q = q.eq('needs_review', true)
  if (!f.incluirBajas) q = q.is('deleted_at', null)
  const columna = { nombre: 'legal_name', referencia: 'legacy_ref', cuit: 'tax_id', rubro: 'industry' }[f.orden]
  const asc = f.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  if (columna !== 'legal_name') q = q.order('legal_name', { ascending: true })
  q = q.order('id', { ascending: true })
  const desde = (f.pagina - 1) * f.porPagina
  const { data, error, count } = await q.range(desde, desde + f.porPagina - 1)
  if (error) throw new Error(error.message)
  return { filas: data ?? [], total: count ?? 0 }
}

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: mem } = await c.from('company_memberships').select('company_id, companies ( slug )')
  const BT = mem.find((m) => m.companies.slug === 'buscatools').company_id
  const s = admin()

  console.log('='.repeat(74))
  console.log('  CLIENTES · entrega 1 (sólo lectura), con sesión real')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  // ── Listado ──────────────────────────────────────────────────────────────
  seccion('1 · LISTADO SERVER-SIDE')

  const { count: enBase } = await s.from('customers')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT).is('deleted_at', null)
  const p1 = await listar(c, BT)
  cmp('el total lo cuenta el servidor', enBase, p1.total)
  cmp('la página trae 25 filas, no las 1.010', 25, p1.filas.length)

  const p2 = await listar(c, BT, { pagina: 2 })
  const repetidos = p2.filas.filter((f) => p1.filas.some((g) => g.id === f.id)).length
  cmp('la página 2 no repite filas de la 1', 0, repetidos)

  const ordenados = p1.filas.every((f, i) =>
    i === 0 || p1.filas[i - 1].legal_name.localeCompare(f.legal_name, 'es') <= 0)
  ordenados ? PASS('orden alfabético ascendente') : FAIL('el orden no es alfabético')

  const desc = await listar(c, BT, { direccion: 'desc' })
  desc.filas[0].legal_name !== p1.filas[0].legal_name
    ? PASS('invertir el orden cambia la primera fila', desc.filas[0].legal_name.slice(0, 30))
    : FAIL('invertir el orden no cambió nada')

  const porRef = await listar(c, BT, { orden: 'referencia', direccion: 'asc' })
  porRef.filas[0].legacy_ref
    ? PASS('ordenar por referencia no pone los nulos primero', porRef.filas[0].legacy_ref)
    : FAIL('ordenar por referencia trajo un nulo adelante')

  // Idempotencia del paginado: pedir dos veces la misma página da lo mismo.
  const p1bis = await listar(c, BT)
  const mismos = p1.filas.map((f) => f.id).join(',') === p1bis.filas.map((f) => f.id).join(',')
  mismos ? PASS('la misma página pedida dos veces da el mismo orden', `${p1.filas.length} filas`)
         : FAIL('el orden de la página cambió entre dos pedidos idénticos')

  // ── Búsqueda ─────────────────────────────────────────────────────────────
  seccion('2 · BÚSQUEDA')

  const { data: muestra } = await s.from('customers')
    .select('id, legal_name, legacy_ref, tax_id, emails, email_domains')
    .eq('company_id', BT).not('tax_id', 'is', null).not('emails', 'is', null)
    .limit(1).single()

  const porNombre = await listar(c, BT, { q: muestra.legal_name.slice(0, 12) })
  porNombre.filas.some((f) => f.id === muestra.id)
    ? PASS('busca por nombre', `${porNombre.total} resultado(s)`)
    : FAIL('el nombre buscado no aparece')
  porNombre.total < p1.total
    ? PASS('la búsqueda ACOTA el total', `${porNombre.total} de ${p1.total}`)
    : FAIL('la búsqueda no acotó nada')

  const porCuit = await listar(c, BT, { q: muestra.tax_id })
  porCuit.filas.some((f) => f.id === muestra.id)
    ? PASS('busca por CUIT con guiones', muestra.tax_id)
    : FAIL('no encontró por CUIT')

  const soloDigitos = muestra.tax_id.replace(/\D/g, '')
  const porDigitos = await listar(c, BT, { q: soloDigitos })
  porDigitos.filas.some((f) => f.id === muestra.id)
    ? PASS('busca por CUIT sin guiones', soloDigitos)
    : FAIL('no encontró por los dígitos del CUIT')

  const porRefTexto = await listar(c, BT, { q: muestra.legacy_ref })
  porRefTexto.filas.some((f) => f.id === muestra.id)
    ? PASS('busca por referencia CLI', muestra.legacy_ref)
    : FAIL('no encontró por referencia')

  const email = muestra.emails[0]
  const porEmail = await listar(c, BT, { q: email })
  porEmail.filas.some((f) => f.id === muestra.id)
    ? PASS('busca por email exacto', `${porEmail.total} resultado(s)`)
    : FAIL('no encontró por email')

  const dominio = muestra.email_domains[0]
  if (dominio) {
    const porDominio = await listar(c, BT, { q: dominio })
    porDominio.filas.some((f) => f.id === muestra.id)
      ? PASS('busca por dominio', `${porDominio.total} resultado(s)`)
      : FAIL('no encontró por dominio')
  }

  const inventado = await listar(c, BT, { q: 'zzz-no-existe-zzz' })
  cmp('un texto que no existe da cero, no un error', 0, inventado.total)

  const conComa = await listar(c, BT, { q: 'S.A., y Cia' })
  conComa.total >= 0 ? PASS('una coma en la búsqueda no rompe el `or` de PostgREST')
                     : FAIL('la coma rompió la consulta')

  // ── Cola de revisión ─────────────────────────────────────────────────────
  seccion('3 · COLA DE REVISIÓN Y BAJAS')

  const { count: marcados } = await s.from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', BT).eq('needs_review', true).is('deleted_at', null)
  const revision = await listar(c, BT, { soloRevision: true })
  cmp('el filtro de revisión trae los marcados', marcados, revision.total)
  revision.filas.every((f) => f.needs_review)
    ? PASS('ninguna fila del filtro viene sin marcar')
    : FAIL('el filtro dejó pasar un cliente sin marcar')

  const { count: bajas } = await s.from('customers')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT).not('deleted_at', 'is', null)
  const conBajas = await listar(c, BT, { incluirBajas: true })
  cmp('pedir las bajas suma exactamente las que hay',
    Number(enBase) + Number(bajas), conBajas.total)
  // Hoy `bajas` es 0 —la baja lógica llega con la edición, en la entrega 3—
  // así que la comparación de arriba todavía no separa los dos casos. Se deja
  // dicho para que no se lea como una garantía que no da.
  console.log(`      (dadas de baja hoy: ${bajas})`)

  // ── Ficha ────────────────────────────────────────────────────────────────
  seccion('4 · FICHA')

  // Un cliente del histórico con documentos: el caso que importa.
  const { data: conDocs } = await s.from('sales_quotes')
    .select('customer_id').eq('company_id', BT).not('customer_id', 'is', null).limit(1).single()
  const clienteId = conDocs.customer_id

  const { data: ficha, error: eF } = await c.from('customers')
    .select(`id, legacy_ref, legal_name, trade_name, legacy_name, tax_id, emails,
             email_domains, industry, phone, customer_type, status, payment_terms,
             default_currency, discount_pct, credit_limit, notes, imported_at,
             legacy_source, needs_review, review_reason, deleted_at, created_at,
             vendedor:profiles!salesperson_id ( full_name )`)
    .eq('company_id', BT).eq('id', clienteId).maybeSingle()
  eF ? FAIL('la ficha no se pudo leer', eF.message) : PASS('la ficha se lee', ficha.legal_name)

  const { data: contactos, error: eC } = await c.from('customer_contacts')
    .select('id, full_name, role, email, phone, fax, is_default, notes')
    .eq('company_id', BT).eq('customer_id', clienteId)
  eC ? FAIL('contactos', eC.message) : PASS('contactos por FK real', `${contactos.length}`)

  const historial = []
  for (const [tabla, campoFecha, campoEstado] of [
    ['sales_quotes', 'quote_date', 'status'],
    ['sales_orders', 'order_date', 'commercial_status'],
    ['deliveries', 'delivery_date', 'status'],
  ]) {
    const { data, error } = await c.from(tabla)
      .select(`id, number, original_number, ${campoFecha}, ${campoEstado}, currency_code, total`)
      .eq('company_id', BT).eq('customer_id', clienteId)
      .order(campoFecha, { ascending: false }).limit(200)
    if (error) { FAIL(`historial ${tabla}`, error.message); continue }
    for (const d of data) historial.push({ moneda: d.currency_code, total: Number(d.total ?? 0) })
  }
  historial.length > 0
    ? PASS('el historial trae documentos', `${historial.length}`)
    : FAIL('el cliente elegido no tiene documentos')

  // El punto del panel: los totales NO se suman entre monedas.
  const porMoneda = new Map()
  for (const d of historial) {
    const k = d.moneda ?? 'SIN MONEDA'
    porMoneda.set(k, (porMoneda.get(k) ?? 0) + d.total)
  }
  PASS('totales por moneda, sin mezclar',
    [...porMoneda.entries()].map(([m, t]) => `${m} ${t.toFixed(2)}`).join(' · '))

  const { error: eR1 } = await c.from('customer_addresses')
    .select('id, kind, is_default, street, city, state, postal_code, country_code')
    .eq('company_id', BT).eq('customer_id', clienteId)
  const { error: eR2 } = await c.from('customer_product_aliases')
    .select('id, customer_code, customer_description, times_used, product:products!product_id ( sku, name )')
    .eq('company_id', BT).eq('customer_id', clienteId)
  const { error: eR3 } = await c.from('customer_po_candidates')
    .select('id, candidate, source_type, doc_count, status, created_at')
    .eq('company_id', BT).eq('customer_id', clienteId)
  const errores = [eR1, eR2, eR3].filter(Boolean)
  errores.length === 0
    ? PASS('relacionados: direcciones, alias y candidatos de OC se leen')
    : FAIL('relacionados', errores.map((e) => e.message).join(' | '))

  const { data: inexistente, error: eN } = await c.from('customers')
    .select('id').eq('company_id', BT).eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle()
  !eN && inexistente === null
    ? PASS('un id que no existe devuelve null, no un error')
    : FAIL('el id inexistente no se comportó como se espera')

  // ── RLS ──────────────────────────────────────────────────────────────────
  seccion('5 · RLS · un externo no ve el maestro')

  const externo = sesion()
  const { error: eLe } = await externo.auth.signInWithPassword({
    email: 'cliente.test@buscatools.com.ar',
    password: process.env.BT_PW_TEST,
  })
  if (eLe) {
    FAIL('no se pudo iniciar sesión como cliente externo', eLe.message)
  } else {
    const { data: suyos, error } = await externo.from('customers').select('id, legal_name')
    if (error) {
      PASS('el listado del maestro le está vedado', error.code ?? error.message.slice(0, 30))
    } else {
      cmp('un cliente externo ve UNA sola ficha: la suya', 1, suyos.length)
      const { data: ajeno } = await externo.from('customers').select('id').eq('id', clienteId)
      cmp('no puede leer la ficha de otro cliente por id', 0, (ajeno ?? []).length)
      const { data: contactosAjenos } = await externo.from('customer_contacts')
        .select('id').eq('customer_id', clienteId)
      cmp('no puede leer los contactos de otro cliente', 0, (contactosAjenos ?? []).length)
    }
    // Entrega 1 es de sólo lectura, pero lo que impide escribir es RLS y no la
    // ausencia de botones: se prueba con un intento real.
    const { error: eIns } = await externo.from('customers')
      .insert({ company_id: BT, legal_name: 'ZZ intento externo' })
    eIns ? PASS('un externo no puede crear un cliente', eIns.code ?? eIns.message.slice(0, 30))
         : FAIL('UN EXTERNO PUDO CREAR UN CLIENTE')
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
