/**
 * Fase 12 · Configuración — Entrega 4: visor de auditoría. Pruebas REALES
 * contra la base y la Edge Function del logo, con JWT reales.
 *
 *   1  permisos: sólo admin de la empresa; employee, salesperson, technician,
 *      customer, distributor, anon y admin de otra empresa → sin permiso;
 *   2  cobertura: cada escritura de Configuración deja su evento (usuarios,
 *      empresa, logo, marcas, categorías, autoridad de numeración) y las
 *      lecturas no dejan nada;
 *   3  contenido: etiquetas de actor/entidad, snapshot de lo eliminado, actor
 *      nulo sin inventar, detalles con lista blanca, email sólo de miembros;
 *   4  multiempresa: nunca aparecen eventos de otra empresa;
 *   5  filtros server-side: módulo, evento, actor, fechas, texto (con % y _),
 *      combinados, y parámetros inválidos → datos_invalidos;
 *   6  paginación estable: 50 por página, sin repetidos ni saltos, orden fecha desc;
 *   7  append-only: nadie escribe ni borra auditoría por REST; no hay RPC de borrado;
 *   8  datos reales intactos y sin correos enviados.
 *
 * Fixtures: empresas zz-e4-* y usuarios zz-e4-*@buscatools.test, borrados al
 * final (incluido el logo del bucket). No usa sesiones de personas reales.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase12-configuracion-entrega4-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base. NO canalizar por `head`.
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
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 150)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
const MARCA = 'zz-e4'
const FN_LOGO = `${BASE}/functions/v1/config-empresa-logo`
const BUCKET = 'empresa-logos'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const HOY_AR = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const dia = (delta) => new Date(Date.parse(`${HOY_AR}T12:00:00Z`) + delta * 86400_000).toISOString().slice(0, 10)

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c, id: data.user.id, token: data.session.access_token, email }
}
const usuario = async (companyId, rol, { customerId = null, nombre = null } = {}) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: nombre ? { full_name: nombre } : {} })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  if (nombre) await s.from('profiles').update({ full_name: nombre }).eq('id', data.user.id)
  if (companyId) {
    const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
    if (customerId) fila.customer_id = customerId
    const { error: eM } = await s.from('company_memberships').insert(fila)
    if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  }
  return login(email, password)
}
const clase = (r) => {
  if (!r.error) return 'OK'
  const m = `${r.error.message ?? ''}`
  if (/permission denied|42501/i.test(`${m} ${r.error.code}`) || m === 'sin_permiso') return 'PERMISO'
  return m.split(':')[0] || `OTRO(${r.error.code})`
}
const ordenar = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, ordenar(o[k])])) : o)
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const cuenta = async (tabla, filtro) => {
  let q = s.from(tabla).select('*', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  return (await q).count
}
const ok = (r, t) => { if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data }

async function huellaReal() {
  const { data: c } = await s.from('companies').select('id, slug, name, updated_at, logo_path').not('slug', 'like', 'zz-%').order('slug')
  const ids = c.map((x) => x.id)
  const f = (q) => q.in('company_id', ids)
  return {
    empresas: hash(c),
    membresias: hash((await s.from('company_memberships').select('id, company_id, user_id, role, status').in('company_id', ids).order('id')).data),
    usersAudit: await cuenta('users_audit', f),
    companyAudit: await cuenta('company_audit', f),
    catalogAudit: await cuenta('catalog_audit', f),
    numeracionAudit: await cuenta('document_numbering_authority_audit', f),
    autoridad: hash((await s.from('document_numbering_authority').select('*').in('company_id', ids).order('doc_type')).data),
    marcas: hash((await s.from('brands').select('id, name, is_active').in('company_id', ids).order('id')).data),
    categorias: hash((await s.from('product_categories').select('id, name, slug').in('company_id', ids).order('id')).data),
  }
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  for (const id of ids) {
    const { data: objs } = await s.storage.from(BUCKET).list(id)
    if (objs?.length) await s.storage.from(BUCKET).remove(objs.map((o) => `${id}/${o.name}`))
  }
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('document_numbering_authority').delete().in('company_id', ids)
    for (const t of ['users_audit', 'company_audit', 'catalog_audit', 'document_numbering_authority_audit']) await s.from(t).delete().in('company_id', ids)
    await s.from('brands').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
  if (ids.length) {
    await s.from('document_sequences').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

const listar = (c, company, extra = {}) => c.rpc('config_auditoria_listar', { p_company: company, p_desde: null, p_hasta: null, p_modulo: null, p_evento: null, p_actor: null, p_texto: null, p_limite: 100, p_desplazamiento: 0, ...extra })

const main = async () => {
  await barrer()
  const huellaAntes = await huellaReal()
  INFO('huella real antes', JSON.stringify(huellaAntes))

  const A = ok(await s.from('companies').insert({ slug: `${MARCA}-a-${Date.now()}`, name: 'ZZ E4 A', default_currency: 'USD' }).select('id').single(), 'empresa A').id
  const B = ok(await s.from('companies').insert({ slug: `${MARCA}-b-${Date.now()}`, name: 'ZZ E4 B', default_currency: 'USD' }).select('id').single(), 'empresa B').id
  const cli = ok(await s.from('customers').insert({ company_id: A, legal_name: 'ZZ E4 cliente' }).select('id').single(), 'cliente').id
  const id = {
    admin: await usuario(A, 'admin', { nombre: 'ZZ Admin Uno' }),
    admin2: await usuario(A, 'admin', { nombre: 'ZZ Admin Dos' }),
    employee: await usuario(A, 'employee', { nombre: 'ZZ Empleada' }),
    salesperson: await usuario(A, 'salesperson'),
    technician: await usuario(A, 'technician'),
    customer: await usuario(A, 'customer', { customerId: cli }),
    distributor: await usuario(A, 'distributor', { customerId: cli }),
    adminB: await usuario(B, 'admin', { nombre: 'ZZ Admin de B' }),
  }
  const ROLES = ['employee', 'salesperson', 'technician', 'customer', 'distributor']

  seccion('1 · Permisos')
  {
    const m = {}
    for (const r of ['admin', ...ROLES]) m[r] = `${clase(await listar(id[r].c, A))}/${clase(await id[r].c.rpc('config_auditoria_actores', { p_company: A }))}`
    m.anon = `${clase(await listar(anon, A))}/${clase(await anon.rpc('config_auditoria_actores', { p_company: A }))}`
    m.adminOtraEmpresa = `${clase(await listar(id.adminB.c, A))}/${clase(await id.adminB.c.rpc('config_auditoria_actores', { p_company: A }))}`
    m.adminAconEmpresaB = `${clase(await listar(id.admin.c, B))}/${clase(await id.admin.c.rpc('config_auditoria_actores', { p_company: B }))}`
    m.empresaNula = clase(await listar(id.admin.c, null))
    const P = 'PERMISO/PERMISO'
    cmp('listar/actores', { admin: 'OK/OK', employee: P, salesperson: P, technician: P, customer: P, distributor: P, anon: P, adminOtraEmpresa: P, adminAconEmpresaB: P, empresaNula: 'PERMISO' }, m)
    // Admin suspendido pierde el acceso.
    const { data: mem } = await s.from('company_memberships').select('id').eq('user_id', id.admin2.id).eq('company_id', A).single()
    ok(await id.admin.c.rpc('config_cambiar_estado', { p_membership: mem.id, p_estado: 'suspended' }), 'suspender admin2')
    cmp('admin suspendido: sin permiso', 'PERMISO', clase(await listar(id.admin2.c, A)))
    ok(await id.admin.c.rpc('config_cambiar_estado', { p_membership: mem.id, p_estado: 'active' }), 'reactivar admin2')
    cmp('empresa sin eventos (B): lista vacía sin error', ['OK', 0], await (async () => { const r = await listar(id.adminB.c, B); return [clase(r), r.data?.length] })())
  }

  seccion('2 · Cobertura: cada escritura deja su evento')
  const sumaBitacoras = async () => (await cuenta('users_audit', (q) => q.eq('company_id', A))) + (await cuenta('company_audit', (q) => q.eq('company_id', A))) + (await cuenta('catalog_audit', (q) => q.eq('company_id', A))) + (await cuenta('document_numbering_authority_audit', (q) => q.eq('company_id', A)))
  {
    const c = id.admin.c
    const { data: memEmp } = await s.from('company_memberships').select('id').eq('user_id', id.employee.id).eq('company_id', A).single()
    ok(await c.rpc('config_cambiar_rol', { p_membership: memEmp.id, p_rol: 'salesperson' }), 'rol')
    ok(await c.rpc('config_cambiar_rol', { p_membership: memEmp.id, p_rol: 'employee' }), 'rol vuelta')
    ok(await c.rpc('config_cambiar_estado', { p_membership: memEmp.id, p_estado: 'suspended' }), 'suspender')
    ok(await c.rpc('config_cambiar_estado', { p_membership: memEmp.id, p_estado: 'active' }), 'reactivar')

    // Invitación y alta a cuenta existente: la misma RPC que usa la Edge Function
    // DESPUÉS de Auth. Acá no se llama a Auth para invitar: no se envía ningún correo.
    const invitada = await usuario(null, 'invitada', { nombre: 'ZZ Invitada' })
    ok(await s.rpc('config_registrar_miembro', { p_actor: id.admin.id, p_company: A, p_user: invitada.id, p_rol: 'technician', p_nombre: 'ZZ Invitada', p_evento: 'USER_INVITED' }), 'invitada')
    ok(await s.rpc('config_registrar_miembro', { p_actor: id.admin.id, p_company: A, p_user: id.adminB.id, p_rol: 'employee', p_nombre: null, p_evento: 'MEMBERSHIP_ADDED' }), 'alta existente')
    const { data: memInv } = await s.from('company_memberships').select('id').eq('user_id', invitada.id).eq('company_id', A).single()
    ok(await s.rpc('config_auditar_reenvio', { p_actor: id.admin.id, p_membership: memInv.id }), 'reenvío')
    // Se le quita a B el acceso a A por SQL (operación de plataforma) para seguir probando privacidad.
    await s.from('company_memberships').delete().eq('user_id', id.adminB.id).eq('company_id', A)

    const { data: emp } = await s.from('companies').select('updated_at').eq('id', A).single()
    ok(await c.rpc('config_empresa_actualizar', { p_company: A, p_esperado: emp.updated_at, p_datos: { phone: '011 4444-5555', legal_name: 'ZZ E4 SA' } }), 'empresa')

    const logo = async (campos, archivo) => {
      const fd = new FormData()
      for (const [k, v] of Object.entries(campos)) fd.append(k, v)
      if (archivo) fd.append('archivo', new Blob([archivo], { type: 'image/png' }), 'logo.png')
      const r = await fetch(FN_LOGO, { method: 'POST', headers: { apikey: PUB, Authorization: `Bearer ${id.admin.token}`, Origin: 'https://app.buscatools.com' }, body: fd })
      return r.status
    }
    const version = async () => (await s.from('companies').select('updated_at').eq('id', A).single()).data.updated_at
    cmp('logo: subir y quitar por la Edge Function', [200, 200], [await logo({ accion: 'subir', company_id: A, version: await version() }, PNG), await logo({ accion: 'eliminar', company_id: A, version: await version() })])

    const marca = ok(await c.rpc('config_marca_crear', { p_company: A, p_datos: { name: 'ZZ Marca 50%_E4' } }), 'marca')[0]
    ok(await c.rpc('config_marca_estado', { p_company: A, p_marca: marca.id, p_activa: false }), 'marca off')
    const efimera = ok(await c.rpc('config_marca_crear', { p_company: A, p_datos: { name: 'ZZ Marca efímera' } }), 'marca 2')[0]
    ok(await c.rpc('config_marca_eliminar', { p_company: A, p_marca: efimera.id }), 'marca borrar')
    const cat = ok(await c.rpc('config_categoria_crear', { p_company: A, p_datos: { name: 'ZZ Categoría E4' } }), 'cat')[0]
    ok(await c.rpc('config_categoria_renombrar', { p_company: A, p_categoria: cat.id, p_esperado: 'ZZ Categoría E4', p_datos: { name: 'ZZ Categoría renombrada' } }), 'cat renombrar')

    ok(await s.from('document_numbering_authority').insert({ company_id: A, doc_type: 'quote', authority: 'STEL', reason: 'ZZ E4 motivo de prueba' }), 'autoridad')
    ok(await s.from('document_numbering_authority').update({ authority: 'ERP', reason: 'ZZ E4 cutover de prueba' }).eq('company_id', A).eq('doc_type', 'quote'), 'autoridad update')

    // Lecturas (no deben escribir auditoría)
    const antesLecturas = await sumaBitacoras()
    for (let i = 0; i < 3; i++) { await listar(c, A); await c.rpc('config_auditoria_actores', { p_company: A }); await c.rpc('config_marcas_listar', { p_company: A }); await c.rpc('config_empresa_obtener', { p_company: A }) }

    const r = await listar(c, A)
    const eventos = (r.data ?? []).map((e) => e.evento)
    const conteo = eventos.reduce((m, e) => ({ ...m, [e]: (m[e] ?? 0) + 1 }), {})
    cmp('eventos generados (+2 del suspender/reactivar admin2 de §1)', {
      BRAND_CREATED: 2, BRAND_DELETED: 1, BRAND_DISABLED: 1, CATEGORY_CREATED: 1, CATEGORY_UPDATED: 1,
      COMPANY_LOGO_REMOVED: 1, COMPANY_LOGO_UPDATED: 1, COMPANY_UPDATED: 1,
      INVITATION_RESENT: 1, MEMBERSHIP_ADDED: 1, MEMBERSHIP_REACTIVATED: 2, MEMBERSHIP_ROLE_CHANGED: 2, MEMBERSHIP_SUSPENDED: 2,
      NUMBERING_AUTHORITY_INSERT: 1, NUMBERING_AUTHORITY_UPDATE: 1, USER_INVITED: 1,
    }, Object.fromEntries(Object.entries(conteo).sort()))
    const esperado = await sumaBitacoras()
    cmp('total del visor = suma de las 4 bitácoras de la empresa', esperado, r.data?.[0]?.total)
    cmp('12 lecturas no escribieron auditoría', antesLecturas, esperado)
  }

  seccion('3 · Contenido de los eventos')
  const todos = (await listar(id.admin.c, A)).data ?? []
  {
    const por = (ev) => todos.filter((e) => e.evento === ev)
    const rol = por('MEMBERSHIP_ROLE_CHANGED').find((e) => e.detalles.rol_nuevo === 'salesperson')
    cmp('rol cambiado: actor, entidad y detalle', { actor: 'ZZ Admin Uno', actorEmail: id.admin.email, entidad: 'ZZ Empleada', existe: true, det: ordenar({ rol_anterior: 'employee', rol_nuevo: 'salesperson', estado_anterior: 'active', estado_nuevo: 'active', email_afectado: id.employee.email }) },
      rol && { actor: rol.actor?.nombre, actorEmail: rol.actor?.email, entidad: rol.entidad_nombre, existe: rol.entidad_existe, det: ordenar(rol.detalles) })
    const inv = por('USER_INVITED')[0]
    cmp('invitación: persona invitada con su rol', ['ZZ Invitada', 'technician', 'usuarios'], inv && [inv.entidad_nombre, inv.detalles.rol_nuevo, inv.modulo])
    const add = por('MEMBERSHIP_ADDED')[0]
    cmp('alta a cuenta que YA NO es miembro: nombre sí, email no, marcada como fuera', ['ZZ Admin de B', undefined, false], add && [add.entidad_nombre, add.detalles.email_afectado, add.entidad_existe])
    const emp = por('COMPANY_UPDATED')[0]
    cmp('empresa: sólo nombres de campos, sin valores', { campos: ['legal_name', 'phone'] }, emp && { campos: [...emp.detalles.campos].sort() })
    cmp('empresa: el valor nuevo no aparece en ningún evento', false, JSON.stringify(todos).includes('4444-5555'))
    const borrada = por('BRAND_DELETED')[0]
    cmp('marca eliminada: snapshot del nombre y existe=false', ['ZZ Marca efímera', false], borrada && [borrada.entidad_nombre, borrada.entidad_existe])
    const ren = por('CATEGORY_UPDATED')[0]
    cmp('categoría renombrada: nombre actual y registrado', ['ZZ Categoría renombrada', true, 'ZZ Categoría renombrada'], ren && [ren.entidad_nombre, ren.entidad_existe, ren.detalles.nombre_registrado])
    const num = por('NUMBERING_AUTHORITY_UPDATE')[0]
    cmp('numeración: actor nulo (no se inventa), origen técnico y cambio', { actor: null, det: ordenar({ motivo: 'ZZ E4 cutover de prueba', origen_tecnico: 'service_role', tipo_documento: 'quote', autoridad_nueva: 'ERP', autoridad_anterior: 'STEL' }) }, num && { actor: num.actor, det: ordenar(num.detalles) })
    const permitidas = new Set(['rol_anterior', 'rol_nuevo', 'estado_anterior', 'estado_nuevo', 'email_afectado', 'campos', 'nombre_registrado', 'tipo_documento', 'autoridad_anterior', 'autoridad_nueva', 'motivo', 'origen_tecnico'])
    const claves = [...new Set(todos.flatMap((e) => Object.keys(e.detalles)))]
    cmp('detalles: sólo claves de la lista blanca', [], claves.filter((k) => !permitidas.has(k)))
    cmp('ningún token, contraseña, enlace ni header', false, /token|password|access_token|refresh|invite_link|recovery|authorization|smtp/i.test(JSON.stringify(todos)))
    const act = (await id.admin.c.rpc('config_auditoria_actores', { p_company: A })).data ?? []
    cmp('actores con eventos (sin actor nulo)', [['ZZ Admin Uno', id.admin.email]], act.map((a) => [a.nombre, a.email]))
  }

  seccion('4 · Multiempresa')
  {
    // Evento en B hecho por el admin de B.
    ok(await id.adminB.c.rpc('config_marca_crear', { p_company: B, p_datos: { name: 'ZZ Marca de B' } }), 'marca B')
    const b = (await listar(id.adminB.c, B)).data ?? []
    cmp('admin de B ve sólo su evento', [1, 'ZZ Marca de B'], [b.length, b[0]?.entidad_nombre])
    const a = (await listar(id.admin.c, A)).data ?? []
    cmp('en A no aparece nada de B', false, a.some((e) => e.entidad_nombre === 'ZZ Marca de B'))
    // Evento en A cuyo actor no es miembro de A (insertado por plataforma).
    ok(await s.from('catalog_audit').insert({ company_id: A, entity_type: 'brand', entity_id: randomUUID(), entity_name: 'ZZ actor ajeno', action: 'BRAND_CREATED', changed_fields: ['name'], actor_id: id.adminB.id }), 'actor ajeno')
    const aj = ((await listar(id.admin.c, A, { p_texto: 'actor ajeno' })).data ?? [])[0]
    cmp('actor que no es miembro de A: nombre sí, email no', ['ZZ Admin de B', null, false], aj && [aj.actor?.nombre, aj.actor?.email, aj.actor?.miembro])
  }

  seccion('5 · Filtros server-side')
  {
    const c = id.admin.c
    const n = async (extra) => { const r = await listar(c, A, extra); return r.error ? clase(r) : (r.data ?? []).length }
    const total = await n({})
    cmp('módulo', { usuarios: 9, empresa: 3, catalogo: 7, numeracion: 2 }, { usuarios: await n({ p_modulo: 'usuarios' }), empresa: await n({ p_modulo: 'empresa' }), catalogo: await n({ p_modulo: 'catalogo' }), numeracion: await n({ p_modulo: 'numeracion' }) })
    cmp('evento', [2, 1], [await n({ p_evento: 'MEMBERSHIP_SUSPENDED' }), await n({ p_evento: 'COMPANY_LOGO_REMOVED' })])
    cmp('actor', [total - 3, 0], [await n({ p_actor: id.admin.id }), await n({ p_actor: id.employee.id })])
    cmp('fechas (hora de Argentina)', [total, total, 0, 0, total], [await n({ p_desde: HOY_AR }), await n({ p_hasta: HOY_AR }), await n({ p_desde: dia(1) }), await n({ p_hasta: dia(-1) }), await n({ p_desde: dia(-1), p_hasta: dia(1) })])
    cmp('texto: marca, email afectado, motivo, comodines literales', [2, 4, 1, 2, 0], [
      await n({ p_texto: 'zz marca 50%' }),
      await n({ p_texto: id.employee.email }),
      await n({ p_texto: 'cutover de prueba' }),
      await n({ p_texto: '50%_' }),
      await n({ p_texto: '%%%' }),
    ])
    cmp('combinados: catálogo + BRAND_DISABLED + admin + hoy', 1, await n({ p_modulo: 'catalogo', p_evento: 'BRAND_DISABLED', p_actor: id.admin.id, p_desde: HOY_AR, p_hasta: HOY_AR }))
    const malos = []
    for (const extra of [{ p_modulo: 'ventas' }, { p_evento: 'brand_created' }, { p_evento: "X'; drop" }, { p_desde: dia(1), p_hasta: dia(-1) }, { p_limite: 0 }, { p_limite: 101 }, { p_desplazamiento: -1 }, { p_texto: 'x'.repeat(101) }]) malos.push(await n(extra))
    cmp('módulo/evento inválidos, rango al revés, límites y texto largo', Array(8).fill('datos_invalidos'), malos)
  }

  seccion('6 · Paginación estable')
  {
    const filas = Array.from({ length: 120 }, (_, i) => ({ company_id: A, entity_type: 'category', entity_id: randomUUID(), entity_name: `ZZ lote ${String(i).padStart(3, '0')}`, action: 'CATEGORY_CREATED', changed_fields: ['name', 'slug'], actor_id: id.admin.id, created_at: new Date(Date.now() - 60_000 - (i % 7) * 1000).toISOString() }))
    ok(await s.from('catalog_audit').insert(filas), 'lote')
    const total = ((await listar(id.admin.c, A, { p_limite: 1 })).data ?? [])[0]?.total
    const paginas = []
    for (let off = 0; off < total; off += 50) paginas.push((await listar(id.admin.c, A, { p_limite: 50, p_desplazamiento: off })).data ?? [])
    const todas = paginas.flat()
    const esperadas = Array.from({ length: Math.ceil(Number(total) / 50) }, (_, i) => Math.min(50, Number(total) - i * 50))
    cmp('páginas de 50 que suman el total', [Number(total), esperadas], [todas.length, paginas.map((p) => p.length)])
    cmp('sin repetidos', todas.length, new Set(todas.map((e) => `${e.origen}:${e.evento_id}`)).size)
    const ordenado = todas.every((e, i) => i === 0 || todas[i - 1].fecha > e.fecha || (todas[i - 1].fecha === e.fecha && (todas[i - 1].evento_id > e.evento_id || (todas[i - 1].evento_id === e.evento_id && todas[i - 1].origen <= e.origen))))
    cmp('orden fecha desc, id desc (estable con fechas repetidas)', true, ordenado)
    const otraVez = (await listar(id.admin.c, A, { p_limite: 50, p_desplazamiento: 50 })).data ?? []
    cmp('repetir la página 2 da lo mismo', paginas[1].map((e) => e.evento_id), otraVez.map((e) => e.evento_id))
    const t0 = Date.now()
    await listar(id.admin.c, A, { p_limite: 50, p_desplazamiento: 100 })
    INFO('tiempo página 3 (fixture, desde este equipo)', `${Date.now() - t0} ms`)
  }

  seccion('7 · Append-only')
  {
    const c = id.admin.c
    const intentos = []
    for (const t of ['users_audit', 'company_audit', 'catalog_audit']) {
      intentos.push(clase(await c.from(t).delete().eq('company_id', A).select('id')))
      intentos.push(clase(await c.from(t).update({ actor_id: null }).eq('company_id', A).select('id')))
      intentos.push(clase(await c.from(t).insert({ company_id: A, action: 'x' }).select('id')))
    }
    intentos.push(clase(await c.from('document_numbering_authority_audit').select('id')))
    intentos.push(clase(await c.from('document_numbering_authority_audit').delete().eq('company_id', A).select('id')))
    cmp('admin: DELETE/UPDATE/INSERT en bitácoras y lectura directa de la de numeración → rechazado', Array(11).fill('PERMISO'), intentos)
    cmp('no existe RPC para borrar auditoría', ['PGRST202', 'PGRST202'], [(await c.rpc('config_auditoria_borrar', { p_company: A })).error?.code, (await c.rpc('config_auditoria_limpiar', { p_company: A })).error?.code])
    const lectura = (await c.from('catalog_audit').select('id').eq('company_id', A)).data?.length ?? 0
    cmp('lectura directa de catalog_audit sigue siendo del admin (RLS)', true, lectura > 100)
    cmp('employee no lee bitácoras directo', [0, 0, 0], [
      (await id.employee.c.from('users_audit').select('id')).data?.length ?? 0,
      (await id.employee.c.from('company_audit').select('id')).data?.length ?? 0,
      (await id.employee.c.from('catalog_audit').select('id')).data?.length ?? 0,
    ])
  }

  seccion('8 · Limpieza y datos reales intactos')
  await barrer()
  cmp('0 empresas zz-e4 residuales', 0, await cuenta('companies', (q) => q.like('slug', `${MARCA}-%`)))
  let residuales = 0
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    residuales += (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length
    if ((us?.users ?? []).length < 1000) break
  }
  cmp('0 usuarios zz-e4 residuales', 0, residuales)
  cmp('empresas, membresías, bitácoras, autoridad, marcas y categorías reales idénticas', huellaAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? '✓ TODO PASA' : `✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ Error inesperado:', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
