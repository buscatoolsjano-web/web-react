/**
 * Fase 12 · Configuración — Entrega 2: empresa, logo y numeración (sólo lectura).
 * Pruebas REALES contra la base y la Edge Function desplegada.
 *
 *   1  lógica pura del logo (bytes, tipo, campos, ruta);
 *   2  permisos con JWT reales: admin, employee, salesperson, technician,
 *      customer, distributor, admin de otra empresa y anon;
 *   3  lista blanca y validaciones (campos inyectados, tipos, formatos,
 *      normalización, datos históricos que no bloquean);
 *   4  concurrencia optimista (versión vieja y dos guardados simultáneos);
 *   5  sin escrituras directas: companies, document_sequences, company_audit;
 *   6  bitácora: sólo nombres de campos, actor, lectura admin;
 *   7  numeración: estados OK / BEHIND / AHEAD / SIN_DOCUMENTOS, fuera de
 *      patrón, en revisión, autoridad; no escribe; lectura de las empresas reales;
 *   8  logo contra la Edge Function: red team y ciclo completo (subir,
 *      reemplazar, leer con URL firmada, quitar);
 *   9  datos reales intactos: companies y document_sequences idénticos, sin
 *      objetos de logo de empresas reales.
 *
 * Fixtures: empresas zz-cfg2-* y usuarios zz-cfg2-*@buscatools.test, borrados al
 * final. La lectura de las empresas reales usa la sesión de Jano SÓLO para
 * `config_numeracion_diagnostico` y `config_empresa_obtener` (lectura).
 *
 *   set -a; source .env; source .env.migration; source .env.rls.txt; set +a
 *   node --experimental-strip-types scripts/fase12-configuracion-entrega2-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET || !process.env.BT_PW_JANO) { console.error('✗ Faltan variables'); process.exit(1) }
const logica = await import('../supabase/functions/config-empresa-logo/logica.ts').catch((e) => { console.error('✗ logica.ts (¿falta --experimental-strip-types?):', e.message); process.exit(1) })

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-cfg2'
const FN = `${BASE}/functions/v1/config-empresa-logo`
const BUCKET = 'empresa-logos'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>')
const SVG_SCRIPT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>')

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c, token: data.session.access_token, id: data.user.id }
}
const usuario = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  const { error: eM } = await s.from('company_memberships').insert(fila)
  if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  return login(email, password)
}
const codigo = (r) => (r.error?.message ?? '').split(':')[0]
const esSinPermiso = (r) => codigo(r) === 'sin_permiso'
const esDenegado = (r) => !!r.error && /permission denied|42501|sin_permiso|not find|Could not find/i.test(`${r.error.message} ${r.error.code}`)
const version = async (id) => (await s.from('companies').select('updated_at').eq('id', id).single()).data.updated_at
const logo = async (campos, { token, archivo, tipo = 'image/png', nombre = 'logo.png', origen = 'https://app.buscatools.com' } = {}) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.append(k, v)
  if (archivo) fd.append('archivo', new Blob([archivo], { type: tipo }), nombre)
  const headers = { apikey: PUB, Origin: origen }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(FN, { method: 'POST', headers, body: fd })
  const texto = await r.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* no json */ }
  return { status: r.status, json, texto }
}
const objetos = async (companyId) => ((await s.storage.from(BUCKET).list(companyId)).data ?? []).map((o) => o.name)
async function huellaReal() {
  const { data: c } = await s.from('companies').select('*').not('slug', 'like', 'zz-%').order('slug')
  const ids = c.map((x) => x.id)
  const { data: seq } = await s.from('document_sequences').select('*').in('company_id', ids).order('company_id').order('doc_type').order('series_code')
  const logos = []
  for (const id of ids) logos.push(...(await objetos(id)))
  return { c: createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16), seq: createHash('sha256').update(JSON.stringify(seq)).digest('hex').slice(0, 16), logos: logos.length }
}
const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  for (const id of ids) {
    const nombres = await objetos(id)
    if (nombres.length) await s.storage.from(BUCKET).remove(nombres.map((n) => `${id}/${n}`))
  }
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('suppliers').delete().in('company_id', ids)
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
  if (ids.length) {
    await s.from('document_sequences').delete().in('company_id', ids)
    await s.from('warehouses').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

const main = async () => {
  await barrer()
  const huellaAntes = await huellaReal()

  seccion('1 · Lógica pura del logo')
  {
    const U = '00000000-0000-4000-8000-000000000000'
    const V = '2026-09-08T18:59:21.433774+00:00'
    cmp('detecta PNG, JPEG y WEBP por bytes', ['image/png', 'image/jpeg', 'image/webp'], [PNG, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), WEBP].map((b) => logica.detectarTipo(new Uint8Array(b))))
    cmp('SVG, GIF y texto no se aceptan', [null, null, null], [SVG, Buffer.from('GIF89a......'), Buffer.from('hola')].map((b) => logica.detectarTipo(new Uint8Array(b))))
    cmp('tipo declarado distinto del real → tipo_no_coincide', 'tipo_no_coincide', logica.validarArchivo(new Uint8Array(PNG), 'image/jpeg').error)
    cmp('SVG disfrazado de PNG → formato_no_permitido', 'formato_no_permitido', logica.validarArchivo(new Uint8Array(SVG), 'image/png').error)
    cmp('vacío y > 2 MB', ['archivo_vacio', 'archivo_grande'], [logica.validarArchivo(new Uint8Array(0), 'image/png').error, logica.validarArchivo(new Uint8Array(2 * 1024 * 1024 + 1), 'image/png').error])
    cmp('campo extra y duplicado → campos_no_permitidos', ['campos_no_permitidos', 'campos_no_permitidos'], [
      logica.validarCampos({ accion: 'eliminar', company_id: U, version: V }, ['accion', 'company_id', 'version', 'path']).error,
      logica.validarCampos({ accion: 'eliminar', company_id: U, version: V }, ['accion', 'company_id', 'version', 'version']).error,
    ])
    cmp('company_id con traversal → datos_invalidos', 'datos_invalidos', logica.validarCampos({ accion: 'eliminar', company_id: '../../otra', version: V }, ['accion', 'company_id', 'version']).error)
    cmp('ruta controlada, sin nombre del usuario', `${U}/logo-1789388804024.webp`, logica.rutaLogo(U, 'image/webp', 1789388804024))
  }

  seccion('2 · Permisos con JWT reales')
  const { data: emp } = await s.from('companies').insert({ slug: `${MARCA}-propia-${Date.now()}`, name: 'ZZ CFG2', default_currency: 'ARS', phone: 'abc' }).select('id').single()
  const { data: empX } = await s.from('companies').insert({ slug: `${MARCA}-ajena-${Date.now()}`, name: 'ZZ CFG2 ajena', default_currency: 'ARS' }).select('id').single()
  const ZZ = emp.id
  const ZX = empX.id
  const { data: cli } = await s.from('customers').insert({ company_id: ZZ, legal_name: 'ZZ CFG2 cliente', legacy_ref: 'CLI00005' }).select('id').single()
  const id = {
    admin: await usuario(ZZ, 'admin'), admin2: await usuario(ZZ, 'admin'), employee: await usuario(ZZ, 'employee'),
    salesperson: await usuario(ZZ, 'salesperson'), technician: await usuario(ZZ, 'technician'),
    customer: await usuario(ZZ, 'customer', cli.id), distributor: await usuario(ZZ, 'distributor', cli.id),
    ajeno: await usuario(ZX, 'admin'),
  }
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  {
    const rA = await id.admin.c.rpc('config_empresa_obtener', { p_company: ZZ })
    const rE = await id.employee.c.rpc('config_empresa_obtener', { p_company: ZZ })
    cmp('admin y employee leen la empresa; sólo admin puede editar', [true, true, true, false], [rA.data?.length === 1, rE.data?.length === 1, rA.data?.[0]?.puede_editar, rE.data?.[0]?.puede_editar])
    cmp('columnas de lectura (sin secretos)', ['address', 'brand_color', 'default_currency', 'email', 'id', 'is_active', 'legal_name', 'logo_path', 'name', 'phone', 'puede_editar', 'slug', 'tax_id', 'updated_at', 'website'], Object.keys(rA.data?.[0] ?? {}).sort())
    const noLeen = []
    const noDiag = []
    for (const k of ['salesperson', 'technician', 'customer', 'distributor', 'ajeno']) {
      if (!esSinPermiso(await id[k].c.rpc('config_empresa_obtener', { p_company: ZZ }))) noLeen.push(k)
      if (!esSinPermiso(await id[k].c.rpc('config_numeracion_diagnostico', { p_company: ZZ }))) noDiag.push(k)
    }
    cmp('salesperson, technician, customer, distributor y admin ajeno: obtener → sin_permiso', [], noLeen)
    cmp('los mismos: diagnóstico de numeración → sin_permiso', [], noDiag)
    const v = await version(ZZ)
    const noEditan = []
    for (const k of ['employee', 'salesperson', 'technician', 'customer', 'distributor', 'ajeno']) {
      if (!esSinPermiso(await id[k].c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: v, p_datos: { name: `hack ${k}` } }))) noEditan.push(k)
    }
    cmp('employee, salesperson, technician, customer, distributor y admin ajeno: actualizar → sin_permiso', [], noEditan)
    cmp('anon: las 3 RPC rechazadas', [true, true, true], [
      esDenegado(await anon.rpc('config_empresa_obtener', { p_company: ZZ })),
      esDenegado(await anon.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: v, p_datos: { name: 'anon' } })),
      esDenegado(await anon.rpc('config_numeracion_diagnostico', { p_company: ZZ })),
    ])
    cmp('admin de ZZ no edita la empresa ajena', true, esSinPermiso(await id.admin.c.rpc('config_empresa_actualizar', { p_company: ZX, p_esperado: await version(ZX), p_datos: { name: 'cruzado' } })))
    cmp('nadie cambió el nombre', 'ZZ CFG2', (await s.from('companies').select('name').eq('id', ZZ).single()).data.name)
    cmp('admin de ZZ edita su empresa', ['name'], (await id.admin.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: v, p_datos: { name: 'ZZ CFG2 Editada' } })).data?.[0]?.campos)
    cmp('RPC de servicio del logo cerradas para authenticated y anon', [true, true, true, true], [
      esDenegado(await id.admin.c.rpc('config_empresa_logo_precheck', { p_actor: id.admin.id, p_company: ZZ, p_esperado: v })),
      esDenegado(await id.admin.c.rpc('config_empresa_logo_registrar', { p_actor: id.admin.id, p_company: ZZ, p_esperado: v, p_path: null })),
      esDenegado(await anon.rpc('config_empresa_logo_precheck', { p_actor: id.admin.id, p_company: ZZ, p_esperado: v })),
      esDenegado(await anon.rpc('config_empresa_logo_registrar', { p_actor: id.admin.id, p_company: ZZ, p_esperado: v, p_path: null })),
    ])
  }

  seccion('3 · Lista blanca y validaciones')
  {
    const upd = async (datos) => id.admin.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: await version(ZZ), p_datos: datos })
    const inyectados = []
    for (const campo of ['company_id', 'id', 'slug', 'created_at', 'updated_at', 'is_active', 'default_currency', 'logo_path', 'next_number', 'role', 'prefix']) {
      const r = await upd({ name: 'x', [campo]: campo === 'is_active' ? false : 'x' })
      if (codigo(r) !== 'campos_no_permitidos') inyectados.push(`${campo}: ${r.error?.message ?? 'aceptado'}`)
    }
    cmp('11 campos inyectados → campos_no_permitidos', [], inyectados)
    cmp('cuerpo que no es objeto / null', ['datos_invalidos', 'datos_invalidos'], [codigo(await upd(['name'])), codigo(await upd(null))])
    cmp('tipos: número u objeto en lugar de texto', ['datos_invalidos', 'datos_invalidos'], [codigo(await upd({ phone: 1234 })), codigo(await upd({ name: { x: 1 } }))])
    const formatos = {
      name: ['', ' ', 'x'.repeat(121)], tax_id: ['<script>', '-12'], phone: ['llamame', '1'], email: ['no-es-email', 'a@b'],
      website: ['javascript:alert(1)', 'http://'], brand_color: ['red', '#12345', 'url(x)'], address: ['x'.repeat(301)], legal_name: ['x'.repeat(201)],
    }
    const aceptados = []
    for (const [campo, valores] of Object.entries(formatos)) for (const val of valores) { const r = await upd({ [campo]: val }); if (!r.error) aceptados.push(`${campo}=${val.slice(0, 12)}`) }
    cmp('formatos inválidos rechazados (17 casos)', [], aceptados)
    const r = await upd({ email: '  Info@ZZ.Test.COM ', brand_color: '#f37021', legal_name: '  ', website: 'www.zz-cfg2.com.ar', tax_id: '20-27089205-2', address: ' Calle 1, Granada, España ' })
    const fila = (await s.from('companies').select('email, brand_color, legal_name, website, tax_id, address').eq('id', ZZ).single()).data
    cmp('normaliza: email minúsculas, color mayúsculas, trim, vacío → null', { email: 'info@zz.test.com', brand_color: '#F37021', legal_name: null, website: 'www.zz-cfg2.com.ar', tax_id: '20-27089205-2', address: 'Calle 1, Granada, España' }, fila)
    cmp('campos cambiados informados', ['tax_id', 'address', 'email', 'website', 'brand_color'], r.data?.[0]?.campos)
    cmp('NIF español con forma básica aceptado', null, (await upd({ tax_id: 'B18123456' })).error?.message ?? null)
    cmp('el teléfono histórico inválido («abc») no bloquea editar otro campo', null, (await upd({ name: 'ZZ CFG2' })).error?.message ?? null)
    const v1 = await version(ZZ)
    const sinCambios = await id.admin.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: v1, p_datos: { name: 'ZZ CFG2' } })
    cmp('sin cambios: no escribe ni cambia la versión', [[], true], [sinCambios.data?.[0]?.campos, (await version(ZZ)) === v1])
  }

  seccion('4 · Concurrencia optimista')
  {
    const v = await version(ZZ)
    const a = await id.admin.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: v, p_datos: { phone: '11 1111 1111' } })
    const b = await id.admin2.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: v, p_datos: { phone: '22 2222 2222' } })
    cmp('segundo admin con versión vieja → conflicto_version (no pisa)', [null, 'conflicto_version', '11 1111 1111'], [a.error?.message ?? null, codigo(b), (await s.from('companies').select('phone').eq('id', ZZ).single()).data.phone])
    cmp('versión nula → conflicto_version', 'conflicto_version', codigo(await id.admin.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: null, p_datos: { phone: '33 3333 3333' } })))
    const rondas = 6
    let unoSolo = 0
    for (let i = 0; i < rondas; i++) {
      const vv = await version(ZZ)
      const rs = await Promise.all([
        id.admin.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: vv, p_datos: { website: `www.a${i}.com` } }),
        id.admin2.c.rpc('config_empresa_actualizar', { p_company: ZZ, p_esperado: vv, p_datos: { website: `www.b${i}.com` } }),
      ])
      if (rs.filter((x) => !x.error).length === 1 && rs.filter((x) => codigo(x) === 'conflicto_version').length === 1) unoSolo++
    }
    cmp(`guardados simultáneos (${rondas} rondas): exactamente uno gana y el otro recibe conflicto`, rondas, unoSolo)
  }

  seccion('5 · Sin escrituras directas')
  {
    const u1 = await id.admin.c.from('companies').update({ name: 'directo' }).eq('id', ZZ).select('id')
    const u2 = await id.admin.c.from('companies').update({ slug: 'robado', is_active: false, default_currency: 'USD' }).eq('id', ZZ).select('id')
    const i1 = await id.admin.c.from('companies').insert({ slug: `${MARCA}-intrusa`, name: 'intrusa' }).select('id')
    const d1 = await id.admin.c.from('companies').delete().eq('id', ZZ).select('id')
    cmp('admin: UPDATE, INSERT y DELETE directos sobre companies bloqueados', [true, true, true, true], [!!u1.error || !u1.data?.length, !!u2.error || !u2.data?.length, !!i1.error, !!d1.error || !d1.data?.length])
    const fila = (await s.from('companies').select('name, slug, is_active, default_currency').eq('id', ZZ).single()).data
    cmp('la empresa sigue igual', ['ZZ CFG2', true, 'ARS'], [fila.name, fila.is_active, fila.default_currency])
    cmp('anon no lee ni escribe companies', [true, true], [esDenegado(await anon.from('companies').select('id').limit(1)) || !((await anon.from('companies').select('id').limit(1)).data ?? []).length, !!(await anon.from('companies').update({ name: 'x' }).eq('id', ZZ).select('id')).error])

    await s.from('document_sequences').insert([
      { company_id: ZZ, doc_type: 'customer', prefix: 'CLI', padding: 5, next_number: 3, series_code: 'CLI', is_default: true },
      { company_id: ZZ, doc_type: 'supplier', prefix: 'PROV', padding: 5, next_number: 2, series_code: 'PROV', is_default: true },
      { company_id: ZZ, doc_type: 'purchase_order', prefix: 'PC', padding: 5, next_number: 10, series_code: 'PC', is_default: true },
      { company_id: ZZ, doc_type: 'sales_order', prefix: 'PDV', padding: 5, next_number: 1, series_code: 'PDV', is_default: true },
    ])
    const seqAntes = (await s.from('document_sequences').select('*').eq('company_id', ZZ).order('doc_type')).data
    const ataques = [
      ['admin SELECT', await id.admin.c.from('document_sequences').select('*').eq('company_id', ZZ)],
      ['admin UPDATE next_number', await id.admin.c.from('document_sequences').update({ next_number: 999 }).eq('company_id', ZZ).select('doc_type')],
      ['admin UPDATE prefix', await id.admin.c.from('document_sequences').update({ prefix: 'HACK' }).eq('company_id', ZZ).select('doc_type')],
      ['admin reset (DELETE)', await id.admin.c.from('document_sequences').delete().eq('company_id', ZZ).select('doc_type')],
      ['admin INSERT', await id.admin.c.from('document_sequences').insert({ company_id: ZZ, doc_type: 'quote', prefix: 'X', next_number: 1 }).select('doc_type')],
      ['admin ajeno UPDATE', await id.ajeno.c.from('document_sequences').update({ next_number: 1 }).eq('company_id', ZZ).select('doc_type')],
      ['anon UPDATE', await anon.from('document_sequences').update({ next_number: 1 }).eq('company_id', ZZ).select('doc_type')],
    ]
    cmp('document_sequences: lectura y 6 escrituras directas bloqueadas', [], ataques.filter(([, r]) => !r.error && (r.data ?? []).length).map(([t]) => t))
    cmp('secuencias intactas', JSON.stringify(seqAntes), JSON.stringify((await s.from('document_sequences').select('*').eq('company_id', ZZ).order('doc_type')).data))
    cmp('company_audit no se escribe desde el cliente', true, !!(await id.admin.c.from('company_audit').insert({ company_id: ZZ, action: 'COMPANY_UPDATED', changed_fields: ['x'] }).select('id')).error)
    const rpcsEdicion = ['config_numeracion_editar', 'config_numeracion_reset', 'set_next_number']
    const expuestas = []
    for (const f of rpcsEdicion) if (!(await id.admin.c.rpc(f, { p_company: ZZ })).error) expuestas.push(f)
    cmp('no existe ninguna RPC para editar la numeración', [], expuestas)
  }

  seccion('6 · Bitácora')
  {
    const { data: aud } = await s.from('company_audit').select('action, changed_fields, actor_id').eq('company_id', ZZ).order('id')
    cmp('COMPANY_UPDATED con nombres de campos y actor', true, (aud ?? []).length > 0 && aud.every((a) => a.action === 'COMPANY_UPDATED' && Array.isArray(a.changed_fields) && a.changed_fields.length > 0 && a.actor_id))
    cmp('sin valores en la bitácora (sólo nombres permitidos)', [], [...new Set((aud ?? []).flatMap((a) => a.changed_fields))].filter((c) => !['name', 'legal_name', 'tax_id', 'address', 'phone', 'email', 'website', 'brand_color', 'logo_path'].includes(c)))
    cmp('columnas de la bitácora', ['action', 'actor_id', 'changed_fields', 'company_id', 'created_at', 'id'], Object.keys((await s.from('company_audit').select('*').limit(1)).data?.[0] ?? {}).sort())
    const leen = []
    for (const k of ['employee', 'salesperson', 'technician', 'customer', 'distributor', 'ajeno']) if (((await id[k].c.from('company_audit').select('id').eq('company_id', ZZ)).data ?? []).length) leen.push(k)
    cmp('sólo el admin de la empresa la lee', [true, []], [((await id.admin.c.from('company_audit').select('id').eq('company_id', ZZ)).data ?? []).length > 0, leen])
  }

  seccion('7 · Numeración (sólo lectura)')
  {
    await s.from('customers').insert([
      { company_id: ZZ, legal_name: 'ZZ c2', legacy_ref: 'CLI00002' },
      { company_id: ZZ, legal_name: 'ZZ fuera', legacy_ref: 'TEST-CLI' },
    ])
    await s.from('suppliers').insert({ company_id: ZZ, legal_name: 'ZZ prov', legacy_ref: 'PROV00001' })
    const antes = (await s.from('document_sequences').select('*').eq('company_id', ZZ).order('doc_type')).data
    const rA = await id.admin.c.rpc('config_numeracion_diagnostico', { p_company: ZZ })
    const rE = await id.employee.c.rpc('config_numeracion_diagnostico', { p_company: ZZ })
    const por = Object.fromEntries((rA.data ?? []).map((x) => [x.doc_type, x]))
    cmp('employee también lee el diagnóstico', rA.data?.length, rE.data?.length)
    if (rA.error) INFO('error', rA.error.message)
    cmp('CLI next 3 con CLI00005 existente → BEHIND (colisión)', ['BEHIND', 5, 'CLI00003'], [por.customer?.estado, por.customer?.max_numero_sin_atipicos, por.customer?.proximo])
    cmp('referencia fuera de patrón contada aparte; clientes sin atípicos', [5, 0, 1], [por.customer?.max_numero, por.customer?.atipicos_por_encima, por.customer?.fuera_patron])
    cmp('PROV next 2 con PROV00001 → OK', 'OK', por.supplier?.estado)
    cmp('PC next 10 sin documentos → SIN_DOCUMENTOS', ['SIN_DOCUMENTOS', 0], [por.purchase_order?.estado, por.purchase_order?.documentos])
    cmp('autoridad ERP en una empresa que no es Buscatools', ['ERP'], [...new Set((rA.data ?? []).map((x) => x.autoridad))])
    cmp('el diagnóstico no modificó ninguna secuencia', JSON.stringify(antes), JSON.stringify((await s.from('document_sequences').select('*').eq('company_id', ZZ).order('doc_type')).data))
    cmp('empresa nula → sin_permiso', true, esSinPermiso(await id.admin.c.rpc('config_numeracion_diagnostico', { p_company: null })))

    // Empresa real, sólo lectura, con la sesión de Jano (admin de Buscatools).
    const { data: bt } = await s.from('companies').select('id').eq('slug', 'buscatools').single()
    // El email no se escribe en el repo: se busca el admin «Jano» de Buscatools.
    const { data: pj } = await s.from('profiles').select('id').eq('full_name', 'Jano').single()
    const { data: uj } = await s.auth.admin.getUserById(pj.id)
    const jano = await login(uj.user.email, process.env.BT_PW_JANO)
    const real = (await jano.c.rpc('config_numeracion_diagnostico', { p_company: bt.id })).data ?? []
    const r = Object.fromEntries(real.map((x) => [x.doc_type, x]))
    for (const x of real) INFO(`Buscatools ${x.doc_type}`, `próximo ${x.proximo} · docs ${x.documentos} · máx ${x.max_numero ?? '—'} (sin atípicos ${x.max_numero_sin_atipicos ?? '—'}) · atípicos ≥ próximo ${x.atipicos_por_encima} · fuera de patrón ${x.fuera_patron} · ${x.estado} · ${x.autoridad}`)
    cmp('Buscatools: 10 secuencias; cotización, pedido y remito con autoridad STEL', [10, 'STEL', 'STEL', 'STEL', 'ERP'], [real.length, r.quote?.autoridad, r.sales_order?.autoridad, r.delivery?.autoridad, r.customer?.autoridad])
    cmp('Buscatools remito: contra lo importado 1424 = 1423 + 1 (OK); la colisión con STEL no es visible desde la base', ['RT0000001424', 1423, 'OK'], [r.delivery?.proximo, r.delivery?.max_numero_sin_atipicos, r.delivery?.estado])
    cmp('Buscatools pedidos: los PDV11xxx atípicos se informan y no ensucian el estado', [9, 1315, 'OK'], [r.sales_order?.atipicos_por_encima, r.sales_order?.max_numero_sin_atipicos, r.sales_order?.estado])
    await jano.c.auth.signOut()
  }

  seccion('8 · Logo (Edge Function desplegada)')
  {
    const base = async () => ({ accion: 'subir', company_id: ZZ, version: await version(ZZ) })
    cmp('sin JWT → 401', 401, (await logo(await base(), { archivo: PNG })).status)
    const casos = [
      ['employee → 403', id.employee.token, await base(), { archivo: PNG }, 403, 'sin_permiso'],
      ['salesperson → 403', id.salesperson.token, await base(), { archivo: PNG }, 403, 'sin_permiso'],
      ['admin de otra empresa → 403', id.ajeno.token, await base(), { archivo: PNG }, 403, 'sin_permiso'],
      ['versión vieja → 409', id.admin.token, { accion: 'subir', company_id: ZZ, version: '2020-01-01T00:00:00+00:00' }, { archivo: PNG }, 409, 'conflicto_version'],
      ['SVG declarado como PNG → 422', id.admin.token, await base(), { archivo: SVG, nombre: 'logo.png' }, 422, 'formato_no_permitido'],
      ['PNG declarado como JPEG → 422', id.admin.token, await base(), { archivo: PNG, tipo: 'image/jpeg', nombre: 'logo.jpg' }, 422, 'tipo_no_coincide'],
      ['> 2 MB → 413', id.admin.token, await base(), { archivo: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) }, 413, 'archivo_grande'],
      ['company_id con traversal → 400', id.admin.token, { accion: 'subir', company_id: `../${ZX}`, version: await version(ZZ) }, { archivo: PNG }, 400, 'datos_invalidos'],
      ['campo extra (path) → 400', id.admin.token, { ...(await base()), path: `${ZX}/logo.png` }, { archivo: PNG }, 400, 'campos_no_permitidos'],
      ['sin archivo → 400', id.admin.token, await base(), {}, 400, 'datos_invalidos'],
      ['eliminar sin logo → 409', id.admin.token, { accion: 'eliminar', company_id: ZZ, version: await version(ZZ) }, {}, 409, 'sin_logo'],
    ]
    const mal = []
    for (const [t, token, campos, extra, st, err] of casos) { const r = await logo(campos, { token, ...extra }); if (r.status !== st || r.json?.error !== err) mal.push(`${t}: ${r.status} ${r.json?.error}`) }
    cmp(`${casos.length} ataques de logo fallan cerrados`, [], mal)
    cmp('ningún ataque dejó objetos', [[], []], [await objetos(ZZ), await objetos(ZX)])

    const up = await logo(await base(), { token: id.admin.token, archivo: PNG, nombre: '../../evil.php.png' })
    cmp('admin sube un PNG real', 'logo_actualizado', up.json?.resultado)
    const ruta1 = up.json?.logo_path
    cmp('ruta controlada (ignora el nombre del archivo)', true, new RegExp(`^${ZZ}/logo-\\d{13}\\.png$`).test(ruta1 ?? ''))
    cmp('queda un objeto y logo_path registrado', [[ruta1.split('/')[1]], ruta1], [await objetos(ZZ), (await s.from('companies').select('logo_path').eq('id', ZZ).single()).data.logo_path])
    const firmada = await id.employee.c.storage.from(BUCKET).createSignedUrl(ruta1, 60)
    const img = firmada.data ? await fetch(firmada.data.signedUrl) : null
    cmp('employee lo lee con URL firmada; se sirve como image/png', [200, 'image/png'], [img?.status, img?.headers.get('content-type')])
    cmp('admin de otra empresa no puede firmar la URL', true, !!(await id.ajeno.c.storage.from(BUCKET).createSignedUrl(ruta1, 60)).error)
    cmp('anon no puede firmar la URL', true, !!(await anon.storage.from(BUCKET).createSignedUrl(ruta1, 60)).error)
    const directo = await id.admin.c.storage.from(BUCKET).upload(`${ZZ}/directo.png`, PNG, { contentType: 'image/png' })
    const ajenoSube = await id.ajeno.c.storage.from(BUCKET).upload(ruta1, PNG, { contentType: 'image/png', upsert: true })
    await id.ajeno.c.storage.from(BUCKET).remove([ruta1])
    await id.admin.c.storage.from(BUCKET).remove([ruta1])
    cmp('subida directa a storage bloqueada (admin y ajeno); borrado directo sin efecto', [true, true, [ruta1.split('/')[1]]], [!!directo.error, !!ajenoSube.error, await objetos(ZZ)])
    const ajenoBorra = await logo({ accion: 'eliminar', company_id: ZZ, version: await version(ZZ) }, { token: id.ajeno.token })
    cmp('admin de otra empresa no borra el logo por la función', [403, [ruta1.split('/')[1]]], [ajenoBorra.status, await objetos(ZZ)])

    await new Promise((r) => setTimeout(r, 5))
    const rep = await logo(await base(), { token: id.admin.token, archivo: WEBP, tipo: 'image/webp', nombre: 'nuevo.webp' })
    const ruta2 = rep.json?.logo_path
    cmp('reemplazo por WEBP: ruta nueva y el anterior borrado', [true, [ruta2?.split('/')[1]]], [/\.webp$/.test(ruta2 ?? '') && ruta2 !== ruta1, await objetos(ZZ)])
    const del = await logo({ accion: 'eliminar', company_id: ZZ, version: await version(ZZ) }, { token: id.admin.token })
    cmp('quitar: logo_path null y sin objetos', ['logo_eliminado', null, []], [del.json?.resultado, (await s.from('companies').select('logo_path').eq('id', ZZ).single()).data.logo_path, await objetos(ZZ)])
    const { data: aud } = await s.from('company_audit').select('action, changed_fields, actor_id').eq('company_id', ZZ).like('action', 'COMPANY_LOGO%').order('id')
    cmp('bitácora del logo: 2 actualizaciones y 1 baja, con actor', [['COMPANY_LOGO_UPDATED', 'COMPANY_LOGO_UPDATED', 'COMPANY_LOGO_REMOVED'], true], [(aud ?? []).map((a) => a.action), (aud ?? []).every((a) => a.actor_id === id.admin.id && a.changed_fields.join() === 'logo_path')])
    cmp('ninguna respuesta trae URLs firmadas ni tokens', [], [up.texto, rep.texto, del.texto].filter((t) => /token=|eyJ|signedUrl|http/i.test(t)))
    const conScript = await logo(await base(), { token: id.admin.token, archivo: SVG_SCRIPT, nombre: 'x.png' })
    cmp('SVG con script: rechazado antes o por la función (nunca 200)', true, conScript.status !== 200 && (await objetos(ZZ)).length === 0)
    INFO('SVG con script', `${conScript.status} ${conScript.json?.error ?? '(respuesta del gateway, no de la función)'}`)
    const pre = await fetch(FN, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    cmp('CORS: origen desconocido sin Allow-Origin', [403, null], [pre.status, pre.headers.get('access-control-allow-origin')])
  }

  await barrer()
  seccion('9 · Datos reales')
  const huellaDespues = await huellaReal()
  cmp('companies y document_sequences reales idénticos; 0 logos reales', huellaAntes, huellaDespues)
  const { count: restos } = await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)
  cmp('sin fixtures persistentes', 0, restos)

  console.log(`\n  ${fallos === 0 ? 'TODO PASS' : `${fallos} FAIL`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('✗', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
