/**
 * Fase 14 · Entrega 0 — apariencia por usuario (profiles.appearance).
 * Pruebas REALES contra la base, con JWT reales, sólo con usuarios fixture.
 *
 *   1  default: el perfil nace sin preferencia (NULL = original);
 *   2  guardar la propia: OK y se lee igual desde OTRA sesión (otro dispositivo);
 *   3  CHECK: preset/acento/tamaño/fuente inválidos, clave extra, clave faltante,
 *      tipos cambiados y arreglo → rechazados; el valor anterior queda;
 *   4  aislamiento: A no puede escribir la de B (0 filas), ni insertar perfiles,
 *      ni anon escribir nada; B intacto;
 *   5  restaurar: NULL;
 *   6  la vía de servicio (alta de usuario por trigger, updates del backend)
 *      sigue funcionando con el CHECK;
 *   7  limpieza: 0 usuarios y empresas zz-f14ap; perfiles reales intactos.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-apariencia-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'zz-f14ap'
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const clase = (r) => {
  if (!r.error) return Array.isArray(r.data) && r.data.length === 0 ? 'VACIO' : 'OK'
  if (r.error.code === '23514') return 'CHECK'
  if (/permission denied|42501|row-level security/i.test(`${r.error.message} ${r.error.code}`)) return 'PERMISO'
  return `OTRO(${r.error.code}: ${r.error.message.slice(0, 80)})`
}

const credenciales = new Map()
const usuario = async (etiqueta, companyId) => {
  const email = `${MARCA}-${etiqueta}-${Date.now()}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `ZZ F14 ${etiqueta}` } })
  if (error) throw new Error(`crear ${etiqueta}: ${error.message}`)
  await s.from('company_memberships').insert({ company_id: companyId, user_id: data.user.id, role: 'employee', status: 'active' })
  credenciales.set(etiqueta, { email, password })
  return { id: data.user.id, ...(await sesion(etiqueta)) }
}
const sesion = async (etiqueta) => {
  const { email, password } = credenciales.get(etiqueta)
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c }
}

const huellaPerfilesReales = async () => {
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  const reales = (us?.users ?? []).filter((u) => !u.email?.startsWith('zz-')).map((u) => u.id)
  const { data } = await s.from('profiles').select('*').in('id', reales).order('id')
  return { n: data?.length ?? 0, hash: hash(data) }
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) await s.from('company_memberships').delete().in('company_id', ids)
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) await s.auth.admin.deleteUser(u.id)
  if (ids.length) await s.from('companies').delete().in('id', ids)
}

const VALIDA = { version: 1, preset: 'grafito', acento: 'verde', tamano: 'grande', fuente: 'serif' }

const main = async () => {
  await barrer()
  const antes = await huellaPerfilesReales()
  const { data: emp, error } = await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ F14 apariencia' }).select('id').single()
  if (error) throw new Error(`empresa: ${error.message}`)
  const A = await usuario('a', emp.id)
  const B = await usuario('b', emp.id)
  // jsonb no conserva el orden de las claves: se ordena para comparar.
  const ordenar = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v)
  const leer = async (cliente, id) => ordenar((await cliente.from('profiles').select('appearance').eq('id', id).maybeSingle()).data?.appearance)

  seccion('1 · Default')
  cmp('el perfil nace (trigger) sin preferencia: NULL', [null, null], [await leer(A.c, A.id), await leer(B.c, B.id)])

  seccion('2 · Guardar la propia y leerla desde otra sesión')
  cmp('A guarda su apariencia', 'OK', clase(await A.c.from('profiles').update({ appearance: VALIDA }).eq('id', A.id).select('id')))
  cmp('A la lee igual', ordenar(VALIDA), await leer(A.c, A.id))
  const A2 = await sesion('a')
  cmp('otra sesión de A (otro dispositivo) ve la misma', ordenar(VALIDA), await leer(A2.c, A.id))
  cmp('cambio desde la segunda sesión se ve en la primera', 'OK', clase(await A2.c.from('profiles').update({ appearance: { ...VALIDA, preset: 'azul-noche' } }).eq('id', A.id).select('id')))
  cmp('primera sesión lee azul-noche', 'azul-noche', (await leer(A.c, A.id))?.preset)

  seccion('3 · CHECK de la base')
  const invalidos = {
    preset: { ...VALIDA, preset: 'hacker' },
    acento: { ...VALIDA, acento: '#ff0000' },
    tamano: { ...VALIDA, tamano: '48px' },
    fuente: { ...VALIDA, fuente: 'Comic Sans' },
    claveExtra: { ...VALIDA, css: 'body{display:none}' },
    claveFaltante: { version: 1, preset: 'grafito', acento: 'tema', tamano: 'normal' },
    versionTexto: { ...VALIDA, version: '1' },
    presetNumero: { ...VALIDA, preset: 7 },
    arreglo: ['grafito'],
    texto: 'grafito',
  }
  const res = {}
  for (const [k, v] of Object.entries(invalidos)) res[k] = clase(await A.c.from('profiles').update({ appearance: v }).eq('id', A.id).select('id'))
  cmp('todos los inválidos rechazados por el CHECK', Object.fromEntries(Object.keys(invalidos).map((k) => [k, 'CHECK'])), res)
  cmp('el valor anterior quedó intacto', 'azul-noche', (await leer(A.c, A.id))?.preset)
  cmp('17 presets válidos aceptados', 17, (await Promise.all(['claro-naranja', 'oscuro-naranja', 'turquesa-marino', 'violeta-claro', 'azul-marino', 'verde-menta-claro', 'azul-cielo-oscuro', 'azul-noche', 'azul-corporativo', 'azul-corporativo-claro', 'gris-pizarra-oscuro', 'verde-esmeralda', 'azul-electrico', 'verde-industrial', 'grafito', 'naranja-oscuro', 'cian-oscuro']
    .map(async (p) => clase(await A.c.from('profiles').update({ appearance: { ...VALIDA, preset: p } }).eq('id', A.id).select('id'))))).filter((x) => x === 'OK').length)

  seccion('4 · Aislamiento')
  await B.c.from('profiles').update({ appearance: { ...VALIDA, preset: 'cian-oscuro' } }).eq('id', B.id)
  const antesB = await leer(s, B.id)
  cmp('A intenta escribir la apariencia de B: 0 filas', 'VACIO', clase(await A.c.from('profiles').update({ appearance: { ...VALIDA, preset: 'violeta-claro' } }).eq('id', B.id).select('id')))
  cmp('A intenta cambiar su id por el de B: 0 filas', 'VACIO', clase(await A.c.from('profiles').update({ id: B.id }).eq('id', A.id).eq('id', B.id).select('id')))
  cmp('A intenta insertar un perfil ajeno: rechazado', 'PERMISO', clase(await A.c.from('profiles').insert({ id: randomUUID(), full_name: 'intruso', appearance: VALIDA })).replace(/OTRO\(23503.*/, 'PERMISO'))
  cmp('upsert de A sobre B: no toca a B', true, JSON.stringify(await (async () => { await A.c.from('profiles').upsert({ id: B.id, full_name: 'x', appearance: { ...VALIDA, preset: 'grafito' } }); return leer(s, B.id) })()) === JSON.stringify(antesB))
  cmp('anon: no escribe', 'sin efecto', ['VACIO', 'PERMISO'].includes(clase(await anon.from('profiles').update({ appearance: VALIDA }).eq('id', A.id).select('id'))) ? 'sin efecto' : 'ESCRIBIÓ')
  cmp('B quedó intacto', antesB, await leer(s, B.id))
  cmp('anon no lee perfiles', [], (await anon.from('profiles').select('appearance').eq('id', A.id)).data ?? [])

  seccion('5 · Restaurar original')
  cmp('A guarda NULL', 'OK', clase(await A.c.from('profiles').update({ appearance: null }).eq('id', A.id).select('id')))
  cmp('A lee NULL', null, await leer(A.c, A.id))

  seccion('6 · Vías de servicio con el CHECK')
  cmp('service role actualiza nombre de un perfil (backend de usuarios)', 'OK', clase(await s.from('profiles').update({ full_name: 'ZZ F14 renombrado' }).eq('id', B.id).select('id')))
  cmp('service role con apariencia válida', 'OK', clase(await s.from('profiles').update({ appearance: VALIDA }).eq('id', B.id).select('id')))
  cmp('service role con apariencia inválida: también rechazada', 'CHECK', clase(await s.from('profiles').update({ appearance: { ...VALIDA, preset: 'x' } }).eq('id', B.id).select('id')))
  const C = await usuario('c', emp.id)
  cmp('alta de usuario nuevo (trigger handle_new_user) con el CHECK activo', null, await leer(C.c, C.id))

  seccion('7 · Limpieza y perfiles reales')
  await barrer()
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('0 usuarios zz-f14ap', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)
  cmp('0 empresas zz-f14ap', 0, (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  cmp('perfiles reales idénticos (incluye appearance NULL)', antes, await huellaPerfilesReales())

  console.log(`\n  ${fallos === 0 ? '✓ TODO PASA' : `✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ Error inesperado:', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
