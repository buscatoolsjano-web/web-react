/**
 * Banco de medición del coste de RLS en el listado del catálogo.
 *
 * Existe para que el "antes" y el "después" de un cambio de policy sean
 * literalmente la misma corrida, y no dos mediciones parecidas hechas a
 * mano. Cada consulta se repite N veces y se informa la MEDIANA, que es
 * menos sensible al primer acceso frío que el promedio.
 *
 * Usa la clave PUBLICABLE y sesiones reales: mide lo que mide el
 * navegador, con RLS aplicada. No usa la Secret salvo para la línea de
 * base sin RLS, que es opcional.
 *
 *   set -a; source .env; set +a
 *   BT_PW_JANO=… BT_PW_TEST=… node scripts/medir-rls-count.mjs > antes.txt
 *
 * Las contraseñas se leen del entorno y nunca se imprimen.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const REPETICIONES = Number(process.env.BT_REPS ?? 5)

if (!URL || !PUB) {
  console.error('✗ Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const cliente = () => createClient(URL, PUB, { auth: { persistSession: false } })

/** Corre `fn` REPETICIONES veces y devuelve mediana, mínimo, máximo y el error si lo hubo. */
async function medir(fn) {
  const ms = []
  let error = null
  let muestra = null
  for (let i = 0; i < REPETICIONES; i++) {
    const t0 = Date.now()
    const r = await fn()
    ms.push(Date.now() - t0)
    if (r?.error) error = r.error.message
    if (muestra === null) muestra = r
  }
  ms.sort((a, b) => a - b)
  return {
    mediana: ms[Math.floor(ms.length / 2)],
    min: ms[0],
    max: ms[ms.length - 1],
    error,
    muestra,
  }
}

const fmt = (n) => String(n).padStart(6) + ' ms'

function linea(nombre, r, extra = '') {
  const alerta = r.error ? '  ← ' + r.error.slice(0, 46) : r.mediana >= 4000 ? '  ← >= 4 s' : ''
  console.log(
    '    ' + nombre.padEnd(34) +
    'mediana ' + fmt(r.mediana) +
    '   [' + r.min + '–' + r.max + ']' +
    (extra ? '   ' + extra : '') + alerta,
  )
}

/** Las cuatro consultas que hace el catálogo, tal como las emite la app. */
async function medirRol(etiqueta, email, password, slug) {
  console.log('\n  ' + etiqueta)
  console.log('  ' + '-'.repeat(72))
  const sb = cliente()
  const { error: eLogin } = await sb.auth.signInWithPassword({ email, password })
  if (eLogin) { console.log('    ✗ login: ' + eLogin.message); return }

  const { data: comps } = await sb.from('companies').select('id, slug')
  const empresa = comps?.find((c) => c.slug === slug)
  if (!empresa) { console.log('    ✗ sin acceso a la empresa ' + slug); await sb.auth.signOut(); return }
  const cid = empresa.id

  const base = () => sb.from('products').select('id, sku, name')
    .eq('company_id', cid).is('deleted_at', null).eq('status', 'active')

  linea('listado sin count', await medir(() =>
    base().order('name').range(0, 49)))

  linea('count exact solo', await medir(() =>
    sb.from('products').select('*', { count: 'exact', head: true })
      .eq('company_id', cid).is('deleted_at', null).eq('status', 'active')))

  const conCount = await medir(() =>
    sb.from('products').select('id, sku, name', { count: 'exact' })
      .eq('company_id', cid).is('deleted_at', null).eq('status', 'active')
      .order('name').range(0, 49))
  linea('listado + count exact', conCount, 'total=' + (conCount.muestra?.count ?? '—'))

  const rpc = await medir(() => sb.rpc('search_products', {
    p_company: cid, p_query: 'punta torx', p_limit: 50, p_offset: 0,
    p_category: null, p_brand: null, p_attrs: null,
  }))
  linea('search_products (RPC)', rpc, 'filas=' + (rpc.muestra?.data?.length ?? '—'))

  await sb.auth.signOut()
}

const main = async () => {
  console.log('═'.repeat(76))
  console.log('  COSTE DE RLS EN EL LISTADO — ' + REPETICIONES + ' repeticiones, se informa la mediana')
  console.log('  ' + new Date().toISOString())
  console.log('═'.repeat(76))

  const jano = process.env.BT_PW_JANO
  const test = process.env.BT_PW_TEST
  if (!jano || !test) { console.error('✗ Faltan BT_PW_JANO / BT_PW_TEST en el entorno'); process.exit(1) }

  await medirRol('admin · Buscatools (interno)', 'buscatools.jano@gmail.com', jano, 'buscatools')
  await medirRol('salesperson · Torquetools (interno)', 'buscatools.jano@gmail.com', jano, 'torquetools')
  await medirRol('distributor · Buscatools (externo)', 'distribuidor.test@buscatools.com.ar', test, 'buscatools')
  await medirRol('customer · Buscatools (externo)', 'cliente.test@buscatools.com.ar', test, 'buscatools')

  console.log('\n  anon (sin sesión)')
  console.log('  ' + '-'.repeat(72))
  const sb = cliente()
  const r = await medir(() => sb.from('products').select('id', { count: 'exact' }).limit(1))
  linea('listado + count exact', r, 'filas=' + (r.muestra?.data?.length ?? 0) + ' (RLS debe bloquear)')

  console.log('\n' + '═'.repeat(76))
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
