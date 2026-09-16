/**
 * Fase 14 · Entrega 4 — sync incremental STEL → React.
 *
 *   sincronizarProductos(sb, c, o)   catálogo y precios de catálogo
 *   sincronizarDocumentos(sb, c, o)  delta de cotizaciones, pedidos y remitos
 *
 * Reglas:
 *   · STEL es el maestro de producto y de precio de catálogo; React manda en
 *     categoría, marca, atributos y stock, y esos campos no se tocan;
 *   · identidad = `external_id` (id de STEL). El SKU sirve una sola vez, para no
 *     duplicar al crear; nunca para re-identificar algo ya vinculado;
 *   · nada de borrado físico: un producto que STEL desactiva queda
 *     `discontinued`;
 *   · el precio de catálogo no toca el precio de las líneas de documentos, que
 *     es historia;
 *   · checkpoint y candado viven en la base (`stel_sync_state`), nunca en el
 *     navegador ni en un archivo local: así el reintento y el resume son fiables;
 *   · un solo sync a la vez por empresa (candado con dueño y vencimiento, más el
 *     índice único de corridas en curso).
 *
 * La API de STEL no admite filtro por fecha en `products` (E000003): el
 * incremental ordena por `utc-last-modification-date:desc` y corta en cuanto
 * llega al checkpoint. Un día normal es 1 página.
 */
import { CATEGORIA_REVISION, ejecutarPlan, hashPlan, planificarE2 } from './stel-reconciliacion.mjs'

const RUTA_PRODUCTOS = 'products'
const RUTA_SERVICIOS = 'services'

/** Lo que STEL dice de un ítem, en los términos de React. */
export function productoDeStel(item, { categoriaRevisionId, crear = false } = {}) {
  return {
    stel_id: String(item.id),
    sku: (item['full-reference'] ?? '').trim(),
    name: item.name ?? '',
    description: item.description ?? '',
    product_type: item.clase === 'services' ? 'Servicio' : '',
    status: item.inactive || item.deleted ? 'discontinued' : 'active',
    crear,
    category_id: categoriaRevisionId ?? null,
  }
}

const ts = (x) => Date.parse(x ?? '') || 0

/**
 * Página a página desde el más reciente, hasta pasar el checkpoint.
 * Devuelve los ítems ordenados de más viejo a más nuevo (para que el checkpoint
 * avance de forma monótona aunque la corrida se corte por la mitad).
 */
export async function leerItemsModificados(c, { desde = null, maxPaginas = 40, limite = 200, incluirServicios = true } = {}) {
  const corte = ts(desde)
  const out = []
  let alcanzoElCheckpoint = false
  for (const [ruta, clase] of incluirServicios ? [[RUTA_PRODUCTOS, 'products'], [RUTA_SERVICIOS, 'services']] : [[RUTA_PRODUCTOS, 'products']]) {
    for (let p = 0; p < maxPaginas; p++) {
      const pagina = await c.get(ruta, { sort: 'utc-last-modification-date:desc', limit: limite, start: p * limite })
      const arr = Array.isArray(pagina) ? pagina : []
      for (const it of arr) {
        if (corte && ts(it['utc-last-modification-date']) <= corte) { alcanzoElCheckpoint = true; break }
        out.push({ ...it, clase })
      }
      if (alcanzoElCheckpoint || arr.length < limite) break
      if (p === maxPaginas - 1) throw new Error(`STEL ${ruta}: el incremental necesitó más de ${maxPaginas} páginas; correr un full sync a propósito`)
    }
    alcanzoElCheckpoint = false
  }
  return out.sort((a, b) => ts(a['utc-last-modification-date']) - ts(b['utc-last-modification-date']))
}

/** Productos de React ya vinculados a esos ids de STEL, con su precio en la lista. */
async function leerProductosVinculados(sb, company, stelIds, listaPreciosId) {
  const mapa = new Map()
  for (let i = 0; i < stelIds.length; i += 150) {
    const lote = stelIds.slice(i, i + 150)
    const { data, error } = await sb.from('products')
      .select('id, sku, name, description, status, product_type, external_id')
      .eq('company_id', company).eq('external_source', 'stel').in('external_id', lote)
    if (error) throw new Error(`productos vinculados: ${error.message}`)
    for (const p of data ?? []) mapa.set(p.external_id, { ...p, precio: null })
  }
  if (!listaPreciosId || mapa.size === 0) return mapa
  const ids = [...mapa.values()].map((p) => p.id)
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from('product_prices')
      .select('product_id, amount, valid_from').eq('company_id', company).eq('price_list_id', listaPreciosId)
      .is('valid_to', null).in('product_id', ids.slice(i, i + 150))
    if (error) throw new Error(`precios: ${error.message}`)
    for (const pr of data ?? []) {
      for (const p of mapa.values()) if (p.id === pr.product_id) p.precio = pr.amount
    }
  }
  return mapa
}

async function tomar(sb, company, entidad, owner) {
  const r = await sb.rpc('stel_sync_tomar', { p_company: company, p_entidad: entidad, p_owner: owner })
  if (r.error) throw new Error(`sync_tomar: ${r.error.message}`)
  return r.data
}

async function cerrar(sb, run, estado, cursor, cursorId, llamadas, resumen, error) {
  const r = await sb.rpc('stel_sync_cerrar', {
    p_run: run, p_estado: estado, p_cursor: cursor, p_cursor_id: cursorId,
    p_llamadas: llamadas, p_resumen: resumen, p_error: error ?? null,
  })
  if (r.error) throw new Error(`sync_cerrar: ${r.error.message}`)
}

/**
 * @param o {
 *   company, owner, categoriaRevisionId, listaPreciosId,
 *   crearNuevos = false, maxNuevos = 50, desde = null (fuerza el checkpoint),
 *   soloLectura = false, log
 * }
 */
export async function sincronizarProductos(sb, c, o) {
  const log = o.log ?? (() => {})
  const { run, cursor_modified_at: checkpoint } = await tomar(sb, o.company, 'products', o.owner)
  const desde = o.desde ?? checkpoint ?? null
  const resumen = {
    desde, leidos: 0, actualizados: 0, creados: 0, sinCambios: 0, nuevosNoCreados: 0,
    skuExistente: 0, desactivados: 0, precios: { creados: 0, actualizados: 0, sinCambios: 0, sinProducto: 0 },
    errores: [],
  }
  let cursor = desde
  let cursorId = null
  try {
    if (!desde && !o.forzarFullSync) {
      throw new Error('sin checkpoint: pasar --desde <fecha> para el primer incremental, o --full-sync a propósito')
    }
    const items = await leerItemsModificados(c, { desde, maxPaginas: o.maxPaginas ?? 40, incluirServicios: o.incluirServicios !== false })
    resumen.leidos = items.length
    // En sólo lectura se compara acá mismo contra React: el dry run tiene que
    // decir qué cambiaría, no limitarse a contar lo leído.
    const enReact = o.soloLectura ? await leerProductosVinculados(sb, o.company, items.map((i) => String(i.id)), o.listaPreciosId) : null
    if (o.soloLectura) resumen.cambiosPrevistos = { producto: [], precio: [] }
    let creados = 0
    for (const item of items) {
      const puedeCrear = Boolean(o.crearNuevos) && creados < (o.maxNuevos ?? 50)
      const payload = productoDeStel(item, { categoriaRevisionId: o.categoriaRevisionId, crear: puedeCrear })
      if (!payload.sku) { resumen.errores.push({ stel_id: payload.stel_id, error: 'sin referencia' }); continue }
      if (o.soloLectura) {
        const actual = enReact.get(payload.stel_id)
        if (!actual) {
          if (payload.crear) resumen.creados++
          else resumen.nuevosNoCreados++
        } else {
          const difieren = ['name', 'description', 'status', 'product_type'].filter((k) => (actual[k] ?? '') !== (payload[k] ?? ''))
          if (difieren.length) {
            resumen.actualizados++
            if (resumen.cambiosPrevistos.producto.length < 40) resumen.cambiosPrevistos.producto.push({ sku: payload.sku, campos: difieren })
          } else resumen.sinCambios++
        }
      } else {
        const r = await sb.rpc('stel_sync_producto', { p_run: run, p: payload })
        if (r.error) { resumen.errores.push({ stel_id: payload.stel_id, sku: payload.sku, error: r.error.message }); continue }
        const res = r.data.resultado
        if (res === 'creado') { resumen.creados++; creados++ } else if (res === 'actualizado') resumen.actualizados++
        else if (res === 'sin_cambios') resumen.sinCambios++
        else if (res === 'nuevo_no_creado') resumen.nuevosNoCreados++
        else if (res === 'sku_existente') resumen.skuExistente++
      }
      if (payload.status === 'discontinued') resumen.desactivados++

      const precio = Number(item['sales-price'])
      if (o.listaPreciosId && Number.isFinite(precio) && precio > 0 && o.soloLectura) {
        const actual = enReact.get(payload.stel_id)
        if (!actual) resumen.precios.sinProducto++
        else if (actual.precio === null || actual.precio === undefined) { resumen.precios.creados++; if (resumen.cambiosPrevistos.precio.length < 40) resumen.cambiosPrevistos.precio.push({ sku: payload.sku, de: null, a: precio }) }
        else if (Number(actual.precio) !== precio) { resumen.precios.actualizados++; if (resumen.cambiosPrevistos.precio.length < 40) resumen.cambiosPrevistos.precio.push({ sku: payload.sku, de: Number(actual.precio), a: precio }) }
        else resumen.precios.sinCambios++
      }
      if (o.listaPreciosId && Number.isFinite(precio) && precio > 0 && !o.soloLectura) {
        const rp = await sb.rpc('stel_sync_precio', { p_run: run, p: { stel_id: payload.stel_id, price_list_id: o.listaPreciosId, amount: precio } })
        if (rp.error) resumen.errores.push({ stel_id: payload.stel_id, error: `precio: ${rp.error.message}` })
        else if (rp.data.resultado === 'creado') resumen.precios.creados++
        else if (rp.data.resultado === 'actualizado') resumen.precios.actualizados++
        else if (rp.data.resultado === 'sin_cambios') resumen.precios.sinCambios++
        else resumen.precios.sinProducto++
      }
      cursor = item['utc-last-modification-date'] ?? cursor
      cursorId = payload.stel_id
      if ((resumen.actualizados + resumen.creados) % 100 === 0 && resumen.actualizados + resumen.creados > 0) log(`  productos con cambios: ${resumen.actualizados + resumen.creados}`)
    }
    // En sólo lectura el checkpoint no avanza: no se escribió nada.
    await cerrar(sb, run, 'finished', o.soloLectura ? null : cursor, cursorId, c.llamadas(), resumen)
    return { run, resumen }
  } catch (e) {
    await cerrar(sb, run, 'failed', null, null, c.llamadas(), resumen, String(e.message).slice(0, 400))
    throw e
  }
}

/**
 * Delta de documentos: reutiliza la reconciliación de E2 sobre una ventana.
 * Idempotente, sin efectos de stock y sin consumir secuencias: todo pasa por las
 * mismas RPC, que sólo escriben documentos históricos importados.
 */
export async function sincronizarDocumentos(sb, c, o) {
  const log = o.log ?? (() => {})
  const { run, cursor_modified_at: checkpoint } = await tomar(sb, o.company, 'documents', o.owner)
  const desde = (o.desde ?? checkpoint ?? '').toString().slice(0, 10)
  const resumen = { desde, documentos: 0, cambios: 0, insertados: 0, actualizados: 0, bloqueados: 0, pendientesBorrado: 0, errores: [] }
  try {
    if (!desde) throw new Error('sin checkpoint: pasar --desde <YYYY-MM-DD>')
    const stel = await o.leerStel(c, { desde, conMaestro: false, loteReferencias: 80 })
    const react = await o.leerReact(sb, o.empresaSlug)
    const { plan } = planificarE2(stel, react, { categoriaRevisionId: o.categoriaRevisionId, listaBaseId: o.listaPreciosId, aprobados: { borrados: [] } })
    resumen.documentos = plan.documentos.length
    resumen.insertados = plan.documentos.filter((d) => d.operacion === 'insert').length
    resumen.actualizados = plan.documentos.filter((d) => d.operacion === 'update').length
    resumen.bloqueados = plan.bloqueados.length
    resumen.pendientesBorrado = plan.pendientesBorrado.length
    resumen.planHash = hashPlan(plan)
    if (o.soloLectura) {
      await cerrar(sb, run, 'finished', null, null, c.llamadas(), resumen)
      return { run, resumen, plan }
    }
    // El sync automático nunca crea productos ni resuelve clientes por heurística:
    // si el delta necesita eso, se detiene y lo reporta para una corrida manual.
    if (plan.productos.length || plan.clientes?.length) {
      throw new Error(`el delta necesita ${plan.productos.length} producto(s) y ${plan.clientes?.length ?? 0} cliente(s): corre la reconciliación manual`)
    }
    // La corrida ya está abierta por `stel_sync_tomar`: se reusa (sólo puede
    // haber una por empresa) y la cierra `cerrar` más abajo.
    const hechos = await ejecutarPlan(sb, plan, { run, autorizacion: { planHash: hashPlan(plan), confirmado: true }, log })
    resumen.cambios = hechos.cambios
    resumen.errores = hechos.fallidos
    await cerrar(sb, run, hechos.fallidos.length ? 'failed' : 'finished', hechos.fallidos.length ? null : new Date().toISOString(), null, c.llamadas(), resumen)
    return { run, resumen, hechos }
  } catch (e) {
    await cerrar(sb, run, 'failed', null, null, c.llamadas(), resumen, String(e.message).slice(0, 400))
    throw e
  }
}

export { CATEGORIA_REVISION }
