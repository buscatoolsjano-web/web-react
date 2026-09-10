/**
 * Fase 5 · Clientes — reconciliación explícita.
 *
 * Cuenta lo que hay contra lo que había que migrar y no redondea nada: si
 * quedan casos ambiguos se dicen, y no se declara «100 %» mientras existan.
 *
 * Incluye la huella histórica de Ventas —md5 de número + total + moneda de los
 * 636 documentos— que tiene que seguir siendo la misma después de cada cambio
 * en `customers`.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/fase5-reconciliacion.mjs <BuscatoolsERP.html> <erp_store.json>
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const HTML = process.argv[2]
const STORE = process.argv[3]

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const normCuit = (s) => (s ?? '').replace(/\D/g, '') || null
const normEmail = (s) => {
  const t = (s ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

async function traerTodo(tabla, select, filtro = (q) => q, orden = 'id') {
  const filas = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await filtro(sb.from(tabla).select(select)).order(orden).range(d, d + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return filas
}

const fila = (etiqueta, esperado, real, ok = esperado === real) =>
  `  ${ok ? '✓' : '✗'} ${String(etiqueta).padEnd(46)} ${String(esperado).padStart(8)}  →  ${String(real).padStart(8)}`

const main = async () => {
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id

  const maestro = HTML
    ? JSON.parse(fs.readFileSync(HTML, 'utf8').match(/<script[^>]*id="clientes-data"[^>]*>([\s\S]*?)<\/script>/)[1])
    : []
  const store = STORE ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : []
  const contactosLegacy = store.find((r) => r.key === 'erp_contactos')?.value ?? []

  const clientes = await traerTodo('customers',
    `id, legal_name, trade_name, tax_id, emails, email_domains, industry, phone,
     legacy_ref, legacy_name, legacy_source, imported_at, needs_review, review_reason, deleted_at`,
    (q) => q.eq('company_id', BT))
  const contactos = await traerTodo('customer_contacts',
    'id, customer_id, full_name, email, role, phone', (q) => q.eq('company_id', BT))

  const porRef = new Map(clientes.filter((c) => c.legacy_ref).map((c) => [c.legacy_ref, c]))

  console.log('='.repeat(86))
  console.log('  FASE 5 · CLIENTES — RECONCILIACIÓN')
  console.log('='.repeat(86))

  // ── Maestro ──────────────────────────────────────────────────────────────
  const conEquivalente = maestro.filter((l) => porRef.has(l.ref))
  const sinEquivalente = maestro.filter((l) => !porRef.has(l.ref))
  const creados = clientes.filter((c) => c.legacy_source === 'maestro_clientes')
  const previos = clientes.filter((c) => !c.imported_at)
  const deContactos = clientes.filter((c) => c.legacy_source === 'erp_contactos')

  console.log('\n  -- MAESTRO DE CLIENTES --                        legacy      base')
  console.log(fila('clientes en el maestro legacy', maestro.length, conEquivalente.length))
  console.log(fila('sin equivalente en la base (no debería haber)', 0, sinEquivalente.length))
  for (const l of sinEquivalente.slice(0, 10)) console.log(`      ! ${l.ref} «${l.nj}»`)
  console.log(`\n  clientes en la base                            ${clientes.length}`)
  console.log(`    · creados desde el maestro                   ${creados.length}`)
  console.log(`    · creados desde la agenda de contactos       ${deContactos.length}`)
  console.log(`    · ya existían (histórico de ventas y demos)  ${previos.length}`)
  console.log(`    · con referencia CLI                         ${clientes.filter((c) => c.legacy_ref).length}`)
  console.log(`    · marcados needs_review                      ${clientes.filter((c) => c.needs_review).length}`)
  const motivos = {}
  for (const c of clientes.filter((x) => x.review_reason)) {
    for (const m of c.review_reason.split(' | ')) motivos[m] = (motivos[m] ?? 0) + 1
  }
  for (const [m, n] of Object.entries(motivos).sort((a, b) => b[1] - a[1])) {
    console.log(`        · ${m.padEnd(34)} ${n}`)
  }
  console.log(`    · borrados (soft delete)                     ${clientes.filter((c) => c.deleted_at).length}`)

  // ── Campo por campo ──────────────────────────────────────────────────────
  console.log('\n  -- CAMPO POR CAMPO (sólo los 988 del maestro) --  legacy      base')
  let lCuit = 0, bCuit = 0, lEmails = 0, bEmails = 0, lDoms = 0, bDoms = 0, lNc = 0, bNc = 0
  let cuitDistinto = 0, emailsFaltantes = 0
  for (const l of maestro) {
    const c = porRef.get(l.ref)
    if (!c) continue
    if (normCuit(l.cif)) { lCuit += 1; if (normCuit(c.tax_id)) bCuit += 1 }
    if (normCuit(l.cif) && normCuit(c.tax_id) && normCuit(l.cif) !== normCuit(c.tax_id)) cuitDistinto += 1
    const le = new Set((l.emails ?? []).map(normEmail).filter(Boolean))
    if (le.size) { lEmails += 1; if ((c.emails ?? []).length) bEmails += 1 }
    const be = new Set((c.emails ?? []).map(normEmail).filter(Boolean))
    for (const e of le) if (!be.has(e)) emailsFaltantes += 1
    if ((l.doms ?? []).length) { lDoms += 1; if ((c.email_domains ?? []).length) bDoms += 1 }
    if ((l.nc ?? '').trim()) { lNc += 1; if ((c.trade_name ?? '').trim()) bNc += 1 }
  }
  // El CUIT es el único campo que no llega al 100 %, y a propósito: `tax_id`
  // tiene índice único por empresa y el maestro legacy repite seis CUIT entre
  // fichas distintas. Al que no se le pudo asignar quedó con `tax_id` vacío y
  // marcado, nunca con el CUIT de otro.
  const sinCuitPorRepetido = clientes.filter(
    (c) => !c.tax_id && (c.review_reason ?? '').includes('CUIT')).length
  console.log(fila('con CUIT', lCuit, bCuit, lCuit - bCuit <= sinCuitPorRepetido))
  if (lCuit !== bCuit) {
    console.log(`        ${lCuit - bCuit} sin asignar por CUIT repetido en el legacy (marcados, no inventados)`)
  }
  console.log(fila('con al menos un email', lEmails, bEmails))
  console.log(fila('con al menos un dominio', lDoms, bDoms))
  console.log(fila('con nombre comercial', lNc, bNc))
  console.log(fila('CUIT distinto al del legacy', 0, cuitDistinto))
  console.log(fila('emails del legacy que no están', 0, emailsFaltantes))
  const conRubro = clientes.filter((c) => (c.industry ?? '').trim())
  console.log(`  · con rubro (el legacy tenía 1 real)             ${conRubro.length}`)

  // ── Contactos ────────────────────────────────────────────────────────────
  console.log('\n  -- CONTACTOS --                                  legacy      base')
  console.log(fila('contactos', contactosLegacy.length, contactos.length))
  console.log(fila('sin customer_id (imposible: es NOT NULL)', 0, contactos.filter((c) => !c.customer_id).length))
  const huerfanos = contactos.filter((c) => !clientes.some((x) => x.id === c.customer_id))
  console.log(fila('apuntando a un cliente que no existe', 0, huerfanos.length))
  console.log(`  · clientes con contactos                        ${new Set(contactos.map((c) => c.customer_id)).size}`)
  console.log(`  · con cargo                                     ${contactos.filter((c) => (c.role ?? '').trim()).length}`)
  console.log(`  · con email                                     ${contactos.filter((c) => (c.email ?? '').trim()).length}`)
  console.log(`  · con teléfono                                  ${contactos.filter((c) => (c.phone ?? '').trim()).length}`)

  // ── Numeración CLI ───────────────────────────────────────────────────────
  const { data: seq } = await sb.from('document_sequences')
    .select('doc_type, series_code, prefix, padding, next_number, is_default')
    .eq('company_id', BT).eq('doc_type', 'customer')
  const refs = clientes.map((c) => Number((c.legacy_ref ?? '').replace('CLI', ''))).filter(Number.isFinite)
  const maxRef = refs.length ? Math.max(...refs) : 0
  const dupRef = clientes.length - new Set(clientes.map((c) => c.legacy_ref ?? c.id)).size
  console.log('\n  -- NUMERACIÓN CLI --')
  for (const s of seq ?? []) {
    console.log(`  · serie ${s.series_code} · prefijo ${s.prefix} · padding ${s.padding} · próximo ${s.next_number} · default ${s.is_default}`)
  }
  console.log(fila('referencias CLI duplicadas', 0, dupRef))
  console.log(fila('próximo número > máximo usado', true, (seq?.[0]?.next_number ?? 0) > maxRef, (seq?.[0]?.next_number ?? 0) > maxRef))
  console.log(`  · máximo CLI en uso                             ${maxRef}`)

  // ── Huella histórica de Ventas ───────────────────────────────────────────
  // La receta es la de Stage 2.5 y no se toca; cambiar un detalle daría otro
  // md5 y la comparación con el valor histórico dejaría de significar nada.
  // En SQL era:
  //
  //   md5(string_agg(original_number||'|'||coalesce(total::text,'')||'|'||
  //                  coalesce(currency_code,''), ',' order by original_number))
  //
  // Dos detalles que hay que respetar para que dé lo mismo desde acá:
  // `total::text` de un numeric(18,4) siempre trae las cuatro decimales —de ahí
  // el `toFixed(4)`, porque JS las comería— y el orden lo pone la base, no
  // `Array.sort()`. Los tres prefijos (COTI, PDV, RT) no se mezclan entre sí,
  // así que ordenar cada tabla y concatenarlas equivale al orden global.
  const docs = []
  for (const tabla of ['sales_quotes', 'sales_orders', 'deliveries']) {
    const f = await traerTodo(tabla, 'original_number, total, currency_code',
      (q) => q, 'original_number')
    for (const d of f) {
      const total = d.total === null || d.total === undefined ? '' : Number(d.total).toFixed(4)
      docs.push(`${d.original_number}|${total}|${d.currency_code ?? ''}`)
    }
  }
  const huella = crypto.createHash('md5').update(docs.join(',')).digest('hex')

  const cuenta = async (t) => (await sb.from(t).select('id', { count: 'exact', head: true })
    .eq('company_id', BT).not('imported_at', 'is', null)).count

  console.log('\n  -- HUELLA HISTÓRICA DE VENTAS --                esperado      real')
  console.log(fila('cotizaciones históricas', 288, await cuenta('sales_quotes')))
  console.log(fila('pedidos históricos', 166, await cuenta('sales_orders')))
  console.log(fila('entregas históricas', 182, await cuenta('deliveries')))
  console.log(fila('documentos históricos', 636, docs.length))
  const esperada = '8091b9166350c5bf2c331b1d882ec654'
  const ok = huella === esperada
  console.log(`  ${ok ? '✓' : '✗'} huella md5
      esperada  ${esperada}
      real      ${huella}`)

  console.log('\n' + '='.repeat(86))
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
