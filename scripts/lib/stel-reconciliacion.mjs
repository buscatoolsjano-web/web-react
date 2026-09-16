/**
 * Fase 14 · Entrega 2 — plan y ejecución de la reconciliación STEL → React.
 *
 *   planificarE2(stel, react, opciones) → plan puro (no lee ni escribe)
 *   hashPlan(plan)                      → sha256 del contenido ejecutable
 *   ejecutarPlan(sb, plan, opciones)    → sólo por las RPC public.stel_*
 *   revertirRun(sb, runId)              → deshace un run desde su bitácora
 *   huellaEmpresa(sb, companyId)        → hashes por tabla (invariantes)
 *   respaldoAfectado(sb, plan)          → filas actuales que el plan tocaría
 *
 * Reglas (docs/PHASE_14_ENTREGA_2_RECONCILIACION_PRODUCTIVA.md):
 *   · STEL manda: moneda, totales oficiales, precios de LÍNEA, vínculos por
 *     parent-document-id; nada por nombre parecido;
 *   · identidad externa = id STEL; SKU sólo para vincular un producto una vez,
 *     con SKU único exacto y nombre compatible;
 *   · cada documento es una llamada atómica; si falla, sus dependientes no corren;
 *   · borrados de líneas: sólo con aprobación explícita (quedan pendientes);
 *   · nada toca secuencias, autoridad, stock ni bitácora de usuario.
 */
import { createHash } from 'node:crypto'
import { reconciliar, similitud } from '../fase14-stel-api-auditoria.mjs'

export const CATEGORIA_REVISION = { nombre: 'Pendiente de clasificación STEL', slug: 'pendiente-clasificacion-stel' }
const TIPOS = {
  quote: { tabla: 'sales_quotes', lineas: 'sales_quote_lines', fk: 'quote_id', fecha: 'quote_date', cantidad: 'quantity', estado: 'status' },
  order: { tabla: 'sales_orders', lineas: 'sales_order_lines', fk: 'order_id', fecha: 'order_date', cantidad: 'quantity_ordered', estado: 'commercial_status' },
  delivery: { tabla: 'deliveries', lineas: 'delivery_lines', fk: 'delivery_id', fecha: 'delivery_date', cantidad: 'quantity', estado: 'status' },
}
const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n }
const igual = (a, b, tol = 0.01) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= tol + 1e-9)
const dia = (s) => (s ?? '').toString().slice(0, 10) || null
const normTexto = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function tratamiento(docStel, linea) {
  if (docStel['primary-tax-enabled'] === false) return { tax_treatment: 'not_taxed', tax_rate_snapshot: 0 }
  const pct = num(linea?.['primary-tax-percentage']) ?? 0
  if (Math.abs(pct - 21) < 0.001) return { tax_treatment: 'vat_21', tax_rate_snapshot: 21 }
  if (Math.abs(pct - 10.5) < 0.001) return { tax_treatment: 'vat_105', tax_rate_snapshot: 10.5 }
  if (pct === 0) return { tax_treatment: 'vat_0', tax_rate_snapshot: 0 }
  return { tax_treatment: 'other', tax_rate_snapshot: pct }
}

/** Igual que app.stel_estado_react (la RPC vuelve a validarlo). */
export function estadoReact(tipo, nombre) {
  const n = normTexto(nombre)
  if (tipo === 'quote') return { pendiente: 'sent', 'en curso': 'sent', cerrada: 'accepted', cerrado: 'accepted', aceptada: 'accepted', rechazada: 'rejected' }[n] ?? null
  if (tipo === 'order') return !nombre ? null : n === 'rechazado' ? 'cancelled' : 'confirmed'
  if (tipo === 'delivery') return nombre ? 'delivered' : null
  return null
}

/**
 * @param stel  lo que devuelve leerStel
 * @param react lo que devuelve leerReactEmpresa
 * @param o     { categoriaRevisionId?, listaBaseId, aprobados }
 *
 * `aprobados` son las excepciones que una persona autorizó caso por caso, cada
 * una revalidada contra STEL antes de entrar (Fase 14 E4):
 *   borrados:          ids de líneas de React que sobran
 *   vinculosProducto:  ids STEL cuyo producto React se vincula pese al nombre distinto
 *   estadosRegresivos: números de cotización que pueden volver de accepted a sent
 *   clientes:          [{ customer_id, stel_account_id, tax_id }] identidad fuerte
 */
export function planificarE2(stel, react, o = {}) {
  const reco = reconciliar(stel, react)
  const aprobados = new Set(o.aprobados?.borrados ?? [])
  const vinculosAprobados = new Set((o.aprobados?.vinculosProducto ?? []).map(String))
  const regresivosAprobados = new Set(o.aprobados?.estadosRegresivos ?? [])
  // Documentos que STEL emitió en una serie que ya pasó al ERP y que se decidió
  // absorber. Sin esta lista la base los rechaza (serie_emitida_por_el_erp).
  const absorcionAprobada = new Set(o.aprobados?.seriesDelErp ?? [])
  const itemPorId = new Map(stel.productos.map((p) => [p.id, p]))
  const prodPorExterno = new Map(react.productos.filter((p) => p.external_source === 'stel').map((p) => [p.external_id, p]))
  const prodPorSku = new Map()
  for (const p of react.productos) prodPorSku.set(p.sku.trim(), [...(prodPorSku.get(p.sku.trim()) ?? []), p])
  const reactDoc = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, new Map(react.docs[t].map((d) => [d.id, d]))]))
  const stelDoc = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, new Map([...(stel.docs[t] ?? []), ...(stel.padresExternos?.[t] ?? [])].map((d) => [d.id, d]))]))
  const bloqueados = []
  const excepciones = []
  const info = { tipoDeCambioNoCopiado: 0, cambiosDeMonedaEnStel: [], soloEnReact: [], ordenDeLineasDistinto: [], totalesStelInconsistentes: [], categoriasStelSinMapeo: 0 }

  // ── Productos ────────────────────────────────────────────────────────────
  const productos = []
  const destinoProducto = new Map() // item-id STEL → uuid | {stel_id} | null (bloqueado)
  const usados = new Map()
  for (const t of Object.keys(TIPOS)) for (const f of reco.documentos[t]) for (const l of f.lineasStel ?? []) usados.set(l.itemId, { sku: l.sku, nombre: l.nombre, esServicio: l.esServicio })
  for (const [itemId, u] of [...usados].sort((a, b) => a[0] - b[0])) {
    const stelId = String(itemId)
    const item = itemPorId.get(itemId) ?? null
    const yaVinculado = prodPorExterno.get(stelId)
    if (yaVinculado) { destinoProducto.set(itemId, yaVinculado.id); continue }
    const porSku = prodPorSku.get(u.sku) ?? []
    if (porSku.length > 1) { bloqueados.push({ tipo: 'product', stel_id: stelId, sku: u.sku, motivo: 'AMBIGUOUS_SKU' }); destinoProducto.set(itemId, null); continue }
    if (porSku.length === 1) {
      const p = porSku[0]
      if (p.external_id && p.external_id !== stelId) { bloqueados.push({ tipo: 'product', stel_id: stelId, sku: u.sku, motivo: 'SKU_VINCULADO_A_OTRO_ID_STEL' }); destinoProducto.set(itemId, null); continue }
      const sim = similitud(p.name, item?.name ?? u.nombre)
      if (sim < 0.34 && !vinculosAprobados.has(stelId)) {
        bloqueados.push({ tipo: 'product', stel_id: stelId, sku: u.sku, motivo: 'NAME_MISMATCH', stel: item?.name ?? u.nombre, react: p.name })
        destinoProducto.set(itemId, null)
        continue
      }
      if (sim < 0.34) excepciones.push({ tipo: 'product', motivo: 'LINK_EXISTING_APROBADO', stel_id: stelId, sku: u.sku, stel: item?.name ?? u.nombre, react: p.name })
      productos.push({ op: 'vincular', stel_id: stelId, sku: u.sku, product_id: p.id })
      destinoProducto.set(itemId, p.id)
      continue
    }
    if (!item) { bloqueados.push({ tipo: 'product', stel_id: stelId, sku: u.sku, motivo: 'NO_LEIDO_EN_STEL' }); destinoProducto.set(itemId, null); continue }
    const precio = num(item['sales-price'])
    if (item['product-category-id'] != null) info.categoriasStelSinMapeo++
    productos.push({
      op: 'crear', stel_id: stelId, sku: u.sku, name: item.name ?? u.nombre, description: item.description ?? '',
      product_type: item.clase === 'services' ? 'Servicio' : '', status: item.inactive || item.deleted ? 'discontinued' : 'active',
      category_id: o.categoriaRevisionId ?? { categoriaRevision: true },
      ...(precio !== null && precio > 0 && o.listaBaseId ? { precio: { price_list_id: o.listaBaseId, amount: precio } } : {}),
      _stel: { clase: item.clase, tarifas: (item['item-rates'] ?? []).length, categoriaStel: item['product-category-id'] ?? null },
    })
    destinoProducto.set(itemId, { stel_id: stelId })
  }

  // ── Clientes: sólo CUIT, o nombre confirmado por documentos ya vinculados ─
  const clientesPorCuenta = new Map()
  for (const t of Object.keys(TIPOS)) for (const f of reco.documentos[t]) {
    if (f.clase === 'MATCHED' && ['POR_CUIT_OK', 'POR_NOMBRE_OK'].includes(f.cliente?.clase)) {
      const set = clientesPorCuenta.get(f.stel.accountId) ?? new Set()
      set.add(f.react.customerId)
      clientesPorCuenta.set(f.stel.accountId, set)
    }
  }
  const clienteSeguro = (f) => {
    const c = f.cliente
    if (!c?.reactCustomerIdPropuesto) return { id: null, motivo: `CLIENTE_${c?.clase ?? 'SIN_MATCH'}` }
    if (c.clase === 'POR_CUIT_OK') return { id: c.reactCustomerIdPropuesto }
    const confirmados = clientesPorCuenta.get(f.stel.accountId)
    if (confirmados?.size === 1 && confirmados.has(c.reactCustomerIdPropuesto)) return { id: c.reactCustomerIdPropuesto }
    return { id: null, motivo: 'CLIENTE_SOLO_POR_NOMBRE_SIN_CONFIRMAR' }
  }

  // ── Documentos ───────────────────────────────────────────────────────────
  const documentos = []
  const pendientesBorrado = []
  const porNumero = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, new Map(reco.documentos[t].map((f) => [f.numero, f]))]))
  const relDe = new Map(reco.relaciones.map((r) => [r.hijo, r]))
  const auditoria = (f) => ({
    subtotal_bruto: f.calculo.sumaNeto, descuento_pct: f.stel.descuentoPct, descuento_monto: f.stel.descuentoMonto,
    subtotal_stel: f.stel.subtotal, impuestos_stel: f.stel.impuestos, total_stel: f.stel.total, total_calculado: f.calculo.totalCalc,
    motivo_diferencia: f.totales.stelInterno.length ? `STEL: ${f.totales.stelInterno.join('+')}` : null,
  })

  for (const [tipo, conf] of Object.entries(TIPOS)) {
    for (const f of reco.documentos[tipo]) {
      if (f.clase === 'REACT_ONLY') {
        // Un documento sin marca de importación lo emitió el ERP después del
        // cutover: STEL no lo tiene ni tiene por qué tenerlo. No es un faltante
        // y nunca se toca. Los importados que ya no están en STEL sí son otra
        // cosa: STEL los borró y acá se conservan a propósito.
        info.soloEnReact.push(f.react?.importado
          ? { tipo, numero: f.numero, clasificacion: 'SOURCE_MISSING / PROBABLE_DELETED_IN_STEL', accion: 'se conserva' }
          : { tipo, numero: f.numero, clasificacion: 'ERP_ISSUED / POST_CUTOVER', accion: 'no corresponde a STEL' })
        continue
      }
      const s = stelDoc[tipo].get(f.stel.id)
      if (s['currency-code'] && s['currency-code'] !== 'USD') info.tipoDeCambioNoCopiado++
      if (f.totales.stelInterno.length) info.totalesStelInconsistentes.push({ tipo, numero: f.numero, clases: f.totales.stelInterno })
      if (f.ordenLineasDistinto) info.ordenDeLineasDistinto.push(f.numero)
      const rel = relDe.get(f.numero)
      if (rel?.cambiaMonedaEnStel) info.cambiosDeMonedaEnStel.push({ desde: `${rel.padre} ${rel.monedaPadreStel}`, hacia: `${f.numero} ${rel.monedaHijoStel}`, accion: 'se preserva' })

      // Padre según STEL (id explícito)
      let padre = null
      if (tipo !== 'quote' && s['parent-document-id']) {
        const tipoPadre = /salesEstimates/.test(s['parent-document-path'] ?? '') ? 'quote' : /salesOrders/.test(s['parent-document-path'] ?? '') ? 'order' : null
        const ps = tipoPadre ? stelDoc[tipoPadre].get(s['parent-document-id']) : null
        if (ps) {
          const campo = tipo === 'order' ? (tipoPadre === 'quote' ? 'quote_id' : null) : tipoPadre === 'order' ? 'order_id' : 'source_quote_id'
          const fp = porNumero[tipoPadre].get(ps['full-reference'])
          if (campo && fp) padre = { campo, tipo: tipoPadre, numero: ps['full-reference'], stel_id: String(ps.id), react_id: fp.react?.id ?? null, se_inserta: fp.clase === 'STEL_ONLY' }
        }
      }

      const lineaProducto = (ls) => (destinoProducto.has(ls.itemId) ? destinoProducto.get(ls.itemId) : null)

      if (f.clase === 'STEL_ONLY') {
        const cli = clienteSeguro(f)
        if (!cli.id) { bloqueados.push({ tipo, numero: f.numero, motivo: cli.motivo }); continue }
        const estado = estadoReact(tipo, f.stel.estado)
        if (tipo !== 'delivery' && !estado) { bloqueados.push({ tipo, numero: f.numero, motivo: 'ESTADO_STEL_SIN_MAPEO', stel: f.stel.estado }); continue }
        const hijos = tipo === 'order' ? (stel.docs.delivery ?? []).filter((d) => d['parent-document-id'] === s.id && /salesOrders/.test(d['parent-document-path'] ?? '')).length : 0
        const lineas = f.lineasStel.map((ls, i) => {
          const lineaStel = s.lines.find((l) => l.id === ls.stelLineaId)
          const destino = lineaProducto(ls)
          return {
            ...(tipo !== 'delivery' ? { line_no: i + 1, line_type: ls.esServicio ? 'service' : 'item' } : {}),
            product_id: destino, sku_snapshot: ls.sku || null, name_snapshot: ls.nombre ?? null, [conf.cantidad]: ls.cantidad,
            unit_price: ls.precio ?? 0, discount_pct: ls.descuento ?? 0, ...tratamiento(s, lineaStel),
          }
        })
        const sinProducto = lineas.filter((l) => l.product_id === null).length
        const cabecera = {
          customer_id: cli.id, [conf.fecha]: dia(s.date), currency_code: s['currency-code'] ?? null, title: s.title ?? null,
          subtotal: num(s['subtotal-amount']), tax_amount: num(s['tax-total-amount']), total: num(s['total-amount']),
          series_code: f.numero.replace(/[0-9]+$/, ''), needs_review: sinProducto > 0,
          review_reason: sinProducto > 0 ? `STEL_RECONCILIATION: ${sinProducto} línea(s) sin producto vinculado` : null,
          ...(tipo !== 'delivery' ? { discount_pct: num(s['discount-percentage']) ?? 0, perception_pct: num(s['income-tax-percentage']) ?? 0 } : {}),
          ...(tipo === 'quote' ? { status: estado } : {}),
          ...(tipo === 'order' ? { commercial_status: estado, fulfillment_status: hijos === 0 ? 'pending' : normTexto(f.stel.estado) === 'cerrado' ? 'delivered' : 'partially_delivered' } : {}),
        }
        if (padre) cabecera[padre.campo] = padre.react_id ?? { depende: padre.numero }
        documentos.push({
          tipo, numero: f.numero, stel_id: String(s.id), estado_stel: f.stel.estado, operacion: 'insert', cabecera,
          lineas: { insertar: lineas, actualizar: [], borrar: [] }, auditoria: auditoria(f),
          depende: padre ? [`${padre.tipo}:${padre.numero}`] : [],
          ...(absorcionAprobada.has(f.numero) ? { aprobar_serie_del_erp: true } : {}),
        })
        if (absorcionAprobada.has(f.numero)) excepciones.push({ tipo, numero: f.numero, motivo: 'ABSORCION_POST_CUTOVER_APROBADA' })
        continue
      }

      // MATCHED
      const r = reactDoc[tipo].get(f.react.id)
      const cab = {}
      const poner = (campo, viejo, nuevo) => { cab[campo] = { old: viejo, new: nuevo } }
      if (r.external_source !== 'stel' || r.external_id !== String(s.id)) {
        if (r.external_id && r.external_id !== String(s.id)) { bloqueados.push({ tipo, numero: f.numero, motivo: 'ID_EXTERNO_DISTINTO' }); continue }
        poner('external_source', r.external_source ?? null, 'stel')
        poner('external_id', r.external_id ?? null, String(s.id))
      }
      if (!r.currency_code && s['currency-code']) poner('currency_code', null, s['currency-code'])
      else if (r.currency_code && s['currency-code'] && r.currency_code !== s['currency-code']) bloqueados.push({ tipo, numero: f.numero, motivo: 'MONEDA_DISTINTA_REVISAR', react: r.currency_code, stel: s['currency-code'] })
      for (const [campo, clave] of [['subtotal', 'subtotal-amount'], ['tax_amount', 'tax-total-amount'], ['total', 'total-amount']]) {
        if (!igual(num(r[campo]), num(s[clave]))) poner(campo, num(r[campo]), num(s[clave]))
      }
      if (tipo !== 'delivery' && !igual(num(r.discount_pct) ?? 0, num(s['discount-percentage']) ?? 0, 0.0001)) poner('discount_pct', num(r.discount_pct), num(s['discount-percentage']) ?? 0)
      if (tipo === 'quote') {
        const e = estadoReact('quote', f.stel.estado)
        if (e && e !== r.status) {
          const regresivo = ['accepted', 'rejected'].includes(r.status) && e === 'sent'
          if (regresivo && !regresivosAprobados.has(f.numero)) bloqueados.push({ tipo, numero: f.numero, motivo: 'ESTADO_REGRESIVO', react: r.status, stel: f.stel.estado })
          else {
            poner('status', r.status, e)
            if (regresivo) excepciones.push({ tipo, numero: f.numero, motivo: 'ESTADO_REGRESIVO_APROBADO', react: r.status, stel: f.stel.estado })
          }
        }
      }
      if (padre) {
        const actual = r[padre.campo] ?? null
        if (!padre.react_id && padre.se_inserta && !actual) poner(padre.campo, null, { depende: padre.numero })
        else if (padre.react_id && actual !== padre.react_id) {
          if (actual) bloqueados.push({ tipo, numero: f.numero, motivo: 'VINCULO_DISTINTO_REVISAR', campo: padre.campo })
          else if (padre.campo === 'source_quote_id' && r.order_id) bloqueados.push({ tipo, numero: f.numero, motivo: 'REMITO_CON_PEDIDO_Y_COTIZACION' })
          else poner(padre.campo, null, padre.react_id)
        }
      }

      const lineas = { insertar: [], actualizar: [], borrar: [] }
      for (const [i, ls] of f.lineasStel.entries()) {
        const x = ls.reactLinea
        const destino = lineaProducto(ls)
        if (!x) {
          const lineaStel = s.lines.find((l) => l.id === ls.stelLineaId)
          lineas.insertar.push({
            ...(tipo !== 'delivery' ? { line_type: ls.esServicio ? 'service' : 'item' } : {}),
            product_id: destino, sku_snapshot: ls.sku, name_snapshot: ls.nombre, [conf.cantidad]: ls.cantidad,
            unit_price: ls.precio ?? 0, discount_pct: ls.descuento ?? 0, ...tratamiento(s, lineaStel),
          })
          continue
        }
        const campos = {}
        // Un producto que se crea en este run no tiene uuid todavía: se referencia por id STEL.
        if (destino !== null && (typeof destino === 'object' || x.product_id !== destino)) campos.product_id = { old: x.product_id ?? null, new: destino }
        if ((x.sku_snapshot ?? '').trim() !== ls.sku) { campos.sku_snapshot = { old: x.sku_snapshot ?? null, new: ls.sku }; campos.name_snapshot = { old: x.name_snapshot ?? null, new: ls.nombre } }
        const cant = num(x[conf.cantidad])
        if (!igual(cant, ls.cantidad, 0.0001)) campos[conf.cantidad] = { old: cant, new: ls.cantidad }
        if (!igual(num(x.unit_price), ls.precio)) campos.unit_price = { old: num(x.unit_price), new: ls.precio }
        if (!igual(num(x.discount_pct), ls.descuento ?? 0, 0.0001)) campos.discount_pct = { old: num(x.discount_pct), new: ls.descuento ?? 0 }
        if (Object.keys(campos).length) lineas.actualizar.push({ id: x.id, posicion: i + 1, sku: ls.sku, campos })
      }
      for (const d of f.lineas?.diferencias ?? []) {
        if (d.motivo !== 'LINEA_SOLO_EN_REACT') continue
        if (aprobados.has(d.reactLinea)) lineas.borrar.push({ id: d.reactLinea, aprobado: true })
        else pendientesBorrado.push({ tipo, numero: f.numero, react_linea_id: d.reactLinea, sku: d.sku, stel_modificado: f.stel.modificacion, stel_lineas: f.lineas.stel, react_lineas: f.lineas.react })
      }
      const hay = Object.keys(cab).length + lineas.insertar.length + lineas.actualizar.length + lineas.borrar.length
      if (!hay) continue
      documentos.push({
        tipo, numero: f.numero, stel_id: String(s.id), estado_stel: f.stel.estado, operacion: 'update', react_id: r.id, cabecera: cab, lineas,
        auditoria: auditoria(f), depende: padre && cab[padre.campo] ? [`${padre.tipo}:${padre.numero}`] : [],
        // La base vuelve a exigir que no haya derivados aunque esto venga en true.
        ...(cab.status && regresivosAprobados.has(f.numero) ? { aprobar_estado_regresivo: true } : {}),
      })
    }
  }

  // Dependencias a productos que se crean: si el producto falla, el documento no corre.
  for (const d of documentos) {
    const refs = [...d.lineas.insertar.map((l) => l.product_id), ...d.lineas.actualizar.map((l) => l.campos.product_id?.new)]
    for (const ref of refs) if (ref && typeof ref === 'object' && ref.stel_id) d.depende.push(`product:${ref.stel_id}`)
    d.depende = [...new Set(d.depende)]
  }

  const plan = {
    version: 2,
    empresa: react.BT,
    stelLeidoEn: stel.leidoEn ?? null,
    categoriaRevision: productos.some((p) => p.op === 'crear') ? { ...CATEGORIA_REVISION, id: o.categoriaRevisionId ?? null } : null,
    productos,
    // Identidad fuerte de cliente: ya viene decidida y revalidada desde afuera.
    clientes: (o.aprobados?.clientes ?? []).map((c) => ({ customer_id: c.customer_id, stel_account_id: String(c.stel_account_id ?? ''), tax_id: c.tax_id })),
    documentos,
    pendientesBorrado,
    bloqueados,
    excepciones,
    info,
  }
  plan.resumen = resumirPlan(plan)
  return { plan, reco }
}

export function resumirPlan(plan) {
  const docs = plan.documentos
  const campos = (fn) => docs.filter((d) => d.operacion === 'update').reduce((n, d) => n + Object.keys(d.cabecera).filter(fn).length, 0)
  return {
    PRODUCTS_TO_CREATE: plan.productos.filter((p) => p.op === 'crear').length,
    PRODUCTS_TO_CREATE_SERVICES: plan.productos.filter((p) => p.op === 'crear' && p._stel?.clase === 'services').length,
    PRODUCTS_TO_LINK: plan.productos.filter((p) => p.op === 'vincular').length,
    PRODUCTS_BLOCKED: plan.bloqueados.filter((b) => b.tipo === 'product').length,
    CATEGORY_TO_CREATE: plan.categoriaRevision && !plan.categoriaRevision.id ? 1 : 0,
    DOCUMENTS_TO_INSERT: docs.filter((d) => d.operacion === 'insert').length,
    DOCUMENTS_TO_INSERT_BY_TYPE: Object.fromEntries(Object.keys(TIPOS).map((t) => [t, docs.filter((d) => d.operacion === 'insert' && d.tipo === t).length])),
    DOCUMENTS_TO_UPDATE: docs.filter((d) => d.operacion === 'update').length,
    HEADER_FIELD_CHANGES: campos(() => true),
    EXTERNAL_ID_LINKS: docs.filter((d) => d.cabecera.external_id).length,
    LINES_TO_INSERT: docs.reduce((n, d) => n + d.lineas.insertar.length, 0),
    LINES_TO_INSERT_IN_NEW_DOCS: docs.filter((d) => d.operacion === 'insert').reduce((n, d) => n + d.lineas.insertar.length, 0),
    LINES_TO_UPDATE: docs.reduce((n, d) => n + d.lineas.actualizar.length, 0),
    LINE_FIELD_CHANGES: docs.reduce((n, d) => n + d.lineas.actualizar.reduce((m, l) => m + Object.keys(l.campos).length, 0), 0),
    LINE_PRODUCT_LINKS: docs.reduce((n, d) => n + d.lineas.actualizar.filter((l) => l.campos.product_id).length, 0),
    LINES_TO_DELETE_PENDING_APPROVAL: plan.pendientesBorrado.length,
    LINES_TO_DELETE_APPROVED: docs.reduce((n, d) => n + d.lineas.borrar.length, 0),
    CUSTOMERS_TO_IDENTIFY: (plan.clientes ?? []).length,
    APPROVED_EXCEPTIONS: (plan.excepciones ?? []).length,
    APPROVED_EXCEPTIONS_BY_REASON: (plan.excepciones ?? []).reduce((m, e) => ({ ...m, [e.motivo]: (m[e.motivo] ?? 0) + 1 }), {}),
    CURRENCY_FIXES: campos((c) => c === 'currency_code'),
    TOTAL_FIELD_FIXES: campos((c) => ['subtotal', 'tax_amount', 'total', 'discount_pct'].includes(c)),
    STATUS_FIXES: campos((c) => c === 'status'),
    RELATION_FIXES: campos((c) => ['quote_id', 'order_id', 'source_quote_id', 'customer_id'].includes(c)),
    QUOTE_DIRECT_DELIVERIES: campos((c) => c === 'source_quote_id') + docs.filter((d) => d.operacion === 'insert' && d.cabecera.source_quote_id).length,
    BLOCKED: plan.bloqueados.length,
    BLOCKED_BY_REASON: plan.bloqueados.reduce((m, b) => ({ ...m, [b.motivo]: (m[b.motivo] ?? 0) + 1 }), {}),
  }
}

/** Hash del contenido ejecutable (sin resumen ni info, que son derivados). */
export function hashPlan(plan) {
  const ejecutable = { empresa: plan.empresa, categoriaRevision: plan.categoriaRevision && { nombre: plan.categoriaRevision.nombre, slug: plan.categoriaRevision.slug }, productos: plan.productos, clientes: plan.clientes ?? [], documentos: plan.documentos }
  return createHash('sha256').update(canonico(ejecutable)).digest('hex')
}

export function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

// ── Ejecución ───────────────────────────────────────────────────────────────
/**
 * @param o { slugEmpresa, autorizacion: { planHash, confirmado }, log }
 * Una empresa real exige autorizacion.confirmado === true y el mismo hash del plan revisado.
 */
export async function ejecutarPlan(sb, plan, o = {}) {
  const log = o.log ?? (() => {})
  const hash = hashPlan(plan)
  const { data: emp, error: eE } = await sb.from('companies').select('id, slug').eq('id', plan.empresa).single()
  if (eE || !emp) throw new Error('empresa del plan no encontrada')
  if (!emp.slug.startsWith('zz-')) {
    if (o.autorizacion?.confirmado !== true || o.autorizacion?.planHash !== hash) {
      throw new Error(`ejecución productiva sin autorización para este plan (hash ${hash.slice(0, 12)}…)`)
    }
  }
  if (!plan.stelLeidoEn) throw new Error('el plan no dice cuándo se leyó STEL')

  // `o.run`: la corrida ya está abierta y la cierra quien la abrió (el sync de
  // documentos). Sólo puede haber una por empresa a la vez.
  const propia = !o.run
  let run = o.run ?? null
  if (propia) {
    const r = await sb.rpc('stel_reconciliacion_iniciar', { p_company: plan.empresa, p_plan_hash: hash, p_stel_read_at: plan.stelLeidoEn })
    if (r.error) throw new Error(`iniciar: ${r.error.message}`)
    run = r.data
  }
  o.alIniciar?.(run, hash)
  const fallidos = new Map()
  const hechos = { run, productos: 0, clientes: 0, documentos: 0, cambios: 0, fallidos: [], salteados: [] }
  const idInsertado = new Map()

  try {
    let categoria = plan.categoriaRevision?.id ?? null
    if (plan.categoriaRevision && !categoria) {
      const c = await sb.rpc('stel_asegurar_categoria_revision', { p_run: run, p_nombre: plan.categoriaRevision.nombre, p_slug: plan.categoriaRevision.slug })
      if (c.error) throw new Error(`categoría de revisión: ${c.error.message}`)
      categoria = c.data
    }
    for (const p of plan.productos) {
      const { _stel, ...payload } = p
      if (payload.op === 'crear' && typeof payload.category_id === 'object') payload.category_id = categoria
      const x = await sb.rpc('stel_reconciliar_producto', { p_run: run, p: payload })
      if (x.error) { fallidos.set(`product:${p.stel_id}`, x.error.message); hechos.fallidos.push({ item: `product:${p.stel_id}`, sku: p.sku, error: x.error.message }); continue }
      hechos.productos++
      hechos.cambios += x.data.cambios
      if (hechos.productos % 100 === 0) log(`  productos procesados: ${hechos.productos}`)
    }
    // Clientes antes que los documentos: un documento puede apuntar al cliente,
    // pero la identidad fuerte no depende de ningún documento.
    for (const c of plan.clientes ?? []) {
      const x = await sb.rpc('stel_reconciliar_cliente', { p_run: run, p: c })
      if (x.error) { fallidos.set(`customer:${c.customer_id}`, x.error.message); hechos.fallidos.push({ item: `customer:${c.customer_id}`, error: x.error.message }); continue }
      hechos.clientes++
      hechos.cambios += x.data.cambios
    }
    for (const tipo of ['quote', 'order', 'delivery']) {
      for (const d of plan.documentos.filter((x) => x.tipo === tipo)) {
        const bloqueo = d.depende.find((k) => fallidos.has(k))
        if (bloqueo) { fallidos.set(`${tipo}:${d.numero}`, `depende de ${bloqueo}`); hechos.salteados.push({ item: `${tipo}:${d.numero}`, depende: bloqueo }); continue }
        const payload = { tipo: d.tipo, stel_id: d.stel_id, numero: d.numero, estado_stel: d.estado_stel, operacion: d.operacion, cabecera: structuredClone(d.cabecera), lineas: d.lineas, auditoria: d.auditoria }
        if (d.react_id) payload.react_id = d.react_id
        if (d.aprobar_estado_regresivo) payload.aprobar_estado_regresivo = true
        if (d.aprobar_serie_del_erp) payload.aprobar_serie_del_erp = true
        // Padre insertado en este mismo run: ahora sí tiene uuid.
        for (const [campo, v] of Object.entries(payload.cabecera)) {
          const nuevo = d.operacion === 'insert' ? v : v?.new
          if (nuevo && typeof nuevo === 'object' && nuevo.depende) {
            const clave = `${campo === 'order_id' ? 'order' : 'quote'}:${nuevo.depende}`
            const id = idInsertado.get(clave)
            if (!id) { payload.saltear = `padre ${clave} no insertado`; break }
            if (d.operacion === 'insert') payload.cabecera[campo] = id
            else payload.cabecera[campo].new = id
          }
        }
        if (payload.saltear) { fallidos.set(`${tipo}:${d.numero}`, payload.saltear); hechos.salteados.push({ item: `${tipo}:${d.numero}`, depende: payload.saltear }); continue }
        const x = await sb.rpc('stel_reconciliar_documento', { p_run: run, p: payload })
        if (x.error) { fallidos.set(`${tipo}:${d.numero}`, x.error.message); hechos.fallidos.push({ item: `${tipo}:${d.numero}`, error: x.error.message }); log(`  ✗ ${d.numero}: ${x.error.message}`); continue }
        if (d.operacion === 'insert') idInsertado.set(`${tipo}:${d.numero}`, x.data.document_id)
        hechos.documentos++
        if (hechos.documentos % 100 === 0) log(`  documentos procesados: ${hechos.documentos}`)
        hechos.cambios += x.data.cambios
      }
    }
    if (propia) await sb.rpc('stel_reconciliacion_cerrar', { p_run: run, p_estado: hechos.fallidos.length ? 'failed' : 'finished', p_resumen: { cambios: hechos.cambios, documentos: hechos.documentos, productos: hechos.productos, clientes: hechos.clientes, fallidos: hechos.fallidos.length, salteados: hechos.salteados.length } })
  } catch (e) {
    if (propia) await sb.rpc('stel_reconciliacion_cerrar', { p_run: run, p_estado: 'failed', p_resumen: { error: String(e.message).slice(0, 200) } })
    throw e
  }
  return hechos
}

export async function revertirRun(sb, run) {
  let total = 0
  for (let i = 0; i < 1000; i++) {
    const r = await sb.rpc('stel_revertir_reconciliacion', { p_run: run, p_limite: 200 })
    if (r.error) throw new Error(`revertir: ${r.error.message}`)
    total += r.data.revertidas
    if (r.data.quedan === 0) return total
  }
  throw new Error('revertir: demasiadas vueltas')
}

// ── Invariantes y respaldo ──────────────────────────────────────────────────
const TABLAS_HUELLA = [
  ['sales_quotes', 'id'], ['sales_quote_lines', 'id'], ['sales_orders', 'id'], ['sales_order_lines', 'id'],
  ['deliveries', 'id'], ['delivery_lines', 'id'], ['products', 'id'], ['product_prices', 'id'], ['product_categories', 'id'],
  ['customers', 'id'], ['document_sequences', 'doc_type'], ['document_numbering_authority', 'doc_type'],
  ['stock_balances', 'product_id'], ['stock_movements', 'id'], ['stock_reservations', 'id'], ['sales_audit', 'id'],
]
/** Columnas que no son dato de negocio (el trigger touch las mueve con cualquier UPDATE). */
const TECNICAS = new Set(['search_vector', 'updated_at', 'updated_by'])

async function todasLasFilas(sb, tabla, orden, companyId) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    let q = sb.from(tabla).select('*').eq('company_id', companyId).order(orden).range(desde, desde + 999)
    if (tabla === 'stock_balances') q = q.order('warehouse_id')
    const { data, error } = await q
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) return filas
  }
}

/**
 * Hash por tabla. `soloNegocio`: ignora updated_at/updated_by (para comparar
 * un rollback) y las columnas nuevas de E2 cuando son NULL.
 */
export async function huellaEmpresa(sb, companyId, { soloNegocio = false } = {}) {
  const out = {}
  for (const [tabla, orden] of TABLAS_HUELLA) {
    const filas = await todasLasFilas(sb, tabla, orden, companyId)
    const h = createHash('sha256')
    for (const f of filas) {
      const limpia = Object.fromEntries(Object.entries(f).filter(([k, v]) => !(k === 'search_vector' || (soloNegocio && TECNICAS.has(k)) || (['external_source', 'external_id', 'source_quote_id'].includes(k) && v === null))))
      h.update(canonico(limpia))
    }
    out[tabla] = { filas: filas.length, hash: h.digest('hex').slice(0, 24) }
  }
  return out
}

/** Filas actuales de todo lo que el plan tocaría (material de rollback independiente de la bitácora). */
export async function respaldoAfectado(sb, plan) {
  const ids = { sales_quotes: new Set(), sales_orders: new Set(), deliveries: new Set(), sales_quote_lines: new Set(), sales_order_lines: new Set(), delivery_lines: new Set(), products: new Set(), customers: new Set() }
  for (const c of plan.clientes ?? []) ids.customers.add(c.customer_id)
  for (const d of plan.documentos) {
    const conf = TIPOS[d.tipo]
    if (d.react_id) ids[conf.tabla].add(d.react_id)
    for (const l of d.lineas.actualizar) ids[conf.lineas].add(l.id)
    for (const l of d.lineas.borrar) ids[conf.lineas].add(l.id)
  }
  for (const p of plan.pendientesBorrado) ids[TIPOS[p.tipo].lineas].add(p.react_linea_id)
  for (const p of plan.productos) if (p.product_id) ids.products.add(p.product_id)
  const out = {}
  for (const [tabla, set] of Object.entries(ids)) {
    const lista = [...set]
    out[tabla] = []
    for (let i = 0; i < lista.length; i += 150) {
      const { data, error } = await sb.from(tabla).select('*').in('id', lista.slice(i, i + 150))
      if (error) throw new Error(`respaldo ${tabla}: ${error.message}`)
      out[tabla].push(...data.map(({ search_vector: _sv, ...resto }) => resto))
    }
  }
  return out
}

export { TIPOS }
