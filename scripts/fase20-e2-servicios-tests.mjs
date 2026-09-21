/**
 * Fase 20 · E2 — Las reglas del historial de servicio, con fixtures.
 *
 * No toca STEL, no toca la base y no necesita credenciales. Lo que se prueba
 * es lo que puede arruinar un historial sin que se vea en ningún total: un
 * servicio contado tres veces, un equipo con la historia de otro, o un estado
 * adivinado.
 *
 *   node scripts/fase20-e2-servicios-tests.mjs
 */
import {
  aFilaDeCadena,
  aFilaDeDocumento,
  aFilaDeLinea,
  aFilaDeServicio,
  activosDe,
  armarCadenas,
  claseDeCadena,
  claveDeServicio,
  clasificarLinea,
  documentosDe,
  estadoDeServicio,
  importesAtribuibles,
  textoTecnico,
  tipoDeDocumento,
  tipoYId,
} from './lib/fase20-e2-servicios.mjs'

let pasaron = 0
let fallaron = 0
const prueba = (nombre, fn) => {
  try {
    fn()
    pasaron++
    console.log(`  ✓ ${nombre}`)
  } catch (e) {
    fallaron++
    console.log(`  ✗ ${nombre}\n      ${e.message}`)
  }
}
const igual = (a, b, msg = '') => {
  const x = JSON.stringify(a)
  const y = JSON.stringify(b)
  if (x !== y) throw new Error(`${msg} esperado ${y}, obtenido ${x}`)
}

const P = (p) => `app.stelorder.com/app/${p}`
const est = (id, extra = {}) => ({
  id,
  'full-reference': `COTI-T${String(id).padStart(5, '0')}`,
  date: '2024-03-01T00:00:00+0000',
  'document-state-id': 831756,
  'currency-code': 'ARS',
  assets: [],
  lines: [],
  ...extra,
})
const ort = (id, padre, extra = {}) => ({
  id,
  'full-reference': `ORT${String(id).padStart(5, '0')}`,
  date: '2024-03-10T00:00:00+0000',
  'document-state-id': 831758,
  'currency-code': 'ARS',
  'parent-document-path': padre ? P(`workEstimates/${padre}`) : null,
  assets: [],
  lines: [],
  ...extra,
})
const rem = (id, padre, tipo = 'workOrders', extra = {}) => ({
  id,
  'full-reference': `NTT${String(id).padStart(5, '0')}`,
  date: '2024-03-20T00:00:00+0000',
  'document-state-id': 831730,
  'currency-code': 'ARS',
  'parent-document-path': padre ? P(`${tipo}/${padre}`) : null,
  assets: [],
  lines: [],
  ...extra,
})

console.log('\nCADENAS — qué documentos son el MISMO servicio\n')

prueba('presupuesto + orden + remito son UNA cadena, no tres servicios', () => {
  const cadenas = armarCadenas({
    estimates: [est(100)],
    orders: [ort(200, 100)],
    deliveryNotes: [rem(300, 200)],
  })
  igual(cadenas.length, 1)
  igual(claseDeCadena(cadenas[0]), 'COMPLETA')
})

prueba('un remito que cuelga del presupuesto (sin orden) entra en la misma cadena', () => {
  const cadenas = armarCadenas({
    estimates: [est(100)],
    orders: [],
    deliveryNotes: [rem(300, 100, 'workEstimates')],
  })
  igual(cadenas.length, 1)
  igual(claseDeCadena(cadenas[0]), 'EST+REM')
})

prueba('una orden sin padre es su propia cadena: no se descarta', () => {
  const cadenas = armarCadenas({ estimates: [], orders: [ort(200, null)], deliveryNotes: [] })
  igual(cadenas.length, 1)
  igual(claseDeCadena(cadenas[0]), 'SOLO_ORT')
})

prueba('un remito huérfano también: es un servicio que existió', () => {
  const cadenas = armarCadenas({ estimates: [], orders: [], deliveryNotes: [rem(300, null)] })
  igual(claseDeCadena(cadenas[0]), 'SOLO_REM')
})

prueba('todos los documentos quedan en exactamente una cadena', () => {
  const cadenas = armarCadenas({
    estimates: [est(100), est(101)],
    orders: [ort(200, 100), ort(201, null)],
    deliveryNotes: [rem(300, 200), rem(301, null)],
  })
  const total = cadenas.reduce((n, ch) => n + (ch.estimate ? 1 : 0) + ch.ordenes.length + ch.remitos.length, 0)
  igual(total, 6, 'documentos cubiertos:')
  igual(cadenas.length, 4)
})

prueba('el encadenamiento es por ID real: dos documentos del mismo cliente y fecha NO se unen', () => {
  const mismoDia = { date: '2024-03-01T00:00:00+0000', 'account-id': 7565318 }
  const cadenas = armarCadenas({
    estimates: [est(100, mismoDia)],
    orders: [ort(200, null, mismoDia)],
    deliveryNotes: [],
  })
  igual(cadenas.length, 2, 'sin parent-document-path no se adivina el padre:')
})

console.log('\nIDENTIDAD — que la segunda corrida no duplique nada\n')

prueba('la clave es la raíz de la cadena más el activo', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [] })[0]
  igual(claveDeServicio(ch, 1064129), 'we100#1064129')
})

prueba('si STEL renumera el documento visible, la clave no cambia', () => {
  const a = armarCadenas({ estimates: [est(100)], orders: [], deliveryNotes: [] })[0]
  const b = armarCadenas({ estimates: [est(100, { 'full-reference': 'COTI-T99999' })], orders: [], deliveryNotes: [] })[0]
  igual(claveDeServicio(a, 7), claveDeServicio(b, 7))
})

prueba('dos activos del mismo documento son dos servicios distintos', () => {
  const ch = armarCadenas({
    estimates: [est(100, { assets: [{ id: 11 }, { id: 22 }] })],
    orders: [],
    deliveryNotes: [],
  })[0]
  igual(activosDe(ch), [11, 22])
  if (claveDeServicio(ch, 11) === claveDeServicio(ch, 22)) throw new Error('las claves se pisan')
})

prueba('el mismo equipo en dos cadenas son dos entradas de su historial', () => {
  const [a, b] = armarCadenas({
    estimates: [est(100, { assets: [{ id: 11 }] }), est(101, { assets: [{ id: 11 }] })],
    orders: [],
    deliveryNotes: [],
  })
  if (claveDeServicio(a, 11) === claveDeServicio(b, 11)) throw new Error('el historial se colapsa a uno')
})

console.log('\nESTADO — leído de los documentos, no adivinado\n')

prueba('con remito, el servicio terminó y el equipo volvió', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [rem(300, 200)] })[0]
  const e = estadoDeServicio(ch)
  igual([e.status, e.quotation_status], ['closed', 'approved'])
  igual(e.received_at, '2024-03-01')
  igual(e.delivered_at, '2024-03-20')
  igual(e.invoiced, true)
  igual(e.confianza, 'alta')
})

prueba('con orden y sin remito, el equipo todavía no volvió', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual([e.status, e.quotation_status], ['in_progress', 'approved'])
  igual(e.delivered_at, null)
})

prueba('un presupuesto pendiente nunca se aprobó', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual([e.status, e.quotation_status], ['open_quote', 'pending'])
})

prueba('el estado histórico NO habla el vocabulario de maintenance_orders', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [rem(300, 200)] })[0]
  const e = estadoDeServicio(ch)
  for (const campo of ['stage', 'quote_status', 'torque_required', 'repair_required', 'on_hold']) {
    if (campo in e) throw new Error(`sobra el campo ${campo}: ese es el modelo del trabajo vivo`)
  }
})

prueba('se conserva el estado crudo de STEL para poder auditar la traducción', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [rem(300, 200)] })[0]
  igual(estadoDeServicio(ch).stel_status_raw, 'Presupuesto Pendiente + Orden Cerrada + Remito Facturada')
})

prueba('un presupuesto CERRADO sin orden ni remito no se importa: STEL no dice si se ganó', () => {
  const ch = armarCadenas({ estimates: [est(100, { 'document-state-id': 831765 })], orders: [], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual(e.importable, false)
})

prueba('«rechazada» no existe: no hay dato en STEL que lo diga', () => {
  const casos = [
    armarCadenas({ estimates: [est(100)], orders: [], deliveryNotes: [] })[0],
    armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [] })[0],
    armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [rem(300, 200)] })[0],
  ]
  for (const ch of casos) {
    if (estadoDeServicio(ch).quotation_status === 'rejected') throw new Error('se inventó un rechazo')
  }
})

prueba('un estado de STEL que no conocemos frena el servicio, no lo aproxima', () => {
  const ch = armarCadenas({ estimates: [est(100, { 'document-state-id': 999999 })], orders: [], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual(e.importable, false)
  if (!/desconocido/.test(e.motivo)) throw new Error(`motivo poco claro: ${e.motivo}`)
})

prueba('los tres estados posibles son los que la base acepta, y nada más', () => {
  const casos = [
    armarCadenas({ estimates: [est(100)], orders: [], deliveryNotes: [] })[0],
    armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [] })[0],
    armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [rem(300, 200)] })[0],
  ]
  const vistos = casos.map((ch) => estadoDeServicio(ch).status)
  igual(vistos, ['open_quote', 'in_progress', 'closed'])
})

console.log('\nLÍNEAS E IMPORTES\n')

prueba('una línea de producto, una de servicio y una sección se distinguen por su path', () => {
  igual(clasificarLinea({ 'line-type': 'ITEM', 'item-path': P('products/123') }), 'producto')
  igual(clasificarLinea({ 'line-type': 'ITEM', 'item-path': P('services/123') }), 'servicio')
  igual(clasificarLinea({ 'line-type': 'SECTION', 'item-path': null }), 'seccion')
  igual(clasificarLinea({ 'line-type': 'ITEM', 'item-path': null }), 'sin-item')
  igual(clasificarLinea({ 'line-type': 'ITEM', 'item-path': P('products/1'), deleted: true }), 'borrada')
})

prueba('con un solo activo, el importe del documento es de ese equipo', () => {
  const ch = armarCadenas({
    estimates: [est(100, { assets: [{ id: 11 }], 'subtotal-amount': 1000, 'total-amount': 1210 })],
    orders: [],
    deliveryNotes: [],
  })[0]
  igual(importesAtribuibles(ch), { atribuible: true, activos: 1, moneda: 'ARS', subtotal: 1000, total: 1210, lineas: 0 })
})

prueba('con varios activos el importe NO se reparte: se midió que las unidades no los siguen', () => {
  const ch = armarCadenas({
    estimates: [est(100, { assets: [{ id: 11 }, { id: 22 }], 'total-amount': 1210 })],
    orders: [],
    deliveryNotes: [],
  })[0]
  igual(importesAtribuibles(ch), { atribuible: false, activos: 2 })
})

prueba('el texto técnico viene con el documento del que salió', () => {
  const ch = armarCadenas({
    estimates: [],
    orders: [
      ort(200, null, {
        title: 'SERVICIO DE MANTENIMIENTO',
        lines: [{ 'line-type': 'ITEM', 'item-path': P('services/9'), 'item-name': 'MANO DE OBRA', 'item-description': 'CAMBIO DE RODAMIENTOS' }],
      }),
    ],
    deliveryNotes: [],
  })[0]
  const t = textoTecnico(ch)
  igual(t.length, 2)
  igual(t[0], { origen: 'ORT00200', campo: 'title', texto: 'SERVICIO DE MANTENIMIENTO' })
  igual(t[1].texto, 'MANO DE OBRA\nCAMBIO DE RODAMIENTOS')
})

prueba('una línea borrada no aporta texto', () => {
  const ch = armarCadenas({
    estimates: [],
    orders: [ort(200, null, { title: null, lines: [{ 'line-type': 'ITEM', 'item-name': 'X', deleted: true }] })],
    deliveryNotes: [],
  })[0]
  igual(textoTecnico(ch), [])
})

prueba('tipoYId lee el path de STEL y no se cuelga con basura', () => {
  igual(tipoYId(P('workEstimates/23822940')), ['workEstimates', 23822940])
  igual(tipoYId(null), null)
  igual(tipoYId('cualquier cosa'), null)
})

console.log('\nFILAS — el modelo de cuatro tablas (opción C)\n')

const conEquipos = (n) => {
  const assets = Array.from({ length: n }, (_, i) => ({ id: 1000 + i }))
  return armarCadenas({
    estimates: [est(100, { assets, 'document-state-id': 831765, 'subtotal-amount': 100000, 'total-amount': 121000 })],
    orders: [ort(200, 100, { assets, 'assignee-id': 25664 })],
    deliveryNotes: [rem(300, 200, 'workOrders', { assets, 'total-amount': 121000 })],
  })[0]
}
const CTX = { companyId: 'emp-1', nombrePorEmpleado: new Map([[25664, 'NICOLAS']]) }

prueba('una cadena de 7 equipos da 1 cadena, 3 documentos y 7 servicios', () => {
  const ch = conEquipos(7)
  igual(activosDe(ch).length, 7)
  igual(documentosDe(ch).length, 3, 'documentos:')
  const servicios = activosDe(ch).map((a) => aFilaDeServicio(ch, a, { ...CTX, assetId: `act-${a}` }))
  igual(servicios.length, 7)
  igual(new Set(servicios.map((s) => s.external_id)).size, 7, 'claves distintas:')
})

prueba('los documentos NO se duplican por equipo: la clave es del documento', () => {
  const ch = conEquipos(13)
  const docs = documentosDe(ch).map((d) => aFilaDeDocumento(ch, d, CTX))
  igual(docs.length, 3)
  igual(
    docs.map((d) => d.external_id),
    ['we100', 'wo200', 'wd300'],
  )
  igual(
    docs.map((d) => d.doc_kind),
    ['estimate', 'work_order', 'delivery_note'],
  )
})

prueba('el encadenamiento queda escrito en la fila del documento', () => {
  const ch = conEquipos(2)
  const docs = documentosDe(ch).map((d) => aFilaDeDocumento(ch, d, CTX))
  igual(
    docs.map((d) => d.parent_external_id),
    [null, 'we100', 'wo200'],
  )
})

prueba('con UN equipo el importe es del equipo', () => {
  const s = aFilaDeServicio(conEquipos(1), 1000, { ...CTX, assetId: 'act-1' })
  igual([s.amount, s.amount_attribution], [121000, 'asset'])
})

prueba('con VARIOS equipos el servicio no lleva importe, y lo dice', () => {
  const ch = conEquipos(7)
  for (const a of activosDe(ch)) {
    const s = aFilaDeServicio(ch, a, { ...CTX, assetId: `act-${a}` })
    igual([s.amount, s.amount_attribution], [null, 'shared'], `equipo ${a}:`)
  }
})

prueba('el importe compartido igual se guarda, pero en la cadena: es del documento', () => {
  const c = aFilaDeCadena(conEquipos(7), CTX)
  igual([c.amount, c.amount_attribution, c.asset_count], [121000, 'shared', 7])
})

prueba('la cadena y el servicio tienen identidades distintas y estables', () => {
  const ch = conEquipos(3)
  igual(aFilaDeCadena(ch, CTX).external_id, 'we100')
  igual(aFilaDeServicio(ch, 1002, { ...CTX, assetId: 'act-3' }).external_id, 'we100#1002')
})

prueba('segunda corrida: las mismas entradas dan las mismas claves', () => {
  const a = conEquipos(4)
  const b = conEquipos(4)
  igual(aFilaDeCadena(a, CTX).external_id, aFilaDeCadena(b, CTX).external_id)
  igual(
    activosDe(a).map((x) => aFilaDeServicio(a, x, { ...CTX, assetId: 'x' }).external_id),
    activosDe(b).map((x) => aFilaDeServicio(b, x, { ...CTX, assetId: 'x' }).external_id),
  )
})

prueba('la clase de la cadena se guarda con el código que acepta la base', () => {
  igual(aFilaDeCadena(conEquipos(1), CTX).chain_class, 'complete')
  const soloEst = armarCadenas({ estimates: [est(100, { assets: [{ id: 1 }] })], orders: [], deliveryNotes: [] })[0]
  igual(aFilaDeCadena(soloEst, CTX).chain_class, 'estimate_only')
  const soloRem = armarCadenas({ estimates: [], orders: [], deliveryNotes: [rem(300, null)] })[0]
  igual(aFilaDeCadena(soloRem, CTX).chain_class, 'delivery_only')
})

prueba('falta la orden de trabajo: se importa igual y NO se inventa una', () => {
  const ch = armarCadenas({
    estimates: [est(100, { assets: [{ id: 1 }], 'document-state-id': 831765 })],
    orders: [],
    deliveryNotes: [rem(300, 100, 'workEstimates', { assets: [{ id: 1 }] })],
  })[0]
  const c = aFilaDeCadena(ch, CTX)
  igual([c.chain_class, c.status, c.quotation_status], ['estimate_delivery', 'closed', 'approved'])
  igual(documentosDe(ch).some((d) => tipoDeDocumento(ch, d) === 'work_order'), false, 'no hay ORT:')
})

prueba('falta el presupuesto: la cotización no se declara aprobada', () => {
  const ch = armarCadenas({ estimates: [], orders: [], deliveryNotes: [rem(300, null, 'workOrders', { assets: [{ id: 1 }] })] })[0]
  const c = aFilaDeCadena(ch, CTX)
  igual([c.chain_class, c.status, c.quotation_status], ['delivery_only', 'closed', 'pending'])
})

prueba('falta el remito: no hay fecha de entrega inventada', () => {
  const ch = armarCadenas({ estimates: [est(100, { 'document-state-id': 831765 })], orders: [ort(200, 100)], deliveryNotes: [] })[0]
  const c = aFilaDeCadena(ch, CTX)
  igual([c.chain_class, c.status, c.delivered_at, c.invoiced], ['estimate_order', 'in_progress', null, false])
})

prueba('el diagnóstico queda NULO: STEL no tiene diagnóstico', () => {
  igual(aFilaDeServicio(conEquipos(1), 1000, { ...CTX, assetId: 'act-1' }).diagnosis_notes, null)
})

prueba('el trabajo realizado sale de las líneas, con el documento del que vino', () => {
  const ch = armarCadenas({
    estimates: [],
    orders: [
      ort(200, null, {
        assets: [{ id: 1 }],
        title: 'SERVICIO DE MANTENIMIENTO',
        lines: [
          {
            id: 9,
            'line-type': 'ITEM',
            'item-path': P('services/9'),
            'item-name': 'MANO DE OBRA',
            'item-description': 'CAMBIO DE RODAMIENTOS',
          },
        ],
      }),
    ],
    deliveryNotes: [],
  })[0]
  const s = aFilaDeServicio(ch, 1, { ...CTX, assetId: 'act-1' })
  igual(s.title, 'SERVICIO DE MANTENIMIENTO')
  igual(s.repair_notes, '[ORT00200] MANO DE OBRA\nCAMBIO DE RODAMIENTOS')
})

prueba('el técnico se guarda como texto crudo, sin inventar un perfil', () => {
  igual(aFilaDeServicio(conEquipos(1), 1000, { ...CTX, assetId: 'act-1' }).technician_name_raw, 'NICOLAS')
  const sinNombre = aFilaDeServicio(conEquipos(1), 1000, { companyId: 'emp-1', assetId: 'act-1', nombrePorEmpleado: new Map() })
  igual(sinNombre.technician_name_raw, 'empleado 25664', 'un id sin nombre no se borra:')
})

prueba('una línea de producto guarda el SKU y el producto emparejado', () => {
  const l = {
    id: 55,
    'line-type': 'ITEM',
    'item-path': P('products/7'),
    'item-reference': 'FI.REP.596500007',
    'item-name': 'FILTER',
    units: 2,
    'item-base-price': 100,
    'total-amount': 200,
  }
  igual(aFilaDeLinea(l, 1, { companyId: 'emp-1', matchedProductId: 'prod-1', monedaDelDocumento: 'ARS' }), {
    company_id: 'emp-1',
    external_id: '55',
    line_no: 1,
    line_type: 'product',
    sku: 'FI.REP.596500007',
    description: 'FILTER',
    quantity: 2,
    unit_price: 100,
    amount: 200,
    currency_code: 'ARS',
    matched_product_id: 'prod-1',
  })
})

prueba('una línea sin match entra igual, con el producto en nulo', () => {
  const l = { id: 56, 'line-type': 'ITEM', 'item-path': P('products/7'), 'item-reference': 'PRO09777', 'item-name': 'ASW18-60-PC Reparada' }
  igual(aFilaDeLinea(l, 2, { companyId: 'emp-1' }).matched_product_id, null)
})

prueba('una sección con texto se conserva: ahí está el detalle del servicio', () => {
  const l = { id: 57, 'line-type': 'SECTION', 'item-name': 'Detalle del servicio', 'item-description': '- ASM18-8 N/S 014223 …' }
  const fila = aFilaDeLinea(l, 3, { companyId: 'emp-1' })
  igual(fila.line_type, 'section')
  igual(fila.sku, null, 'una sección no tiene SKU:')
  if (!fila.description) throw new Error('se perdió el texto de la sección')
})

prueba('ninguna fila de línea habla de stock ni de depósito', () => {
  const fila = aFilaDeLinea({ id: 1, 'line-type': 'ITEM', 'item-path': P('products/7') }, 1, { companyId: 'e' })
  for (const campo of ['warehouse_id', 'stock_movement_id', 'consumed_at']) {
    if (campo in fila) throw new Error(`sobra ${campo}: esto es historia, no consumo`)
  }
})

console.log(`\n${pasaron} pasaron · ${fallaron} fallaron\n`)
process.exit(fallaron === 0 ? 0 : 1)
