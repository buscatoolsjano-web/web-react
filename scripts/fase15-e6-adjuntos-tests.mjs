/**
 * Fase 15 · E6 — adjuntos, storage y domicilio de entrega, contra la base.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase15-e6-adjuntos-tests.mjs
 *
 * Lo que prueba, midiendo el EFECTO:
 *   1. subir, listar, descargar con URL firmada y borrar de verdad
 *   2. dos archivos con el mismo nombre conviven (la identidad es la ruta)
 *   3. validación: documento de otra empresa, ruta que no corresponde, salto
 *      de carpeta y archivo demasiado grande
 *   4. auditoría: attachment_added / attachment_deleted, y nada al leer
 *   5. permisos: anon, vendedor, portal y admin de otra empresa
 *   6. storage: nadie firma una URL de otra empresa
 *   7. domicilio de entrega: snapshot al crear, y mudarse después no lo cambia
 *   8. limpieza e invariantes de producción (incluido el bucket)
 *
 * Todo lleva el prefijo zz-e6 y se borra al final. No toca WhatsApp.
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

const MARCA = 'zz-e6'
const BUCKET = 'ventas'
const creados = { usuarios: [], empresas: [], objetos: [] }
const ok = (r, q) => { if (r.error) throw new Error(`${q}: ${r.error.message}`); return r.data }
const cuenta = async (t, filtro = (q) => q) => (await filtro(s.from(t).select('*', { count: 'exact', head: true }))).count

const usuarioTemporal = async (companyId, rol, customerId = null) => {
  const email = `${MARCA}-${rol}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@buscatools.test`
  const password = `Zz${randomUUID()}!`
  const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`crear ${rol}: ${error.message}`)
  creados.usuarios.push(data.user.id)
  const fila = { company_id: companyId, user_id: data.user.id, role: rol, status: 'active' }
  if (customerId) fila.customer_id = customerId
  ok(await s.from('company_memberships').insert(fila), `membresía ${rol}`)
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({ email, password })
  if (eL) throw new Error(`login ${rol}: ${eL.message}`)
  return { id: data.user.id, rol, c }
}

const limpiar = async () => {
  const ids = creados.empresas
  // Los archivos primero: si se van las filas, la ruta se pierde. Se juntan
  // las dos fuentes —lo que subió esta corrida y lo que diga la tabla— porque
  // un archivo suelto en el bucket no lo ve nadie y no lo limpia nadie.
  if (ids.length) {
    const { data: filas } = await s.from('attachments').select('storage_path').in('company_id', ids)
    creados.objetos.push(...(filas ?? []).map((a) => a.storage_path))
  }
  const rutas = [...new Set(creados.objetos)]
  if (rutas.length > 0) {
    const r = await s.storage.from(BUCKET).remove(rutas)
    if (r.error) console.log(`    aviso storage: ${r.error.message.slice(0, 110)}`)
    creados.objetos = []
  }
  if (ids.length) {
    const borrar = async (t) => {
      const r = await s.from(t).delete().in('company_id', ids)
      if (r.error) console.log(`    aviso ${t}: ${r.error.message.slice(0, 110)}`)
    }
    await borrar('attachments')
    await s.from('sales_audit').delete().in('company_id', ids)
    await borrar('stock_movements')
    await borrar('stock_reservations')
    await borrar('stock_balances')
    await borrar('delivery_lines')
    await borrar('deliveries')
    await borrar('sales_orders')
    await borrar('sales_quotes')
    await borrar('warehouses')
    await borrar('products')
    await borrar('product_categories')
    await borrar('document_sequences')
    await borrar('company_memberships')
    await borrar('customer_addresses')
    await borrar('customer_contacts')
    await borrar('customers')
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
  const { data: us } = await s.auth.admin.listUsers({ perPage: 1000 })
  creados.usuarios = (us?.users ?? []).filter((u) => u.email?.startsWith(`${MARCA}-`)).map((u) => u.id)
  for (const e of creados.empresas) {
    const { data: viejos } = await s.from('attachments').select('storage_path').eq('company_id', e)
    creados.objetos.push(...(viejos ?? []).map((a) => a.storage_path))
  }
  await limpiar()
  creados.empresas = []
}

const PRODUCCION = ['buscatools', 'torquetools']

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 15 · VENTAS E6 — adjuntos, storage y domicilio de entrega')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  await barrerRestos()

  const { data: prodEmpresas } = await s.from('companies').select('id, slug').in('slug', PRODUCCION)
  const prodIds = prodEmpresas.map((e) => e.id)
  const objetosDelBucket = async () => {
    const { data } = await s.storage.from(BUCKET).list('', { limit: 1000 })
    return (data ?? []).length
  }
  const baselineProd = async () => ({
    adjuntos: await cuenta('attachments', (q) => q.in('company_id', prodIds)),
    remitos: await cuenta('deliveries', (q) => q.in('company_id', prodIds)),
    remitosConDomicilio: await cuenta('deliveries', (q) => q.in('company_id', prodIds).not('delivery_address_snapshot', 'is', null)),
    direcciones: await cuenta('customer_addresses', (q) => q.in('company_id', prodIds)),
    auditoria: await cuenta('sales_audit', (q) => q.in('company_id', prodIds)),
    stock: await cuenta('stock_movements', (q) => q.in('company_id', prodIds)),
    carpetasBucket: await objetosDelBucket(),
  })
  const antesProd = await baselineProd()
  console.log(`  baseline producción: ${JSON.stringify(antesProd)}`)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const sello = Date.now()
  const empresa = async (k, nombre) => {
    const e = ok(await s.from('companies').insert({
      slug: `${MARCA}-${k}-${sello}`, name: nombre, legal_name: `${nombre} SA`, default_currency: 'USD',
    }).select('id').single(), `empresa ${k}`)
    creados.empresas.push(e.id)
    for (const [doc, code] of [['quote', 'ZQ'], ['sales_order', 'ZP'], ['delivery', 'ZR']]) {
      ok(await s.from('document_sequences').insert({
        company_id: e.id, doc_type: doc, series_code: `${code}${k.toUpperCase()}`, prefix: `${code}${k.toUpperCase()}`,
        padding: 5, next_number: 1, is_default: true,
      }), `secuencia ${doc} ${k}`)
    }
    return e.id
  }
  const A = await empresa('a', 'ZZ E6 Alfa')
  const B = await empresa('b', 'ZZ E6 Beta')

  const deposito = ok(await s.from('warehouses').insert({
    company_id: A, code: `ZA${sello % 1000}`, name: 'ZZ Depósito E6',
  }).select('id').single(), 'depósito')

  const categoria = ok(await s.from('product_categories').insert({
    company_id: A, name: 'ZZ E6 Cat', slug: `${MARCA}-cat-${sello}`, position: 1, needs_review: false,
  }).select('id').single(), 'categoría')
  const producto = ok(await s.from('products').insert({
    company_id: A, category_id: categoria.id, sku: `${MARCA}-P-${sello}`, name: 'ZZ Producto E6', status: 'active', attributes: {},
  }).select('id').single(), 'producto')

  const cliente = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E6 Cliente SA', status: 'active',
  }).select('id').single(), 'cliente')
  const clienteB = ok(await s.from('customers').insert({
    company_id: B, legal_name: 'ZZ E6 Cliente B SA', status: 'active',
  }).select('id').single(), 'cliente B')

  const admin = await usuarioTemporal(A, 'admin')
  const vendedor = await usuarioTemporal(A, 'salesperson')
  const portal = await usuarioTemporal(A, 'customer', cliente.id)
  const adminB = await usuarioTemporal(B, 'admin')
  const anon = sesion()

  const LINEA = (over = {}) => ({
    line_type: 'item', product_id: producto.id, sku_snapshot: 'ZZ-1', name_snapshot: 'ZZ Producto E6',
    description_snapshot: 'ZZ texto', quantity: 5, unit_price: 100, discount_pct: 0,
    tax_treatment: 'vat_21', tax_rate_snapshot: 21, ...over,
  })

  const cot = ok(await admin.c.rpc('crear_cotizacion', {
    p_company: A, p_cabecera: { customer_id: cliente.id, currency_code: 'USD' }, p_lineas: [LINEA()],
  }), 'cotización')
  const ped = ok(await admin.c.rpc('crear_pedido', {
    p_company: A, p_cabecera: { customer_id: cliente.id, currency_code: 'USD' }, p_lineas: [LINEA()],
  }), 'pedido')
  const cotB = ok(await adminB.c.rpc('crear_cotizacion', {
    p_company: B, p_cabecera: { customer_id: clienteB.id, currency_code: 'USD' },
    p_lineas: [{ line_type: 'item', sku_snapshot: 'ZZ-B', name_snapshot: 'ZZ B', quantity: 1, unit_price: 10, discount_pct: 0, tax_treatment: 'vat_21', tax_rate_snapshot: 21 }],
  }), 'cotización B')

  /** Sube un archivo como lo hace la aplicación: primero Storage, después la fila. */
  const subir = async (cliente_, tipo, docId, nombre, contenido = 'ZZ E6', companyId = A, rutaForzada = null) => {
    const ruta = rutaForzada ?? `${companyId}/${tipo}/${docId}/${randomUUID()}-${nombre}`
    const blob = new Blob([contenido], { type: 'text/plain' })
    const r1 = await cliente_.storage.from(BUCKET).upload(ruta, blob, { contentType: 'text/plain', upsert: false })
    if (r1.error) return { error: r1.error, ruta }
    creados.objetos.push(ruta)
    const r2 = await cliente_.from('attachments').insert({
      company_id: companyId, entity_type: tipo, entity_id: docId, storage_path: ruta,
      file_name: nombre, mime_type: 'text/plain', bytes: contenido.length, kind: 'customer_po',
    })
    if (r2.error) {
      await s.storage.from(BUCKET).remove([ruta])
      creados.objetos = creados.objetos.filter((o) => o !== ruta)
    }
    return { error: r2.error, ruta }
  }

  // ── 1 · Subir, listar, descargar y borrar ────────────────────────────────
  seccion('1 · El circuito completo de un adjunto')

  const a1 = await subir(admin.c, 'quote', cot.id, 'orden-de-compra.txt')
  cmp('subir deja el archivo y la fila', true, !a1.error)

  const lista = ok(await admin.c.from('attachments').select('id, file_name, bytes, kind, uploaded_by, storage_path')
    .eq('entity_id', cot.id), 'listar')
  cmp('la lista trae un adjunto con su metadata', '1/orden-de-compra.txt/customer_po',
    `${lista.length}/${lista[0]?.file_name}/${lista[0]?.kind}`)
  cmp('queda registrado quién lo subió', admin.id, lista[0]?.uploaded_by)

  const firmada = await admin.c.storage.from(BUCKET).createSignedUrl(a1.ruta, 60)
  cmp('se puede firmar una URL de descarga', true, !firmada.error && !!firmada.data?.signedUrl)
  const bajado = firmada.data ? await fetch(firmada.data.signedUrl) : null
  cmp('y la URL trae el archivo', 'ZZ E6', bajado ? (await bajado.text()) : 'sin URL')

  const a2 = await subir(admin.c, 'quote', cot.id, 'orden-de-compra.txt', 'ZZ otro')
  cmp('dos archivos con el MISMO nombre conviven', 2,
    await cuenta('attachments', (q) => q.eq('entity_id', cot.id)))
  cmp('cada uno con su propia ruta', true, a1.ruta !== a2.ruta)

  // ── 2 · Auditoría ────────────────────────────────────────────────────────
  seccion('2 · Qué queda auditado')

  const auditAlta = ok(await s.from('sales_audit').select('*').eq('entity_id', cot.id).eq('action', 'attachment_added'), 'auditoría alta')
  cmp('un evento por archivo subido', 2, auditAlta.length)
  cmp('con el nombre y el autor', true,
    auditAlta.every((e) => e.diff.archivo === 'orden-de-compra.txt' && e.actor_id === admin.id))
  cmp('del documento, no de la tabla de adjuntos', 'sales_quote', auditAlta[0]?.entity_type)

  ok(await admin.c.from('attachments').select('id').eq('entity_id', cot.id), 'leer de nuevo')
  cmp('leer NO audita nada', 2,
    await cuenta('sales_audit', (q) => q.eq('entity_id', cot.id).like('action', 'attachment%')))

  const borrado = await admin.c.from('attachments').delete().eq('id', lista[0].id)
  cmp('borrar la fila funciona', true, !borrado.error)
  // Y el archivo se va DE VERDAD: con la política anterior el borrado
  // contestaba que sí y no borraba nada, porque al irse la fila el objeto
  // dejaba de ser visible. El efecto se mide listando, no leyendo el error.
  await admin.c.storage.from(BUCKET).remove([a1.ruta])
  const quedo = await s.storage.from(BUCKET).list(a1.ruta.split('/').slice(0, -1).join('/'), { limit: 50 })
  cmp('y el archivo se va del bucket de verdad', false,
    (quedo.data ?? []).some((f) => a1.ruta.endsWith(f.name)))
  cmp('queda el evento de baja', 1,
    await cuenta('sales_audit', (q) => q.eq('entity_id', cot.id).eq('action', 'attachment_deleted')))
  creados.objetos = creados.objetos.filter((o) => o !== a1.ruta)

  // ── 3 · Validaciones del servidor ────────────────────────────────────────
  seccion('3 · Lo que el servidor no deja registrar')

  rechaza('un adjunto de un documento de OTRA empresa',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'quote', entity_id: cotB.id,
      storage_path: `${A}/quote/${cotB.id}/x.txt`, file_name: 'x.txt', bytes: 4,
    }), 'DOCUMENTO_INEXISTENTE')

  rechaza('un adjunto de un documento inventado',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'quote', entity_id: randomUUID(),
      storage_path: `${A}/quote/${randomUUID()}/x.txt`, file_name: 'x.txt', bytes: 4,
    }), 'DOCUMENTO_INEXISTENTE')

  rechaza('una ruta que apunta a otra carpeta',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'quote', entity_id: cot.id,
      storage_path: `${A}/quote/${ped.id}/x.txt`, file_name: 'x.txt', bytes: 4,
    }), 'RUTA_INVALIDA')

  rechaza('una ruta con salto de carpeta',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'quote', entity_id: cot.id,
      storage_path: `${A}/quote/${cot.id}/../../otro/x.txt`, file_name: 'x.txt', bytes: 4,
    }), 'RUTA_INVALIDA')

  rechaza('un archivo de más de 20 MB',
    await admin.c.from('attachments').insert({
      company_id: A, entity_type: 'quote', entity_id: cot.id,
      storage_path: `${A}/quote/${cot.id}/grande.bin`, file_name: 'grande.bin', bytes: 20971521,
    }), 'ARCHIVO_DEMASIADO_GRANDE')

  const subidaGrande = await admin.c.storage.from(BUCKET)
    .upload(`${A}/quote/${cot.id}/${randomUUID()}.bin`, new Blob([new Uint8Array(21 * 1024 * 1024)]), { contentType: 'application/octet-stream' })
  rechaza('y el bucket tampoco lo acepta', subidaGrande)

  const subidaMime = await admin.c.storage.from(BUCKET)
    .upload(`${A}/quote/${cot.id}/${randomUUID()}.exe`, new Blob(['MZ'], { type: 'application/x-msdownload' }), { contentType: 'application/x-msdownload' })
  rechaza('un tipo de archivo fuera de la lista', subidaMime)

  // ── 4 · Permisos ─────────────────────────────────────────────────────────
  seccion('4 · Quién ve y quién escribe')

  cmp('el vendedor VE los adjuntos de su empresa', 1,
    (await vendedor.c.from('attachments').select('id').eq('entity_id', cot.id)).data?.length)
  rechaza('pero no sube', await subir(vendedor.c, 'quote', cot.id, 'no.txt'))
  cmp('el cliente del portal no ve ninguno', 0,
    (await portal.c.from('attachments').select('id').eq('entity_id', cot.id)).data?.length ?? 0)
  cmp('el admin de otra empresa tampoco', 0,
    (await adminB.c.from('attachments').select('id').eq('entity_id', cot.id)).data?.length ?? 0)
  cmp('anónimo, menos', 0,
    (await anon.from('attachments').select('id').eq('entity_id', cot.id)).data?.length ?? 0)

  // Un DELETE que RLS filtra no da error: no borra nada y contesta que sí. Lo
  // que importa es el EFECTO, así que se cuenta después.
  await adminB.c.from('attachments').delete().eq('entity_id', cot.id)
  cmp('el admin de otra empresa no borra lo ajeno', 1,
    await cuenta('attachments', (q) => q.eq('entity_id', cot.id)))
  await portal.c.from('attachments').delete().eq('entity_id', cot.id)
  cmp('el cliente del portal tampoco', 1,
    await cuenta('attachments', (q) => q.eq('entity_id', cot.id)))

  // ── 5 · Storage ──────────────────────────────────────────────────────────
  seccion('5 · El bucket no se abre con el nombre del archivo')

  const firmaAjena = await adminB.c.storage.from(BUCKET).createSignedUrl(a2.ruta, 60)
  rechaza('el admin de otra empresa no firma una URL ajena', firmaAjena)
  const firmaAnon = await anon.storage.from(BUCKET).createSignedUrl(a2.ruta, 60)
  rechaza('anónimo tampoco', firmaAnon)
  const firmaPortal = await portal.c.storage.from(BUCKET).createSignedUrl(a2.ruta, 60)
  rechaza('el cliente del portal tampoco', firmaPortal)
  const firmaPropia = await admin.c.storage.from(BUCKET).createSignedUrl(a2.ruta, 60)
  cmp('el dueño sí', true, !firmaPropia.error)

  // ── 6 · Domicilio de entrega ─────────────────────────────────────────────
  seccion('6 · El domicilio se congela al emitir el remito')

  const direccion = ok(await s.from('customer_addresses').insert({
    company_id: A, customer_id: cliente.id, kind: 'shipping', is_default: true,
    street: 'Av. Siempreviva 742', city: 'Springfield', state: 'Buenos Aires',
    postal_code: 'B1636', country_code: 'AR',
  }).select('id').single(), 'dirección')

  ok(await s.from('sales_orders').update({ commercial_status: 'confirmed', shipping_address_id: direccion.id }).eq('id', ped.id), 'confirmar pedido')
  const lineasPed = ok(await s.from('sales_order_lines').select('id').eq('order_id', ped.id), 'líneas')
  const rem = ok(await admin.c.rpc('crear_remito_desde_pedido', {
    p_order: ped.id, p_lineas: [{ order_line_id: lineasPed[0].id, quantity: 2 }],
  }), 'remito')

  const d1 = (await s.from('deliveries').select('delivery_address_snapshot').eq('id', rem.id).single()).data
  cmp('el remito guarda el domicilio del pedido', 'Av. Siempreviva 742/Springfield/B1636',
    `${d1.delivery_address_snapshot?.street}/${d1.delivery_address_snapshot?.city}/${d1.delivery_address_snapshot?.postal_code}`)

  ok(await s.from('customer_addresses').update({ street: 'Otra calle 1', city: 'Otra ciudad' }).eq('id', direccion.id), 'mudanza')
  const d2 = (await s.from('deliveries').select('delivery_address_snapshot').eq('id', rem.id).single()).data
  cmp('si el cliente se muda, el remito NO cambia', 'Av. Siempreviva 742',
    d2.delivery_address_snapshot?.street)

  // Un cliente sin domicilio: null, no una dirección inventada.
  const clienteSinDir = ok(await s.from('customers').insert({
    company_id: A, legal_name: 'ZZ E6 Sin domicilio SA', status: 'active',
  }).select('id').single(), 'cliente sin dirección')
  const ped2 = ok(await admin.c.rpc('crear_pedido', {
    p_company: A, p_cabecera: { customer_id: clienteSinDir.id, currency_code: 'USD' }, p_lineas: [LINEA({ quantity: 1 })],
  }), 'pedido 2')
  ok(await s.from('sales_orders').update({ commercial_status: 'confirmed' }).eq('id', ped2.id), 'confirmar 2')
  const lineasPed2 = ok(await s.from('sales_order_lines').select('id').eq('order_id', ped2.id), 'líneas 2')
  const rem2 = ok(await admin.c.rpc('crear_remito_desde_pedido', {
    p_order: ped2.id, p_lineas: [{ order_line_id: lineasPed2[0].id, quantity: 1 }],
  }), 'remito 2')
  const d3 = (await s.from('deliveries').select('delivery_address_snapshot').eq('id', rem2.id).single()).data
  cmp('sin domicilio cargado queda NULL, no inventado', 'null', String(d3.delivery_address_snapshot))

  cmp('los remitos históricos siguen sin domicilio (no hubo backfill)', 0,
    await cuenta('deliveries', (q) => q.in('company_id', prodIds).not('delivery_address_snapshot', 'is', null)))

  // ── 7 · Limpieza e invariantes ───────────────────────────────────────────
  seccion('7 · Limpieza e invariantes')

  await limpiar()
  cmp('sin empresas de fixture', 0,
    (await s.from('companies').select('id', { count: 'exact', head: true }).like('slug', `${MARCA}-%`)).count)
  cmp('sin adjuntos de fixture', 0, await cuenta('attachments'))

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
