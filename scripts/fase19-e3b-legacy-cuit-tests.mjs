/**
 * Fase 19 · E3B — `customer_legacy_tax_ids`, la evidencia del CUIT legacy.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase19-e3b-legacy-cuit-tests.mjs [ruta-del-html-legacy]
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. el esquema: PK, FK, NOT NULL, check, RLS, permisos
 *   2. las 31 evidencias son exactamente las auditadas
 *   3. los 15 grupos de CUIT normalizado
 *   4. idempotencia: reinsertar no duplica ni pisa
 *   5. un valor distinto se detecta como conflicto, no se sobrescribe
 *   6. RLS con sesiones reales: anónimo, otra empresa, vendedor ajeno
 *   7. `authenticated` no puede escribir la evidencia
 *   8. producción intacta: clientes, revisión, updated_at, tax_id, auditoría
 *
 * Si se le pasa el HTML del sistema anterior, además verifica que la fuente
 * siga diciendo lo mismo que se guardó.
 *
 * Lo del fixture lleva el prefijo zz-e3b y se borra al final. No toca
 * WhatsApp, ni STEL, ni la numeración, ni ningún documento productivo.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e3b'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

/**
 * La verdad auditada, congelada acá.
 *
 * No es «lo que dice la base»: es lo que la auditoría del 20/09/2026 leyó del
 * maestro del sistema anterior. Si la base se aparta de esto, el test falla —
 * que es todo el punto de tenerlo escrito.
 */
const ESPERADO = [
  ['3639aa66-f1b0-4f4e-a425-00b7f0de61c3', 'CLI00124', '30-70945325-0'],
  ['7eb8b934-fe66-451e-9352-49cd86c32d98', 'CLI00127', '30-50215968-9'],
  ['7905d260-b36f-4015-ae80-6e88c9f52f81', 'CLI00153', '20-21669342-7'],
  ['135874bb-ef45-4b2d-ac5b-9e20c51ad790', 'CLI00166', '33-70731251-9'],
  ['d38d266d-a900-4711-ba40-21f4fe5e36f0', 'CLI00200', '30-64261755-5'],
  ['1731a1a1-e544-40d2-b7f4-3976e6970937', 'CLI00222', '30708603879'],
  ['85f33430-cfe1-49da-a964-0185f704d634', 'CLI00224', '30-70945325-0'],
  ['10c7b5d5-4cb7-40fd-8da0-55398442d44a', 'CLI00243', '30-52913594-3'],
  ['ed8652a7-1aa3-41ea-8baf-c1f3ce4b95c1', 'CLI00244', '30-71187148-5'],
  ['b8eea9ac-6933-474a-92be-fe7a8b2fc3e3', 'CLI00270', '30711871485'],
  ['bfe8cd82-60e0-4c55-8fd9-85c3e1e2813c', 'CLI00282', '30-66916066-2'],
  ['c4888b1d-c68a-4a90-b046-fcb993742fa5', 'CLI00298', '30502680478'],
  ['d14c34f0-ebc2-44d8-ab9c-18063370912f', 'CLI00307', '30-50215968-9'],
  ['09c4b993-45ac-413c-9fde-031bb0ce42d9', 'CLI00336', '2024652303-8'],
  ['7c9904cf-4feb-42cb-b4d5-5a76f80e5cb7', 'CLI00340', '20-24652303-8'],
  ['7b8411ad-b442-4233-b1b5-3a1dac27cf96', 'CLI00341', '30606552390'],
  ['0a6334f0-6b00-4966-9da0-9324e7faaca6', 'CLI00527', '30-50268047-8'],
  ['da9eebce-5af5-403f-8fac-2ff6c6970284', 'CLI00556', '33-70731251-9'],
  ['4b366975-ccd0-4b6c-b6dd-fb262ba0e23d', 'CLI00605', '20216693427'],
  ['1329055d-2458-462d-ae9e-d106a5f87404', 'CLI00728', '33-71159029-9'],
  ['af4b824d-cb50-4db7-aa4b-f11b59b06bcc', 'CLI00810', '20-27089205-2'],
  ['caecf5dc-e837-4b1a-9220-976728f86d63', 'CLI00824', '30-64261755-5'],
  ['6edee18c-3cb1-4945-83f3-023a52aab6eb', 'CLI00834', '20-27089205-2'],
  ['80111092-05df-4e24-82b5-fd4e193370c8', 'CLI00837', '30-60655239-0'],
  ['8b6cfc0f-262c-4a09-981f-be772006c3e8', 'CLI01072', '33-71159029-9'],
  ['b53776df-4ec2-48e3-9c71-b893b1399042', 'CLI01073', '30-70860387-9'],
  ['1f35c31b-1b24-4951-8180-57019d3fbed3', 'CLI01077', '30529135943'],
  ['3c6cf45a-69c7-4c03-9e26-0fa7c6570d92', 'CLI01097', '30-71750919-2'],
  ['943dc954-03ac-4f5e-afa2-b584c44202ac', 'CLI01118', '20-27089205-2'],
  ['19d75809-d97d-4174-a21b-f62d7500d296', 'CLI01136', '30669160662'],
  ['e9e8cb17-3a42-462f-b326-5c35e9cf8811', 'CLI01193', '30717509192'],
]

/** Baseline medida el 20/09/2026, antes de crear nada. */
const BASELINE = {
  clientes: 1010,
  revision: 40,
  maxUpdated: '2026-09-16T00:01:50.325964+00:00',
  auditoria: 2,
}

const normCuit = (x) => (x ?? '').replace(/\D/g, '')

const usuarioTemporal = async (companyId, rol) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  ok(await s.from('company_memberships').insert({
    company_id: companyId, user_id: data.user.id, role: rol, status: 'active',
  }), `membresía ${rol}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, rol, c }
}

const limpiar = async () => {
  const ids = creados.empresas
  if (ids.length) {
    // La evidencia del fixture se va con el cliente (on delete cascade), pero
    // se borra explícito para no depender de eso en la limpieza.
    const clientes = (await s.from('customers').select('id').in('company_id', ids)).data ?? []
    if (clientes.length) {
      await s.from('customer_legacy_tax_ids').delete().in('customer_id', clientes.map((c) => c.id))
    }
    for (const t of ['company_memberships', 'customers']) {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
  }
  for (const u of creados.usuarios) await s.auth.admin.deleteUser(u)
  creados.usuarios = []
  if (ids.length) {
    const r = await s.from('companies').delete().in('id', ids)
    if (r.error) console.log(`    aviso companies: ${r.error.message.slice(0, 120)}`)
  }
}

const barrerRestos = async () => {
  const { data: viejas } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  creados.empresas = (viejas ?? []).map((x) => x.id)
  if (creados.empresas.length) {
    console.log(`  barriendo ${creados.empresas.length} empresa(s) de una corrida anterior`)
    await limpiar()
  }
  creados.empresas = []
}

/** Lee el maestro del sistema anterior igual que `fase5-migrar-clientes.mjs`. */
function leerMaestro(ruta) {
  const html = fs.readFileSync(ruta, 'utf8')
  const m = html.match(/<script[^>]*id="clientes-data"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('No se encontró el bloque clientes-data en el HTML')
  return JSON.parse(m[1])
}

async function main() {
  console.log('\n═══ Fase 19 · E3B — Evidencia del CUIT legacy ═══')
  await barrerRestos()

  // ── 1 · Esquema ──────────────────────────────────────────────────────────
  seccion('1 · Esquema y permisos')

  const filas = ok(await s.from('customer_legacy_tax_ids')
    .select('customer_id, legacy_tax_id_raw, legacy_ref, source, created_at')
    .order('legacy_ref'), 'evidencias')
  cmp('hay exactamente 31 evidencias', 31, filas.length)
  cmp('todas con `source` de la migración', 31,
    filas.filter((f) => f.source === 'maestro_clientes_html').length)
  cmp('ninguna con el crudo vacío', 0,
    filas.filter((f) => !f.legacy_tax_id_raw || f.legacy_tax_id_raw.trim() === '').length)

  // La PK impide dos evidencias para el mismo cliente. Se comprueba por el
  // efecto: intentar insertar una segunda tiene que fallar.
  const choque = await s.from('customer_legacy_tax_ids').insert({
    customer_id: ESPERADO[0][0], legacy_tax_id_raw: '11-11111111-1', legacy_ref: 'ZZ',
  })
  cmp('un segundo registro para el mismo cliente es rechazado', true,
    choque.error !== null && /duplicate key|unique/i.test(choque.error.message))

  // El cliente tiene que existir: la FK lo exige.
  const huerfana = await s.from('customer_legacy_tax_ids').insert({
    customer_id: randomUUID(), legacy_tax_id_raw: '11-11111111-1', legacy_ref: 'ZZ',
  })
  cmp('una evidencia sin cliente es rechazada', true,
    huerfana.error !== null && /foreign key|violates/i.test(huerfana.error.message))

  // ── 2 · Las 31, exactas ──────────────────────────────────────────────────
  seccion('2 · Las 31 evidencias coinciden con la auditoría')

  const porId = new Map(filas.map((f) => [f.customer_id, f]))
  let exactas = 0
  for (const [id, ref, raw] of ESPERADO) {
    const f = porId.get(id)
    if (f && f.legacy_tax_id_raw === raw && f.legacy_ref === ref) exactas++
    else FAIL(`evidencia de ${ref}`, f ? `guardó ${f.legacy_tax_id_raw}, esperaba ${raw}` : 'no está')
  }
  cmp('las 31 coinciden exactamente (crudo y referencia)', 31, exactas)

  // El crudo se conservó SIN reformatear: si alguien normalizara al guardar,
  // estos tres dejarían de ser distintos entre sí.
  const conGuiones = filas.filter((f) => /\D/.test(f.legacy_tax_id_raw)).length
  cmp('23 se guardaron con separadores', 23, conGuiones)
  cmp('8 se guardaron sólo con dígitos', 8, filas.length - conGuiones)
  const malFormado = filas.find((f) => f.legacy_ref === 'CLI00336')
  cmp('el histórico mal formado sobrevivió tal cual', '2024652303-8', malFormado?.legacy_tax_id_raw)

  // ── 3 · Los grupos ───────────────────────────────────────────────────────
  seccion('3 · Grupos por CUIT normalizado')

  const grupos = new Map()
  for (const f of filas) {
    const k = normCuit(f.legacy_tax_id_raw)
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  cmp('15 grupos', 15, [...grupos.values()].filter((g) => g.length > 1).length)
  cmp('ninguna evidencia queda sola en su grupo', 0,
    [...grupos.values()].filter((g) => g.length === 1).length)
  cmp('el grupo más grande tiene 3 fichas', 3,
    Math.max(...[...grupos.values()].map((g) => g.length)))
  cmp('los 11 dígitos están completos en todos', 31,
    filas.filter((f) => normCuit(f.legacy_tax_id_raw).length === 11).length)

  // ── 4 · Idempotencia y conflicto ─────────────────────────────────────────
  seccion('4 · Idempotencia')

  const antesIdem = JSON.stringify(filas)
  const reinsertar = await s.from('customer_legacy_tax_ids')
    .upsert(ESPERADO.map(([id, ref, raw]) => ({
      customer_id: id, legacy_tax_id_raw: raw, legacy_ref: ref,
    })), { onConflict: 'customer_id', ignoreDuplicates: true })
  cmp('reinsertar las 31 no falla', true, reinsertar.error === null)

  const despuesIdem = ok(await s.from('customer_legacy_tax_ids')
    .select('customer_id, legacy_tax_id_raw, legacy_ref, source, created_at')
    .order('legacy_ref'), 'evidencias 2')
  cmp('siguen siendo 31', 31, despuesIdem.length)
  // El digest en vez del JSON entero: lo que importa es si cambió, no el dump.
  const digest = (x) => `${JSON.parse(x).length} filas / ${x.length} chars`
  const iguales = antesIdem === JSON.stringify(despuesIdem)
  iguales
    ? PASS('ninguna fila cambió (ni created_at)', digest(antesIdem))
    : FAIL('alguna fila cambió al reinsertar', digest(JSON.stringify(despuesIdem)))

  // Un valor distinto NO se pisa en silencio: con `ignoreDuplicates` la fila
  // vieja queda, y el backfill de la migración además lo detecta y aborta.
  const distinto = await s.from('customer_legacy_tax_ids')
    .upsert([{ customer_id: ESPERADO[0][0], legacy_tax_id_raw: '99-99999999-9', legacy_ref: 'ZZ' }],
      { onConflict: 'customer_id', ignoreDuplicates: true })
  const tras = ok(await s.from('customer_legacy_tax_ids')
    .select('legacy_tax_id_raw').eq('customer_id', ESPERADO[0][0]).single(), 'tras conflicto')
  cmp('un crudo distinto no sobrescribe la evidencia', ESPERADO[0][2], tras.legacy_tax_id_raw)
  if (distinto.error) PASS('y además el motor lo rechaza', distinto.error.message.slice(0, 60))

  // ── 5 · Fixture para RLS ─────────────────────────────────────────────────
  seccion('5 · RLS con sesiones reales')

  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E3B Alfa', legal_name: 'ZZ E3B Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa A').id
  creados.empresas.push(A)
  const B = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ E3B Beta', legal_name: 'ZZ E3B Beta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B').id
  creados.empresas.push(B)

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const adminAjeno = await usuarioTemporal(B, 'admin')

  const suyo = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E3B Cliente Del Vendedor', customer_type: 'business',
    status: 'active', salesperson_id: vendedor.id, legacy_ref: 'ZZ-E3B-1',
  }).select('id').single(), 'cliente del vendedor').id
  const ajeno = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E3B Cliente De Otro', customer_type: 'business',
    status: 'active', legacy_ref: 'ZZ-E3B-2',
  }).select('id').single(), 'cliente sin vendedor').id

  ok(await s.from('customer_legacy_tax_ids').insert([
    { customer_id: suyo, legacy_tax_id_raw: '30-11111111-1', legacy_ref: 'ZZ-E3B-1', source: 'zz-fixture' },
    { customer_id: ajeno, legacy_tax_id_raw: '30-22222222-2', legacy_ref: 'ZZ-E3B-2', source: 'zz-fixture' },
  ]), 'evidencias del fixture')

  const leer = async (c, id) => {
    const r = await c.from('customer_legacy_tax_ids').select('legacy_tax_id_raw').eq('customer_id', id)
    return r.error ? `error: ${r.error.message.slice(0, 40)}` : (r.data ?? []).length
  }

  // Al anónimo no le llega ni a la RLS: sin `grant select` la tabla ni
  // siquiera existe para él. Es MÁS fuerte que devolver cero filas, y hay que
  // afirmar eso y no un `length === 0`, que también daría cero si la consulta
  // falla por cualquier otro motivo.
  const anon = sesion()
  const anonTodo = await anon.from('customer_legacy_tax_ids').select('customer_id')
  cmp('al anónimo la tabla le es negada de entrada', true,
    anonTodo.error !== null && /permission denied/i.test(anonTodo.error.message))
  cmp('anónimo no obtiene ni una fila', 0, anonTodo.data?.length ?? 0)
  cmp('y tampoco por cliente concreto', true, String(await leer(anon, suyo)).startsWith('error: permission denied'))

  cmp('el admin de la empresa ve la evidencia de su cliente', 1, await leer(admin.c, suyo))
  cmp('el admin de OTRA empresa no la ve', 0, await leer(adminAjeno.c, suyo))
  cmp('el vendedor ve la del cliente que tiene asignado', 1, await leer(vendedor.c, suyo))
  // Éste es el que separa esta policy de una por `company_id`: el vendedor es
  // interno de la misma empresa, pero ese cliente no es suyo.
  cmp('el vendedor NO ve la de un cliente que no tiene asignado', 0, await leer(vendedor.c, ajeno))
  cmp('y tampoco ve al cliente en sí', 0,
    (await vendedor.c.from('customers').select('id').eq('id', ajeno)).data?.length ?? 0)

  const deProduccion = await leer(adminAjeno.c, ESPERADO[0][0])
  cmp('nadie de una empresa ajena ve las evidencias productivas', 0, deProduccion)

  // ── 6 · La evidencia no se edita desde la aplicación ─────────────────────
  seccion('6 · Sólo lectura')

  const escribir = await admin.c.from('customer_legacy_tax_ids')
    .insert({ customer_id: suyo, legacy_tax_id_raw: '30-33333333-3', legacy_ref: 'ZZ' })
  cmp('un admin con sesión no puede insertar evidencia', true, escribir.error !== null)
  const actualizar = await admin.c.from('customer_legacy_tax_ids')
    .update({ legacy_tax_id_raw: '30-44444444-4' }).eq('customer_id', suyo)
  const sigue = ok(await s.from('customer_legacy_tax_ids')
    .select('legacy_tax_id_raw').eq('customer_id', suyo).single(), 'sigue')
  cmp('ni actualizarla', '30-11111111-1', sigue.legacy_tax_id_raw)
  if (actualizar.error) PASS('el update es rechazado', actualizar.error.message.slice(0, 60))
  const borrar = await admin.c.from('customer_legacy_tax_ids').delete().eq('customer_id', suyo)
  cmp('ni borrarla', 2, await cuenta('customer_legacy_tax_ids', (q) => q.in('customer_id', [suyo, ajeno])))
  if (borrar.error) PASS('el delete es rechazado', borrar.error.message.slice(0, 60))

  // ── 7 · Producción intacta ───────────────────────────────────────────────
  seccion('7 · Producción')

  const prodIds = (await s.from('companies').select('id').not('slug', 'like', 'zz-%')).data.map((c) => c.id)
  cmp('los clientes siguen siendo 1.010', BASELINE.clientes,
    await cuenta('customers', (q) => q.in('company_id', prodIds)))
  cmp('la cola de revisión sigue en 40', BASELINE.revision,
    await cuenta('customers', (q) => q.in('company_id', prodIds).eq('needs_review', true)))
  cmp('ningún cliente productivo se marcó como revisado de más', 31,
    await cuenta('customers', (q) => q.in('id', ESPERADO.map((e) => e[0])).eq('needs_review', true)))
  cmp('los 31 siguen SIN CUIT vigente', 31,
    await cuenta('customers', (q) => q.in('id', ESPERADO.map((e) => e[0])).is('tax_id', null)))

  const masNuevo = ok(await s.from('customers').select('updated_at')
    .in('company_id', prodIds).order('updated_at', { ascending: false }).limit(1).single(), 'updated_at')
  cmp('el updated_at más nuevo no se movió', BASELINE.maxUpdated, masNuevo.updated_at)
  cmp('la auditoría comercial no creció', BASELINE.auditoria, await cuenta('sales_audit'))
  cmp('no hay auditoría de clientes', 0,
    await cuenta('sales_audit', (q) => q.eq('entity_type', 'customer')))
  cmp('los documentos no se movieron', '306 / 172 / 193',
    `${await cuenta('sales_quotes', (q) => q.in('company_id', prodIds))} / ` +
    `${await cuenta('sales_orders', (q) => q.in('company_id', prodIds))} / ` +
    `${await cuenta('deliveries', (q) => q.in('company_id', prodIds))}`)

  // ── 8 · Contra la fuente, si está a mano ─────────────────────────────────
  const ruta = process.argv[2]
  if (ruta && fs.existsSync(ruta)) {
    seccion('8 · Contra el maestro del sistema anterior')
    const maestro = leerMaestro(ruta)
    const porRef = new Map()
    for (const l of maestro) if (l.ref) porRef.set(l.ref, l)
    let coinciden = 0
    for (const f of filas) {
      const l = porRef.get(f.legacy_ref)
      if (l && (l.cif ?? '').trim() === f.legacy_tax_id_raw) coinciden++
      else FAIL(`fuente de ${f.legacy_ref}`, l ? `el maestro dice ${(l.cif ?? '').trim()}` : 'no está en el maestro')
    }
    cmp('las 31 siguen coincidiendo con el maestro', 31, coinciden)
    cmp('el maestro sigue teniendo 988 clientes', 988, maestro.length)
  } else {
    console.log('\n  (sin HTML del sistema anterior: se omite el cotejo contra la fuente)')
  }
}

main()
  .catch((e) => { fallos++; console.error(`\n  ERROR: ${e.message}`) })
  .finally(async () => {
    await limpiar()
    console.log(fallos === 0 ? '\n  ✓ TODO EN VERDE\n' : `\n  ✗ ${fallos} FALLO(S)\n`)
    process.exit(fallos === 0 ? 0 : 1)
  })
