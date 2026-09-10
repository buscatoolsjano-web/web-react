/**
 * Fase 6 · Compras — migración del maestro de proveedores.
 *
 * Los 142 proveedores del legacy están EMBEBIDOS en el HTML, no en
 * `localStorage`: la clave `erp_proveedores` no existe en el origen (ver
 * `docs/PHASE_6_COMPRAS_ENTREGA_0.md`). Se leen del bloque
 * `<script id="proveedores-data">`.
 *
 * A diferencia de Clientes, acá NO hay que cruzar nada: Compras es
 * funcionalidad nueva y `suppliers` arrancó vacía. Toda la complicación de
 * matching —CUIT, email, dominio, nombre normalizado— no aplica. La única
 * clave es la referencia legacy, que es única y está bien formada en los 142.
 *
 * Qué NO hace, por decisión explícita:
 *
 *   · No extrae los 22 emails escritos dentro de `notas`. Se migra la nota
 *     entera y el proveedor queda marcado para revisión humana.
 *   · No parte la dirección en calle / localidad / provincia / CP. Se guarda
 *     como texto, igual que en el legacy. Lo único que se separa es el país,
 *     que en los 142 es un código de dos letras exacto.
 *   · No inventa CUIT, email ni actividad: en el legacy los tres están
 *     vacíos en los 142 registros.
 *   · No rellena los 3 huecos de numeración (41, 93, 121).
 *
 * Idempotente: la segunda corrida no crea ni cambia nada.
 *
 *   set -a; source .env.migration; set +a
 *   node scripts/fase6-migrar-proveedores.mjs <BuscatoolsERP.html>            # dry run
 *   node scripts/fase6-migrar-proveedores.mjs <BuscatoolsERP.html> --apply
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const HTML = process.argv[2]
const APLICAR = process.argv.includes('--apply')
if (!HTML) {
  console.error('Falta el HTML del legacy (BuscatoolsERP.html)')
  process.exit(1)
}

const EMPRESA = process.env.COMPANY_ID ?? 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const ORIGEN = 'BuscatoolsERP.html#proveedores-data'

const sb = createClient(
  process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
)

// ── Lectura del legacy ─────────────────────────────────────────────────────

function leerMaestro(ruta) {
  const html = fs.readFileSync(ruta, 'utf8')
  const m = html.match(/<script[^>]*id="proveedores-data"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('No se encontró el bloque proveedores-data en el HTML')
  const j = JSON.parse(m[1].trim())
  if (!Array.isArray(j)) throw new Error('proveedores-data no es un array')
  return j
}

// ── Normalización ──────────────────────────────────────────────────────────

/** Texto que se guarda tal cual, sólo recortado. Vacío es NULL, no ''. */
const texto = (v) => {
  const t = String(v ?? '').trim()
  return t === '' ? null : t
}

/**
 * El país, del último segmento de la dirección.
 *
 * Dos formas, y ninguna otra en los 142:
 *
 *   «AR»                                    → AR
 *   «Direccion: … · Pacheco · … · AR»       → AR
 *
 * La regla es ESTRICTA a propósito: exactamente dos letras mayúsculas. Si
 * alguna vez aparece algo que no encaje, devuelve null y el proveedor queda
 * sin país, que es mejor que un país inventado. No se le saca nada a
 * `address_text`: la dirección se guarda entera, con el país incluido.
 */
function paisDeDireccion(direccion) {
  const d = String(direccion ?? '').trim()
  if (d === '') return null
  const ultimo = d.includes('·') ? d.split('·').pop().trim() : d
  return /^[A-Z]{2}$/.test(ultimo) ? ultimo : null
}

/** ¿Hay un email escrito adentro de la nota? */
const RE_EMAIL = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[a-zA-Z]{2,}/g

function emailsEnNota(notas) {
  const encontrados = String(notas ?? '').match(RE_EMAIL)
  return encontrados ? [...new Set(encontrados.map((e) => e.toLowerCase()))] : []
}

const MOTIVO_EMAIL = 'LEGACY_EMAIL_EN_NOTAS'

/**
 * Un proveedor legacy, en la forma de la tabla.
 *
 * `email` y `activity` salen del campo REAL del legacy, que en los 142 está
 * vacío: quedan en null. No se completan con nada de las notas.
 */
function aFila(p) {
  const emails = emailsEnNota(p.notas)
  return {
    company_id: EMPRESA,
    legacy_ref: texto(p.ref),
    legal_name: texto(p.nj) ?? '(sin nombre)',
    trade_name: texto(p.nc),
    tax_id: texto(p.cif),
    email: texto(p.email),
    phone: texto(p.tel),
    address_text: texto(p.direccion),
    country_code: paisDeDireccion(p.direccion),
    activity: texto(p.actividad),
    agent: texto(p.agente),
    payment_terms: texto(p.formaPago),
    notes: texto(p.notas),
    status: 'active',
    legacy_source: ORIGEN,
    needs_review: emails.length > 0,
    review_reason: emails.length > 0 ? MOTIVO_EMAIL : null,
  }
}

/** Las columnas que la migración maneja. Se comparan una a una. */
const CAMPOS = [
  'legal_name', 'trade_name', 'tax_id', 'email', 'phone', 'address_text',
  'country_code', 'activity', 'agent', 'payment_terms', 'notes', 'status',
  'legacy_source', 'needs_review', 'review_reason',
]

// ── Migración ──────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(74))
  console.log(`  MAESTRO DE PROVEEDORES  ·  ${APLICAR ? 'APLICAR' : 'DRY RUN (no escribe)'}`)
  console.log('='.repeat(74))

  const legacy = leerMaestro(HTML)
  console.log(`\n  Legacy: ${legacy.length} proveedores en ${HTML}`)

  // Integridad del origen ANTES de tocar nada.
  const refs = legacy.map((p) => String(p.ref ?? '').trim())
  const sinRef = refs.filter((r) => r === '').length
  const repetidas = refs.length - new Set(refs).size
  const malFormadas = refs.filter((r) => !/^PROV\d{5}$/.test(r)).length
  console.log(`  Referencias: ${new Set(refs).size} únicas · ${sinRef} vacías · ${repetidas} repetidas · ${malFormadas} mal formadas`)
  if (sinRef > 0 || repetidas > 0 || malFormadas > 0) {
    console.error('\n  ✗ El origen no cumple la precondición: la referencia es la clave.')
    process.exit(1)
  }

  const numeros = refs.map((r) => Number(r.slice(4))).sort((a, b) => a - b)
  const huecos = []
  for (let n = numeros[0]; n <= numeros[numeros.length - 1]; n += 1) {
    if (!numeros.includes(n)) huecos.push(n)
  }
  console.log(`  Numeración: ${refs[0]}…PROV${String(numeros[numeros.length - 1]).padStart(5, '0')} · huecos ${huecos.join(', ')} (NO se rellenan)`)

  // Lo que ya está en la base.
  const { data: existentes, error: eLeer } = await sb
    .from('suppliers')
    .select(['id', 'legacy_ref', ...CAMPOS].join(', '))
    .eq('company_id', EMPRESA)
    .limit(2000)
  if (eLeer) throw new Error(`No se pudo leer suppliers: ${eLeer.message}`)

  const porRef = new Map()
  for (const s of existentes ?? []) if (s.legacy_ref) porRef.set(s.legacy_ref, s)
  console.log(`  Base:   ${(existentes ?? []).length} proveedores (${porRef.size} con referencia legacy)`)

  const aCrear = []
  const aActualizar = []
  const sinCambios = []
  const conflictos = []

  for (const p of legacy) {
    const fila = aFila(p)
    const actual = porRef.get(fila.legacy_ref)
    if (!actual) {
      aCrear.push(fila)
      continue
    }
    const distintos = CAMPOS.filter((c) => (actual[c] ?? null) !== (fila[c] ?? null))
    if (distintos.length === 0) {
      sinCambios.push(fila.legacy_ref)
      continue
    }
    // Un proveedor que ya existe y difiere: se informa qué campos y NO se pisa
    // nada que una persona haya editado. Sólo se completa lo que está vacío.
    const completables = distintos.filter((c) => (actual[c] ?? null) === null)
    const pisaria = distintos.filter((c) => (actual[c] ?? null) !== null)
    if (pisaria.length > 0) {
      conflictos.push({ ref: fila.legacy_ref, campos: pisaria, id: actual.id })
    }
    if (completables.length > 0) {
      const parche = { id: actual.id, ref: fila.legacy_ref, campos: completables }
      for (const c of completables) parche[c] = fila[c]
      aActualizar.push(parche)
    }
  }

  console.log(`\n  A crear:        ${aCrear.length}`)
  console.log(`  A completar:    ${aActualizar.length}`)
  console.log(`  Sin cambios:    ${sinCambios.length}`)
  console.log(`  Con conflicto:  ${conflictos.length}`)
  for (const c of conflictos.slice(0, 20)) {
    console.log(`     ${c.ref}: difiere en ${c.campos.join(', ')} — NO se pisa`)
  }

  if (!APLICAR) {
    console.log('\n  DRY RUN: no se escribió nada. Volvé a correr con --apply.')
    resumen(legacy)
    return
  }

  // ── Escritura ────────────────────────────────────────────────────────────
  //
  // De a 100. El insert NO usa upsert con ON CONFLICT: `uq_suppliers_legacy_ref`
  // es un índice único PARCIAL y PostgREST no puede inferirlo. La idempotencia
  // la da la comparación de arriba, que es explícita y auditable.
  let creados = 0
  for (let i = 0; i < aCrear.length; i += 100) {
    const lote = aCrear.slice(i, i + 100)
    const { error } = await sb.from('suppliers').insert(lote)
    if (error) throw new Error(`Insert falló en el lote ${i / 100 + 1}: ${error.message}`)
    creados += lote.length
    process.stdout.write(`\r  Creando… ${creados}/${aCrear.length}`)
  }
  if (aCrear.length > 0) console.log('')

  let completados = 0
  for (const p of aActualizar) {
    const parche = {}
    for (const c of p.campos) parche[c] = p[c]
    const { error } = await sb.from('suppliers').update(parche).eq('id', p.id)
    if (error) throw new Error(`Update falló en ${p.ref}: ${error.message}`)
    completados += 1
  }

  // `imported_at` se escribe UNA sola vez, en el alta, y no se vuelve a tocar:
  // es la marca de «esto vino del sistema anterior», no la fecha del último
  // script que corrió.
  if (creados > 0) {
    const { error } = await sb
      .from('suppliers')
      .update({ imported_at: new Date().toISOString() })
      .eq('company_id', EMPRESA)
      .eq('legacy_source', ORIGEN)
      .is('imported_at', null)
    if (error) throw new Error(`No se pudo marcar imported_at: ${error.message}`)
  }

  console.log(`\n  Creados: ${creados} · completados: ${completados}`)

  // La secuencia arranca en 146 desde la entrega 1. Se verifica, no se toca:
  // moverla acá sería pisar una decisión ya tomada y probada.
  const { data: seq } = await sb
    .from('document_sequences')
    .select('next_number')
    .eq('company_id', EMPRESA)
    .eq('doc_type', 'supplier')
    .maybeSingle()
  console.log(`  Próxima referencia PROV: ${seq?.next_number ?? '?'} ${seq?.next_number === 146 ? '(correcta)' : '(REVISAR)'}`)

  await reconciliar(legacy)
}

// ── Reconciliación ─────────────────────────────────────────────────────────

function resumen(legacy) {
  console.log('\n  ' + '-'.repeat(70))
  console.log('  LO QUE TRAE EL LEGACY, POR CAMPO')
  console.log('  ' + '-'.repeat(70))
  const con = (f) => legacy.filter((p) => String(p[f] ?? '').trim() !== '').length
  const pares = [
    ['ref → legacy_ref', 'ref'], ['nj → legal_name', 'nj'], ['nc → trade_name', 'nc'],
    ['cif → tax_id', 'cif'], ['email → email', 'email'], ['tel → phone', 'tel'],
    ['direccion → address_text', 'direccion'], ['actividad → activity', 'actividad'],
    ['agente → agent', 'agente'], ['formaPago → payment_terms', 'formaPago'],
    ['notas → notes', 'notas'],
  ]
  for (const [etiqueta, campo] of pares) {
    console.log(`    ${etiqueta.padEnd(28)} ${String(con(campo)).padStart(3)} / ${legacy.length}`)
  }
  const paises = new Map()
  for (const p of legacy) {
    const c = paisDeDireccion(p.direccion) ?? '(sin país)'
    paises.set(c, (paises.get(c) ?? 0) + 1)
  }
  console.log(`    ${'país derivado'.padEnd(28)} ${[...paises].map(([k, v]) => `${k}=${v}`).join(' ')}`)
  const conEmail = legacy.filter((p) => emailsEnNota(p.notas).length > 0)
  const cuantos = conEmail.reduce((a, p) => a + emailsEnNota(p.notas).length, 0)
  console.log(`    ${'emails DENTRO de notas'.padEnd(28)} ${cuantos} en ${conEmail.length} proveedores — NO se extraen`)
}

async function reconciliar(legacy) {
  console.log('\n  ' + '='.repeat(70))
  console.log('  RECONCILIACIÓN')
  console.log('  ' + '='.repeat(70))

  const { data, error } = await sb
    .from('suppliers')
    .select(['id', 'legacy_ref', 'imported_at', 'deleted_at', ...CAMPOS].join(', '))
    .eq('company_id', EMPRESA)
    .limit(2000)
  if (error) throw new Error(`No se pudo releer suppliers: ${error.message}`)
  // La reconciliación mira SÓLO lo migrado. Un proveedor dado de alta a mano
  // —o una fixture de la suite de tests— no es una diferencia contra el
  // legacy; contarlo haría fallar la reconciliación por existir.
  const todas = data ?? []
  const filas = todas.filter((s) => s.legacy_source === ORIGEN)
  const propios = todas.length - filas.length
  const porRef = new Map(filas.filter((s) => s.legacy_ref).map((s) => [s.legacy_ref, s]))

  const cmp = (etiqueta, esperado, real) => {
    const ok = String(esperado) === String(real)
    console.log(`    ${ok ? 'OK  ' : 'FAIL'}  ${etiqueta.padEnd(46)} ${real}${ok ? '' : ` (esperaba ${esperado})`}`)
    return ok
  }

  let fallos = 0
  const chequear = (e, esp, real) => { if (!cmp(e, esp, real)) fallos += 1 }

  console.log('\n  Totales')
  chequear('proveedores legacy', 142, legacy.length)
  chequear('migrados en la base', legacy.length, filas.length)
  chequear('migrados con referencia legacy', legacy.length,
    filas.filter((s) => s.legacy_ref).length)
  console.log(`    ----  dados de alta acá, fuera de la migración: ${propios}`)
  chequear('con imported_at', legacy.length, filas.filter((s) => s.imported_at).length)
  chequear('referencias únicas', legacy.length, new Set(filas.map((s) => s.legacy_ref)).size)
  chequear('dados de baja', 0, filas.filter((s) => s.deleted_at).length)
  chequear('duplicados por razón social', 0,
    filas.length - new Set(filas.map((s) => (s.legal_name ?? '').toUpperCase())).size)

  console.log('\n  Campo a campo, contra el legacy')
  let sinResolver = 0
  const porCampo = new Map()
  for (const p of legacy) {
    const esperada = aFila(p)
    const real = porRef.get(esperada.legacy_ref)
    if (!real) { sinResolver += 1; continue }
    for (const c of CAMPOS) {
      const acc = porCampo.get(c) ?? { iguales: 0, distintos: [], conDato: 0 }
      if ((esperada[c] ?? null) !== null) acc.conDato += 1
      if ((esperada[c] ?? null) === (real[c] ?? null)) acc.iguales += 1
      else acc.distintos.push(esperada.legacy_ref)
      porCampo.set(c, acc)
    }
  }
  for (const c of CAMPOS) {
    const a = porCampo.get(c)
    const etiqueta = `${c} (${a.conDato} con dato)`
    if (!cmp(etiqueta, legacy.length, a.iguales)) {
      fallos += 1
      console.log(`          difieren: ${a.distintos.slice(0, 10).join(', ')}`)
    }
  }
  chequear('sin resolver (legacy sin fila en la base)', 0, sinResolver)

  console.log('\n  Marcas de revisión')
  const conEmailEnNota = legacy.filter((p) => emailsEnNota(p.notas).length > 0).length
  chequear('marcados LEGACY_EMAIL_EN_NOTAS', conEmailEnNota,
    filas.filter((s) => s.review_reason === MOTIVO_EMAIL).length)
  chequear('needs_review coincide', conEmailEnNota, filas.filter((s) => s.needs_review).length)
  chequear('emails migrados al campo email', 0, filas.filter((s) => s.email).length)
  chequear('CUIT migrados', 0, filas.filter((s) => s.tax_id).length)
  chequear('actividades migradas', 0, filas.filter((s) => s.activity).length)

  console.log('\n  País')
  const paises = new Map()
  for (const s of filas) paises.set(s.country_code ?? '(null)', (paises.get(s.country_code ?? '(null)') ?? 0) + 1)
  console.log(`    ${[...paises].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  chequear('sin país', 0, filas.filter((s) => !s.country_code).length)

  console.log('\n  ' + '='.repeat(70))
  console.log(`  ${fallos === 0 ? 'RECONCILIACIÓN COMPLETA: 0 diferencias' : `RECONCILIACIÓN CON ${fallos} DIFERENCIA(S)`}`)
  console.log('  ' + '='.repeat(70))
  if (fallos > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('\n✗', e.message)
  process.exit(1)
})
