/**
 * Fase 12 · Configuración — Entrega 3: listas de precios, marcas, categorías y
 * atributos. Pruebas REALES contra la base, con JWT reales.
 *
 *   1  lectura por rol: admin y employee leen; salesperson, technician,
 *      customer, distributor, anon y admin de otra empresa no;
 *   2  escritura por rol: sólo admin de la misma empresa;
 *   3  escritura directa por REST cerrada en las 6 tablas (admin y employee);
 *   4  lista blanca e inyección: campos extra, tipos, vacíos, largos, JSON no objeto;
 *   5  marcas: normalización, duplicados (mayúsculas y espacios), concurrencia,
 *      desactivar/reactivar (idempotente, impacto), borrar sólo si no se usa;
 *   6  categorías: slug generado y único, renombrar sin tocar el slug,
 *      conflicto de versión, borrar sólo si no se usa (productos, atributos);
 *   7  entre empresas: ids ajenos → no_encontrado; empresa ajena → sin_permiso;
 *   8  atributos: sólo lectura, estructura y uso;
 *   9  listas: sólo lectura, conteos, clientes, paginación server-side,
 *      vigencia, búsqueda con comodines literales, límites fuera de rango;
 *  10  histórico: cambiar el precio maestro, desactivar la marca y renombrar la
 *      categoría no reescriben cotizaciones (líneas y totales idénticos);
 *  11  bitácora: acciones con actor y nombre; lecturas sin ruido; employee no la lee;
 *  12  datos reales intactos: productos, marcas, categorías, atributos, listas,
 *      precios, líneas y totales de documentos, secuencias.
 *
 * Fixtures: empresas zz-e3-* y usuarios zz-e3-*@buscatools.test, borrados al final.
 * No usa sesiones de personas reales ni escribe en empresas reales.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase12-configuracion-entrega3-tests.mjs
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
const MARCA = 'zz-e3'
const HOY = new Date().toISOString().slice(0, 10)
const MANANA = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

const login = async (email, password) => {
  const c = createClient(BASE, PUB, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login: ${error.message}`)
  return { c, id: data.user.id }
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

/** 'OK', 'PERMISO' o el código de negocio (primer segmento del mensaje). */
const clase = (r) => {
  if (!r.error) return 'OK'
  const m = `${r.error.message ?? ''}`
  if (/permission denied|42501/i.test(`${m} ${r.error.code}`) || m === 'sin_permiso') return 'PERMISO'
  return m.split(':')[0] || `OTRO(${r.error.code})`
}
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
const cuenta = async (tabla, filtro) => {
  let q = s.from(tabla).select('*', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  return (await q).count
}
const todas = async (tabla, columnas, orden = 'id') => {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await s.from(tabla).select(columnas).order(orden).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) break
  }
  return filas
}

async function huellaReal() {
  const { data: c } = await s.from('companies').select('id').not('slug', 'like', 'zz-%')
  const ids = new Set(c.map((x) => x.id))
  const reales = (filas) => filas.filter((f) => ids.has(f.company_id))
  return {
    productos: hash(reales(await todas('products', 'id, company_id, sku, name, brand_id, category_id, status, attributes, updated_at, deleted_at'))),
    marcas: hash(reales(await todas('brands', 'id, company_id, name, is_active, logo_path'))),
    categorias: hash(reales(await todas('product_categories', 'id, company_id, name, slug, position, needs_review, parent_id'))),
    atributos: hash(reales(await todas('product_attribute_definitions', 'id, company_id, key, label, data_type, unit, is_filterable, position'))),
    atributosCategorias: hash(reales(await todas('product_attribute_categories', 'company_id, attribute_definition_id, category_id', 'attribute_definition_id'))),
    listas: hash(reales(await todas('price_lists', 'id, company_id, name, currency_code, is_default, valid_from, valid_to'))),
    precios: hash(reales(await todas('product_prices', 'id, company_id, price_list_id, product_id, amount, valid_from, valid_to'))),
    cotizaciones: hash(reales(await todas('sales_quotes', 'id, company_id, subtotal, tax_amount, total, status'))),
    pedidos: hash(reales(await todas('sales_orders', 'id, company_id, subtotal, tax_amount, total'))),
    remitos: hash(reales(await todas('deliveries', 'id, company_id, subtotal, total'))),
    lineasCot: hash(reales(await todas('sales_quote_lines', 'id, company_id, unit_price, quantity, list_price_snapshot, name_snapshot, sku_snapshot, brand_snapshot'))),
    lineasPed: hash(reales(await todas('sales_order_lines', 'id, company_id, unit_price, quantity_ordered, name_snapshot'))),
    lineasRt: hash(reales(await todas('delivery_lines', 'id, company_id, quantity, product_id'))),
    secuencias: hash(reales(await todas('document_sequences', 'company_id, doc_type, series_code, next_number', 'doc_type'))),
    clientesConLista: hash(reales(await todas('customers', 'id, company_id, default_price_list_id'))),
    bitacoraCatalogo: (await todas('catalog_audit', 'id, company_id')).filter((f) => ids.has(f.company_id)).length,
  }
}

const barrer = async () => {
  const { data: emp } = await s.from('companies').select('id').like('slug', `${MARCA}-%`)
  const ids = (emp ?? []).map((x) => x.id)
  if (ids.length) {
    await s.from('sales_quote_lines').delete().in('company_id', ids)
    await s.from('sales_quotes').delete().in('company_id', ids)
    await s.from('sales_audit').delete().in('company_id', ids)
    await s.from('company_memberships').delete().in('company_id', ids)
    await s.from('customers').update({ default_price_list_id: null }).in('company_id', ids)
    await s.from('product_prices').delete().in('company_id', ids)
    await s.from('price_lists').delete().in('company_id', ids)
    await s.from('maintenance_assets').delete().in('company_id', ids)
    await s.from('maintenance_audit').delete().in('company_id', ids)
    await s.from('products').delete().in('company_id', ids)
    await s.from('product_attribute_categories').delete().in('company_id', ids)
    await s.from('product_attribute_definitions').delete().in('company_id', ids)
    await s.from('product_categories').delete().in('company_id', ids)
    await s.from('brands').delete().in('company_id', ids)
    await s.from('customers').delete().in('company_id', ids)
    await s.from('catalog_audit').delete().in('company_id', ids)
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

const ok = (r, t) => { if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data }

async function empresa(etiqueta) {
  const emp = ok(await s.from('companies').insert({ slug: `${MARCA}-${etiqueta}-${Date.now()}`, name: `ZZ E3 ${etiqueta}`, default_currency: 'USD' }).select('id').single(), `empresa ${etiqueta}`)
  const id = emp.id
  const marcaUsada = ok(await s.from('brands').insert({ company_id: id, name: 'ZZ Usada' }).select('id').single(), 'marca usada')
  const marcaLibre = ok(await s.from('brands').insert({ company_id: id, name: 'ZZ Libre' }).select('id').single(), 'marca libre')
  const catUsada = ok(await s.from('product_categories').insert({ company_id: id, name: 'ZZ Puntas', slug: 'zz-puntas', position: 1 }).select('id').single(), 'cat usada')
  const catAttr = ok(await s.from('product_categories').insert({ company_id: id, name: 'ZZ Sólo atributo', slug: 'zz-solo-atributo', position: 2 }).select('id').single(), 'cat attr')
  const catLibre = ok(await s.from('product_categories').insert({ company_id: id, name: 'ZZ Libre', slug: 'zz-libre', position: 3 }).select('id').single(), 'cat libre')
  const attr = ok(await s.from('product_attribute_definitions').insert({ company_id: id, key: 'encastre', label: 'Encastre', data_type: 'text', is_filterable: true, position: 1 }).select('id').single(), 'attr')
  ok(await s.from('product_attribute_categories').insert([{ company_id: id, attribute_definition_id: attr.id, category_id: catUsada.id }, { company_id: id, attribute_definition_id: attr.id, category_id: catAttr.id }]), 'pac')
  const p1 = ok(await s.from('products').insert({ company_id: id, sku: `${MARCA}-A-1`, name: 'ZZ Punta 1/4', brand_id: marcaUsada.id, category_id: catUsada.id, attributes: { encastre: '1/4' }, status: 'active' }).select('id').single(), 'p1')
  const p2 = ok(await s.from('products').insert({ company_id: id, sku: `${MARCA}-A-2`, name: 'ZZ Punta 50%_x', category_id: catUsada.id, attributes: {}, status: 'active' }).select('id').single(), 'p2')
  const lista = ok(await s.from('price_lists').insert({ company_id: id, name: 'ZZ Lista base', currency_code: 'USD', is_default: true }).select('id').single(), 'lista')
  ok(await s.from('product_prices').insert([
    { company_id: id, price_list_id: lista.id, product_id: p1.id, amount: 100, valid_from: '2026-01-01' },
    { company_id: id, price_list_id: lista.id, product_id: p2.id, amount: 0, valid_from: '2026-01-01' },
    { company_id: id, price_list_id: lista.id, product_id: p1.id, amount: 120, valid_from: MANANA },
  ]), 'precios')
  const cli = ok(await s.from('customers').insert({ company_id: id, legal_name: `ZZ E3 cliente ${etiqueta}`, default_price_list_id: lista.id }).select('id').single(), 'cliente')
  return { id, marcaUsada: marcaUsada.id, marcaLibre: marcaLibre.id, catUsada: catUsada.id, catAttr: catAttr.id, catLibre: catLibre.id, p1: p1.id, p2: p2.id, lista: lista.id, cliente: cli.id }
}

const main = async () => {
  await barrer()
  const huellaAntes = await huellaReal()
  INFO('huella real antes', JSON.stringify(huellaAntes))

  const A = await empresa('a')
  const B = await empresa('b')
  const id = {
    admin: await usuario(A.id, 'admin'),
    employee: await usuario(A.id, 'employee'),
    salesperson: await usuario(A.id, 'salesperson'),
    technician: await usuario(A.id, 'technician'),
    customer: await usuario(A.id, 'customer', A.cliente),
    distributor: await usuario(A.id, 'distributor', A.cliente),
    adminB: await usuario(B.id, 'admin'),
  }
  const ROLES = ['admin', 'employee', 'salesperson', 'technician', 'customer', 'distributor']
  const actores = [...ROLES.map((r) => [r, id[r].c]), ['anon', anon], ['adminOtraEmpresa', id.adminB.c]]

  // Cotización histórica en A, con snapshot de la línea (precio 100 de la lista).
  const cot = ok(await s.from('sales_quotes').insert({ company_id: A.id, number: 'ZZE3-COT-1', customer_id: A.cliente, quote_date: HOY, currency_code: 'USD', status: 'sent' }).select('id').single(), 'cotización')
  ok(await s.from('sales_quote_lines').insert({ company_id: A.id, quote_id: cot.id, line_no: 1, product_id: A.p1, sku_snapshot: `${MARCA}-A-1`, name_snapshot: 'ZZ Punta 1/4', brand_snapshot: 'ZZ Usada', quantity: 2, unit_price: 100, list_price_snapshot: 100, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }), 'línea')
  const docAntes = async () => ({
    cab: (await s.from('sales_quotes').select('subtotal, tax_amount, total, status').eq('id', cot.id).single()).data,
    lin: (await s.from('sales_quote_lines').select('unit_price, quantity, list_price_snapshot, name_snapshot, sku_snapshot, brand_snapshot, product_id').eq('quote_id', cot.id)).data,
  })
  const historicoAntes = await docAntes()
  INFO('cotización fixture', JSON.stringify(historicoAntes.cab))

  seccion('1 · Lectura por rol')
  {
    const lecturas = {
      marcas: (c) => c.rpc('config_marcas_listar', { p_company: A.id }),
      categorias: (c) => c.rpc('config_categorias_listar', { p_company: A.id }),
      atributos: (c) => c.rpc('config_atributos_listar', { p_company: A.id }),
      listas: (c) => c.rpc('config_listas_precios_listar', { p_company: A.id }),
      items: (c) => c.rpc('config_lista_precios_items', { p_company: A.id, p_lista: A.lista, p_busqueda: null, p_vigencia: 'todas', p_limite: 50, p_desplazamiento: 0 }),
      clientes: (c) => c.rpc('config_lista_precios_clientes', { p_company: A.id, p_lista: A.lista }),
    }
    const matriz = {}
    for (const [nombre, c] of actores) {
      const fila = []
      for (const f of Object.values(lecturas)) fila.push(clase(await f(c)))
      matriz[nombre] = fila.join('/')
    }
    const OKS = 'OK/OK/OK/OK/OK/OK'
    const NO = 'PERMISO/PERMISO/PERMISO/PERMISO/PERMISO/PERMISO'
    cmp('marcas/categorías/atributos/listas/items/clientes por rol', { admin: OKS, employee: OKS, salesperson: NO, technician: NO, customer: NO, distributor: NO, anon: NO, adminOtraEmpresa: NO }, matriz)
    const m = (await id.employee.c.rpc('config_marcas_listar', { p_company: A.id })).data
    const ma = (await id.admin.c.rpc('config_marcas_listar', { p_company: A.id })).data
    cmp('puede_editar: admin true, employee false', [true, false], [ma[0]?.puede_editar, m[0]?.puede_editar])
  }

  seccion('2 · Escritura por rol (sólo admin de la empresa)')
  {
    const matriz = {}
    for (const [nombre, c] of actores) {
      matriz[nombre] = [
        clase(await c.rpc('config_marca_crear', { p_company: A.id, p_datos: { name: `ZZ Rol ${nombre}` } })),
        clase(await c.rpc('config_marca_estado', { p_company: A.id, p_marca: A.marcaLibre, p_activa: false })),
        clase(await c.rpc('config_categoria_crear', { p_company: A.id, p_datos: { name: `ZZ Rol ${nombre}` } })),
        clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catLibre, p_esperado: 'ZZ Libre', p_datos: { name: 'ZZ Libre' } })),
      ].join('/')
    }
    const NO = 'PERMISO/PERMISO/PERMISO/PERMISO'
    cmp('crear marca / desactivar / crear categoría / renombrar', { admin: 'OK/OK/OK/OK', employee: NO, salesperson: NO, technician: NO, customer: NO, distributor: NO, anon: NO, adminOtraEmpresa: NO }, matriz)
    await id.admin.c.rpc('config_marca_estado', { p_company: A.id, p_marca: A.marcaLibre, p_activa: true })
    cmp('en A sólo quedó la marca y la categoría del admin', [1, 1], [
      await cuenta('brands', (q) => q.eq('company_id', A.id).like('name', 'ZZ Rol %')),
      await cuenta('product_categories', (q) => q.eq('company_id', A.id).like('name', 'ZZ Rol %')),
    ])
  }

  seccion('3 · Escritura directa por REST cerrada')
  {
    const antes = { m: await cuenta('brands', (q) => q.eq('company_id', A.id)), c: await cuenta('product_categories', (q) => q.eq('company_id', A.id)), p: hash((await s.from('product_prices').select('id, amount').eq('company_id', A.id).order('id')).data), l: hash((await s.from('price_lists').select('*').eq('company_id', A.id).order('id')).data) }
    const res = {}
    for (const r of ['admin', 'employee']) {
      const c = id[r].c
      res[r] = [
        clase(await c.from('brands').insert({ company_id: A.id, name: `ZZ directa ${r}` }).select('id')),
        clase(await c.from('brands').update({ name: 'hackeada', is_active: false }).eq('id', A.marcaUsada).select('id')),
        clase(await c.from('brands').delete().eq('id', A.marcaLibre).select('id')),
        clase(await c.from('product_categories').insert({ company_id: A.id, name: 'x', slug: `x-${r}` }).select('id')),
        clase(await c.from('product_categories').update({ slug: 'hack' }).eq('id', A.catUsada).select('id')),
        clase(await c.from('product_attribute_definitions').update({ key: 'hack' }).eq('company_id', A.id).select('id')),
        clase(await c.from('product_attribute_categories').delete().eq('company_id', A.id).select('category_id')),
        clase(await c.from('price_lists').update({ currency_code: 'ARS' }).eq('id', A.lista).select('id')),
        clase(await c.from('price_lists').insert({ company_id: A.id, name: 'ZZ directa', currency_code: 'USD' }).select('id')),
        clase(await c.from('product_prices').update({ amount: -5 }).eq('price_list_id', A.lista).select('id')),
        clase(await c.from('product_prices').insert({ company_id: A.id, price_list_id: A.lista, product_id: A.p2, amount: 1, valid_from: '2030-01-01' }).select('id')),
        clase(await c.from('product_prices').delete().eq('price_list_id', A.lista).select('id')),
      ].join('/')
    }
    const P = Array(12).fill('PERMISO').join('/')
    cmp('admin y employee: INSERT/UPDATE/DELETE en las 6 tablas rechazados', { admin: P, employee: P }, res)
    const despues = { m: await cuenta('brands', (q) => q.eq('company_id', A.id)), c: await cuenta('product_categories', (q) => q.eq('company_id', A.id)), p: hash((await s.from('product_prices').select('id, amount').eq('company_id', A.id).order('id')).data), l: hash((await s.from('price_lists').select('*').eq('company_id', A.id).order('id')).data) }
    cmp('sin cambios en marcas, categorías, precios ni listas', antes, despues)
    const lee = (await id.employee.c.from('brands').select('id').eq('company_id', A.id)).data?.length ?? 0
    cmp('la lectura directa sigue funcionando (Catálogo)', true, lee >= 2)
  }

  seccion('4 · Lista blanca e inyección')
  {
    const c = id.admin.c
    const crear = (d) => c.rpc('config_marca_crear', { p_company: A.id, p_datos: d })
    const extra = []
    for (const k of ['company_id', 'created_at', 'updated_at', 'slug', 'role', 'status', 'is_active', 'id', 'logo_path', 'extra']) {
      extra.push(clase(await crear({ name: `ZZ Inj ${k}`, [k]: k === 'company_id' ? B.id : 'x' })))
    }
    cmp('campos extra (company_id, created_at, updated_at, slug, role, status, is_active, id, logo_path, extra)', Array(10).fill('campos_no_permitidos'), extra)
    const catExtra = [
      clase(await c.rpc('config_categoria_crear', { p_company: A.id, p_datos: { name: 'ZZ Inj', slug: 'hack' } })),
      clase(await c.rpc('config_categoria_crear', { p_company: A.id, p_datos: { name: 'ZZ Inj', position: 0 } })),
      clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catLibre, p_esperado: 'ZZ Libre', p_datos: { name: 'ZZ Inj', slug: 'hack' } })),
      clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catLibre, p_esperado: 'ZZ Libre', p_datos: { name: 'ZZ Inj', company_id: B.id } })),
    ]
    cmp('categorías: slug, position y company_id inyectados', Array(4).fill('campos_no_permitidos'), catExtra)
    const tipos = []
    for (const d of [{ name: 5 }, { name: ['a'] }, { name: { a: 1 } }, { name: null }, { name: '' }, { name: '    ' }, { name: 'x'.repeat(81) }, {}, [], 'ZZ texto', null]) tipos.push(clase(await crear(d)))
    cmp('tipos, vacíos, largo > 80, sin name, JSON no objeto', Array(11).fill('datos_invalidos'), tipos)
    cmp('80 caracteres sí', 'OK', clase(await crear({ name: `ZZ ${'x'.repeat(77)}` })))
    cmp('0 marcas inyectadas creadas', 0, await cuenta('brands', (q) => q.eq('company_id', A.id).like('name', 'ZZ Inj%')))
    cmp('nada escrito en la empresa B', 2, await cuenta('brands', (q) => q.eq('company_id', B.id)))
  }

  seccion('5 · Marcas: normalización, duplicados, estado y borrado')
  {
    const c = id.admin.c
    const r = await c.rpc('config_marca_crear', { p_company: A.id, p_datos: { name: '   Nueva    Marca  ' } })
    cmp('trim y espacios colapsados', ['OK', 'Nueva Marca'], [clase(r), r.data?.[0]?.name])
    const dups = []
    for (const n of ['nueva marca', 'NUEVA MARCA', ' Nueva  Marca', 'zz usada']) dups.push(clase(await c.rpc('config_marca_crear', { p_company: A.id, p_datos: { name: n } })))
    cmp('duplicados por mayúsculas y espacios, también contra marcas existentes', Array(4).fill('nombre_duplicado'), dups)
    cmp('mismo nombre en OTRA empresa: permitido', 'OK', clase(await id.adminB.c.rpc('config_marca_crear', { p_company: B.id, p_datos: { name: 'Nueva Marca' } })))
    const dos = await Promise.all([
      c.rpc('config_marca_crear', { p_company: A.id, p_datos: { name: 'ZZ Carrera' } }),
      c.rpc('config_marca_crear', { p_company: A.id, p_datos: { name: 'zz carrera' } }),
    ])
    cmp('2 altas simultáneas del mismo nombre: una entra, la otra es duplicado', ['OK', 'nombre_duplicado'], dos.map(clase).sort())
    cmp('queda 1 sola', 1, await cuenta('brands', (q) => q.eq('company_id', A.id).ilike('name', 'zz carrera')))

    const d1 = await c.rpc('config_marca_estado', { p_company: A.id, p_marca: A.marcaUsada, p_activa: false })
    cmp('desactivar marca usada: cambia e informa impacto', { is_active: false, cambiado: true, productos: 1 }, d1.data?.[0])
    const d2 = await c.rpc('config_marca_estado', { p_company: A.id, p_marca: A.marcaUsada, p_activa: false })
    cmp('repetir: idempotente', { is_active: false, cambiado: false, productos: 1 }, d2.data?.[0])
    cmp('el producto sigue referenciando la marca', A.marcaUsada, (await s.from('products').select('brand_id').eq('id', A.p1).single()).data.brand_id)
    const x1 = await c.rpc('config_marca_eliminar', { p_company: A.id, p_marca: A.marcaUsada })
    cmp('borrar marca usada: en_uso (1 producto, 0 equipos)', 'en_uso:1:0', x1.error?.message)
    cmp('la marca usada sigue existiendo', 1, await cuenta('brands', (q) => q.eq('id', A.marcaUsada)))
    const eq = ok(await s.from('maintenance_assets').insert({ company_id: A.id, reference: 'ZZE3-EQ-1', brand_id: A.marcaLibre }).select('id').single(), 'equipo')
    const x2 = await c.rpc('config_marca_eliminar', { p_company: A.id, p_marca: A.marcaLibre })
    cmp('borrar marca usada sólo por un equipo de mantenimiento: en_uso:0:1', 'en_uso:0:1', x2.error?.message)
    await s.from('maintenance_assets').delete().eq('id', eq.id)
    cmp('marca sin uso: se borra', 'OK', clase(await c.rpc('config_marca_eliminar', { p_company: A.id, p_marca: A.marcaLibre })))
    cmp('borrar otra vez: no_encontrado', 'no_encontrado', clase(await c.rpc('config_marca_eliminar', { p_company: A.id, p_marca: A.marcaLibre })))
    cmp('reactivar la usada', { is_active: true, cambiado: true, productos: 1 }, (await c.rpc('config_marca_estado', { p_company: A.id, p_marca: A.marcaUsada, p_activa: true })).data?.[0])
    await c.rpc('config_marca_estado', { p_company: A.id, p_marca: A.marcaUsada, p_activa: false })
  }

  seccion('6 · Categorías: slug, renombrar, conflicto y borrado')
  {
    const c = id.admin.c
    const r1 = await c.rpc('config_categoria_crear', { p_company: A.id, p_datos: { name: '  Llaves   Ñandú Ácidas ' } })
    cmp('slug sin acentos ni espacios', ['OK', 'Llaves Ñandú Ácidas', 'llaves-nandu-acidas'], [clase(r1), r1.data?.[0]?.name, r1.data?.[0]?.slug])
    const r2 = await c.rpc('config_categoria_crear', { p_company: A.id, p_datos: { name: 'Llaves-Ñandú Ácidas' } })
    cmp('nombre distinto con el mismo slug: slug único con sufijo', ['OK', 'llaves-nandu-acidas-2'], [clase(r2), r2.data?.[0]?.slug])
    cmp('duplicado por mayúsculas', 'nombre_duplicado', clase(await c.rpc('config_categoria_crear', { p_company: A.id, p_datos: { name: 'llaves ñandú ÁCIDAS' } })))
    const pos = (await s.from('product_categories').select('position').eq('id', r1.data[0].id).single()).data.position
    cmp('posición al final', true, pos > 3)

    const ren = await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catUsada, p_esperado: 'ZZ Puntas', p_datos: { name: 'ZZ Puntas y tubos' } })
    cmp('renombrar usada (8 productos no se tocan)', { name: 'ZZ Puntas y tubos', cambiado: true }, ren.data?.[0])
    cmp('el slug no cambia', 'zz-puntas', (await s.from('product_categories').select('slug').eq('id', A.catUsada).single()).data.slug)
    cmp('versión vieja: conflicto_version', 'conflicto_version', clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catUsada, p_esperado: 'ZZ Puntas', p_datos: { name: 'Otra' } })))
    cmp('sin esperado: conflicto_version', 'conflicto_version', clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catUsada, p_esperado: null, p_datos: { name: 'Otra' } })))
    cmp('renombrar a un nombre existente: nombre_duplicado', 'nombre_duplicado', clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catUsada, p_esperado: 'ZZ Puntas y tubos', p_datos: { name: 'zz libre' } })))
    cmp('mismo nombre: sin cambios ni bitácora', { name: 'ZZ Puntas y tubos', cambiado: false }, (await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: A.catUsada, p_esperado: 'ZZ Puntas y tubos', p_datos: { name: ' ZZ  Puntas y tubos ' } })).data?.[0])

    const e1 = await c.rpc('config_categoria_eliminar', { p_company: A.id, p_categoria: A.catUsada })
    cmp('borrar con productos: en_uso (2 productos, 1 atributo, 0 hijas)', 'en_uso:2:1:0', e1.error?.message)
    const e2 = await c.rpc('config_categoria_eliminar', { p_company: A.id, p_categoria: A.catAttr })
    cmp('borrar con sólo un atributo vinculado: en_uso:0:1:0', 'en_uso:0:1:0', e2.error?.message)
    cmp('borrar sin uso: OK', 'OK', clase(await c.rpc('config_categoria_eliminar', { p_company: A.id, p_categoria: r2.data[0].id })))
    cmp('categorías usadas siguen, productos intactos', [1, 1, 2], [await cuenta('product_categories', (q) => q.eq('id', A.catUsada)), await cuenta('product_categories', (q) => q.eq('id', A.catAttr)), await cuenta('products', (q) => q.eq('category_id', A.catUsada))])
  }

  seccion('7 · Entre empresas')
  {
    const c = id.admin.c
    cmp('ids de B pasando la empresa A: no_encontrado', ['no_encontrado', 'no_encontrado', 'no_encontrado', 'no_encontrado', 'no_encontrado', 'no_encontrado', 'no_encontrado'], [
      clase(await c.rpc('config_marca_estado', { p_company: A.id, p_marca: B.marcaUsada, p_activa: false })),
      clase(await c.rpc('config_marca_eliminar', { p_company: A.id, p_marca: B.marcaLibre })),
      clase(await c.rpc('config_categoria_renombrar', { p_company: A.id, p_categoria: B.catLibre, p_esperado: 'ZZ Libre', p_datos: { name: 'hack' } })),
      clase(await c.rpc('config_categoria_eliminar', { p_company: A.id, p_categoria: B.catLibre })),
      clase(await c.rpc('config_lista_precios_items', { p_company: A.id, p_lista: B.lista, p_busqueda: null, p_vigencia: 'todas', p_limite: 50, p_desplazamiento: 0 })),
      clase(await c.rpc('config_lista_precios_clientes', { p_company: A.id, p_lista: B.lista })),
      clase(await c.rpc('config_marca_estado', { p_company: A.id, p_marca: randomUUID(), p_activa: false })),
    ])
    cmp('empresa B pasada por el admin de A: sin_permiso', ['PERMISO', 'PERMISO', 'PERMISO', 'PERMISO'], [
      clase(await c.rpc('config_marca_estado', { p_company: B.id, p_marca: B.marcaUsada, p_activa: false })),
      clase(await c.rpc('config_categoria_crear', { p_company: B.id, p_datos: { name: 'hack' } })),
      clase(await c.rpc('config_marcas_listar', { p_company: B.id })),
      clase(await c.rpc('config_lista_precios_items', { p_company: B.id, p_lista: B.lista, p_busqueda: null, p_vigencia: 'todas', p_limite: 50, p_desplazamiento: 0 })),
    ])
    cmp('B intacta (marca activa, categoría con su nombre)', [true, 'ZZ Libre'], [(await s.from('brands').select('is_active').eq('id', B.marcaUsada).single()).data.is_active, (await s.from('product_categories').select('name').eq('id', B.catLibre).single()).data.name])
    cmp('company_id nulo: sin_permiso', 'PERMISO', clase(await c.rpc('config_marcas_listar', { p_company: null })))
  }

  seccion('8 · Atributos (sólo lectura)')
  {
    const r = await id.employee.c.rpc('config_atributos_listar', { p_company: A.id })
    const a = r.data?.[0]
    cmp('estructura: clave, tipo, filtrable, categorías, productos que la usan', { key: 'encastre', label: 'Encastre', data_type: 'text', is_filterable: true, productos: 1, categorias: ['ZZ Puntas y tubos', 'ZZ Sólo atributo'] }, a && { key: a.key, label: a.label, data_type: a.data_type, is_filterable: a.is_filterable, productos: a.productos, categorias: a.categorias })
    const vacio = await id.adminB.c.rpc('config_atributos_listar', { p_company: B.id })
    cmp('empresa con 1 atributo propio (B): sólo el suyo', 1, vacio.data?.length)
  }

  seccion('9 · Listas de precios (sólo lectura, paginación)')
  {
    const c = id.employee.c
    const l = (await c.rpc('config_listas_precios_listar', { p_company: A.id })).data?.[0]
    cmp('lista: moneda, default, items, vigentes, cero, clientes', { name: 'ZZ Lista base', currency_code: 'USD', is_default: true, items: 3, items_vigentes: 2, precios_cero: 1, clientes: 1, vigencia_hasta: null }, l && { name: l.name, currency_code: l.currency_code, is_default: l.is_default, items: l.items, items_vigentes: l.items_vigentes, precios_cero: l.precios_cero, clientes: l.clientes, vigencia_hasta: l.vigencia_hasta })
    const pag = async (lim, off, extra = {}) => c.rpc('config_lista_precios_items', { p_company: A.id, p_lista: A.lista, p_busqueda: null, p_vigencia: 'todas', p_limite: lim, p_desplazamiento: off, ...extra })
    const p1 = await pag(2, 0)
    const p2 = await pag(2, 2)
    cmp('página 1 (2 filas) y 2 (1 fila), total 3', [2, 1, 3, 3], [p1.data?.length, p2.data?.length, p1.data?.[0]?.total, p2.data?.[0]?.total])
    cmp('sin repetir filas entre páginas', 3, new Set([...(p1.data ?? []), ...(p2.data ?? [])].map((x) => x.price_id)).size)
    cmp('precio 0 se muestra tal cual', 0, Number((p1.data ?? []).concat(p2.data ?? []).find((x) => x.sku.endsWith('-2'))?.amount))
    cmp('vigencia futura: el precio de mañana', ['futura', 120], ((await pag(50, 0, { p_vigencia: 'futura' })).data ?? []).map((x) => [x.vigencia, Number(x.amount)])[0])
    cmp('vigente: 2', 2, (await pag(50, 0, { p_vigencia: 'vigente' })).data?.length)
    cmp('búsqueda con % y _ literales', [1, `${MARCA}-A-2`], await (async () => { const x = await pag(50, 0, { p_busqueda: '50%_' }); return [x.data?.length, x.data?.[0]?.sku] })())
    cmp('búsqueda % sola no trae todo', 1, (await pag(50, 0, { p_busqueda: '%' })).data?.length)
    const malos = []
    for (const extra of [{ p_limite: 0 }, { p_limite: 101 }, { p_limite: -1 }, { p_desplazamiento: -1 }, { p_vigencia: 'otra' }, { p_busqueda: 'x'.repeat(101) }]) malos.push(clase(await pag(50, 0, extra)))
    cmp('límite 0/101/-1, desplazamiento negativo, vigencia inválida, búsqueda > 100', Array(6).fill('datos_invalidos'), malos)
    const cli = (await c.rpc('config_lista_precios_clientes', { p_company: A.id, p_lista: A.lista })).data
    cmp('clientes asociados', [1, 'ZZ E3 cliente a'], [cli?.[0]?.total, cli?.[0]?.legal_name])
    cmp('lista inexistente: no_encontrado', 'no_encontrado', clase(await c.rpc('config_lista_precios_items', { p_company: A.id, p_lista: randomUUID(), p_busqueda: null, p_vigencia: 'todas', p_limite: 50, p_desplazamiento: 0 })))
    cmp('no existe RPC de escritura de listas ni precios', 'PGRST202', (await id.admin.c.rpc('config_precio_actualizar', { p_company: A.id })).error?.code)
  }

  seccion('10 · Histórico: el maestro cambia, los documentos no')
  {
    // El importador (service role) cambia el precio maestro; el admin ya
    // desactivó la marca y renombró la categoría en las secciones 5 y 6.
    ok(await s.from('product_prices').update({ amount: 999 }).eq('price_list_id', A.lista).eq('product_id', A.p1).eq('valid_from', '2026-01-01'), 'cambio de precio')
    const despues = await docAntes()
    cmp('cabecera y líneas de la cotización idénticas', historicoAntes, despues)
    cmp('la línea conserva su precio y sus snapshots', [100, 100, 'ZZ Usada'], [Number(despues.lin[0].unit_price), Number(despues.lin[0].list_price_snapshot), despues.lin[0].brand_snapshot])
  }

  seccion('11 · Bitácora')
  {
    const { data: bit } = await s.from('catalog_audit').select('entity_type, action, entity_name, changed_fields, actor_id').eq('company_id', A.id).order('id')
    const acciones = (bit ?? []).map((x) => x.action)
    const conteo = acciones.reduce((m, a) => ({ ...m, [a]: (m[a] ?? 0) + 1 }), {})
    cmp('acciones registradas', { BRAND_CREATED: 4, BRAND_DELETED: 1, BRAND_DISABLED: 3, BRAND_ENABLED: 2, CATEGORY_CREATED: 3, CATEGORY_DELETED: 1, CATEGORY_UPDATED: 1 }, Object.fromEntries(Object.entries(conteo).sort()))
    cmp('todas con actor = admin de A', true, (bit ?? []).every((x) => x.actor_id === id.admin.id))
    cmp('borrados conservan el nombre', ['ZZ Libre', 'Llaves-Ñandú Ácidas'], (bit ?? []).filter((x) => x.action.endsWith('_DELETED')).map((x) => x.entity_name))
    const nLect = await cuenta('catalog_audit', (q) => q.eq('company_id', A.id))
    await id.employee.c.rpc('config_marcas_listar', { p_company: A.id })
    await id.admin.c.rpc('config_lista_precios_items', { p_company: A.id, p_lista: A.lista, p_busqueda: null, p_vigencia: 'todas', p_limite: 50, p_desplazamiento: 0 })
    cmp('las lecturas no escriben bitácora', nLect, await cuenta('catalog_audit', (q) => q.eq('company_id', A.id)))
    cmp('employee no lee la bitácora; admin sólo la de su empresa', [0, nLect, 0], [
      (await id.employee.c.from('catalog_audit').select('id')).data?.length ?? 0,
      (await id.admin.c.from('catalog_audit').select('id')).data?.length ?? 0,
      (await id.admin.c.from('catalog_audit').select('id').eq('company_id', B.id)).data?.length ?? 0,
    ])
    cmp('nadie escribe la bitácora directo', 'PERMISO', clase(await id.admin.c.from('catalog_audit').insert({ company_id: A.id, entity_type: 'brand', entity_id: randomUUID(), entity_name: 'x', action: 'BRAND_CREATED' })))
  }

  seccion('12 · Limpieza y datos reales intactos')
  await barrer()
  cmp('0 empresas zz-e3 residuales', 0, await cuenta('companies', (q) => q.like('slug', `${MARCA}-%`)))
  let residuales = 0
  for (let page = 1; ; page++) {
    const { data: us } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    residuales += (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).length
    if ((us?.users ?? []).length < 1000) break
  }
  cmp('0 usuarios zz-e3 residuales', 0, residuales)
  cmp('productos, marcas, categorías, atributos, listas, precios, documentos y secuencias reales idénticos', huellaAntes, await huellaReal())

  console.log(`\n  ${fallos === 0 ? '✓ TODO PASA' : `✗ ${fallos} FALLO(S)`}\n`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ Error inesperado:', e.message)
  try { await barrer() } catch { /* ya informado */ }
  process.exit(1)
})
