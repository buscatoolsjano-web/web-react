/**
 * Fase 12 · Configuración — Entrega 1: usuarios, roles e invitaciones.
 * Pruebas REALES contra la base y la Edge Function desplegada.
 *
 *   1  lógica pura de la Edge Function (validación, decisión, CORS, errores);
 *   2  matriz de permisos de las RPC: admin, admin 2, employee, salesperson,
 *      technician, customer, distributor, admin de otra empresa y anon;
 *   3  sin escrituras directas: memberships y users_audit por REST con JWT;
 *      RPC de servicio cerradas para authenticated y anon;
 *   4  invariante del último admin: degradarse, suspenderse, suspender al otro,
 *      y CONCURRENCIA (dos admins degradándose a la vez, varias rondas);
 *   5  bitácora: eventos, actor, lectura sólo del admin de la empresa;
 *   6  API red team: sin JWT, JWT inválido, JWT de sesión cerrada, empleado,
 *      admin ajeno, company_id ajeno, rol inválido, email inválido, campos
 *      extra, user_id inyectado, CORS;
 *   7  idempotencia y multiempresa: cuenta existente a otra empresa (sin
 *      duplicar identidad), mayúsculas, repetir, membresía suspendida, cuenta
 *      sin confirmar, reenvío, email nuevo (sonda del mailer por defecto);
 *   8  datos reales intactos: huella de memberships y perfiles de las empresas
 *      reales antes y después.
 *
 * Fixtures: empresas zz-cfg1-* y usuarios zz-cfg1-*@buscatools.test, borrados
 * al final. Ningún correo sale hacia una persona: Supabase Auth rechaza las
 * direcciones .test (`email_address_invalid`) antes de enviar (sección 7).
 * Ojo: cada intento cuenta para el límite de envíos del proyecto.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node --experimental-strip-types scripts/fase12-configuracion-entrega1-tests.mjs
 *
 * NO correrla en paralelo con otra suite de base.
 *
 * ENVÍOS: con SMTP propio configurado, invitar a una cuenta nueva o sin confirmar
 * MANDA un correo real. Por defecto esos casos NO se ejecutan. Para correrlos
 * (sólo con direcciones controladas): agregar `--con-envios`.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const logica = await import('../supabase/functions/config-usuarios/logica.ts').catch((e) => { console.error('✗ logica.ts (¿falta --experimental-strip-types?):', e.message); process.exit(1) })

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const INFO = (t, d = '') => console.log(`    INFO  ${t}${d ? ' — ' + d : ''}`)
const cmp = (t, esp, real) => (JSON.stringify(esp) === JSON.stringify(real) ? PASS(t, String(JSON.stringify(real)).slice(0, 140)) : FAIL(t, `esperaba ${JSON.stringify(esp)}, dio ${JSON.stringify(real)}`))

const s = createClient(BASE, SECRET, { auth: { persistSession: false } })
const MARCA = 'zz-cfg1'
const FN = `${BASE}/functions/v1/config-usuarios`
const ORIGEN_APP = 'https://app.buscatools.com'
const CON_ENVIOS = process.argv.includes('--con-envios')

const nuevoEmail = (etq) => `${MARCA}-${etq}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
const cuentas = new Map()
const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c, token: data.session.access_token, id: data.user.id, email }
}
const usuario = async (companyId, rol, customerId = null, etq = rol) => {
  const email = nuevoEmail(etq)
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  if (companyId) {
    const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
    if (customerId) fila.customer_id = customerId
    const { error: eM } = await s.from('company_memberships').insert(fila)
    if (eM) throw new Error(`membresía ${rol}: ${eM.message}`)
  }
  const sesion = await login(email, password)
  cuentas.set(etq, { ...sesion, password })
  return sesion
}
const membresia = async (userId, companyId) => (await s.from('company_memberships').select('id, role, status').eq('user_id', userId).eq('company_id', companyId).maybeSingle()).data
const llamar = async (cuerpo, { token, origen = ORIGEN_APP, apikey = PUB, metodo = 'POST', crudo } = {}) => {
  const headers = { apikey, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (origen) headers.Origin = origen
  const r = await fetch(FN, { method: metodo, headers, body: metodo === 'POST' ? (crudo ?? JSON.stringify(cuerpo)) : undefined })
  const texto = await r.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* no json */ }
  return { status: r.status, json, texto, headers: r.headers }
}
const esSinPermiso = (r) => !!r.error && /sin_permiso/.test(r.error.message)
const esDenegado = (r) => !!r.error && (/permission denied|42501|sin_permiso|not found|Could not find/i.test(`${r.error.message} ${r.error.code}`))

async function contarAuthPorEmail(email) {
  let n = 0
  for (let page = 1; ; page++) {
    const { data } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    n += (data?.users ?? []).filter((u) => (u.email ?? '').toLowerCase() === email.toLowerCase()).length
    if ((data?.users ?? []).length < 1000) return n
  }
}
async function huellaReal() {
  const { data: reales } = await s.from('companies').select('id, slug').not('slug', 'like', 'zz-%').order('slug')
  const ids = reales.map((c) => c.id)
  const { data: m } = await s.from('company_memberships').select('id, user_id, company_id, role, status, updated_at').in('company_id', ids).order('id')
  const usuarios = [...new Set(m.map((x) => x.user_id))]
  const { data: p } = await s.from('profiles').select('id, full_name, is_active, updated_at').in('id', usuarios).order('id')
  return createHash('sha256').update(JSON.stringify({ m, p })).digest('hex').slice(0, 16)
}
const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
  }
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    for (const u of us?.users ?? []) if (u.email?.startsWith(`${MARCA}-`)) { await s.from('company_memberships').delete().eq('user_id', u.id); await s.auth.admin.deleteUser(u.id) }
    if ((us?.users ?? []).length < 1000) break
  }
  if (ids.length) {
    await s.from('warehouses').delete().in('company_id', ids)
    await s.from('companies').delete().in('id', ids)
  }
}

const main = async () => {
  await barrer()
  const huellaAntes = await huellaReal()

  seccion('1 · Lógica pura de la Edge Function')
  {
    const U = '00000000-0000-4000-8000-000000000000'
    cmp('normaliza el email', 'ana@buscatools.test', logica.validarPedido({ accion: 'invitar', company_id: U, email: '  Ana@BuscaTools.TEST ', rol: 'employee' }).email)
    cmp('rol externo o inventado → rol_invalido', ['rol_invalido', 'rol_invalido', 'rol_invalido'], ['customer', 'owner', 'supplier'].map((rol) => logica.validarPedido({ accion: 'invitar', company_id: U, email: 'a@b.co', rol }).error))
    cmp('campo extra → campos_no_permitidos', { error: 'campos_no_permitidos', campo: 'user_id' }, logica.validarPedido({ accion: 'invitar', company_id: U, email: 'a@b.co', rol: 'admin', user_id: U }))
    cmp('email inválido', ['email_invalido', 'email_invalido', 'email_invalido'], ['sin-arroba', 'a@b', `${'x'.repeat(250)}@b.co`].map((email) => logica.validarPedido({ accion: 'invitar', company_id: U, email, rol: 'admin' }).error))
    cmp('company_id no uuid', 'datos_invalidos', logica.validarPedido({ accion: 'invitar', company_id: "x' or 1=1", email: 'a@b.co', rol: 'admin' }).error)
    cmp('acción desconocida', 'datos_invalidos', logica.validarPedido({ accion: 'borrar' }).error)
    cmp('decisión: sin cuenta / confirmada / sin confirmar / miembro / suspendida / bloqueada / duplicada',
      ['crear_e_invitar', 'agregar:false', 'agregar:true', 'ya_es_miembro', 'membresia_suspendida', 'cuenta_bloqueada', 'identidad_ambigua'],
      [
        [{ user_id: null }],
        [{ user_id: U, email_confirmado: true, membership_id: null }],
        [{ user_id: U, email_confirmado: false, membership_id: null }],
        [{ user_id: U, email_confirmado: true, membership_id: U, membership_estado: 'active' }],
        [{ user_id: U, email_confirmado: true, membership_id: U, membership_estado: 'suspended' }],
        [{ user_id: U, email_confirmado: true, bloqueada: true, membership_id: null }],
        [{ user_id: U }, { user_id: U }],
      ].map((f) => { const d = logica.decidirInvitacion(f); return d.tipo === 'agregar' ? `agregar:${d.enviarInvitacion}` : d.tipo === 'conflicto' ? d.error : d.tipo }))
    cmp('destino del enlace: sólo orígenes conocidos', ['https://app.buscatools.com/', 'http://localhost:5173/', 'https://app.buscatools.com/', 'https://app.buscatools.com/'], [ORIGEN_APP, 'http://localhost:5173', 'https://evil.example', null].map((o) => logica.destinoEnlace(o)))
    cmp('errores de Auth clasificados sin texto crudo', ['correo_no_autorizado', 'demasiados_envios', 'correo_no_enviado', 'email_rechazado'], [{ code: 'email_address_not_authorized', message: 'Email address "x" cannot be used' }, { status: 429 }, { message: 'boom' }, { code: 'email_address_invalid' }].map((e) => logica.clasificarErrorAuth(e).error))
    cmp('mensajes de base desconocidos no se exponen', null, logica.codigoDeErrorBase('duplicate key value violates unique constraint "x"'))
  }

  seccion('2 · Matriz de permisos de las RPC')
  const { data: emp } = await s.from('companies').insert({ slug: `${MARCA}-propia-${Date.now()}`, name: 'ZZ-CFG1', default_currency: 'ARS' }).select('id').single()
  const { data: empX } = await s.from('companies').insert({ slug: `${MARCA}-ajena-${Date.now()}`, name: 'ZZ-CFG1 ajena', default_currency: 'ARS' }).select('id').single()
  const ZZ = emp.id
  const ZX = empX.id
  const { data: cli } = await s.from('customers').insert({ company_id: ZZ, legal_name: 'ZZ-CFG1 cliente' }).select('id').single()
  const id = {
    admin: await usuario(ZZ, 'admin'), admin2: await usuario(ZZ, 'admin', null, 'admin2'), employee: await usuario(ZZ, 'employee'),
    salesperson: await usuario(ZZ, 'salesperson'), technician: await usuario(ZZ, 'technician'),
    customer: await usuario(ZZ, 'customer', cli.id), distributor: await usuario(ZZ, 'distributor', cli.id, 'distributor'),
    ajeno: await usuario(ZX, 'admin', null, 'ajeno'),
  }
  const anon = createClient(BASE, PUB, { auth: { persistSession: false } })
  const mEmployee = await membresia(id.employee.id, ZZ)
  const mAjeno = await membresia(id.ajeno.id, ZX)
  {
    const r = await id.admin.c.rpc('config_listar_usuarios', { p_company: ZZ })
    cmp('admin lista los 7 miembros de SU empresa', 7, r.data?.length ?? r.error?.message)
    cmp('la lista no incluye al admin de otra empresa', false, (r.data ?? []).some((u) => u.user_id === id.ajeno.id))
    cmp('marca la membresía propia', [id.admin.id], (r.data ?? []).filter((u) => u.es_propia).map((u) => u.user_id))
    cmp('columnas exactas (sin tokens, hashes ni metadatos)', ['alta', 'bloqueada', 'cliente', 'email', 'email_confirmado', 'es_propia', 'estado', 'invitado_el', 'membership_id', 'nombre', 'rol', 'ultimo_ingreso', 'user_id'], Object.keys(r.data?.[0] ?? {}).sort())
    const noAdmins = ['employee', 'salesperson', 'technician', 'customer', 'distributor', 'ajeno']
    const listar = []
    const cambiarRol = []
    const cambiarEstado = []
    for (const k of noAdmins) {
      if (!esSinPermiso(await id[k].c.rpc('config_listar_usuarios', { p_company: ZZ }))) listar.push(k)
      if (!esSinPermiso(await id[k].c.rpc('config_cambiar_rol', { p_membership: mEmployee.id, p_rol: 'admin' }))) cambiarRol.push(k)
      if (!esSinPermiso(await id[k].c.rpc('config_cambiar_estado', { p_membership: mEmployee.id, p_estado: 'suspended' }))) cambiarEstado.push(k)
    }
    cmp('employee, salesperson, technician, customer, distributor y admin ajeno: listar → sin_permiso', [], listar)
    cmp('los mismos: cambiar rol (employee → admin) → sin_permiso', [], cambiarRol)
    cmp('los mismos: suspender → sin_permiso', [], cambiarEstado)
    cmp('employee no se auto-eleva', 'employee', (await membresia(id.employee.id, ZZ)).role)
    cmp('anon: las tres RPC rechazadas', [true, true, true], [
      esDenegado(await anon.rpc('config_listar_usuarios', { p_company: ZZ })),
      esDenegado(await anon.rpc('config_cambiar_rol', { p_membership: mEmployee.id, p_rol: 'admin' })),
      esDenegado(await anon.rpc('config_cambiar_estado', { p_membership: mEmployee.id, p_estado: 'suspended' })),
    ])
    cmp('admin de ZZ sobre la membresía de otra empresa → sin_permiso', [true, true], [
      esSinPermiso(await id.admin.c.rpc('config_cambiar_rol', { p_membership: mAjeno.id, p_rol: 'employee' })),
      esSinPermiso(await id.admin.c.rpc('config_cambiar_estado', { p_membership: mAjeno.id, p_estado: 'suspended' })),
    ])
    cmp('membresía inexistente → sin_permiso (no confirma ids)', true, esSinPermiso(await id.admin.c.rpc('config_cambiar_rol', { p_membership: randomUUID(), p_rol: 'employee' })))
    cmp('empresa nula → sin_permiso', true, esSinPermiso(await id.admin.c.rpc('config_listar_usuarios', { p_company: null })))
    cmp('admin ajeno no lista ZZ; admin de ZZ no lista la ajena', [true, true], [esSinPermiso(await id.ajeno.c.rpc('config_listar_usuarios', { p_company: ZZ })), esSinPermiso(await id.admin.c.rpc('config_listar_usuarios', { p_company: ZX }))])
    const rInv = await id.admin.c.rpc('config_cambiar_rol', { p_membership: mEmployee.id, p_rol: 'owner' })
    cmp('rol inventado → rol_invalido', true, /rol_invalido/.test(rInv.error?.message ?? ''))
    const mCustomer = await membresia(id.customer.id, ZZ)
    cmp('rol externo no se cambia desde la UI (rol_externo)', true, /rol_externo/.test((await id.admin.c.rpc('config_cambiar_rol', { p_membership: mCustomer.id, p_rol: 'employee' })).error?.message ?? ''))
    cmp('estado inventado → estado_invalido', true, /estado_invalido/.test((await id.admin.c.rpc('config_cambiar_estado', { p_membership: mEmployee.id, p_estado: 'deleted' })).error?.message ?? ''))
    const ok = await id.admin.c.rpc('config_cambiar_rol', { p_membership: mEmployee.id, p_rol: 'salesperson' })
    cmp('admin cambia employee → salesperson', 'salesperson', ok.data?.[0]?.rol ?? ok.error?.message)
    const sus = await id.admin.c.rpc('config_cambiar_estado', { p_membership: mEmployee.id, p_estado: 'suspended' })
    cmp('admin suspende', 'suspended', sus.data?.[0]?.estado ?? sus.error?.message)
    cmp('suspendido pierde el acceso a la empresa (RLS)', [1, 0], [((await id.salesperson.c.from('companies').select('id').eq('id', ZZ)).data ?? []).length, ((await id.employee.c.from('companies').select('id').eq('id', ZZ)).data ?? []).length])
    const rea = await id.admin.c.rpc('config_cambiar_estado', { p_membership: mEmployee.id, p_estado: 'active' })
    cmp('admin reactiva (reversible, misma membresía)', ['active', mEmployee.id], [rea.data?.[0]?.estado, rea.data?.[0]?.membership_id])
    await id.admin.c.rpc('config_cambiar_rol', { p_membership: mEmployee.id, p_rol: 'employee' })
  }

  seccion('3 · Sin escrituras directas')
  {
    const mAdmin2 = await membresia(id.admin2.id, ZZ)
    const ins = await id.admin.c.from('company_memberships').insert({ company_id: ZZ, user_id: id.ajeno.id, role: 'admin', status: 'active' }).select('id')
    cmp('admin NO inserta memberships por REST', true, !!ins.error)
    const upd = await id.admin.c.from('company_memberships').update({ role: 'employee' }).eq('id', mAdmin2.id).select('id')
    cmp('admin NO actualiza memberships por REST', true, !!upd.error || (upd.data ?? []).length === 0)
    const updUser = await id.admin.c.from('company_memberships').update({ user_id: id.ajeno.id }).eq('id', mEmployee.id).select('id')
    cmp('admin NO reasigna user_id por REST', true, !!updUser.error || (updUser.data ?? []).length === 0)
    const del = await id.admin.c.from('company_memberships').delete().eq('id', mEmployee.id).select('id')
    cmp('admin NO borra memberships por REST', true, !!del.error || (del.data ?? []).length === 0)
    cmp('las membresías siguen iguales', ['admin', 'employee'], [(await membresia(id.admin2.id, ZZ)).role, (await membresia(id.employee.id, ZZ)).role])
    const insAud = await id.admin.c.from('users_audit').insert({ company_id: ZZ, membership_id: mEmployee.id, action: 'USER_INVITED' }).select('id')
    cmp('admin NO escribe users_audit', true, !!insAud.error)
    const svc = ['config_validar_invitacion', 'config_registrar_miembro', 'config_preparar_reenvio', 'config_auditar_reenvio']
    const args = {
      config_validar_invitacion: { p_actor: id.admin.id, p_company: ZZ, p_email: 'x@buscatools.test', p_rol: 'admin' },
      config_registrar_miembro: { p_actor: id.admin.id, p_company: ZZ, p_user: id.ajeno.id, p_rol: 'admin', p_nombre: null, p_evento: 'MEMBERSHIP_ADDED' },
      config_preparar_reenvio: { p_actor: id.admin.id, p_membership: mEmployee.id },
      config_auditar_reenvio: { p_actor: id.admin.id, p_membership: mEmployee.id },
    }
    const abiertas = []
    for (const f of svc) {
      if (!esDenegado(await id.admin.c.rpc(f, args[f]))) abiertas.push(`admin:${f}`)
      if (!esDenegado(await anon.rpc(f, args[f]))) abiertas.push(`anon:${f}`)
    }
    cmp('RPC de servicio cerradas para authenticated (incluso admin) y anon', [], abiertas)
    cmp('nadie se coló en la empresa ajena', null, await membresia(id.ajeno.id, ZZ))
    const perfil = await id.employee.c.from('profiles').update({ phone: '000' }).eq('id', id.employee.id).select('id')
    cmp('el perfil propio sigue editable (sin cambios de RLS en profiles)', 1, (perfil.data ?? []).length)
    const perfilAjeno = await id.employee.c.from('profiles').update({ full_name: 'hack' }).eq('id', id.admin.id).select('id')
    cmp('un perfil ajeno no', 0, (perfilAjeno.data ?? []).length)
  }

  seccion('4 · Último admin (base, no UI)')
  {
    const mA = await membresia(id.admin.id, ZZ)
    const mB = await membresia(id.admin2.id, ZZ)
    cmp('suspenderse a uno mismo → no_auto_suspension', true, /no_auto_suspension/.test((await id.admin.c.rpc('config_cambiar_estado', { p_membership: mA.id, p_estado: 'suspended' })).error?.message ?? ''))
    const r1 = await id.admin.c.rpc('config_cambiar_rol', { p_membership: mB.id, p_rol: 'employee' })
    cmp('con dos admins, A degrada a B', 'employee', r1.data?.[0]?.rol ?? r1.error?.message)
    cmp('A, único admin, NO puede degradarse (ultimo_admin)', true, /ultimo_admin/.test((await id.admin.c.rpc('config_cambiar_rol', { p_membership: mA.id, p_rol: 'employee' })).error?.message ?? ''))
    cmp('A sigue siendo admin', 'admin', (await membresia(id.admin.id, ZZ)).role)
    const svcUpd = await s.from('company_memberships').update({ role: 'employee' }).eq('id', mA.id).select('id')
    cmp('el invariante vale también para UPDATE con clave de servicio', true, /ultimo_admin/.test(svcUpd.error?.message ?? ''))
    const svcSus = await s.from('company_memberships').update({ status: 'suspended' }).eq('id', mA.id).select('id')
    cmp('…y para suspender por UPDATE directo', true, /ultimo_admin/.test(svcSus.error?.message ?? ''))
    await id.admin.c.rpc('config_cambiar_rol', { p_membership: mB.id, p_rol: 'admin' })
    const sB = await id.admin.c.rpc('config_cambiar_estado', { p_membership: mB.id, p_estado: 'suspended' })
    cmp('con dos admins, A suspende a B', 'suspended', sB.data?.[0]?.estado ?? sB.error?.message)
    cmp('B suspendido no cuenta: A no puede degradarse', true, /ultimo_admin/.test((await id.admin.c.rpc('config_cambiar_rol', { p_membership: mA.id, p_rol: 'technician' })).error?.message ?? ''))
    await id.admin.c.rpc('config_cambiar_estado', { p_membership: mB.id, p_estado: 'active' })

    // Concurrencia: A degrada a B y B degrada a A en el mismo instante.
    const rondas = 8
    const resultados = []
    for (let i = 0; i < rondas; i++) {
      await s.from('company_memberships').update({ role: 'admin', status: 'active' }).in('id', [mA.id, mB.id])
      const [x, y] = await Promise.all([
        id.admin.c.rpc('config_cambiar_rol', { p_membership: mB.id, p_rol: 'employee' }),
        id.admin2.c.rpc('config_cambiar_rol', { p_membership: mA.id, p_rol: 'employee' }),
      ])
      const { count } = await s.from('company_memberships').select('id', { count: 'exact', head: true }).eq('company_id', ZZ).eq('role', 'admin').eq('status', 'active')
      resultados.push({ ok: [x, y].filter((r) => !r.error).length, ultimo: [x, y].filter((r) => /ultimo_admin|sin_permiso/.test(r.error?.message ?? '')).length, admins: count })
    }
    cmp(`concurrencia (${rondas} rondas): nunca 0 admins`, 0, resultados.filter((r) => r.admins < 1).length)
    cmp('concurrencia: en cada ronda exactamente un cambio pasa', rondas, resultados.filter((r) => r.ok === 1 && r.ultimo === 1).length)
    // Suspensiones cruzadas simultáneas.
    const cruz = []
    for (let i = 0; i < 4; i++) {
      await s.from('company_memberships').update({ role: 'admin', status: 'active' }).in('id', [mA.id, mB.id])
      await Promise.all([
        id.admin.c.rpc('config_cambiar_estado', { p_membership: mB.id, p_estado: 'suspended' }),
        id.admin2.c.rpc('config_cambiar_estado', { p_membership: mA.id, p_estado: 'suspended' }),
      ])
      const { count } = await s.from('company_memberships').select('id', { count: 'exact', head: true }).eq('company_id', ZZ).eq('role', 'admin').eq('status', 'active')
      cruz.push(count)
    }
    cmp('suspensiones cruzadas simultáneas: siempre queda 1 admin activo', [1, 1, 1, 1], cruz)
    await s.from('company_memberships').update({ role: 'admin', status: 'active' }).in('id', [mA.id, mB.id])
  }

  seccion('5 · Bitácora')
  {
    const { data: aud } = await s.from('users_audit').select('action, actor_id, membership_id, from_role, to_role, from_status, to_status').eq('company_id', ZZ).order('id')
    const acciones = [...new Set((aud ?? []).map((a) => a.action))].sort()
    cmp('eventos de rol, suspensión y reactivación registrados', ['MEMBERSHIP_REACTIVATED', 'MEMBERSHIP_ROLE_CHANGED', 'MEMBERSHIP_SUSPENDED'], acciones.filter((a) => a !== 'USER_INVITED' && a !== 'MEMBERSHIP_ADDED'))
    const primero = (aud ?? []).find((a) => a.action === 'MEMBERSHIP_ROLE_CHANGED' && a.membership_id === mEmployee.id)
    cmp('actor = el admin que cambió; from/to correctos', [id.admin.id, 'employee', 'salesperson'], [primero?.actor_id, primero?.from_role, primero?.to_role])
    cmp('cambios hechos con la clave de servicio quedan sin actor (no se inventa)', true, (aud ?? []).some((a) => a.actor_id === null))
    cmp('admin de ZZ lee la bitácora de ZZ', true, ((await id.admin.c.from('users_audit').select('id').eq('company_id', ZZ)).data ?? []).length > 0)
    const noLeen = []
    for (const k of ['employee', 'salesperson', 'technician', 'customer', 'distributor', 'ajeno']) if (((await id[k].c.from('users_audit').select('id').eq('company_id', ZZ)).data ?? []).length) noLeen.push(k)
    cmp('nadie más la lee', [], noLeen)
    cmp('anon no la lee', true, esDenegado(await anon.from('users_audit').select('id').limit(1)) || ((await anon.from('users_audit').select('id').limit(1)).data ?? []).length === 0)
    const cols = Object.keys((await s.from('users_audit').select('*').limit(1)).data?.[0] ?? {}).sort()
    cmp('sin columnas de contraseña, token ni enlace', [], cols.filter((c) => /pass|token|link|secret|hash/i.test(c)))
  }

  seccion('6 · API red team (Edge Function desplegada)')
  {
    const cuerpoOk = (email, rol = 'employee', company = ZZ) => ({ accion: 'invitar', company_id: company, email, rol })
    const destino = nuevoEmail('redteam')
    cmp('sin JWT → 401', 401, (await llamar(cuerpoOk(destino))).status)
    cmp('JWT inválido → 401', 401, (await llamar(cuerpoOk(destino), { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma' })).status)
    const trucado = id.admin.token.slice(0, -4) + (id.admin.token.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    cmp('JWT con firma alterada → 401', 401, (await llamar(cuerpoOk(destino), { token: trucado })).status)
    cmp('GET → 405', 405, (await llamar(null, { token: id.admin.token, metodo: 'GET' })).status)
    cmp('cuerpo no JSON → 400', 400, (await llamar(null, { token: id.admin.token, crudo: '{nope' })).status)
    const casos = [
      ['employee invita → 403', id.employee.token, cuerpoOk(destino), 403, 'sin_permiso'],
      ['salesperson invita → 403', id.salesperson.token, cuerpoOk(destino), 403, 'sin_permiso'],
      ['technician invita → 403', id.technician.token, cuerpoOk(destino), 403, 'sin_permiso'],
      ['customer invita → 403', id.customer.token, cuerpoOk(destino), 403, 'sin_permiso'],
      ['distributor invita → 403', id.distributor.token, cuerpoOk(destino), 403, 'sin_permiso'],
      ['admin ajeno invita a ZZ → 403', id.ajeno.token, cuerpoOk(destino), 403, 'sin_permiso'],
      ['admin de ZZ con company_id ajeno → 403', id.admin.token, cuerpoOk(destino, 'admin', ZX), 403, 'sin_permiso'],
      ['company_id inexistente → 403', id.admin.token, cuerpoOk(destino, 'admin', randomUUID()), 403, 'sin_permiso'],
      ['rol customer → 422', id.admin.token, cuerpoOk(destino, 'customer'), 422, 'rol_invalido'],
      ['rol owner → 422', id.admin.token, cuerpoOk(destino, 'owner'), 422, 'rol_invalido'],
      ['email inválido → 422', id.admin.token, cuerpoOk('no-es-email'), 422, 'email_invalido'],
      ['user_id inyectado → 400', id.admin.token, { ...cuerpoOk(destino), user_id: id.ajeno.id }, 400, 'campos_no_permitidos'],
      ['status inyectado → 400', id.admin.token, { ...cuerpoOk(destino), status: 'active' }, 400, 'campos_no_permitidos'],
      ['reenviar membresía ajena → 403', id.admin.token, { accion: 'reenviar', membership_id: mAjeno.id }, 403, 'sin_permiso'],
      ['employee reenvía → 403', id.employee.token, { accion: 'reenviar', membership_id: mEmployee.id }, 403, 'sin_permiso'],
    ]
    const mal = []
    for (const [t, token, cuerpo, st, err] of casos) {
      const r = await llamar(cuerpo, { token })
      if (r.status !== st || r.json?.error !== err) mal.push(`${t}: ${r.status} ${r.json?.error}`)
    }
    cmp(`${casos.length} ataques fallan cerrados con el código esperado`, [], mal)
    cmp('ningún ataque creó la cuenta destino', 0, await contarAuthPorEmail(destino))
    // Sesión cerrada: el token sigue siendo un JWT firmado, pero la sesión ya no existe.
    const efimero = await usuario(ZZ, 'admin', null, 'efimero')
    await efimero.c.auth.signOut({ scope: 'global' })
    cmp('JWT de una sesión cerrada → 401', 401, (await llamar(cuerpoOk(destino), { token: efimero.token })).status)
    await s.from('company_memberships').update({ status: 'active' }).eq('user_id', efimero.id)
    const pre = await llamar(null, { metodo: 'OPTIONS', origen: 'https://evil.example' })
    cmp('CORS: origen desconocido sin Allow-Origin', [403, null], [pre.status, pre.headers.get('access-control-allow-origin')])
    const preOk = await fetch(FN, { method: 'OPTIONS', headers: { Origin: ORIGEN_APP, 'Access-Control-Request-Method': 'POST' } })
    cmp('CORS: app.buscatools.com permitido', ORIGEN_APP, preOk.headers.get('access-control-allow-origin'))
  }

  seccion('7 · Idempotencia, multiempresa y envío')
  {
    const respuestas = []
    // Cuenta confirmada de OTRA empresa, invitada a ZZ: no se duplica la identidad.
    const antesAjeno = await contarAuthPorEmail(id.ajeno.email)
    const r1 = await llamar({ accion: 'invitar', company_id: ZZ, email: id.ajeno.email.toUpperCase(), rol: 'technician', nombre: 'No pisa el nombre' }, { token: id.admin.token })
    respuestas.push(r1.texto)
    cmp('cuenta existente (en mayúsculas) → agregado_existente, sin correo', ['agregado_existente', false], [r1.json?.resultado, r1.json?.email_enviado])
    cmp('misma identidad: sigue habiendo 1 cuenta', [1, 1], [antesAjeno, await contarAuthPorEmail(id.ajeno.email)])
    cmp('ahora pertenece a las dos empresas con su rol en cada una', ['admin', 'technician'], [(await membresia(id.ajeno.id, ZX)).role, (await membresia(id.ajeno.id, ZZ)).role])
    const { data: perfilAjeno } = await s.from('profiles').select('full_name').eq('id', id.ajeno.id).single()
    cmp('una cuenta existente conserva su nombre', false, perfilAjeno.full_name === 'No pisa el nombre')
    const r2 = await llamar({ accion: 'invitar', company_id: ZZ, email: id.ajeno.email, rol: 'admin' }, { token: id.admin.token })
    cmp('repetir → 409 ya_es_miembro (no cambia el rol)', [409, 'ya_es_miembro', 'technician'], [r2.status, r2.json?.error, (await membresia(id.ajeno.id, ZZ)).role])
    const mAjenoEnZZ = await membresia(id.ajeno.id, ZZ)
    await id.admin.c.rpc('config_cambiar_estado', { p_membership: mAjenoEnZZ.id, p_estado: 'suspended' })
    const r3 = await llamar({ accion: 'invitar', company_id: ZZ, email: id.ajeno.email, rol: 'technician' }, { token: id.admin.token })
    cmp('membresía suspendida → 409 membresia_suspendida (no se reactiva sola)', [409, 'membresia_suspendida', 'suspended'], [r3.status, r3.json?.error, (await membresia(id.ajeno.id, ZZ)).status])
    const r4 = await llamar({ accion: 'reenviar', membership_id: mEmployee.id }, { token: id.admin.token })
    cmp('reenviar a cuenta confirmada → 409 invitacion_no_pendiente', [409, 'invitacion_no_pendiente'], [r4.status, r4.json?.error])
    // Concurrencia de invitación: dos admins agregan a la misma cuenta a la vez.
    const otro = await usuario(null, 'employee', null, 'sinempresa')
    const [c1, c2] = await Promise.all([
      llamar({ accion: 'invitar', company_id: ZZ, email: otro.email, rol: 'employee' }, { token: id.admin.token }),
      llamar({ accion: 'invitar', company_id: ZZ, email: otro.email, rol: 'salesperson' }, { token: id.admin2.token }),
    ])
    const { count: nMemb } = await s.from('company_memberships').select('id', { count: 'exact', head: true }).eq('user_id', otro.id).eq('company_id', ZZ)
    cmp('dos invitaciones simultáneas → 1 membresía, la otra 409', [1, [200, 409]], [nMemb, [c1.status, c2.status].sort()])

    if (!CON_ENVIOS) {
      INFO('casos con envío real (cuenta sin confirmar, reenvío, email nuevo)', 'OMITIDOS: correr con --con-envios sólo con direcciones controladas')
    } else {
    // Cuenta SIN confirmar (p. ej. un alta pública previa): se agrega y se intenta invitar.
    const sinConfirmar = nuevoEmail('sinconfirmar')
    const { data: uSin } = await s.auth.admin.createUser({ email: sinConfirmar, password: `Zz${randomUUID()}!`, email_confirm: false })
    const r5 = await llamar({ accion: 'invitar', company_id: ZZ, email: sinConfirmar, rol: 'employee' }, { token: id.admin.token })
    respuestas.push(r5.texto)
    cmp('cuenta sin confirmar → agregado_pendiente, misma identidad', ['agregado_pendiente', 1], [r5.json?.resultado, await contarAuthPorEmail(sinConfirmar)])
    INFO('envío de la invitación a la cuenta sin confirmar', `email_enviado=${r5.json?.email_enviado} ${r5.json?.error_envio ?? ''}`)
    const lista = (await id.admin.c.rpc('config_listar_usuarios', { p_company: ZZ })).data ?? []
    const filaSin = lista.find((u) => u.user_id === uSin.user.id)
    cmp('la lista la muestra sin email confirmado', [false, 'active'], [filaSin?.email_confirmado, filaSin?.estado])
    const r6 = await llamar({ accion: 'reenviar', membership_id: filaSin?.membership_id }, { token: id.admin.token })
    respuestas.push(r6.texto)
    INFO('reenvío a cuenta sin confirmar', `${r6.status} ${r6.json?.resultado ?? r6.json?.error}`)
    cmp('reenvío: respuesta clasificada (reenviada, o error del mailer sin texto crudo)', true, r6.json?.resultado === 'reenviada' || ['correo_no_autorizado', 'demasiados_envios', 'correo_no_enviado', 'email_rechazado'].includes(r6.json?.error))

    // Email completamente nuevo: sonda del mailer por defecto.
    const nuevo = nuevoEmail('nuevo')
    const r7 = await llamar({ accion: 'invitar', company_id: ZZ, email: nuevo, rol: 'employee', nombre: 'ZZ Nuevo' }, { token: id.admin.token })
    respuestas.push(r7.texto)
    const nNuevo = await contarAuthPorEmail(nuevo)
    INFO('invitación a un email nuevo (.test)', `${r7.status} ${r7.json?.resultado ?? r7.json?.error} · cuentas creadas: ${nNuevo}`)
    if (r7.status === 200) {
      cmp('email nuevo: invitado con membresía y nombre', ['invitado', 1], [r7.json.resultado, nNuevo])
    } else {
      cmp('email nuevo rechazado por el mailer: error clasificado y SIN cuenta huérfana', [true, 0], [['correo_no_autorizado', 'correo_no_enviado', 'demasiados_envios', 'email_rechazado'].includes(r7.json?.error), nNuevo])
    }
    }
    cmp('ninguna respuesta trae tokens, enlaces ni texto crudo de Auth', [], respuestas.filter((t) => /eyJ|access_token|action_link|token_hash|verify\?|http|password/i.test(t)))
    const { data: aud } = await s.from('users_audit').select('action').eq('company_id', ZZ)
    cmp('bitácora: MEMBERSHIP_ADDED registrado', true, (aud ?? []).some((a) => a.action === 'MEMBERSHIP_ADDED'))
  }

  seccion('8 · Estático: secretos y código')
  {
    const fuentes = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fuentes(join(dir, e.name)) : /\.(tsx?|css|html|js)$/.test(e.name) ? [join(dir, e.name)] : []))
    const src = fuentes('src').map((f) => [f, readFileSync(f, 'utf8')])
    cmp('src/ no nombra la clave de servicio ni la usa', [], src.filter(([, t]) => /SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_|['"`]service_role['"`]/.test(t)).map(([f]) => f))
    const dist = existsSync('dist') ? fuentes('dist').map((f) => [f, readFileSync(f, 'utf8')]) : []
    cmp('dist/ sin la clave de servicio', [], dist.filter(([, t]) => t.includes(SECRET)).map(([f]) => f))
    const fn = readFileSync('supabase/functions/config-usuarios/index.ts', 'utf8')
    cmp('la Edge Function no loguea el JWT, la clave ni el cuerpo', [], (fn.match(/console\.\w+\([^)]*\)/g) ?? []).filter((l) => /jwt|CLAVE|token|cuerpo|pedido\b|email\b/i.test(l)))
    cmp('la Edge Function no devuelve enlaces (generateLink / action_link)', false, /generateLink|action_link/.test(fn))
    const auth = src.filter(([f]) => /features[\\/]auth|services[\\/]auth/.test(f))
    cmp('el frontend no persiste contraseñas ni tokens en storage', [], auth.filter(([, t]) => /(localStorage|sessionStorage)\.setItem\([^)]*(password|contrasena|token)/i.test(t)).map(([f]) => f))
  }

  await barrer()
  const huellaDespues = await huellaReal()
  seccion('9 · Datos reales')
  cmp('memberships y perfiles de las empresas reales intactos', huellaAntes, huellaDespues)
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
