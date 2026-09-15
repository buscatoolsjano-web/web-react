/**
 * Fase 14 · Entrega 0 — apariencia por usuario y superficie de escritura de profiles.
 * Pruebas REALES contra la base, con JWT reales, sólo con usuarios fixture.
 *
 *   1  default: el perfil nace sin preferencia (NULL = original);
 *   2  RPC guardar_mi_apariencia: guarda la propia y se lee igual desde OTRA sesión;
 *   3  CHECK: preset/acento/tamaño/fuente inválidos, clave extra, clave faltante,
 *      tipos cambiados, arreglo y texto → rechazados; el valor anterior queda;
 *   4  RED TEAM por REST (usuario A): appearance directo, is_active, full_name,
 *      phone, avatar_path, locale, theme, deleted_at, created_at, updated_at, id,
 *      INSERT, DELETE, UPSERT → BLOCKED; perfil de A intacto salvo appearance;
 *      appearance de B por REST y por RPC con parámetros inyectados → BLOCKED;
 *      anon por REST y por RPC → BLOCKED; membresía y rol intactos;
 *   5  restaurar: NULL;
 *   6  flujos legítimos: alta de usuario (trigger handle_new_user), login y
 *      lectura del propio perfil y de compañeros, service role (backend de
 *      usuarios) sigue escribiendo y respeta el CHECK;
 *   7  limpieza: 0 usuarios y empresas zz-f14ap; perfiles y membresías reales intactos.
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
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 160)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'zz-f14ap'
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)

/** OK | CHECK | BLOCKED (permiso, función inexistente o 0 filas) | OTRO(...) */
const clase = (r) => {
  if (!r.error) return Array.isArray(r.data) && r.data.length === 0 ? 'BLOCKED(0 filas)' : 'OK'
  if (r.error.code === '23514') return 'CHECK'
  if (/permission denied|42501|row-level security|sin_sesion/i.test(`${r.error.message} ${r.error.code}`)) return 'BLOCKED'
  if (r.error.code === 'PGRST202') return 'BLOCKED(sin esa firma)'
  return `OTRO(${r.error.code}: ${r.error.message.slice(0, 80)})`
}
const bloqueado = (c) => c.startsWith('BLOCKED')

const credenciales = new Map()
const usuario = async (etiqueta, companyId, rol = 'employee') => {
  const email = `${MARCA}-${etiqueta}-${Date.now()}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `ZZ F14 ${etiqueta}` } })
  if (error) throw new Error(`crear ${etiqueta}: ${error.message}`)
  const { error: eM } = await s.from('company_memberships').insert({ company_id: companyId, user_id: data.user.id, role: rol, status: 'active' })
  if (eM) throw new Error(`membresía ${etiqueta}: ${eM.message}`)
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

const huellaReal = async () => {
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  const reales = (us?.users ?? []).filter((u) => !u.email?.startsWith('zz-')).map((u) => u.id)
  const { data: perfiles } = await s.from('profiles').select('*').in('id', reales).order('id')
  const { data: memb } = await s.from('company_memberships').select('*').in('user_id', reales).order('id')
  return { perfiles: perfiles?.length ?? 0, hashPerfiles: hash(perfiles), membresias: memb?.length ?? 0, hashMembresias: hash(memb) }
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
// jsonb no conserva el orden de las claves: se ordena para comparar.
const ordenar = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v)

const main = async () => {
  await barrer()
  const antes = await huellaReal()
  const { data: emp, error } = await s.from('companies').insert({ slug: `${MARCA}-${Date.now()}`, name: 'ZZ F14 apariencia' }).select('id').single()
  if (error) throw new Error(`empresa: ${error.message}`)
  const A = await usuario('a', emp.id)
  const B = await usuario('b', emp.id, 'admin')
  const leer = async (cliente, id) => ordenar((await cliente.from('profiles').select('appearance').eq('id', id).maybeSingle()).data?.appearance)
  const guardar = (cliente, valor) => cliente.rpc('guardar_mi_apariencia', { p_appearance: valor })
  const filaCompleta = async (id) => (await s.from('profiles').select('*').eq('id', id).single()).data

  seccion('1 · Default')
  cmp('el perfil nace (trigger) sin preferencia: NULL', [null, null], [await leer(A.c, A.id), await leer(B.c, B.id)])

  seccion('2 · RPC guardar_mi_apariencia')
  cmp('A cambia su appearance por la RPC → PASS', 'OK', clase(await guardar(A.c, VALIDA)))
  cmp('A la lee igual', ordenar(VALIDA), await leer(A.c, A.id))
  const A2 = await sesion('a')
  cmp('otra sesión de A (otro dispositivo) ve la misma', ordenar(VALIDA), await leer(A2.c, A.id))
  cmp('cambio desde la segunda sesión', 'OK', clase(await guardar(A2.c, { ...VALIDA, preset: 'azul-noche' })))
  cmp('la primera sesión lee azul-noche', 'azul-noche', (await leer(A.c, A.id))?.preset)
  cmp('la RPC devuelve lo guardado (sin otras columnas)', ['acento', 'fuente', 'preset', 'tamano', 'version'], Object.keys((await guardar(A.c, { ...VALIDA, preset: 'azul-noche' })).data ?? {}).sort())
  cmp('17 presets válidos aceptados', 17, (await Promise.all(['claro-naranja', 'oscuro-naranja', 'turquesa-marino', 'violeta-claro', 'azul-marino', 'verde-menta-claro', 'azul-cielo-oscuro', 'azul-noche', 'azul-corporativo', 'azul-corporativo-claro', 'gris-pizarra-oscuro', 'verde-esmeralda', 'azul-electrico', 'verde-industrial', 'grafito', 'naranja-oscuro', 'cian-oscuro']
    .map(async (p) => clase(await guardar(B.c, { ...VALIDA, preset: p }))))).filter((x) => x === 'OK').length)
  await guardar(A.c, { ...VALIDA, preset: 'azul-noche' })

  seccion('3 · CHECK de la base (vía RPC)')
  const invalidos = {
    preset: { ...VALIDA, preset: 'hacker' },
    acento: { ...VALIDA, acento: '#ff0000' },
    tamano: { ...VALIDA, tamano: '48px' },
    fuente: { ...VALIDA, fuente: 'Comic Sans' },
    claveExtra: { ...VALIDA, is_active: false },
    claveFaltante: { version: 1, preset: 'grafito', acento: 'tema', tamano: 'normal' },
    versionTexto: { ...VALIDA, version: '1' },
    presetNumero: { ...VALIDA, preset: 7 },
    arreglo: ['grafito'],
    texto: 'grafito',
  }
  const res = {}
  for (const [k, v] of Object.entries(invalidos)) res[k] = clase(await guardar(A.c, v))
  cmp('todos los inválidos rechazados por el CHECK', Object.fromEntries(Object.keys(invalidos).map((k) => [k, 'CHECK'])), res)
  cmp('el valor anterior quedó intacto', 'azul-noche', (await leer(A.c, A.id))?.preset)

  seccion('4 · Red team')
  const filaA0 = await filaCompleta(A.id)
  const membA0 = (await s.from('company_memberships').select('*').eq('user_id', A.id)).data
  const intentosPropios = {
    appearanceDirecto: await A.c.from('profiles').update({ appearance: { ...VALIDA, preset: 'violeta-claro' } }).eq('id', A.id).select('id'),
    is_active: await A.c.from('profiles').update({ is_active: false }).eq('id', A.id).select('id'),
    full_name: await A.c.from('profiles').update({ full_name: 'ZZ intruso' }).eq('id', A.id).select('id'),
    phone: await A.c.from('profiles').update({ phone: '000' }).eq('id', A.id).select('id'),
    avatar_path: await A.c.from('profiles').update({ avatar_path: 'x/y.png' }).eq('id', A.id).select('id'),
    locale: await A.c.from('profiles').update({ locale: 'en-US' }).eq('id', A.id).select('id'),
    theme: await A.c.from('profiles').update({ theme: 'dark' }).eq('id', A.id).select('id'),
    deleted_at: await A.c.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', A.id).select('id'),
    created_at: await A.c.from('profiles').update({ created_at: '2000-01-01T00:00:00Z' }).eq('id', A.id).select('id'),
    updated_at: await A.c.from('profiles').update({ updated_at: '2000-01-01T00:00:00Z' }).eq('id', A.id).select('id'),
    id: await A.c.from('profiles').update({ id: randomUUID() }).eq('id', A.id).select('id'),
    insert: await A.c.from('profiles').insert({ id: randomUUID(), full_name: 'ZZ intruso' }).select('id'),
    delete: await A.c.from('profiles').delete().eq('id', A.id).select('id'),
    upsertPropio: await A.c.from('profiles').upsert({ id: A.id, full_name: 'ZZ intruso', is_active: false }).select('id'),
  }
  const clasesPropias = Object.fromEntries(Object.entries(intentosPropios).map(([k, r]) => [k, clase(r)]))
  cmp('A por REST sobre SU perfil: appearance directo, is_active, otros campos, INSERT, DELETE, UPSERT → BLOCKED', true, Object.values(clasesPropias).every(bloqueado))
  INFO('detalle', JSON.stringify(clasesPropias))
  cmp('perfil de A intacto (todas las columnas)', hash(filaA0), hash(await filaCompleta(A.id)))

  const filaB0 = await filaCompleta(B.id)
  const intentosAjenos = {
    restAppearanceB: clase(await A.c.from('profiles').update({ appearance: { ...VALIDA, preset: 'cian-oscuro' } }).eq('id', B.id).select('id')),
    restIsActiveB: clase(await A.c.from('profiles').update({ is_active: false }).eq('id', B.id).select('id')),
    upsertB: clase(await A.c.from('profiles').upsert({ id: B.id, full_name: 'ZZ intruso', appearance: VALIDA }).select('id')),
    rpcConIdDeB: clase(await A.c.rpc('guardar_mi_apariencia', { p_appearance: { ...VALIDA, preset: 'cian-oscuro' }, p_user: B.id })),
    rpcConIdDeB2: clase(await A.c.rpc('guardar_mi_apariencia', { p_appearance: { ...VALIDA, preset: 'cian-oscuro' }, id: B.id })),
  }
  cmp('A intenta cambiar el appearance (u otro campo) de B → BLOCKED', true, Object.values(intentosAjenos).every(bloqueado))
  INFO('detalle', JSON.stringify(intentosAjenos))
  cmp('perfil de B intacto', hash(filaB0), hash(await filaCompleta(B.id)))

  const intentosAnon = {
    rpc: clase(await anon.rpc('guardar_mi_apariencia', { p_appearance: VALIDA })),
    restUpdate: clase(await anon.from('profiles').update({ appearance: VALIDA }).eq('id', A.id).select('id')),
    restIsActive: clase(await anon.from('profiles').update({ is_active: false }).eq('id', A.id).select('id')),
    restInsert: clase(await anon.from('profiles').insert({ id: randomUUID(), full_name: 'anon' }).select('id')),
    restSelect: clase(await anon.from('profiles').select('id').eq('id', A.id)),
  }
  cmp('anon: RPC, UPDATE, INSERT y lectura → BLOCKED', true, Object.values(intentosAnon).every(bloqueado))
  INFO('detalle', JSON.stringify(intentosAnon))
  cmp('rol y membresía de A intactos (la RPC no toca company_memberships)', hash(membA0), hash((await s.from('company_memberships').select('*').eq('user_id', A.id)).data))
  cmp('A no puede escribir su rol por REST', true, bloqueado(clase(await A.c.from('company_memberships').update({ role: 'admin' }).eq('user_id', A.id).select('id'))))

  seccion('5 · Restaurar original')
  cmp('A guarda NULL por la RPC', 'OK', clase(await guardar(A.c, null)))
  cmp('A lee NULL', null, await leer(A.c, A.id))

  seccion('6 · Flujos legítimos')
  const C = await usuario('c', emp.id)
  cmp('alta de usuario nuevo: el trigger crea el perfil (sin apariencia)', [true, null], [Boolean(await filaCompleta(C.id)), await leer(C.c, C.id)])
  const C2 = await sesion('c')
  cmp('login con contraseña y lectura del propio perfil', 'OK', clase(await C2.c.from('profiles').select('id, full_name').eq('id', C.id)))
  cmp('lectura del perfil de un compañero de empresa (nombres en listados)', 'OK', clase(await C2.c.from('profiles').select('id, full_name').eq('id', B.id)))
  cmp('lectura de membresías propias (selector de empresa)', 'OK', clase(await C2.c.from('company_memberships').select('company_id, role').eq('user_id', C.id)))
  cmp('service role (backend de usuarios) actualiza el nombre', 'OK', clase(await s.from('profiles').update({ full_name: 'ZZ F14 renombrado' }).eq('id', B.id).select('id')))
  cmp('service role con apariencia inválida: también la frena el CHECK', 'CHECK', clase(await s.from('profiles').update({ appearance: { ...VALIDA, preset: 'x' } }).eq('id', B.id).select('id')))
  cmp('RPC de lectura de usuarios de Configuración (admin B)', 'OK', clase(await B.c.rpc('config_listar_usuarios', { p_company: emp.id })))

  seccion('7 · Limpieza y datos reales')
  await barrer()
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  cmp('0 usuarios zz-f14ap', 0, (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length)
  cmp('0 empresas zz-f14ap', 0, (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  cmp('perfiles y membresías reales idénticos', antes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? '✓ TODO PASA' : `✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ Error inesperado:', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
