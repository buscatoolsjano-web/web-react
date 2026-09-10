/**
 * Fase 5 · Clientes — migración de los 87 contactos legacy.
 *
 * En el legacy un contacto se relaciona con su cliente por el TEXTO del nombre
 * (`contacto.cliente = "Grupo Mirgor S.A."`). Acá eso no se conserva: la
 * relación tiene que ser `customer_contacts.customer_id`, una FK real, y si no
 * se puede resolver con evidencia inequívoca el contacto NO se inserta. La
 * columna es NOT NULL justamente para que no exista la opción de dejarlo a
 * medias.
 *
 * Orden de evidencia, sin excepciones:
 *
 *   1. REF     el nombre del cliente coincide EXACTO con el `nj` del maestro
 *              legacy, y ese `nj` pertenece a una sola ficha → su `ref` →
 *              `customers.legacy_ref`. Es la relación propia del legacy.
 *   2. EMAIL   el mail del contacto figura en `customers.emails` de un solo
 *              cliente.
 *   3. NOMBRE  el nombre normalizado coincide con `legal_name` / `trade_name` /
 *              `legacy_name` de un solo cliente.
 *
 * Nada de fuzzy, nada de parecidos. Dos candidatos = NO_RESUELTO.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/fase5-migrar-contactos.mjs <BuscatoolsERP.html> <erp_store.json>
 *   node scripts/fase5-migrar-contactos.mjs <html> <json> --apply
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const HTML = process.argv[2]
const STORE = process.argv[3]
const APLICAR = process.argv.includes('--apply')
if (!HTML || !STORE) { console.error('Uso: <BuscatoolsERP.html> <erp_store.json> [--apply]'); process.exit(1) }

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const normNombre = (s) =>
  (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Mismo criterio que en la migración del maestro: «Madexa S.A» y
    // «MADEXA SA» tienen que normalizar igual. Ver el comentario de allá.
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
    .replace(/\b(s\s?a\s?u|s\s?a\s?c\s?i|s\s?a\s?i\s?c|srl|s\s?r\s?l|sa|sas|sac|ltda|ltd|inc|llc|cia|y\s?cia)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normEmail = (s) => {
  const t = (s ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

const limpiar = (s) => {
  const t = (s ?? '').trim()
  return t === '' ? null : t
}

function leerMaestro(ruta) {
  const html = fs.readFileSync(ruta, 'utf8')
  const m = html.match(/<script[^>]*id="clientes-data"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('No se encontró el bloque clientes-data en el HTML')
  return JSON.parse(m[1])
}

function leerContactos(ruta) {
  const store = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  return store.find((r) => r.key === 'erp_contactos')?.value ?? []
}

async function traerTodo(tabla, select, filtro = (q) => q) {
  const filas = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await filtro(sb.from(tabla).select(select)).order('id').range(d, d + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return filas
}

const main = async () => {
  const maestro = leerMaestro(HTML)
  const contactos = leerContactos(STORE)
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id

  const clientes = await traerTodo('customers',
    'id, legal_name, trade_name, legacy_name, legacy_ref, emails',
    (q) => q.eq('company_id', BT))
  const yaEstan = await traerTodo('customer_contacts',
    'id, customer_id, full_name, email', (q) => q.eq('company_id', BT))

  console.log('='.repeat(78))
  console.log(`  CONTACTOS  ·  ${APLICAR ? 'APLICAR' : 'DRY RUN (no escribe)'}`)
  console.log('='.repeat(78))
  console.log(`\n  legacy: ${contactos.length} contactos · maestro: ${maestro.length} clientes`)
  console.log(`  base:   ${clientes.length} clientes · ${yaEstan.length} contactos ya migrados`)

  // ── Índices ──────────────────────────────────────────────────────────────
  // Un mismo cliente entra al índice por `legal_name`, `trade_name` y
  // `legacy_name`, que muchas veces son el mismo texto. Si se lo contara tres
  // veces, `unico()` lo leería como tres candidatos y descartaría un match que
  // en realidad es inequívoco: lo que importa es cuántos clientes DISTINTOS
  // responden a la clave.
  const agregar = (mapa, clave, v) => {
    if (!clave) return
    if (!mapa.has(clave)) mapa.set(clave, [])
    const lista = mapa.get(clave)
    if (!lista.some((x) => x === v || (x?.id !== undefined && x.id === v?.id))) lista.push(v)
  }

  const porRef = new Map()
  const porEmail = new Map()
  const porNombre = new Map()
  for (const c of clientes) {
    agregar(porRef, c.legacy_ref, c)
    for (const e of c.emails ?? []) agregar(porEmail, normEmail(e), c)
    for (const n of [c.legal_name, c.trade_name, c.legacy_name]) agregar(porNombre, normNombre(n), c)
  }

  // El `nj` del maestro es el nombre con el que el legacy nombra al cliente en
  // la ficha del contacto. Se indexa tal cual y normalizado; si un nombre lleva
  // a dos fichas distintas, no decide.
  const refPorNj = new Map()
  const refPorNjNorm = new Map()
  for (const l of maestro) {
    agregar(refPorNj, (l.nj ?? '').trim(), l.ref)
    agregar(refPorNjNorm, normNombre(l.nj), l.ref)
  }

  const unico = (mapa, clave) => {
    const v = clave ? mapa.get(clave) : null
    return v && v.length === 1 ? v[0] : null
  }

  // ── Resolución ───────────────────────────────────────────────────────────
  const plan = []
  for (const k of contactos) {
    const email = normEmail(k.email)
    const nombreCliente = (k.cliente ?? '').trim()
    const item = { legacy: k, email, nombreCliente, cliente: null, via: null }

    const ref = unico(refPorNj, nombreCliente) ?? unico(refPorNjNorm, normNombre(nombreCliente))
    const porLaRef = ref ? unico(porRef, ref) : null
    if (porLaRef) { item.cliente = porLaRef; item.via = 'REF' }

    if (!item.cliente && email) {
      const c = unico(porEmail, email)
      if (c) { item.cliente = c; item.via = 'EMAIL' }
    }
    if (!item.cliente) {
      const c = unico(porNombre, normNombre(nombreCliente))
      if (c) { item.cliente = c; item.via = 'NOMBRE' }
    }
    plan.push(item)
  }

  // ── Clientes que existen SÓLO en la agenda de contactos ──────────────────
  //
  // No están en el maestro ni en el histórico de ventas: el único rastro es
  // que alguien cargó un contacto suyo. La regla es la misma de siempre: si
  // hay identidad suficiente —nombre propio y un dominio de correo que sea de
  // la empresa, no un gmail— se crea el cliente y se enganchan sus contactos.
  // Si no la hay, el contacto no se carga y queda informado.
  const GENERICOS = new Set([
    'gmail.com', 'hotmail.com', 'hotmail.com.ar', 'yahoo.com', 'yahoo.com.ar',
    'outlook.com', 'outlook.com.ar', 'live.com', 'live.com.ar', 'icloud.com',
    'speedy.com.ar', 'fibertel.com.ar', 'arnet.com.ar', 'ciudad.com.ar', 'me.com',
  ])
  const dominioDe = (email) => (email ?? '').split('@')[1] ?? null

  const huerfanos = new Map()
  for (const i of plan) {
    if (i.cliente) continue
    const k = normNombre(i.nombreCliente)
    if (!k) continue
    if (!huerfanos.has(k)) huerfanos.set(k, { nombre: i.nombreCliente, contactos: [], dominios: new Set() })
    const g = huerfanos.get(k)
    g.contactos.push(i)
    const d = dominioDe(i.email)
    if (d && !GENERICOS.has(d)) g.dominios.add(d)
  }

  const clientesACrear = []
  const sinIdentidad = []
  for (const [, g] of huerfanos) (g.dominios.size ? clientesACrear : sinIdentidad).push(g)

  console.log('\n  -- RESOLUCIÓN DEL CLIENTE --')
  console.log(`     resueltos                     ${plan.filter((i) => i.cliente).length}`)
  for (const via of ['REF', 'EMAIL', 'NOMBRE']) {
    const n = plan.filter((i) => i.via === via).length
    if (n) console.log(`       · por ${via.toLowerCase().padEnd(7)}            ${n}`)
  }
  console.log(`     sin cliente en la base        ${plan.filter((i) => !i.cliente).length}`)

  console.log('\n  -- CLIENTES QUE SÓLO ESTÁN EN CONTACTOS --')
  console.log(`     con identidad → se crean      ${clientesACrear.length}`)
  for (const g of clientesACrear) {
    console.log(`       + «${g.nombre}» · ${[...g.dominios].join(', ')} · ${g.contactos.length} contacto(s)`)
  }
  console.log(`     sin identidad → NEEDS_REVIEW  ${sinIdentidad.length}`)
  for (const g of sinIdentidad) {
    console.log(`       ? «${g.nombre}» · ${g.contactos.map((i) => i.legacy.nombre).join(', ')}`)
  }

  // Con `--apply` los clientes se crean primero, así los contactos que los
  // nombran quedan resueltos con una FK real y no por texto.
  if (APLICAR && clientesACrear.length) {
    const filas = clientesACrear.map((g) => ({
      company_id: BT,
      legal_name: g.nombre,
      legacy_name: g.nombre,
      email_domains: [...g.dominios],
      customer_type: 'business',
      status: 'active',
      imported_at: new Date().toISOString(),
      legacy_source: 'erp_contactos',
      needs_review: true,
      // No estaban en el maestro: nadie los dio de alta como cliente, apareció
      // su nombre al cargar un contacto. Que un humano confirme quiénes son.
      review_reason: 'SOLO_EN_CONTACTOS',
    }))
    const { data, error } = await sb.from('customers').insert(filas).select('id, legal_name')
    if (error) throw new Error(`alta de clientes sólo-en-contactos: ${error.message}`)
    console.log(`     creados                       ${data.length}`)
    for (let n = 0; n < clientesACrear.length; n += 1) {
      const creado = data.find((c) => c.legal_name === clientesACrear[n].nombre)
      if (!creado) throw new Error(`no volvió el cliente creado «${clientesACrear[n].nombre}»`)
      for (const i of clientesACrear[n].contactos) { i.cliente = creado; i.via = 'CLIENTE_NUEVO' }
    }
  }

  // ── Duplicados contra lo ya migrado ──────────────────────────────────────
  // Un contacto ya está si es el mismo cliente y el mismo mail; cuando no hay
  // mail, el mismo cliente y el mismo nombre de persona.
  const clave = (customerId, email, nombre) =>
    `${customerId}|${email ?? 'n:' + normNombre(nombre)}`
  const existentes = new Set(yaEstan.map((c) => clave(c.customer_id, normEmail(c.email), c.full_name)))

  const nuevos = []
  const repetidos = []
  const sinResolver = []
  const vistos = new Set()
  for (const i of plan) {
    if (!i.cliente) { sinResolver.push(i); continue }
    const k = clave(i.cliente.id, i.email, i.legacy.nombre)
    if (existentes.has(k) || vistos.has(k)) { repetidos.push(i); continue }
    vistos.add(k)
    nuevos.push(i)
  }

  console.log('\n  -- ALTA DE CONTACTOS --')
  console.log(`     ya estaban en la base         ${repetidos.length}`)
  console.log(`     a insertar                    ${nuevos.length}`)
  console.log(`       · con cargo                 ${nuevos.filter((i) => limpiar(i.legacy.cargo)).length}`)
  console.log(`       · con email                 ${nuevos.filter((i) => i.email).length}`)
  console.log(`       · con teléfono              ${nuevos.filter((i) => limpiar(i.legacy.telefono)).length}`)
  console.log(`     NO SE CARGAN (sin cliente)    ${sinResolver.length}`)
  for (const i of sinResolver) {
    console.log(`       · «${i.legacy.nombre}» → cliente «${i.nombreCliente}» ${i.email ? '· ' + i.email : ''}`)
  }

  const clientesTocados = new Set(nuevos.map((i) => i.cliente.id))
  console.log(`     clientes que reciben contacto ${clientesTocados.size}`)

  if (!APLICAR) {
    console.log('\n  DRY RUN: no se escribió nada.')
    console.log('='.repeat(78))
    return
  }

  const filas = nuevos.map((i) => ({
    company_id: BT,
    customer_id: i.cliente.id,
    full_name: (i.legacy.nombre ?? '').trim() || '(sin nombre)',
    role: limpiar(i.legacy.cargo),
    email: i.email,
    phone: limpiar(i.legacy.telefono),
    fax: limpiar(i.legacy.fax),
    notes: limpiar(i.legacy.observaciones),
  }))

  for (let d = 0; d < filas.length; d += 50) {
    const lote = filas.slice(d, d + 50)
    const { error } = await sb.from('customer_contacts').insert(lote)
    if (error) throw new Error(`insert contactos: ${error.message}`)
    console.log(`     insertados ${Math.min(d + lote.length, filas.length)}/${filas.length}`)
  }

  const { count } = await sb.from('customer_contacts')
    .select('id', { count: 'exact', head: true }).eq('company_id', BT)
  console.log(`\n  customer_contacts ahora: ${count}`)
  console.log('='.repeat(78))
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
