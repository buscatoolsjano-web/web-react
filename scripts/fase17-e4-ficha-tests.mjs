/**
 * Fase 17 · E4 — adjuntos, trazabilidad, productos e historial del cliente.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase17-e4-ficha-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. adjuntos del cliente: subir, listar, borrar, y qué queda auditado
 *   2. validación del servidor: cliente inexistente, ruta ajena, tamaño
 *   3. QUIÉN VE QUÉ: un adjunto de cliente se ve si se ve el cliente
 *   4. QUIÉN ESCRIBE: sólo quien administra el cliente, y no si está de baja
 *   5. el archivo en Storage sigue la misma regla que su fila
 *   6. historial documental paginado, ordenado y completo
 *   7. qué compra el cliente: cotizado y pedido separados, por moneda
 *   8. trazabilidad: los eventos de E1, E3 y E4, contra el cliente
 *   9. limpieza e invariantes de producción
 *
 * Todo lleva el prefijo zz-e4f y se borra al final. No toca WhatsApp.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const BASE = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real)) : FAIL(t, `esperaba ${esperado}, dio ${real}`)
const rechaza = (t, r, codigo) => {
  if (!r.error) return FAIL(`SE PERMITIÓ: ${t}`)
  if (codigo && !String(r.error.message).includes(codigo)) {
    return FAIL(t, `esperaba ${codigo}, dio «${String(r.error.message).slice(0, 70)}»`)
  }
  PASS(t, codigo ?? String(r.error.message).slice(0, 50))
}

const sesion = () => createClient(BASE, PUB, { auth: { persistSession: false } })
const s = createClient(BASE, SECRET, { auth: { persistSession: false } })

const MARCA = 'zz-e4f'
const BUCKET = 'ventas'
const creados = { usuarios: [], empresas: [], archivos: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

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
  if (creados.archivos.length) {
    await s.storage.from(BUCKET).remove(creados.archivos)
    creados.archivos = []
  }
  const ids = creados.empresas
  if (ids.length) {
    const borrar = async (t) => {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
    await borrar('attachments')
    await s.from('sales_audit').delete().in('company_id', ids)
    await borrar('sales_quote_lines')
    await borrar('sales_order_lines')
    await borrar('delivery_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await borrar('products')
    await borrar('product_categories')
    await borrar('customer_addresses')
    await borrar('customer_contacts')
    await borrar('company_memberships')
    await borrar('customers')
    await borrar('price_lists')
    await borrar('document_sequences')
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
  for (const id of creados.empresas) {
    const { data } = await s.storage.from(BUCKET).list(`${id}/customer`, { limit: 1000 })
    for (const carpeta of data ?? []) {
      const { data: dentro } = await s.storage.from(BUCKET).list(`${id}/customer/${carpeta.name}`, { limit: 1000 })
      creados.archivos.push(...(dentro ?? []).map((f) => `${id}/customer/${carpeta.name}/${f.name}`))
    }
  }
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  creados.usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).map((u) => u.id)
  await limpiar()
  creados.empresas = []
}

const PRODUCCION = ['buscatools', 'torquetools']
const archivo = (texto) => new Blob([texto], { type: 'text/plain' })

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 17 · CLIENTES E4 — la ficha completa')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const baselineProd = async () => ({
    clientes: await cuenta('customers', (q) => q.in('company_id', prodIds)),
    contactos: await cuenta('customer_contacts', (q) => q.in('company_id', prodIds)),
    direcciones: await cuenta('customer_addresses', (q) => q.in('company_id', prodIds)),
    adjuntos: await cuenta('attachments', (q) => q.in('company_id', prodIds)),
    adjuntosDeCliente: await cuenta('attachments', (q) => q.in('company_id', prodIds).eq('entity_type', 'customer')),
    cotizaciones: await cuenta('sales_quotes', (q) => q.in('company_id', prodIds)),
    pedidos: await cuenta('sales_orders', (q) => q.in('company_id', prodIds)),
    remitos: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const A = ok(await s.from('companies').insert({
    slug: `${MARCA}-a-${sello}`, name: 'ZZ E4F Alfa', legal_name: 'ZZ E4F Alfa SA', default_currency: 'USD',
  }).select('id').single(), 'empresa').id
  creados.empresas.push(A)
  const B = ok(await s.from('companies').insert({
    slug: `${MARCA}-b-${sello}`, name: 'ZZ E4F Beta', legal_name: 'ZZ E4F Beta SA', default_currency: 'USD',
  }).select('id').single(), 'empresa B').id
  creados.empresas.push(B)

  for (const [doc, code] of [['quote', 'ZQ'], ['sales_order', 'ZP'], ['delivery', 'ZR']]) {
    ok(await s.from('document_sequences').insert({
      company_id: A, doc_type: doc, series_code: code, prefix: code, padding: 5, next_number: 1, is_default: true,
    }), `secuencia ${doc}`)
  }
  const categoria = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E4F Cat', slug: `${MARCA}-cat-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría')
  const producto = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P1-${sello}`, name: 'ZZ Producto uno',
    status: 'active', attributes: {},
  }).select('id').single(), 'producto')
  const producto2 = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P2-${sello}`, name: 'ZZ Producto dos',
    status: 'active', attributes: {},
  }).select('id').single(), 'producto 2')

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const otroVendedor = await usuarioTemporal(A, 'salesperson')
  const tecnico = await usuarioTemporal(A, 'technician')
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const cliente = async (nombre, empresaId = A, extra = {}) =>
    ok(await s.from('customers').insert({
      company_id: empresaId, legal_name: nombre, status: 'active', ...extra,
    }).select('*').single(), `cliente ${nombre}`)

  const propio = await cliente('ZZ E4F Del vendedor', A, { salesperson_id: vendedor.id })
  const ajeno = await cliente('ZZ E4F De otro', A, { salesperson_id: otroVendedor.id })
  const clienteB = await cliente('ZZ E4F De la empresa B', B)

  // ── 1 · Adjuntos del cliente ─────────────────────────────────────────────
  seccion('1 · Subir, listar y borrar un adjunto del cliente')

  const subir = async (c, companyId, clienteId, nombre, clase = 'other', contenido = 'ZZ') => {
    const ruta = `${companyId}/customer/${clienteId}/${randomUUID()}-${nombre}`
    const up = await c.storage.from(BUCKET).upload(ruta, archivo(contenido), { contentType: 'text/plain' })
    if (up.error) return { error: up.error, ruta }
    creados.archivos.push(ruta)
    const fila = await c.from('attachments').insert({
      company_id: companyId, entity_type: 'customer', entity_id: clienteId,
      storage_path: ruta, file_name: nombre, mime_type: 'text/plain',
      bytes: contenido.length, kind: clase,
    }).select('id').single()
    return { error: fila.error, ruta, id: fila.data?.id }
  }

  const a1 = await subir(admin.c, A, ajeno.id, 'contrato.pdf', 'other')
  cmp('el admin adjunta un archivo al cliente', true, !!a1.id && !a1.error)

  const lista = await admin.c.from('attachments').select('id, file_name, kind, bytes, uploaded_by')
    .eq('entity_type', 'customer').eq('entity_id', ajeno.id)
  cmp('y lo ve listado, con su metadata', 'contrato.pdf/other/2',
    `${lista.data?.[0]?.file_name}/${lista.data?.[0]?.kind}/${lista.data?.[0]?.bytes}`)
  cmp('con el autor registrado', admin.id, lista.data?.[0]?.uploaded_by)

  const firmada = await admin.c.storage.from(BUCKET).createSignedUrl(a1.ruta, 300)
  cmp('se puede firmar una URL de descarga', true, !firmada.error && !!firmada.data?.signedUrl)

  // ── 2 · Lo que el servidor valida ────────────────────────────────────────
  seccion('2 · Lo que el servidor no deja pasar')

  rechaza('un adjunto de un cliente que no existe',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'customer', entity_id: randomUUID(),
      storage_path: `${A}/customer/x/f.pdf`, file_name: 'f.pdf', bytes: 1,
    }), 'DOCUMENTO_INEXISTENTE')

  rechaza('una fila cuya ruta es la de OTRO cliente',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'customer', entity_id: ajeno.id,
      storage_path: `${A}/customer/${propio.id}/f.pdf`, file_name: 'f.pdf', bytes: 1,
    }), 'RUTA_INVALIDA')

  rechaza('una ruta con salto de carpeta',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'customer', entity_id: ajeno.id,
      storage_path: `${A}/customer/${ajeno.id}/../otro/f.pdf`, file_name: 'f.pdf', bytes: 1,
    }), 'RUTA_INVALIDA')

  rechaza('un archivo de más de 20 MB',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'customer', entity_id: ajeno.id,
      storage_path: `${A}/customer/${ajeno.id}/grande.pdf`, file_name: 'grande.pdf',
      bytes: 21 * 1024 * 1024,
    }), 'ARCHIVO_DEMASIADO_GRANDE')

  // ── 3 · Quién VE un adjunto de cliente ───────────────────────────────────
  seccion('3 · Ver el adjunto es poder ver el cliente')

  const aPropio = await subir(admin.c, A, propio.id, 'del-vendedor.pdf')
  cmp('el admin adjunta también en el cliente del vendedor', true, !!aPropio.id)

  const veCliente = async (c, clienteId) =>
    ((await c.from('attachments').select('id').eq('entity_type', 'customer').eq('entity_id', clienteId)).data ?? []).length

  cmp('el vendedor ve los adjuntos de SU cliente', 1, await veCliente(vendedor.c, propio.id))
  cmp('pero NO los del cliente de otro vendedor', 0, await veCliente(vendedor.c, ajeno.id))
  cmp('el técnico no ve ninguno: tampoco ve los clientes', 0, await veCliente(tecnico.c, propio.id))
  cmp('el admin de otra empresa, ninguno', 0, await veCliente(adminB.c, propio.id))
  cmp('anónimo, ninguno', 0, await veCliente(anon, propio.id))
  cmp('el admin de la empresa los ve todos', 2,
    ((await admin.c.from('attachments').select('id').eq('entity_type', 'customer')).data ?? []).length)

  // ── 4 · Quién ESCRIBE ────────────────────────────────────────────────────
  seccion('4 · Adjuntar es administrar el cliente')

  const delVendedor = await subir(vendedor.c, A, propio.id, 'suyo.pdf')
  cmp('el vendedor adjunta en SU cliente', true, !!delVendedor.id && !delVendedor.error)

  const enAjeno = await subir(vendedor.c, A, ajeno.id, 'ajeno.pdf')
  cmp('pero no en el de otro vendedor', true, !!enAjeno.error)

  const delTecnico = await subir(tecnico.c, A, propio.id, 'tecnico.pdf')
  cmp('el técnico no adjunta', true, !!delTecnico.error)

  const deOtraEmpresa = await subir(adminB.c, A, propio.id, 'otra.pdf')
  cmp('el admin de otra empresa tampoco', true, !!deOtraEmpresa.error)

  // Cliente dado de baja: se lee, no se escribe.
  ok(await s.from('customers').update({ deleted_at: new Date().toISOString(), status: 'inactive' })
    .eq('id', propio.id), 'dar de baja')
  const enBaja = await subir(admin.c, A, propio.id, 'en-baja.pdf')
  cmp('en un cliente dado de baja NO se adjunta', true, !!enBaja.error)
  cmp('pero sus adjuntos se siguen leyendo', 2, await veCliente(admin.c, propio.id))
  const borradoEnBaja = await admin.c.from('attachments').delete().eq('id', aPropio.id).select('id')
  cmp('y tampoco se borran', 0, (borradoEnBaja.data ?? []).length)
  ok(await s.from('customers').update({ deleted_at: null, status: 'active' }).eq('id', propio.id), 'reactivar')

  // ── 5 · El archivo, no sólo la fila ──────────────────────────────────────
  seccion('5 · El archivo en Storage sigue la misma regla')

  const ajena = `${A}/customer/${ajeno.id}/${randomUUID()}-colado.txt`
  const colado = await vendedor.c.storage.from(BUCKET).upload(ajena, archivo('no'), { contentType: 'text/plain' })
  cmp('el vendedor no sube a la carpeta de un cliente ajeno', true, !!colado.error)
  if (!colado.error) creados.archivos.push(ajena)

  const listadoAjeno = await vendedor.c.storage.from(BUCKET).list(`${A}/customer/${ajeno.id}`)
  cmp('ni ve lo que hay adentro', 0, (listadoAjeno.data ?? []).length)
  const listadoPropio = await vendedor.c.storage.from(BUCKET).list(`${A}/customer/${propio.id}`)
  cmp('y sí ve la carpeta de su cliente', 2, (listadoPropio.data ?? []).length)

  // Borrar de verdad: la fila primero, el archivo después.
  const borrado = await admin.c.from('attachments').delete().eq('id', a1.id).select('id')
  cmp('el admin borra la fila del adjunto', 1, (borrado.data ?? []).length)
  await admin.c.storage.from(BUCKET).remove([a1.ruta])
  const quedo = await s.storage.from(BUCKET).list(`${A}/customer/${ajeno.id}`)
  cmp('y el archivo se va del bucket', 0, (quedo.data ?? []).filter((f) => f.name.includes('contrato')).length)

  // ── 6 · Historial documental ─────────────────────────────────────────────
  seccion('6 · El historial, paginado del lado del servidor')

  const LINEA = (p, cant, precio) => ({
    line_type: 'item', product_id: p, sku_snapshot: 'ZZ', name_snapshot: 'ZZ',
    quantity: cant, unit_price: precio, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21,
  })

  const cotizaciones = []
  for (let i = 0; i < 3; i += 1) {
    const q = ok(await admin.c.rpc('crear_cotizacion', {
      p_company: A,
      p_cabecera: { customer_id: ajeno.id, currency_code: 'USD' },
      p_lineas: [LINEA(producto.id, 2 + i, 100 + i)],
    }), `cotización ${i}`)
    cotizaciones.push(q.id)
  }
  const ped = ok(await admin.c.rpc('crear_pedido', {
    p_company: A,
    p_cabecera: { customer_id: ajeno.id, currency_code: 'USD' },
    p_lineas: [LINEA(producto.id, 10, 90), LINEA(producto2.id, 4, 50)],
  }), 'pedido')
  // Una cotización en otra moneda: no se mezcla con las de dólares.
  ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A,
    p_cabecera: { customer_id: ajeno.id, currency_code: 'ARS' },
    p_lineas: [LINEA(producto.id, 1, 500000)],
  }), 'cotización ARS')

  const docs = async (c, opciones = {}) =>
    c.rpc('documentos_del_cliente', { p_customer: ajeno.id, p_limit: 25, p_offset: 0, ...opciones })

  const pagina1 = ok(await docs(admin.c, { p_limit: 3 }), 'documentos')
  cmp('la página trae lo que se pidió', 3, pagina1.length)
  cmp('y dice cuántos hay en total', 5, pagina1[0].total_filas)
  const pagina2 = ok(await docs(admin.c, { p_limit: 3, p_offset: 3 }), 'página 2')
  cmp('la segunda página trae el resto', 2, pagina2.length)
  const ids = new Set([...pagina1, ...pagina2].map((d) => d.documento_id))
  cmp('sin repetir ni saltear documentos', 5, ids.size)
  cmp('el filtro por tipo funciona', 1, (ok(await docs(admin.c, { p_tipo: 'pedido' }), 'pedidos')).length)

  const ordenadas = pagina1.map((d) => d.fecha)
  cmp('vienen de la más nueva a la más vieja', true,
    ordenadas.every((f, i) => i === 0 || String(ordenadas[i - 1]) >= String(f)))
  cmp('cada fila trae su moneda y su total', true,
    pagina1.every((d) => d.moneda !== null && d.total !== null))

  cmp('el vendedor no ve los documentos de un cliente ajeno', 0,
    (ok(await docs(vendedor.c), 'docs del vendedor')).length)

  // ── 7 · Qué compra el cliente ────────────────────────────────────────────
  seccion('7 · Qué compra: cotizado y pedido, separados')

  const prods = ok(await admin.c.rpc('productos_del_cliente', {
    p_customer: ajeno.id, p_limit: 25, p_offset: 0,
  }), 'productos')

  // Producto 1: 3 cotizaciones en USD (2+3+4=9) y 1 pedido (10); más 1 en ARS.
  const p1usd = prods.find((p) => p.product_id === producto.id && p.moneda === 'USD')
  const p1ars = prods.find((p) => p.product_id === producto.id && p.moneda === 'ARS')
  const p2usd = prods.find((p) => p.product_id === producto2.id)

  cmp('un producto en dos monedas son dos filas', true, !!p1usd && !!p1ars)
  cmp('las cotizaciones se cuentan como cotizaciones', 3, p1usd?.cotizaciones)
  cmp('y los pedidos como pedidos', 1, p1usd?.pedidos)
  cmp('la cantidad cotizada NO incluye la pedida', 9, Number(p1usd?.cantidad_cotizada))
  cmp('la cantidad pedida va por su lado', 10, Number(p1usd?.cantidad_pedida))
  cmp('la fila de la otra moneda no arrastra nada de la primera', '1/0',
    `${Number(p1ars?.cantidad_cotizada)}/${p1ars?.pedidos}`)
  cmp('un producto que sólo se pidió no inventa cotizaciones', '0/1',
    `${p2usd?.cotizaciones}/${p2usd?.pedidos}`)
  // Las líneas del fixture guardan 'ZZ' como snapshot: si acá se lee el nombre
  // del catálogo, es porque la consulta va a buscarlo y no repite el congelado.
  cmp('el nombre sale del catálogo, no del snapshot de la línea', 'ZZ Producto uno', p1usd?.nombre)
  cmp('el último documento viene con su id, para poder abrirlo', true, !!p1usd?.ultimo_documento_id)
  cmp('y dice si fue cotización o pedido', 'pedido', p1usd?.ultimo_tipo)

  const buscado = ok(await admin.c.rpc('productos_del_cliente', {
    p_customer: ajeno.id, p_texto: 'Producto dos', p_limit: 25, p_offset: 0,
  }), 'búsqueda')
  cmp('la búsqueda filtra del lado del servidor', 1, buscado.length)
  cmp('y el total refleja lo filtrado, no el catálogo', 1, buscado[0]?.total_filas)

  cmp('un cliente sin documentos no rompe nada', 0,
    (ok(await admin.c.rpc('productos_del_cliente', { p_customer: propio.id }), 'sin docs')).length)

  cmp('el vendedor no ve los productos de un cliente ajeno', 0,
    (ok(await vendedor.c.rpc('productos_del_cliente', { p_customer: ajeno.id }), 'prod vendedor')).length)

  // ── 8 · Trazabilidad ─────────────────────────────────────────────────────
  seccion('8 · Qué quedó registrado en la ficha')

  const cli = (await s.from('customers').select('updated_at').eq('id', ajeno.id).single()).data
  ok(await admin.c.rpc('guardar_cliente', {
    p_customer: ajeno.id, p_esperado: cli.updated_at, p_datos: { phone: '11 5555' },
  }), 'editar cliente')
  const k = ok(await admin.c.rpc('guardar_contacto', {
    p_customer: ajeno.id, p_contacto: null, p_esperado: null,
    p_datos: { full_name: 'ZZ Ana Pérez', is_default: true },
  }), 'contacto')
  const kAhora = (await s.from('customer_contacts').select('updated_at').eq('id', k.id).single()).data
  ok(await admin.c.rpc('guardar_contacto', {
    p_customer: ajeno.id, p_contacto: k.id, p_esperado: kAhora.updated_at,
    p_datos: { phone: '11 9999' },
  }), 'editar contacto')

  const eventos = ok(await admin.c.from('sales_audit')
    .select('action, diff').eq('entity_type', 'customer').eq('entity_id', ajeno.id)
    .order('created_at', { ascending: false }), 'trazabilidad')

  const acciones = eventos.map((e) => e.action)
  for (const esperada of ['attachment_added', 'attachment_deleted', 'updated', 'contact_added', 'contact_updated']) {
    cmp(`la trazabilidad registra ${esperada}`, true, acciones.includes(esperada))
  }
  const edicion = eventos.find((e) => e.action === 'contact_updated')
  cmp('la edición de un contacto trae su NOMBRE, no sólo el id', 'ZZ Ana Pérez', edicion?.diff?.contacto)
  const adjunto = eventos.find((e) => e.action === 'attachment_added')
  cmp('el adjunto queda con su archivo y su clase', 'contrato.pdf/other',
    `${adjunto?.diff?.archivo}/${adjunto?.diff?.clase}`)
  cmp('leer NO deja rastro: no hay eventos de lectura', 0,
    acciones.filter((a) => String(a).includes('view') || String(a).includes('read')).length)

  cmp('el vendedor no lee la trazabilidad de un cliente ajeno', 0,
    ((await vendedor.c.from('sales_audit').select('id')
      .eq('entity_type', 'customer').eq('entity_id', ajeno.id)).data ?? []).length)

  // ── 9 · Limpieza e invariantes ───────────────────────────────────────────
  seccion('9 · Limpieza e invariantes')

  await limpiar()
  cmp('sin empresas de fixture', 0,
    (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)

  const despues = await baselineProd()
  cmp('producción idéntica al baseline', JSON.stringify(antesProd), JSON.stringify(despues))

  console.log('\n' + '='.repeat(78))
  console.log(`  RESULTADO: ${fallos === 0 ? '0 FALLOS' : fallos + ' FALLO(S)'}`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n✗ ERROR:', e.message)
  try { await limpiar() } catch (x) { console.error('  y la limpieza falló:', x.message) }
  process.exit(1)
})
