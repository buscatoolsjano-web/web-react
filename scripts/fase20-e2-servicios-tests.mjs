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
  activosDe,
  armarCadenas,
  claseDeCadena,
  claveDeServicio,
  clasificarLinea,
  estadoDeServicio,
  importesAtribuibles,
  textoTecnico,
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
  igual([e.status, e.stage, e.quote_status], ['closed', 'closing', 'approved'])
  igual(e.received_at, '2024-03-01')
  igual(e.delivered_at, '2024-03-20')
  igual(e.confianza, 'alta')
})

prueba('con orden y sin remito, el equipo todavía no volvió', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual([e.status, e.stage, e.quote_status], ['open', 'repair', 'approved'])
  igual(e.delivered_at, null)
})

prueba('un presupuesto pendiente nunca se aprobó', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual([e.status, e.stage, e.quote_status], ['open', 'quotation', 'pending'])
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
    const e = estadoDeServicio(ch)
    if (e.quote_status === 'rejected') throw new Error('se inventó un rechazo')
  }
})

prueba('un estado de STEL que no conocemos frena el servicio, no lo aproxima', () => {
  const ch = armarCadenas({ estimates: [est(100, { 'document-state-id': 999999 })], orders: [], deliveryNotes: [] })[0]
  const e = estadoDeServicio(ch)
  igual(e.importable, false)
  if (!/desconocido/.test(e.motivo)) throw new Error(`motivo poco claro: ${e.motivo}`)
})

prueba('el torque nunca se marca como requerido: STEL no trae ninguna medición', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [ort(200, 100)], deliveryNotes: [rem(300, 200)] })[0]
  igual(estadoDeServicio(ch).torque_required, false)
})

prueba('no hay nada equivalente a «En espera»: on_hold queda en falso', () => {
  const ch = armarCadenas({ estimates: [est(100)], orders: [], deliveryNotes: [] })[0]
  igual(estadoDeServicio(ch).on_hold, false)
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

console.log(`\n${pasaron} pasaron · ${fallaron} fallaron\n`)
process.exit(fallaron === 0 ? 0 : 1)
