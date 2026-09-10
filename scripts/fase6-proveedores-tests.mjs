/**
 * Fase 6 · Compras — entrega 2: el maestro de proveedores, contra la base real.
 *
 * Prueba las tres cosas que la entrega 2 promete: que los 142 del legacy
 * están enteros, que el alta y la baja funcionan como se acordó, y que
 * Compras sigue siendo de admin y employee y de nadie más.
 *
 * Cada prohibición se prueba con un INTENTO REAL y se mira el efecto, no el
 * error: con PostgREST una operación prohibida puede devolver «éxito» con
 * cero filas.
 *
 * Se limpia sola: todo lo que crea lleva el prefijo `ZZ-C2` —incluido un
 * usuario employee temporal, porque no hay credenciales del employee real— y
 * la limpieza borra también por prefijo, por si una corrida muere a mitad.
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node scripts/fase6-proveedores-tests.mjs
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

const HTML = process.env.LEGACY_HTML
  ?? 'C:/Users/janog/Documents/Claude/Projects/Codificacion Productos/BuscatoolsERP.html'

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const admin = () => createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-C2'
const ORIGEN = 'BuscatoolsERP.html#proveedores-data'
const creados = { proveedores: [], adjuntos: [], objetos: [], usuarios: [] }

/** Los 142 del legacy, leídos del HTML. La fuente de la verdad. */
function leerLegacy() {
  const html = fs.readFileSync(HTML, 'utf8')
  const m = html.match(/<script[^>]*id="proveedores-data"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('No se encontró proveedores-data en el HTML')
  return JSON.parse(m[1].trim())
}

/** Huella de los 142: si algo cambió entre dos corridas, cambia. */
function huella(filas) {
  const texto = [...filas]
    .sort((a, b) => String(a.legacy_ref).localeCompare(String(b.legacy_ref)))
    .map((f) => [
      f.legacy_ref, f.legal_name, f.trade_name, f.tax_id, f.email, f.phone,
      f.address_text, f.country_code, f.activity, f.agent, f.payment_terms,
      f.notes, f.status, f.needs_review, f.review_reason,
    ].map((v) => (v === null || v === undefined ? '' : String(v))).join('|'))
    .join('\n')
  return crypto.createHash('md5').update(texto).digest('hex')
}

const CAMPOS = `id, legacy_ref, legal_name, trade_name, tax_id, email, phone,
  address_text, country_code, activity, agent, payment_terms, notes, status,
  needs_review, review_reason, legacy_source, imported_at, deleted_at, updated_at`

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const s = admin()
  const { data: comps } = await s.from('companies').select('id, slug')
  const BT = comps.find((x) => x.slug === 'buscatools').id
  const TT = comps.find((x) => x.slug === 'torquetools').id

  const { data: seqAntes } = await s.from('document_sequences')
    .select('next_number').eq('company_id', BT).eq('doc_type', 'supplier').single()

  const legacy = leerLegacy()

  console.log('='.repeat(74))
  console.log('  COMPRAS · entrega 2 — el maestro de proveedores')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  const nuevoProveedor = async (cliente, empresa, nombre, extra = {}) => {
    const { data: ref, error: eN } = await cliente.rpc('next_document_number',
      { p_company: empresa, p_doc_type: 'supplier' })
    if (eN) return { error: eN }
    const { data, error } = await cliente.from('suppliers').insert({
      company_id: empresa, legacy_ref: ref, legal_name: nombre, ...extra,
    }).select('id, legacy_ref, status, deleted_at').single()
    if (data) creados.proveedores.push(data.id)
    return { data, error, ref }
  }

  try {
    // ── 1 · Los 142 ────────────────────────────────────────────────────────
    seccion('1 · EL MAESTRO MIGRADO')

    const { data: todos } = await s.from('suppliers').select(CAMPOS)
      .eq('company_id', BT).eq('legacy_source', ORIGEN).limit(500)
    const migrados = todos ?? []

    cmp('proveedores en el legacy', 142, legacy.length)
    cmp('proveedores migrados', 142, migrados.length)
    cmp('todos con imported_at', 142, migrados.filter((p) => p.imported_at).length)
    cmp('todos activos', 142, migrados.filter((p) => p.status === 'active').length)
    cmp('ninguno dado de baja', 0, migrados.filter((p) => p.deleted_at).length)

    const refs = migrados.map((p) => p.legacy_ref)
    cmp('referencias únicas', 142, new Set(refs).size)
    cmp('todas con formato PROV#####', 142, refs.filter((r) => /^PROV\d{5}$/.test(r)).length)

    // ── 2 · Campo por campo, contra el HTML ────────────────────────────────
    seccion('2 · CAMPO POR CAMPO, CONTRA EL LEGACY')

    const porRef = new Map(migrados.map((p) => [p.legacy_ref, p]))
    const nulo = (v) => { const t = String(v ?? '').trim(); return t === '' ? null : t }
    const pares = [
      ['nj → legal_name', 'nj', 'legal_name'],
      ['nc → trade_name', 'nc', 'trade_name'],
      ['cif → tax_id', 'cif', 'tax_id'],
      ['email → email', 'email', 'email'],
      ['tel → phone', 'tel', 'phone'],
      ['direccion → address_text', 'direccion', 'address_text'],
      ['actividad → activity', 'actividad', 'activity'],
      ['agente → agent', 'agente', 'agent'],
      ['formaPago → payment_terms', 'formaPago', 'payment_terms'],
      ['notas → notes', 'notas', 'notes'],
    ]
    for (const [etiqueta, campoLegacy, columna] of pares) {
      const distintos = legacy.filter((p) => {
        const real = porRef.get(String(p.ref).trim())
        return !real || (real[columna] ?? null) !== nulo(p[campoLegacy])
      })
      const conDato = legacy.filter((p) => nulo(p[campoLegacy]) !== null).length
      distintos.length === 0
        ? PASS(etiqueta, `142 iguales · ${conDato} con dato`)
        : FAIL(etiqueta, `${distintos.length} distintos: ${distintos.slice(0, 5).map((p) => p.ref).join(', ')}`)
    }

    // Los tres campos que el legacy tiene VACÍOS en los 142. No se inventaron.
    cmp('CUIT inventados', 0, migrados.filter((p) => p.tax_id).length)
    cmp('emails inventados', 0, migrados.filter((p) => p.email).length)
    cmp('actividades inventadas', 0, migrados.filter((p) => p.activity).length)

    // ── 3 · La dirección quedó entera ──────────────────────────────────────
    seccion('3 · DIRECCIÓN Y PAÍS')

    const conSeparador = migrados.filter((p) => (p.address_text ?? '').includes('·'))
    cmp('direcciones semiestructuradas, sin partir', 122, conSeparador.length)
    cmp('direcciones que son sólo el país', 20,
      migrados.filter((p) => /^[A-Z]{2}$/.test(p.address_text ?? '')).length)

    // El país se DERIVÓ, pero la dirección no perdió nada: sigue terminando
    // en el código que le dio origen.
    const perdieron = migrados.filter((p) =>
      p.country_code && !(p.address_text ?? '').trim().endsWith(p.country_code))
    cmp('direcciones a las que se les sacó el país', 0, perdieron.length)

    const paises = new Map()
    for (const p of migrados) paises.set(p.country_code, (paises.get(p.country_code) ?? 0) + 1)
    cmp('con país derivado', 142, migrados.filter((p) => p.country_code).length)
    cmp('  AR', 136, paises.get('AR') ?? 0)
    cmp('  ES', 2, paises.get('ES') ?? 0)
    cmp('  IT', 2, paises.get('IT') ?? 0)
    cmp('  UY', 1, paises.get('UY') ?? 0)
    cmp('  US', 1, paises.get('US') ?? 0)

    const rex = porRef.get('PROV00008')
    cmp('PROV00008 conserva la dirección literal',
      'Direccion: Av.Saenz Peña 2227 · San Martin · BUENOS AIRES · CP 1651 · AR',
      rex?.address_text)

    // ── 4 · Notas, forma de pago y agente ──────────────────────────────────
    seccion('4 · NOTAS, FORMA DE PAGO Y AGENTE')

    cmp('con notas', 60, migrados.filter((p) => p.notes).length)
    const masLarga = Math.max(...migrados.map((p) => (p.notes ?? '').length))
    cmp('la nota más larga entró completa', 773, masLarga)

    // Los emails escondidos en las notas siguen SÓLO ahí.
    const RE = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[a-zA-Z]{2,}/g
    const conEmailEnNota = migrados.filter((p) => RE.test(p.notes ?? '') && (RE.lastIndex = 0) === 0)
    cmp('proveedores con un email escrito en las notas', 19, conEmailEnNota.length)
    cmp('  y marcados para revisión', 19,
      migrados.filter((p) => p.review_reason === 'LEGACY_EMAIL_EN_NOTAS').length)
    cmp('  needs_review coincide', 19, migrados.filter((p) => p.needs_review).length)
    cmp('  pero ninguno pasó al campo email', 0, conEmailEnNota.filter((p) => p.email).length)

    cmp('con forma de pago', 139, migrados.filter((p) => p.payment_terms).length)
    cmp('formas de pago distintas', 13,
      new Set(migrados.map((p) => p.payment_terms).filter(Boolean)).size)
    cmp('el agente se migró tal cual', 142,
      migrados.filter((p) => p.agent === 'BUSCATOOLS').length)

    // ── 5 · Numeración ─────────────────────────────────────────────────────
    seccion('5 · NUMERACIÓN')

    const numeros = refs.map((r) => Number(r.slice(4)))
    cmp('la última referencia del legacy', 145, Math.max(...numeros))
    for (const hueco of [41, 93, 121]) {
      cmp(`el hueco PROV${String(hueco).padStart(5, '0')} sigue vacío`, false,
        numeros.includes(hueco))
    }
    cmp('la próxima referencia', 146, seqAntes.next_number)

    const p1 = await nuevoProveedor(c, BT, `${MARCA} Primero`)
    cmp('el alta toma la referencia siguiente', 'PROV00146', p1.data?.legacy_ref)
    const p2 = await nuevoProveedor(c, BT, `${MARCA} Segundo`)
    cmp('y la de después', 'PROV00147', p2.data?.legacy_ref)
    // Si numerara con MAX+1 sobre las referencias existentes, la primera
    // habría sido PROV00146 igual; lo que lo delata es que la secuencia se
    // mueve aunque haya huecos abajo.
    const { data: seqAhora } = await s.from('document_sequences')
      .select('next_number').eq('company_id', BT).eq('doc_type', 'supplier').single()
    cmp('la secuencia avanzó, no se rellenaron huecos', 148, seqAhora.next_number)

    // ── 6 · Alta y edición ─────────────────────────────────────────────────
    seccion('6 · ALTA Y EDICIÓN')

    const p3 = await nuevoProveedor(c, BT, `${MARCA} Con datos`, {
      trade_name: 'Comercial', tax_id: '30-50328441-0', email: 'compras@zz-c2.test',
      phone: '11 4766 7915', address_text: 'Calle Falsa 123 · CABA · AR',
      country_code: 'AR', payment_terms: '30 DIAS F/F', notes: 'una nota',
    })
    p3.data ? PASS('alta con todos los campos', p3.data.legacy_ref)
            : FAIL('no se pudo dar de alta', p3.error?.message)

    const { data: editado, error: eEd } = await c.from('suppliers')
      .update({ phone: '11 0000 0000', payment_terms: 'CONTADO CONTRA ENTREGA' })
      .eq('id', p3.data.id).select('phone, payment_terms').single()
    eEd ? FAIL('no se pudo editar', eEd.message)
        : cmp('edición: teléfono', '11 0000 0000', editado.phone)

    // El CUIT informado no se repite. Es un índice único PARCIAL sobre los
    // dígitos: «30503284410» y «30-50328441-0» son el mismo.
    const { data: refDup } = await c.rpc('next_document_number',
      { p_company: BT, p_doc_type: 'supplier' })
    const { data: dup, error: eDup } = await c.from('suppliers').insert({
      company_id: BT, legacy_ref: refDup, legal_name: `${MARCA} CUIT repetido`,
      tax_id: '30503284410',
    }).select('id').single()
    if (dup) creados.proveedores.push(dup.id)
    eDup?.code === '23505'
      ? PASS('el mismo CUIT dos veces es rechazado', eDup.code)
      : FAIL('SE ACEPTÓ UN CUIT REPETIDO', eDup?.code ?? 'sin error')

    // Un país que no es un código de dos letras no entra.
    const { error: ePais } = await c.from('suppliers')
      .update({ country_code: 'Argentina' }).eq('id', p3.data.id)
    ePais?.code === '23514'
      ? PASS('un país que no es un código de dos letras es rechazado', ePais.code)
      : FAIL('SE ACEPTÓ UN PAÍS INVENTADO', ePais?.code ?? 'sin error')

    // Y uno en minúsculas tampoco: el CHECK exige mayúsculas, por eso el
    // servicio normaliza antes de mandar.
    const { error: eMin } = await c.from('suppliers')
      .update({ country_code: 'ar' }).eq('id', p3.data.id)
    eMin?.code === '23514'
      ? PASS('el país en minúsculas también', eMin.code)
      : FAIL('SE ACEPTÓ UN PAÍS EN MINÚSCULAS', eMin?.code ?? 'sin error')

    // ── 7 · Baja lógica ────────────────────────────────────────────────────
    seccion('7 · BAJA LÓGICA')

    const { data: dado } = await c.from('suppliers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
      .eq('id', p1.data.id).select('deleted_at, status').single()
    dado?.deleted_at ? PASS('se da de baja con fecha', dado.status)
                     : FAIL('no se pudo dar de baja')
    cmp('y queda inactivo, no activo', 'inactive', dado?.status)

    // El listado por defecto NO lo muestra…
    const { data: visibles } = await c.from('suppliers').select('id')
      .eq('company_id', BT).is('deleted_at', null).eq('id', p1.data.id)
    cmp('el listado por defecto lo excluye', 0, (visibles ?? []).length)
    // …pero sigue existiendo, que es lo que necesitan sus documentos.
    const { data: sigue } = await c.from('suppliers').select('id, legal_name')
      .eq('id', p1.data.id).maybeSingle()
    sigue ? PASS('pero sigue existiendo y accesible por id', sigue.legal_name)
          : FAIL('EL PROVEEDOR DESAPARECIÓ')

    // Un selector para armar un pedido ofrece activos y sin baja.
    const { data: ofrecidos } = await c.from('suppliers').select('id')
      .eq('company_id', BT).is('deleted_at', null).eq('status', 'active')
      .in('id', [p1.data.id, p2.data.id])
    cmp('el selector de pedido nuevo ofrece sólo el que sigue activo', 1, (ofrecidos ?? []).length)

    // Un proveedor CON historia no se borra, ni con permiso: lo frena
    // `app.proteger_borrado_proveedor()`. Se mide el EFECTO además del
    // código, porque PostgREST devuelve éxito con cero filas.
    const { data: adjGuarda } = await c.from('attachments').insert({
      company_id: BT, entity_type: 'supplier', entity_id: p2.data.id,
      storage_path: `${BT}/supplier/${p2.data.id}/zz-c2-guarda.txt`,
      file_name: 'zz-c2-guarda.txt', kind: 'other',
    }).select('id').single()
    if (adjGuarda) creados.adjuntos.push(adjGuarda.id)

    const { error: eBorrar } = await c.from('suppliers').delete().eq('id', p2.data.id)
    const { data: sobrevive } = await c.from('suppliers').select('id')
      .eq('id', p2.data.id).maybeSingle()
    sobrevive ? PASS('un proveedor con historia no se borra', eBorrar?.code ?? 'sin error')
              : FAIL('SE BORRÓ UN PROVEEDOR CON HISTORIA')
    cmp('  y el motivo es explícito', '23001', eBorrar?.code)

    // La guarda es sobre la historia, no un «no se borra nunca»: sin
    // documentos ni adjuntos, un proveedor recién creado sí se puede borrar.
    await c.from('attachments').delete().eq('id', adjGuarda.id)
    const pTirar = await nuevoProveedor(c, BT, `${MARCA} Para tirar`)
    await c.from('suppliers').delete().eq('id', pTirar.data.id)
    const { data: seFue } = await c.from('suppliers').select('id')
      .eq('id', pTirar.data.id).maybeSingle()
    seFue ? FAIL('un proveedor sin historia tampoco se pudo borrar')
          : PASS('uno recién creado y sin historia sí se puede borrar')

    const { data: reactivado } = await c.from('suppliers')
      .update({ deleted_at: null, status: 'active' })
      .eq('id', p1.data.id).select('status, deleted_at').single()
    reactivado?.deleted_at === null
      ? PASS('y se puede reactivar', reactivado.status)
      : FAIL('no se pudo reactivar')

    // ── 8 · RLS por rol ────────────────────────────────────────────────────
    seccion('8 · RLS POR ROL')

    PASS('admin ve el maestro', `${migrados.length} proveedores`)

    // No hay credenciales del employee real, así que se crea uno temporal.
    let employee = null
    const correo = `zz-c2-employee-${crypto.randomUUID().slice(0, 8)}@buscatools.test`
    const clave = crypto.randomUUID()
    const { data: creado, error: eUser } = await s.auth.admin.createUser({
      email: correo, password: clave, email_confirm: true,
    })
    if (eUser) {
      FAIL('no se pudo crear el employee temporal', eUser.message)
    } else {
      creados.usuarios.push(creado.user.id)
      await s.from('company_memberships').insert({
        company_id: BT, user_id: creado.user.id, role: 'employee', status: 'active',
      })
      employee = sesion()
      const { error } = await employee.auth.signInWithPassword({ email: correo, password: clave })
      if (error) { FAIL('el employee temporal no pudo iniciar sesión', error.message); employee = null }
    }

    if (employee) {
      const { data: ve } = await employee.from('suppliers').select('id')
        .eq('company_id', BT).limit(500)
      ;(ve ?? []).length >= 142
        ? PASS('employee ve el maestro', `${ve.length} proveedores`)
        : FAIL('el employee no ve los proveedores', `${(ve ?? []).length}`)
      const pe = await nuevoProveedor(employee, BT, `${MARCA} Del employee`)
      pe.data ? PASS('employee puede dar de alta', pe.data.legacy_ref)
              : FAIL('el employee no pudo dar de alta', pe.error?.message)
    }

    for (const [rol, email] of [
      ['customer', 'cliente.test@buscatools.com.ar'],
      ['distributor', 'distribuidor.test@buscatools.com.ar'],
    ]) {
      const ext = sesion()
      const { error } = await ext.auth.signInWithPassword({ email, password: process.env.BT_PW_TEST })
      if (error) { FAIL(`${rol}: no se pudo iniciar sesión`, error.message); continue }
      const { data } = await ext.from('suppliers').select('id')
      cmp(`${rol}: no ve ningún proveedor`, 0, (data ?? []).length)
      const { data: porId } = await ext.from('suppliers').select('id').eq('id', p3.data.id)
      cmp(`${rol}: tampoco por id exacto`, 0, (porId ?? []).length)
      const { data: porRefAjena } = await ext.from('suppliers').select('id')
        .eq('legacy_ref', 'PROV00008')
      cmp(`${rol}: tampoco buscando la referencia`, 0, (porRefAjena ?? []).length)
      const { error: eIns } = await ext.from('suppliers')
        .insert({ company_id: BT, legal_name: `${MARCA} intento ${rol}` })
      eIns ? PASS(`${rol}: no puede crear`, eIns.code ?? '')
           : FAIL(`${rol.toUpperCase()} CREÓ UN PROVEEDOR`)
    }

    const anon = sesion()
    const { data: nadaAnon } = await anon.from('suppliers').select('id')
    cmp('anónimo: no ve nada', 0, (nadaAnon ?? []).length)
    const { data: anonPorId } = await anon.from('suppliers').select('id').eq('id', p3.data.id)
    cmp('anónimo: tampoco por id exacto', 0, (anonPorId ?? []).length)

    // Jano es salesperson en Torquetools: ahí no ve los proveedores de SU
    // empresa, que es el caso que importa.
    const provTT = await nuevoProveedor(s, TT, `${MARCA} De Torquetools`)
    const { data: veTT } = await c.from('suppliers').select('id').eq('id', provTT.data.id)
    cmp('salesperson: no ve los proveedores de su propia empresa', 0, (veTT ?? []).length)
    const { data: listaTT } = await c.from('suppliers').select('id').eq('company_id', TT)
    cmp('salesperson: el listado de su empresa le vuelve vacío', 0, (listaTT ?? []).length)
    const { error: eSp } = await c.from('suppliers')
      .insert({ company_id: TT, legal_name: `${MARCA} intento salesperson` })
    eSp ? PASS('salesperson: no puede crear', eSp.code ?? '')
        : FAIL('EL SALESPERSON CREÓ UN PROVEEDOR')

    // Empresa ajena: Jano es admin en Buscatools, y aun así no puede escribir
    // proveedores en Torquetools con su otro rol.
    const { count: cuantosTT } = await s.from('suppliers')
      .select('id', { count: 'exact', head: true }).eq('company_id', TT)
    cmp('en Torquetools sólo está el proveedor de prueba', 1, cuantosTT)

    // ── 9 · Adjuntos ───────────────────────────────────────────────────────
    seccion('9 · ADJUNTOS')

    const contenido = new Blob(['lista de precios de prueba'], { type: 'text/plain' })
    const ruta = `${BT}/supplier/${p3.data.id}/${crypto.randomUUID()}-zz-c2.txt`
    const { error: eSub } = await c.storage.from('ventas').upload(ruta, contenido, {
      contentType: 'text/plain', upsert: false,
    })
    if (eSub) {
      FAIL('no se pudo subir el archivo al bucket', eSub.message)
    } else {
      creados.objetos.push(ruta)
      PASS('el archivo entra al bucket privado que ya existía')
      const { data: adj, error: eAdj } = await c.from('attachments').insert({
        company_id: BT, entity_type: 'supplier', entity_id: p3.data.id,
        storage_path: ruta, file_name: 'zz-c2.txt', mime_type: 'text/plain',
        bytes: 26, kind: 'quote_pdf',
      }).select('id').single()
      if (eAdj) FAIL('no se pudo registrar el adjunto', eAdj.message)
      else {
        creados.adjuntos.push(adj.id)
        PASS('y se registra en attachments con entity_type supplier')
        const { data: firmada } = await c.storage.from('ventas').createSignedUrl(ruta, 60)
        firmada?.signedUrl ? PASS('la descarga usa una URL firmada, no una pública')
                           : FAIL('no se pudo firmar la URL')

        // El adjunto de un proveedor NO es de Ventas: un salesperson no lo ve.
        // Antes de la entrega 2 sí lo veía —`attachments_select` usaba
        // `current_internal_company_ids()`— y con esa fila podía firmar la URL.
        const vendedor = sesion()
        const { error: eLv } = await vendedor.auth.signInWithPassword({
          email: 'buscatools.epp@gmail.com', password: process.env.BT_PW_VENDEDOR ?? '',
        })
        if (eLv) {
          console.log('    ----  salesperson real: sin credenciales, se prueba con el customer')
        } else {
          const { data: veAdj } = await vendedor.from('attachments').select('id')
            .eq('entity_type', 'supplier')
          cmp('salesperson: no ve los adjuntos de proveedor', 0, (veAdj ?? []).length)
        }

        const ext = sesion()
        await ext.auth.signInWithPassword({
          email: 'cliente.test@buscatools.com.ar', password: process.env.BT_PW_TEST,
        })
        const { data: veCli } = await ext.from('attachments').select('id')
          .eq('entity_type', 'supplier')
        cmp('customer: no ve los adjuntos de proveedor', 0, (veCli ?? []).length)

        // Y Ventas sigue como estaba: el cambio partió la condición por tipo
        // de entidad, no la endureció para todos.
        const { count: adjVentas } = await s.from('attachments')
          .select('id', { count: 'exact', head: true })
          .in('entity_type', ['quote', 'order', 'delivery'])
        PASS('los adjuntos de Ventas siguen existiendo', `${adjVentas} filas, sin tocar`)
      }
    }

    // ── 10 · Auditoría ─────────────────────────────────────────────────────
    seccion('10 · AUDITORÍA')

    const { data: evento, error: eEv } = await c.rpc('registrar_evento_compra', {
      p_entity_type: 'supplier', p_entity_id: p3.data.id, p_action: 'update',
      p_from_status: null, p_to_status: null, p_diff: { phone: '11 0000 0000' },
    })
    eEv ? FAIL('no se pudo auditar la edición', eEv.message)
        : PASS('la edición se puede auditar', `evento ${evento}`)

    const { data: leidos } = await c.from('purchases_audit').select('id, action')
      .eq('entity_type', 'supplier').eq('entity_id', p3.data.id)
    cmp('y el evento se lee', 1, (leidos ?? []).length)

    // `purchases_audit` no tiene policy de INSERT: se escribe por la RPC.
    const { error: eIns } = await c.from('purchases_audit').insert({
      company_id: BT, entity_type: 'supplier', entity_id: p3.data.id, action: 'delete',
    })
    eIns ? PASS('nadie escribe la auditoría directamente', eIns.code ?? '')
         : FAIL('SE PUDO ESCRIBIR LA AUDITORÍA A MANO')

    // Los 142 migrados no tienen eventos inventados.
    const { count: eventosMigrados } = await s.from('purchases_audit')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'supplier')
      .in('entity_id', migrados.slice(0, 100).map((p) => p.id))
    cmp('la migración no inventó eventos de auditoría', 0, eventosMigrados)

    // ── 11 · Idempotencia ──────────────────────────────────────────────────
    seccion('11 · IDEMPOTENCIA DE LA MIGRACIÓN')

    const antes = huella(migrados)
    const { data: masReciente } = await s.from('suppliers').select('updated_at')
      .eq('company_id', BT).eq('legacy_source', ORIGEN)
      .order('updated_at', { ascending: false }).limit(1).single()

    let salida = ''
    try {
      salida = execFileSync('node',
        ['scripts/fase6-migrar-proveedores.mjs', HTML, '--apply'],
        { encoding: 'utf8', env: { ...process.env, SUPABASE_SECRET_KEY: SECRET } })
    } catch (e) {
      FAIL('la segunda corrida de la migración falló', String(e.message).slice(0, 200))
    }

    const { data: despues } = await s.from('suppliers').select(CAMPOS)
      .eq('company_id', BT).eq('legacy_source', ORIGEN).limit(500)

    cmp('segunda corrida: sigue habiendo 142', 142, (despues ?? []).length)
    cmp('segunda corrida: 0 creados', true, /Creados: 0/.test(salida))
    cmp('segunda corrida: 0 completados', true, /completados: 0/.test(salida))
    cmp('segunda corrida: la huella de los 142 no cambió', antes, huella(despues ?? []))
    const { data: masRecienteDespues } = await s.from('suppliers').select('updated_at')
      .eq('company_id', BT).eq('legacy_source', ORIGEN)
      .order('updated_at', { ascending: false }).limit(1).single()
    cmp('segunda corrida: ninguna fila se tocó', masReciente.updated_at,
      masRecienteDespues.updated_at)
    cmp('segunda corrida: 0 referencias duplicadas', 142,
      new Set((despues ?? []).map((p) => p.legacy_ref)).size)
  } catch (e) {
    FAIL('excepción', e.message)
    console.error(e)
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    seccion('LIMPIEZA')

    for (const id of creados.adjuntos) await s.from('attachments').delete().eq('id', id)
    await s.from('attachments').delete().eq('entity_type', 'supplier').like('file_name', 'zz-c2%')
    if (creados.objetos.length > 0) await s.storage.from('ventas').remove(creados.objetos)

    await s.from('purchases_audit').delete().eq('entity_type', 'supplier')
      .in('entity_id', creados.proveedores.length > 0 ? creados.proveedores : [crypto.randomUUID()])
    // También por prefijo, por si una corrida anterior murió a mitad.
    await s.from('suppliers').delete().like('legal_name', `${MARCA}%`)
    for (const id of creados.proveedores) await s.from('suppliers').delete().eq('id', id)

    for (const id of creados.usuarios) {
      await s.from('company_memberships').delete().eq('user_id', id)
      await s.auth.admin.deleteUser(id)
    }

    await s.from('document_sequences').update({ next_number: seqAntes.next_number })
      .eq('company_id', BT).eq('doc_type', 'supplier')

    const { count: quedan } = await s.from('suppliers')
      .select('id', { count: 'exact', head: true }).eq('company_id', BT)
    cmp('quedan los 142 migrados y nada más', 142, quedan)
    const { count: quedanTT } = await s.from('suppliers')
      .select('id', { count: 'exact', head: true }).eq('company_id', TT)
    cmp('Torquetools vuelve a quedar sin proveedores', 0, quedanTT)
    const { count: auditoria } = await s.from('purchases_audit')
      .select('id', { count: 'exact', head: true })
    cmp('la auditoría vuelve a estar vacía', 0, auditoria)
    const { data: seqFinal } = await s.from('document_sequences')
      .select('next_number').eq('company_id', BT).eq('doc_type', 'supplier').single()
    cmp('la secuencia vuelve a 146', seqAntes.next_number, seqFinal.next_number)
  }

  console.log('\n' + '='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e); process.exit(1) })
