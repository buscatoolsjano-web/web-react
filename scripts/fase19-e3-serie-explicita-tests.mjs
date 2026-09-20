/**
 * Fase 19 · E3 — Serie explícita en `crear_cotizacion` y `series_de_documento`.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase19-e3-serie-explicita-tests.mjs
 *
 * Todo lo que ESCRIBE pasa en empresas fixture `zz-e3s`, nunca en Buscatools.
 * De producción sólo se leen invariantes.
 *
 * A · sin series_code → la conducta de siempre (serie por defecto)
 * B · serie STEL explícita → bloqueada
 * C · serie ERP explícita → permitida
 * D · serie inexistente → SERIE_INVALIDA
 * E · serie de otra empresa → SERIE_INVALIDA
 * F · serie de otro doc_type → SERIE_INVALIDA
 * G · anónimo → rechazado
 * H · salesperson → SIN_PERMISO
 * I · employee y admin → pueden
 * J · dos altas concurrentes → dos números distintos, sin huecos
 * K · la secuencia de la serie por defecto no se mueve al crear en otra
 * L · la autoridad no cambia por crear
 * M · un insert directo con serie STEL lo sigue frenando el trigger
 * N · sólo se ven las series de la propia empresa
 * O · otra empresa no puede consultarlas
 * P · anónimo rechazado
 * Q · doc_type inválido rechazado
 * R/S · la autoridad efectiva que devuelve la función (y la real de producción)
 * T · exactamente una serie por defecto para quote
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const BUSCATOOLS = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e3s'
const creados = { usuarios: [], empresas: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

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
    const quotes = (await s.from('sales_quotes').select('id').in('company_id', ids)).data ?? []
    if (quotes.length) await s.from('sales_quote_lines').delete().in('quote_id', quotes.map((q) => q.id))
    for (const t of ['sales_audit', 'sales_quotes', 'document_numbering_authority_series',
                     'document_numbering_authority', 'document_sequences',
                     'company_memberships', 'customers']) {
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

/** Llama al alta y devuelve `{ ok, codigo }` sin romper el script. */
const crear = async (cliente, companyId, cabecera, lineas = [{ quantity: 1, unit_price: 10 }]) => {
  const r = await cliente.rpc('crear_cotizacion', {
    p_company: companyId, p_cabecera: cabecera, p_lineas: lineas,
  })
  if (r.error) return { ok: false, codigo: r.error.message }
  return { ok: true, datos: r.data }
}

async function main() {
  console.log('\n═══ Fase 19 · E3 — Serie explícita ═══')
  await barrerRestos()

  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E3S Alfa', legal_name: 'ZZ E3S Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa A').id
  creados.empresas.push(A)
  const B = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ E3S Beta', legal_name: 'ZZ E3S Beta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B').id
  creados.empresas.push(B)

  // La empresa A imita a Buscatools: autoridad general STEL, serie por defecto
  // que cae en STEL, y una serie piloto en ERP.
  ok(await s.from('document_sequences').insert([
    { company_id: A, doc_type: 'quote', series_code: 'ZZDEF', prefix: 'ZZDEF', padding: 5, next_number: 1, is_default: true },
    { company_id: A, doc_type: 'quote', series_code: 'ZZERP', prefix: 'ZZERP', padding: 5, next_number: 1, is_default: false },
    { company_id: A, doc_type: 'delivery', series_code: 'ZZREM', prefix: 'ZZREM', padding: 5, next_number: 1, is_default: true },
    { company_id: B, doc_type: 'quote', series_code: 'ZZOTRA', prefix: 'ZZOTRA', padding: 5, next_number: 1, is_default: true },
  ]), 'secuencias')
  ok(await s.from('document_numbering_authority').insert(
    { company_id: A, doc_type: 'quote', authority: 'STEL', reason: 'fixture' },
  ), 'autoridad general A')
  ok(await s.from('document_numbering_authority_series').insert(
    { company_id: A, doc_type: 'quote', series_code: 'ZZERP', authority: 'ERP', reason: 'fixture piloto' },
  ), 'autoridad de serie A')

  const admin = await usuarioTemporal(A, 'admin')
  const employee = await usuarioTemporal(A, 'employee')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const adminB = await usuarioTemporal(B, 'admin')

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E3S Cliente', customer_type: 'business', status: 'active',
  }).select('id').single(), 'cliente').id

  const base = { customer_id: cliente, currency_code: 'USD' }

  // ── A · sin series_code ─────────────────────────────────────────────────
  seccion('A · sin series_code: la conducta de siempre')
  const a = await crear(admin.c, A, { ...base })
  cmp('toma la serie por defecto y la autoridad la bloquea', true,
    !a.ok && /external_numbering_authority|autoridad/i.test(a.codigo))

  // ── B · serie STEL explícita ────────────────────────────────────────────
  seccion('B · serie STEL pedida explícitamente')
  const b = await crear(admin.c, A, { ...base, series_code: 'ZZDEF' })
  cmp('pedirla por nombre no la desbloquea', true,
    !b.ok && /external_numbering_authority|autoridad/i.test(b.codigo))

  // ── C · serie ERP explícita ─────────────────────────────────────────────
  seccion('C · serie ERP pedida explícitamente')
  const c = await crear(admin.c, A, { ...base, series_code: 'ZZERP' })
  cmp('se crea', true, c.ok === true)
  if (c.ok) {
    const doc = ok(await s.from('sales_quotes').select('number, series_code, status').eq('id', c.datos.id).single(), 'doc')
    cmp('con la serie pedida', 'ZZERP', doc.series_code)
    cmp('y el número de ESA serie', 'ZZERP00001', doc.number)
    cmp('nace en borrador', 'draft', doc.status)
  }

  // ── D/E/F · series que no corresponden ──────────────────────────────────
  seccion('D · E · F — series que no corresponden')
  const d = await crear(admin.c, A, { ...base, series_code: 'NO-EXISTE' })
  cmp('inexistente → SERIE_INVALIDA', true, !d.ok && /SERIE_INVALIDA/.test(d.codigo))
  const e = await crear(admin.c, A, { ...base, series_code: 'ZZOTRA' })
  cmp('de otra empresa → SERIE_INVALIDA', true, !e.ok && /SERIE_INVALIDA/.test(e.codigo))
  const f = await crear(admin.c, A, { ...base, series_code: 'ZZREM' })
  cmp('de otro doc_type → SERIE_INVALIDA', true, !f.ok && /SERIE_INVALIDA/.test(f.codigo))

  // ── G/H/I · permisos ────────────────────────────────────────────────────
  seccion('G · H · I — permisos, sin cambios')
  const g = await crear(sesion(), A, { ...base, series_code: 'ZZERP' })
  cmp('anónimo rechazado', true, !g.ok)
  const h = await crear(vendedor.c, A, { ...base, series_code: 'ZZERP' })
  cmp('salesperson → SIN_PERMISO', true, !h.ok && /SIN_PERMISO/.test(h.codigo))
  const i = await crear(employee.c, A, { ...base, series_code: 'ZZERP' })
  cmp('employee puede', true, i.ok === true)
  const iB = await crear(adminB.c, A, { ...base, series_code: 'ZZERP' })
  cmp('admin de otra empresa no puede', true, !iB.ok && /SIN_PERMISO/.test(iB.codigo))

  // ── J · concurrencia ────────────────────────────────────────────────────
  seccion('J · dos altas a la vez')
  const [j1, j2] = await Promise.all([
    crear(admin.c, A, { ...base, series_code: 'ZZERP' }),
    crear(employee.c, A, { ...base, series_code: 'ZZERP' }),
  ])
  cmp('las dos se crean', true, j1.ok === true && j2.ok === true)
  if (j1.ok && j2.ok) {
    const nums = ok(await s.from('sales_quotes').select('number').in('id', [j1.datos.id, j2.datos.id]), 'nums')
      .map((x) => x.number).sort()
    cmp('con números distintos', 2, new Set(nums).size)
  }
  const sec = ok(await s.from('document_sequences').select('next_number')
    .eq('company_id', A).eq('doc_type', 'quote').eq('series_code', 'ZZERP').single(), 'secuencia ZZERP')
  const creadas = ok(await s.from('sales_quotes').select('id', { count: 'exact', head: false }).eq('company_id', A), 'creadas')
  cmp('la secuencia avanzó exactamente una vez por documento', creadas.length + 1, sec.next_number)

  // ── K/L · lo que no se movió ────────────────────────────────────────────
  seccion('K · L — lo que no se movió')
  const secDef = ok(await s.from('document_sequences').select('next_number')
    .eq('company_id', A).eq('doc_type', 'quote').eq('series_code', 'ZZDEF').single(), 'secuencia ZZDEF')
  cmp('la serie por defecto sigue en 1', 1, secDef.next_number)
  const aut = ok(await s.from('document_numbering_authority').select('authority')
    .eq('company_id', A).eq('doc_type', 'quote').single(), 'autoridad')
  cmp('la autoridad general sigue STEL', 'STEL', aut.authority)

  // ── M · el trigger sigue cuidando la puerta de atrás ────────────────────
  seccion('M · insert directo con serie STEL')
  const directo = await admin.c.from('sales_quotes').insert({
    company_id: A, number: 'ZZDEF99999', series_code: 'ZZDEF', status: 'draft',
    customer_id: cliente, currency_code: 'USD', quote_date: '2026-09-20',
  })
  cmp('el trigger lo frena aunque no pase por la RPC', true, directo.error !== null)

  // ── N…T · series_de_documento ───────────────────────────────────────────
  seccion('N · O · P · Q — series_de_documento: quién puede y qué ve')
  const propias = await admin.c.rpc('series_de_documento', { p_company: A, p_doc_type: 'quote' })
  cmp('ve las series de su empresa', 2, (propias.data ?? []).length)
  cmp('y ninguna de la otra', 0, (propias.data ?? []).filter((x) => x.series_code === 'ZZOTRA').length)

  const ajena = await adminB.c.rpc('series_de_documento', { p_company: A, p_doc_type: 'quote' })
  cmp('otra empresa no puede consultarlas', true, ajena.error !== null)

  const anon = await sesion().rpc('series_de_documento', { p_company: A, p_doc_type: 'quote' })
  cmp('anónimo rechazado', true, anon.error !== null)

  const malTipo = await admin.c.rpc('series_de_documento', { p_company: A, p_doc_type: 'purchase_order' })
  cmp('doc_type de otro módulo rechazado', true, malTipo.error !== null && /DOC_TYPE_INVALIDO/.test(malTipo.error.message))
  const sinTipo = await admin.c.rpc('series_de_documento', { p_company: A, p_doc_type: '' })
  cmp('doc_type vacío rechazado', true, sinTipo.error !== null)

  seccion('R · S · T — autoridad efectiva y serie por defecto')
  const porCodigo = Object.fromEntries((propias.data ?? []).map((x) => [x.series_code, x]))
  cmp('la serie sin fila propia hereda la general (STEL)', 'STEL', porCodigo['ZZDEF']?.authority)
  cmp('la serie con fila propia manda (ERP)', 'ERP', porCodigo['ZZERP']?.authority)
  cmp('la serie por defecto viene marcada', true, porCodigo['ZZDEF']?.is_default === true)
  cmp('exactamente una por defecto', 1, (propias.data ?? []).filter((x) => x.is_default).length)

  // Y lo mismo, sobre los datos REALES de Buscatools (sólo lectura).
  const seqBT = ok(await s.from('document_sequences').select('series_code, is_default, next_number')
    .eq('company_id', BUSCATOOLS).eq('doc_type', 'quote').order('series_code'), 'secuencias BT')
  const autBT = ok(await s.from('document_numbering_authority').select('authority')
    .eq('company_id', BUSCATOOLS).eq('doc_type', 'quote').single(), 'autoridad BT')
  const serBT = ok(await s.from('document_numbering_authority_series').select('series_code, authority')
    .eq('company_id', BUSCATOOLS).eq('doc_type', 'quote'), 'series BT')
  const efectiva = (codigo) =>
    serBT.find((x) => x.series_code === codigo)?.authority ?? autBT.authority
  cmp('producción: COTI resuelve STEL', 'STEL', efectiva('COTI'))
  cmp('producción: COT-ERP resuelve ERP', 'ERP', efectiva('COT-ERP'))
  cmp('producción: exactamente una serie por defecto', 1, seqBT.filter((x) => x.is_default).length)
  cmp('producción: la serie por defecto es COTI', 'COTI', seqBT.find((x) => x.is_default)?.series_code)

  // ── Producción intacta ──────────────────────────────────────────────────
  seccion('Producción')
  cmp('COTI sigue en 2630', 2630, seqBT.find((x) => x.series_code === 'COTI')?.next_number)
  // COT-ERP sí se mueve: es la serie del piloto. Lo que NO se puede mover es
  // la productiva, así que se afirma eso y no un número que cambia.
  const cotiProd = (await s.from('sales_quotes').select('id', { count: 'exact', head: true })
    .eq('company_id', BUSCATOOLS).eq('series_code', 'COTI')).count
  cmp('las cotizaciones de la serie COTI siguen siendo 306', 306, cotiProd)
  const cotErpProd = (await s.from('sales_quotes').select('id', { count: 'exact', head: true })
    .eq('company_id', BUSCATOOLS).eq('series_code', 'COT-ERP')).count
  cmp('la serie piloto tiene exactamente el documento que se creó a mano', 1, cotErpProd)
  cmp('y la secuencia quedó una posición adelante', cotErpProd + 1,
    seqBT.find((x) => x.series_code === 'COT-ERP')?.next_number)
}

main()
  .catch((e) => { fallos++; console.error(`\n  ERROR: ${e.message}`) })
  .finally(async () => {
    await limpiar()
    // La limpieza se comprueba a sí misma: en la primera corrida se dio por
    // buena y había dejado una cotización fixture viva. Un script que dice
    // «todo en verde» mientras ensucia la base es peor que uno que falla.
    const { data: sobran } = await s.from('companies').select('slug').like('slug', MARCA + '-%')
    if ((sobran ?? []).length > 0) {
      fallos++
      console.log(`\n    FAIL  la limpieza dejó ${sobran.length} empresa(s)`)
    } else {
      console.log('\n    PASS  no quedó nada del fixture')
    }
    console.log(fallos === 0 ? '\n  ✓ TODO EN VERDE\n' : `\n  ✗ ${fallos} FALLO(S)\n`)
    process.exit(fallos === 0 ? 0 : 1)
  })
