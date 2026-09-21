/**
 * Fase 19 · E4 — La revisión histórica contra el dato de hoy.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase19-e4-revision-tests.mjs
 *
 * Todo lo que ESCRIBE pasa en una empresa fixture `zz-e4r`, nunca en
 * Buscatools. De producción SÓLO se lee.
 *
 * A · MISSING_CURRENCY con moneda      → RESOLVED_BY_CURRENT_DATA
 * B · NO_EXCHANGE_RATE sin tipo de cambio → STILL_TRUE
 * C · TOTALS_DO_NOT_CLOSE que cierra   → RESOLVED_BY_CURRENT_DATA
 * D · TOTALS_DO_NOT_CLOSE que no cierra → STILL_TRUE
 * E · TOTALS_DO_NOT_CLOSE sin líneas   → UNVERIFIABLE (nunca «resuelto»)
 * F · NO_QUOTE_LINK con cotización     → RESOLVED_BY_CURRENT_DATA
 * G · UNRESOLVED_SKU con una línea sin producto → STILL_TRUE
 * H · NO_ORDER_LINK con pedido         → RESOLVED_BY_CURRENT_DATA
 * I · DELIVERED_BY_ARRAY_INDEX         → UNVERIFIABLE
 * J · documento sin motivos            → no pide atención
 * K · el contador del informe cuenta atención de HOY, no la foto
 * L · RLS: otra empresa no ve nada; anónimo tampoco
 * M · producción (sólo lectura): PDV01315 y los totales del mes
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const BUSCATOOLS = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const PILOTO_PEDIDO = 'PDV01315'

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const cmpArr = (t, esperado, real) => cmp(t, JSON.stringify(esperado), JSON.stringify([...(real ?? [])].sort()))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }

const MARCA = 'zz-e4r'
const creados = { usuarios: [], empresas: [] }

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
    // Un documento histórico no se borra: es la regla que protege lo migrado.
    // El fixture se marca como importado para poder tener totales que no
    // cierran, así que primero deja de serlo y recién después se borra.
    for (const t of ['sales_orders', 'sales_quotes', 'deliveries']) {
      await s.from(t).update({ imported_at: null }).in('company_id', ids).not('imported_at', 'is', null)
    }
    const pedidos = (await s.from('sales_orders').select('id').in('company_id', ids)).data ?? []
    if (pedidos.length) await s.from('sales_order_lines').delete().in('order_id', pedidos.map((x) => x.id))
    const cotis = (await s.from('sales_quotes').select('id').in('company_id', ids)).data ?? []
    if (cotis.length) await s.from('sales_quote_lines').delete().in('quote_id', cotis.map((x) => x.id))
    for (const t of ['sales_audit', 'deliveries', 'sales_orders', 'sales_quotes',
                     'document_numbering_authority_series', 'document_numbering_authority',
                     'document_sequences', 'company_memberships', 'customers']) {
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

/** La fila de la vista para un documento, leída con la sesión que se pase. */
const revision = async (cliente, docType, id) => {
  const r = await cliente
    .from('revision_de_documentos')
    .select('historical_reasons, active_reasons, resolved_since_migration, unverifiable_reasons, requires_attention_now')
    .eq('doc_type', docType).eq('document_id', id).maybeSingle()
  if (r.error) throw new Error(`revisión ${docType}: ${r.error.message}`)
  return r.data
}

async function main() {
  console.log('\n═══ Fase 19 · E4 — Revisión histórica vs. dato de hoy ═══')
  await barrerRestos()

  const sello = Date.now()
  // El informe corta por la fecha de Buenos Aires: si el fixture usa la de
  // UTC, después de las 21 h los documentos quedan «mañana» y no se cuentan.
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const Z = ok(await s.from('companies').insert({
    slug: `${MARCA}-z-${sello}`, name: 'ZZ E4R Zeta', legal_name: 'ZZ E4R Zeta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa Z').id
  creados.empresas.push(Z)
  const OTRA = ok(await s.from('companies').insert({
    slug: `${MARCA}-o-${sello}`, name: 'ZZ E4R Otra', legal_name: 'ZZ E4R Otra SA', default_currency: 'USD',
  }).select('id').single(), 'empresa otra').id
  creados.empresas.push(OTRA)

  const cliente = ok(await s.from('customers').insert({
    company_id: Z, legal_name: 'ZZ E4R Cliente',
  }).select('id').single(), 'cliente').id

  // ── Los documentos, uno por caso ────────────────────────────────────────
  const quote = async (n, extra) => ok(await s.from('sales_quotes').insert({
    company_id: Z, number: n, customer_id: cliente, quote_date: hoy, status: 'sent',
    needs_review: true, ...extra,
  }).select('id').single(), `cotización ${n}`).id
  const order = async (n, extra) => ok(await s.from('sales_orders').insert({
    company_id: Z, number: n, customer_id: cliente, order_date: hoy, commercial_status: 'confirmed',
    needs_review: true, ...extra,
  }).select('id').single(), `pedido ${n}`).id

  // A · tiene moneda: el aviso ya no aplica.
  const qA = await quote('ZZE4-Q-A', { currency_code: 'USD', review_reason: 'MISSING_CURRENCY' })
  // B · sigue sin tipo de cambio.
  const qB = await quote('ZZE4-Q-B', { currency_code: 'USD', review_reason: 'NO_EXCHANGE_RATE' })
  // C · los totales cierran con la fórmula del ERP: 2 × 100 al 21 %.
  const oC = await order('ZZE4-O-C', {
    currency_code: 'USD', review_reason: 'TOTALS_DO_NOT_CLOSE',
    subtotal: 200, tax_amount: 42, total: 242,
  })
  ok(await s.from('sales_order_lines').insert({
    company_id: Z, order_id: oC, line_no: 1, quantity_ordered: 2, unit_price: 100,
    tax_rate_snapshot: 21, line_type: 'item', product_id: null,
  }), 'línea C')
  // D · los totales NO cierran. Sólo un documento MIGRADO puede tener una
  // cabecera así: en lo que nace en el ERP, el trigger de totales la recalcula.
  // Por eso lleva `imported_at`, igual que los 171 pedidos de producción.
  const oD = await order('ZZE4-O-D', {
    currency_code: 'USD', review_reason: 'TOTALS_DO_NOT_CLOSE',
    subtotal: 200, tax_amount: 42, total: 999, imported_at: new Date().toISOString(),
  })
  ok(await s.from('sales_order_lines').insert({
    company_id: Z, order_id: oD, line_no: 1, quantity_ordered: 2, unit_price: 100,
    tax_rate_snapshot: 21, line_type: 'item', product_id: null,
  }), 'línea D')
  // E · sin líneas no hay con qué comprobar.
  const oE = await order('ZZE4-O-E', {
    currency_code: 'USD', review_reason: 'TOTALS_DO_NOT_CLOSE', subtotal: 100, tax_amount: 21, total: 121,
  })
  // F · ahora sí tiene cotización de origen, y además moneda.
  const oF = await order('ZZE4-O-F', {
    currency_code: 'USD', quote_id: qA, review_reason: 'MISSING_CURRENCY | NO_QUOTE_LINK',
  })
  // G · una línea sin producto: el aviso sigue siendo cierto.
  const oG = await order('ZZE4-O-G', { currency_code: 'USD', review_reason: 'UNRESOLVED_SKU:1' })
  ok(await s.from('sales_order_lines').insert({
    company_id: Z, order_id: oG, line_no: 1, quantity_ordered: 1, unit_price: 50,
    tax_rate_snapshot: 21, line_type: 'item', product_id: null,
  }), 'línea G')
  // H · el remito ya tiene su pedido.
  const dH = ok(await s.from('deliveries').insert({
    company_id: Z, number: 'ZZE4-D-H', customer_id: cliente, delivery_date: hoy, status: 'draft',
    needs_review: true, currency_code: 'USD', order_id: oC, review_reason: 'NO_ORDER_LINK',
  }).select('id').single(), 'remito H').id
  // I · cómo se migró: no se resuelve mirando el documento.
  const dI = ok(await s.from('deliveries').insert({
    company_id: Z, number: 'ZZE4-D-I', customer_id: cliente, delivery_date: hoy, status: 'draft',
    needs_review: true, currency_code: 'USD', review_reason: 'DELIVERED_BY_ARRAY_INDEX',
  }).select('id').single(), 'remito I').id
  // J · nunca se marcó.
  const qJ = await quote('ZZE4-Q-J', { currency_code: 'USD', needs_review: false, review_reason: null })

  const admin = await usuarioTemporal(Z, 'admin')
  const ajena = await usuarioTemporal(OTRA, 'admin')

  // ── A–J · la clasificación ──────────────────────────────────────────────
  seccion('A–J · cada motivo, contra el dato de hoy')
  const rA = await revision(admin.c, 'quote', qA)
  cmpArr('A · MISSING_CURRENCY con moneda → resuelto', ['MISSING_CURRENCY'], rA.resolved_since_migration)
  cmp('A · y deja de pedir atención', false, rA.requires_attention_now)

  const rB = await revision(admin.c, 'quote', qB)
  cmpArr('B · NO_EXCHANGE_RATE sin tipo de cambio → activo', ['NO_EXCHANGE_RATE'], rB.active_reasons)
  cmp('B · pide atención', true, rB.requires_attention_now)

  const rC = await revision(admin.c, 'sales_order', oC)
  cmpArr('C · totales que cierran → resuelto', ['TOTALS_DO_NOT_CLOSE'], rC.resolved_since_migration)

  const rD = await revision(admin.c, 'sales_order', oD)
  cmpArr('D · totales que no cierran → activo', ['TOTALS_DO_NOT_CLOSE'], rD.active_reasons)

  const rE = await revision(admin.c, 'sales_order', oE)
  cmpArr('E · sin líneas → no verificable', ['TOTALS_DO_NOT_CLOSE'], rE.unverifiable_reasons)
  cmpArr('E · y NUNCA resuelto', [], rE.resolved_since_migration)
  cmp('E · falta de evidencia sigue pidiendo atención', true, rE.requires_attention_now)

  const rF = await revision(admin.c, 'sales_order', oF)
  cmpArr('F · moneda y cotización presentes → los dos resueltos',
    ['MISSING_CURRENCY', 'NO_QUOTE_LINK'], rF.resolved_since_migration)
  cmp('F · no pide atención', false, rF.requires_attention_now)

  const rG = await revision(admin.c, 'sales_order', oG)
  cmpArr('G · una línea sin producto → activo', ['UNRESOLVED_SKU'], rG.active_reasons)
  cmp('G · el detalle del motivo (`:1`) no se muestra', 'UNRESOLVED_SKU', rG.historical_reasons[0])

  const rH = await revision(admin.c, 'delivery', dH)
  cmpArr('H · NO_ORDER_LINK con pedido → resuelto', ['NO_ORDER_LINK'], rH.resolved_since_migration)

  const rI = await revision(admin.c, 'delivery', dI)
  cmpArr('I · cómo se migró → no verificable', ['DELIVERED_BY_ARRAY_INDEX'], rI.unverifiable_reasons)

  const rJ = await revision(admin.c, 'quote', qJ)
  cmpArr('J · sin motivos → nada histórico', [], rJ.historical_reasons)
  cmp('J · y no pide atención', false, rJ.requires_attention_now)

  // ── K · el contador ─────────────────────────────────────────────────────
  seccion('K · el informe cuenta la atención de HOY, no la foto de la migración')
  // El informe cuenta cotizaciones no-borrador, pedidos confirmados y remitos
  // despachados: los dos remitos del fixture están en borrador y quedan afuera.
  const marcados = [qA, qB, qJ, oC, oD, oE, oF, oG].length
  const conAtencion = [qB, oD, oE, oG].length
  const inf = await admin.c.rpc('informe_actividad_comercial', { p_company: Z, p_mes: null })
  if (inf.error) FAIL('K · el informe responde', inf.error.message)
  else {
    const actual = (inf.data ?? []).filter((f) => f.periodo === 'actual')
    const enRevision = actual.reduce((t, f) => t + Number(f.en_revision), 0)
    const documentos = actual.reduce((t, f) => t + Number(f.documentos), 0)
    cmp('K · documentos del mes', marcados, documentos)
    cmp(`K · en revisión = los que piden atención (marcados: ${marcados})`, conAtencion, enRevision)
  }

  // ── L · RLS ─────────────────────────────────────────────────────────────
  seccion('L · la vista no es una puerta')
  const propias = ok(await admin.c.from('revision_de_documentos').select('document_id, company_id'), 'propias')
  cmp('L · el admin ve sus documentos', 10, propias.length)
  cmp('L · y ninguno de otra empresa', 0, propias.filter((x) => x.company_id !== Z).length)

  const desdeOtra = ok(await ajena.c.from('revision_de_documentos').select('document_id').eq('company_id', Z), 'otra')
  cmp('L · otra empresa no ve los de Z', 0, desdeOtra.length)

  const anon = sesion()
  const rAnon = await anon.from('revision_de_documentos').select('document_id').limit(1)
  cmp('L · anónimo no lee nada', 0, (rAnon.data ?? []).length)

  const buscatoolsDesdeZ = ok(
    await admin.c.from('revision_de_documentos').select('document_id').eq('company_id', BUSCATOOLS), 'buscatools')
  cmp('L · y tampoco ve producción', 0, buscatoolsDesdeZ.length)

  // ── M · producción, sólo lectura ────────────────────────────────────────
  seccion('M · producción (sólo lectura)')
  const piloto = ok(await s.from('revision_de_documentos')
    .select('numero, active_reasons, resolved_since_migration, unverifiable_reasons, requires_attention_now')
    .eq('company_id', BUSCATOOLS).eq('numero', PILOTO_PEDIDO).maybeSingle(), PILOTO_PEDIDO)
  if (!piloto) FAIL(`M · ${PILOTO_PEDIDO} existe`)
  else {
    cmpArr(`M · ${PILOTO_PEDIDO}: el de totales sigue activo`, ['TOTALS_DO_NOT_CLOSE'], piloto.active_reasons)
    cmpArr(`M · ${PILOTO_PEDIDO}: los otros tres ya no aplican`,
      ['MISSING_CURRENCY', 'NO_QUOTE_LINK', 'UNRESOLVED_SKU'], piloto.resolved_since_migration)
    cmp(`M · ${PILOTO_PEDIDO}: sigue pidiendo atención`, true, piloto.requires_attention_now)
  }

  const todos = ok(await s.from('revision_de_documentos')
    .select('marked_in_migration, historical_reasons, unverifiable_reasons, requires_attention_now')
    .eq('company_id', BUSCATOOLS), 'producción')
  const historico = todos.filter((d) => d.marked_in_migration).length
  const atencion = todos.filter((d) => d.requires_attention_now).length
  const soloHistoria = todos.filter((d) => d.historical_reasons.length > 0 && !d.requires_attention_now).length
  const noVerificables = todos.filter((d) => d.unverifiable_reasons.length > 0).length
  console.log(`    documentos: ${todos.length} · marcados en la migración: ${historico}`)
  console.log(`    piden atención hoy: ${atencion} · sólo historia: ${soloHistoria} · con algo no verificable: ${noVerificables}`)
  cmp('M · la atención de hoy nunca supera a la foto', true, atencion <= historico)
  cmp('M · marcado + resuelto del todo = sólo historia', historico - atencion, soloHistoria)
  cmp('M · ningún documento sin motivos pide atención', 0,
    todos.filter((d) => d.historical_reasons.length === 0 && d.requires_attention_now).length)

  // ── Limpieza ────────────────────────────────────────────────────────────
  seccion('Limpieza')
  await limpiar()
  const quedan = ok(await s.from('companies').select('id').like('slug', `${MARCA}-%`), 'restos')
  cmp('no quedó nada del fixture', 0, quedan.length)
  const cotisProd = ok(await s.from('sales_quotes').select('id', { count: 'exact', head: true })
    .eq('company_id', BUSCATOOLS), 'cotizaciones')
  console.log(`    producción intacta: ${cotisProd?.length ?? ''}`)

  console.log(`\n${fallos === 0 ? '  ✓ TODO EN VERDE' : `  ✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ error:', e.message)
  await limpiar().catch(() => {})
  process.exit(1)
})
