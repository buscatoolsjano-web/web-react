/**
 * Fase 5 · Clientes — migración del maestro completo.
 *
 * Cruza los 988 clientes del maestro legacy contra los que ya están en la
 * base, enriquece los que corresponden y crea los que faltan. Idempotente.
 *
 * Reglas, en este orden y sin excepciones:
 *
 *   1. referencia legacy exacta
 *   2. CUIT exacto
 *   3. email exacto
 *   4. dominio exacto, sólo si identifica a UN cliente
 *   5. nombre normalizado, sólo si el match es inequívoco
 *
 * Si algo queda dudoso —dos candidatos, un CUIT repetido, un conflicto de
 * dato— NO se fusiona ni se pisa nada: se marca `needs_review` y se informa.
 * Enriquecer significa COMPLETAR CAMPOS VACÍOS, nunca reemplazar.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/fase5-migrar-clientes.mjs <index.html> <erp_store.json>   # dry run
 *   node scripts/fase5-migrar-clientes.mjs <index.html> <erp_store.json> --apply
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const HTML = process.argv[2]
const STORE = process.argv[3]
const APLICAR = process.argv.includes('--apply')
if (!HTML) { console.error('Falta el index.html del legacy'); process.exit(1) }

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

// ── Normalización ──────────────────────────────────────────────────────────

/** Para comparar nombres. Saca tildes, puntuación y la forma societaria. */
const normNombre = (s) =>
  (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // «Madexa S.A» y «MADEXA SA» son el mismo cliente, pero la puntuación deja
    // uno como «madexa s a» y el otro como «madexa sa», y la forma societaria
    // sólo se reconoce en el segundo. Juntar las letras sueltas antes de sacarla
    // iguala los dos casos; una letra sola dentro del nombre de una empresa
    // siempre es una inicial, nunca una palabra.
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
    .replace(/\b(s\s?a\s?u|s\s?a\s?c\s?i|s\s?a\s?i\s?c|srl|s\s?r\s?l|sa|sas|sac|ltda|ltd|inc|llc|cia|y\s?cia)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Para comparar CUIT: sólo los dígitos. */
const normCuit = (s) => (s ?? '').replace(/\D/g, '') || null

const normEmail = (s) => {
  const t = (s ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

const normDominio = (s) => (s ?? '').trim().toLowerCase().replace(/^@/, '') || null

/** Dominios que NO identifican a nadie: los tiene medio país. */
const GENERICOS = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.com.ar', 'yahoo.com', 'yahoo.com.ar',
  'outlook.com', 'outlook.com.ar', 'live.com', 'live.com.ar', 'icloud.com',
  'speedy.com.ar', 'fibertel.com.ar', 'arnet.com.ar', 'ciudad.com.ar', 'me.com',
])

// ── Lectura del legacy ─────────────────────────────────────────────────────

function leerMaestro(ruta) {
  const html = fs.readFileSync(ruta, 'utf8')
  const m = html.match(/<script[^>]*id="clientes-data"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('No se encontró el bloque clientes-data en el HTML')
  return JSON.parse(m[1])
}

function leerExtras(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return { extras: {}, contactos: [] }
  const store = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  const v = (k) => store.find((r) => r.key === k)?.value
  return { extras: v('buscatools_clientes_extra') ?? {}, contactos: v('erp_contactos') ?? [] }
}

async function traerTodo(tabla, select, filtro = (q) => q, orden = ['id']) {
  const filas = []
  for (let d = 0; ; d += 1000) {
    let q = filtro(sb.from(tabla).select(select))
    for (const c of orden) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(d, d + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return filas
}

const main = async () => {
  const maestro = leerMaestro(HTML)
  const { extras, contactos } = leerExtras(STORE)
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id

  const clientes = await traerTodo('customers',
    `id, legal_name, trade_name, tax_id, email_domains, emails, phone, industry,
     legacy_ref, legacy_name, needs_review, review_reason, imported_at`,
    (q) => q.eq('company_id', BT), ['legal_name'])

  console.log('='.repeat(78))
  console.log(`  MAESTRO DE CLIENTES  ·  ${APLICAR ? 'APLICAR' : 'DRY RUN (no escribe)'}`)
  console.log('='.repeat(78))
  console.log(`\n  legacy: ${maestro.length} clientes · parches: ${Object.keys(extras).length}`)
  console.log(`  base:   ${clientes.length} clientes · contactos legacy: ${contactos.length}`)

  // ── Índices para el cruce ────────────────────────────────────────────────
  const porRef = new Map()
  const porCuit = new Map()
  const porEmail = new Map()
  const porDominio = new Map()
  const porNombre = new Map()
  const agregar = (mapa, clave, c) => {
    if (!clave) return
    if (!mapa.has(clave)) mapa.set(clave, [])
    mapa.get(clave).push(c)
  }
  for (const c of clientes) {
    agregar(porRef, c.legacy_ref, c)
    agregar(porCuit, normCuit(c.tax_id), c)
    for (const e of c.emails ?? []) agregar(porEmail, normEmail(e), c)
    for (const d of c.email_domains ?? []) {
      const dd = normDominio(d)
      if (dd && !GENERICOS.has(dd)) agregar(porDominio, dd, c)
    }
    for (const n of [c.legal_name, c.trade_name, c.legacy_name]) agregar(porNombre, normNombre(n), c)
  }

  // ── CUIT repetidos dentro del propio maestro ─────────────────────────────
  const vecesCuit = new Map()
  for (const l of maestro) {
    const k = normCuit(l.cif)
    if (k) vecesCuit.set(k, (vecesCuit.get(k) ?? 0) + 1)
  }
  const cuitRepetido = (k) => k !== null && (vecesCuit.get(k) ?? 0) > 1

  // ── Clasificación ────────────────────────────────────────────────────────
  const plan = []
  for (const l of maestro) {
    const cuit = normCuit(l.cif)
    const emails = [...new Set((l.emails ?? []).map(normEmail).filter(Boolean))]
    const dominios = [...new Set((l.doms ?? []).map(normDominio).filter(Boolean))]
    const extra = extras[l.nj] ?? {}

    const item = {
      legacy: l, cuit, emails, dominios, extra,
      cliente: null, via: null, motivos: [],
    }

    const intentar = (mapa, clave, via) => {
      if (item.cliente || !clave) return
      const cand = mapa.get(clave)
      if (!cand) return
      if (cand.length > 1) { item.motivos.push(`AMBIGUO_${via}`); return }
      item.cliente = cand[0]; item.via = via
    }

    intentar(porRef, l.ref, 'REF')
    intentar(porCuit, cuit, 'CUIT')
    for (const e of emails) intentar(porEmail, e, 'EMAIL')
    for (const d of dominios) if (!GENERICOS.has(d)) intentar(porDominio, d, 'DOMINIO')
    if (!item.cliente) {
      const n1 = normNombre(l.nj), n2 = normNombre(l.nc)
      const c1 = n1 ? (porNombre.get(n1) ?? []) : []
      const c2 = n2 && n2 !== n1 ? (porNombre.get(n2) ?? []) : []
      const unicos = [...new Set([...c1, ...c2])]
      if (unicos.length === 1) { item.cliente = unicos[0]; item.via = 'NOMBRE' }
      else if (unicos.length > 1) item.motivos.push('AMBIGUO_NOMBRE')
    }

    if (cuitRepetido(cuit)) item.motivos.push('CUIT_REPETIDO_EN_LEGACY')
    plan.push(item)
  }

  // Un cliente de la base reclamado por más de un legacy.
  //
  // El caso normal es el maestro legacy con varios contactos de la misma
  // empresa: dos fichas distintas caen en el mismo dominio. Ahí nadie se
  // fusiona, porque no hay forma de saber cuál de las dos es «la» empresa.
  //
  // La excepción es la identidad dura. Si de los que reclaman hay UNO SOLO que
  // coincide por referencia legacy o por CUIT exacto, ése gana: su evidencia es
  // la clave primaria del legacy o el número de CUIT, no un parecido. Sin esta
  // regla el resultado ni siquiera es estable —después de escribir el
  // `legacy_ref` en la base, la corrida siguiente encontraba un reclamo más por
  // dominio y desarmaba un match que era exacto— y de ahí salieron tres
  // clientes duplicados que hubo que borrar a mano.
  const FUERTES = ['REF', 'CUIT']
  const reclamantes = new Map()
  for (const i of plan) {
    if (!i.cliente) continue
    if (!reclamantes.has(i.cliente.id)) reclamantes.set(i.cliente.id, [])
    reclamantes.get(i.cliente.id).push(i)
  }
  for (const [, grupo] of reclamantes) {
    if (grupo.length === 1) continue
    let ganador = null
    for (const via of FUERTES) {
      const conEsaVia = grupo.filter((i) => i.via === via)
      if (conEsaVia.length === 1) { ganador = conEsaVia[0]; break }
      if (conEsaVia.length > 1) break // dos refs o dos CUIT iguales: no decide nadie
    }
    for (const i of grupo) {
      if (i === ganador) continue
      i.motivos.push('VARIOS_LEGACY_AL_MISMO_CLIENTE')
      i.cliente = null
      i.via = null
    }
  }

  const conMatch = plan.filter((i) => i.cliente)
  const aCrear = plan.filter((i) => !i.cliente)
  const dudosos = plan.filter((i) => i.motivos.length > 0)

  console.log('\n  -- CRUCE --')
  console.log(`     con equivalente en la base    ${conMatch.length}`)
  for (const via of ['REF', 'CUIT', 'EMAIL', 'DOMINIO', 'NOMBRE']) {
    const n = conMatch.filter((i) => i.via === via).length
    if (n) console.log(`       · por ${via.toLowerCase().padEnd(9)}          ${n}`)
  }
  console.log(`     sin equivalente (se crean)    ${aCrear.length}`)
  console.log(`     con alguna marca de revisión  ${dudosos.length}`)
  const porMotivo = {}
  for (const i of dudosos) for (const m of i.motivos) porMotivo[m] = (porMotivo[m] ?? 0) + 1
  for (const [m, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
    console.log(`       · ${m.padEnd(32)} ${n}`)
  }

  const reclamados = new Set(conMatch.map((i) => i.cliente.id))
  const soloBase = clientes.filter((c) => !reclamados.has(c.id))
  console.log(`     clientes de la base sin legacy ${soloBase.length}`)
  console.log(`       ${soloBase.slice(0, 6).map((c) => c.legal_name).join(' · ')}`)

  // ── Enriquecimiento: sólo campos vacíos ──────────────────────────────────
  const vacio = (v) => v === null || v === undefined || v === '' ||
    (Array.isArray(v) && v.length === 0)

  const enriquecimientos = []
  const conflictos = []
  for (const i of conMatch) {
    const c = i.cliente
    const cambios = {}
    const choques = []

    const proponer = (columna, actual, nuevo) => {
      // La cadena vacía cuenta como "no hay dato": tres de los cuatro parches
      // del legacy tienen rubro:"" y escribirlo sería guardar basura.
      if (nuevo === null || nuevo === undefined || nuevo === '' ||
          (Array.isArray(nuevo) && !nuevo.length)) return
      if (vacio(actual)) { cambios[columna] = nuevo; return }
      const a = Array.isArray(actual) ? [...actual].sort().join('|') : String(actual)
      const b = Array.isArray(nuevo) ? [...nuevo].sort().join('|') : String(nuevo)
      if (a !== b) choques.push(`${columna}: base «${a}» ≠ legacy «${b}»`)
    }

    proponer('trade_name', c.trade_name, (i.legacy.nc ?? '').trim() || null)
    // Un CUIT repetido en el maestro no se propaga: no sabemos cuál es el bueno.
    if (!cuitRepetido(i.cuit)) proponer('tax_id', c.tax_id, (i.legacy.cif ?? '').trim() || null)
    proponer('emails', c.emails, i.emails)
    proponer('email_domains', c.email_domains, i.dominios)
    proponer('legacy_ref', c.legacy_ref, i.legacy.ref ?? null)
    proponer('industry', c.industry, (i.extra.rubro ?? '').trim() || null)
    proponer('phone', c.phone, (i.extra.tel ?? '').trim() || null)

    if (choques.length) conflictos.push({ cliente: c, legacy: i.legacy, choques })

    const motivos = [...i.motivos, ...(choques.length ? ['CONFLICTO_DE_DATO'] : [])]
    if (motivos.length) {
      const yaTiene = (c.review_reason ?? '').split(' | ').filter(Boolean)
      const nuevos = motivos.filter((m) => !yaTiene.includes(m))
      if (nuevos.length) {
        cambios.needs_review = true
        cambios.review_reason = [...yaTiene, ...nuevos].join(' | ')
      }
    }

    if (Object.keys(cambios).length) enriquecimientos.push({ id: c.id, numero: c.legal_name, cambios })
  }

  console.log('\n  -- ENRIQUECIMIENTO (sólo campos vacíos) --')
  console.log(`     clientes a completar          ${enriquecimientos.length}`)
  const porCampo = {}
  for (const e of enriquecimientos) for (const k of Object.keys(e.cambios)) {
    if (k === 'needs_review' || k === 'review_reason') continue
    porCampo[k] = (porCampo[k] ?? 0) + 1
  }
  for (const [k, n] of Object.entries(porCampo).sort((a, b) => b[1] - a[1])) {
    console.log(`       · ${k.padEnd(16)} ${n}`)
  }
  console.log(`     CONFLICTOS (no se pisa nada)  ${conflictos.length}`)
  for (const c of conflictos.slice(0, 8)) {
    console.log(`       ! ${(c.cliente.legal_name ?? '').slice(0, 34).padEnd(36)} ${c.choques[0]}`)
  }

  // ── Altas ────────────────────────────────────────────────────────────────
  const cuitTomado = new Set(clientes.map((c) => normCuit(c.tax_id)).filter(Boolean))
  const refTomada = new Set(clientes.map((c) => c.legacy_ref).filter(Boolean))
  const nuevos = []
  for (const i of aCrear) {
    const motivos = [...i.motivos]
    let cuit = (i.legacy.cif ?? '').trim() || null
    if (cuit && (cuitRepetido(i.cuit) || cuitTomado.has(i.cuit))) {
      motivos.push('CUIT_NO_ASIGNADO')
      cuit = null
    } else if (i.cuit) cuitTomado.add(i.cuit)

    let ref = i.legacy.ref ?? null
    if (ref && refTomada.has(ref)) { motivos.push('REF_DUPLICADA'); ref = null }
    else if (ref) refTomada.add(ref)

    nuevos.push({
      company_id: BT,
      legal_name: (i.legacy.nj ?? '').trim() || (i.legacy.nc ?? '').trim() || '(sin nombre)',
      trade_name: (i.legacy.nc ?? '').trim() || null,
      tax_id: cuit,
      emails: i.emails.length ? i.emails : null,
      // NOT NULL con default '{}': un cliente sin dominios lleva array vacío,
      // no null.
      email_domains: i.dominios,
      phone: (i.extra.tel ?? '').trim() || null,
      industry: (i.extra.rubro ?? '').trim() || null,
      legacy_ref: ref,
      legacy_name: (i.legacy.nj ?? '').trim() || null,
      customer_type: 'business',
      status: 'active',
      imported_at: new Date().toISOString(),
      legacy_source: 'maestro_clientes',
      needs_review: motivos.length > 0,
      review_reason: motivos.length ? motivos.join(' | ') : null,
    })
  }

  console.log('\n  -- ALTAS --')
  console.log(`     clientes a crear              ${nuevos.length}`)
  console.log(`       · con CUIT                  ${nuevos.filter((n) => n.tax_id).length}`)
  console.log(`       · con emails                ${nuevos.filter((n) => n.emails).length}`)
  console.log(`       · con dominios              ${nuevos.filter((n) => n.email_domains).length}`)
  console.log(`       · con nombre comercial      ${nuevos.filter((n) => n.trade_name).length}`)
  console.log(`       · con rubro                 ${nuevos.filter((n) => n.industry).length}`)
  console.log(`       · marcados para revisión    ${nuevos.filter((n) => n.needs_review).length}`)

  if (!APLICAR) {
    console.log('\n  DRY RUN: no se escribió nada.')
    console.log('='.repeat(78))
    return
  }

  // ── Escritura ────────────────────────────────────────────────────────────
  let actualizados = 0
  for (let i = 0; i < enriquecimientos.length; i += 25) {
    await Promise.all(enriquecimientos.slice(i, i + 25).map(async (e) => {
      const { error } = await sb.from('customers').update(e.cambios).eq('id', e.id)
      if (error) throw new Error(`customers ${e.numero}: ${error.message}`)
      actualizados++
    }))
  }

  let creados = 0
  for (let i = 0; i < nuevos.length; i += 100) {
    const lote = nuevos.slice(i, i + 100)
    const { error } = await sb.from('customers').insert(lote)
    if (error) throw new Error(`alta de clientes: ${error.message}`)
    creados += lote.length
  }

  console.log(`\n  clientes enriquecidos            ${actualizados}`)
  console.log(`  clientes creados                 ${creados}`)

  // ── Secuencia de referencia ──────────────────────────────────────────────
  const maxRef = Math.max(
    0,
    ...maestro.map((l) => Number((l.ref ?? '').replace('CLI', ''))).filter(Number.isFinite),
  )
  const { data: seq } = await sb.from('document_sequences').select('next_number')
    .eq('company_id', BT).eq('doc_type', 'customer').maybeSingle()
  if (!seq) {
    const { error } = await sb.from('document_sequences').insert({
      company_id: BT, doc_type: 'customer', series_code: 'CLI', prefix: 'CLI',
      padding: 5, next_number: maxRef + 1, is_default: true,
    })
    if (error) throw new Error(`secuencia de clientes: ${error.message}`)
    console.log(`  secuencia CLI sembrada en        ${maxRef + 1}  (máximo real ${maxRef})`)
  } else {
    console.log(`  secuencia CLI ya existía en      ${seq.next_number}`)
  }

  console.log('='.repeat(78))
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
