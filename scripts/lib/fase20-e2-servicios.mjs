/**
 * Fase 20 · E2 — Reglas puras para reconstruir el historial de servicio de STEL.
 *
 * Acá no se llama a nadie: sólo se decide. Las funciones toman los documentos
 * tal como los devuelve la API de STEL y contestan tres preguntas:
 *
 *   1 · ¿qué documentos son el MISMO servicio?      → `armarCadenas`
 *   2 · ¿en qué estado terminó ese servicio?        → `estadoDeServicio`
 *   3 · ¿cuál es su identidad estable?              → `claveDeServicio`
 *
 * Las tres se prueban con fixtures en `fase20-e2-servicios-tests.mjs`, porque
 * de esto depende que el historial de un equipo no salga triplicado.
 */

/** `app.stelorder.com/app/workEstimates/23822940` → `['workEstimates', 23822940]`. */
export function tipoYId(path) {
  const m = /app\/([a-zA-Z]+)\/(\d+)$/.exec(path ?? '')
  return m ? [m[1], Number(m[2])] : null
}

/** Prefijo corto y estable por colección, para que las claves no choquen. */
const SIGLA = { workEstimates: 'we', workOrders: 'wo', workDeliveryNotes: 'wd' }

/**
 * Agrupa los documentos de STEL en CADENAS: presupuesto → orden → remito.
 *
 * El encadenamiento es por `parent-document-path`, que es un ID real de STEL.
 * No hay nada aproximado acá: si un documento no declara padre, es una raíz,
 * y punto. Nunca se emparejan documentos por cliente, fecha ni importe.
 */
export function armarCadenas({ estimates = [], orders = [], deliveryNotes = [] }) {
  const ordenesDe = new Map()
  const remitosDeOrden = new Map()
  const remitosDeEstimate = new Map()

  for (const o of orders) {
    const p = tipoYId(o['parent-document-path'])
    if (p?.[0] === 'workEstimates') ordenesDe.set(p[1], [...(ordenesDe.get(p[1]) ?? []), o])
  }
  for (const d of deliveryNotes) {
    const p = tipoYId(d['parent-document-path'])
    if (!p) continue
    if (p[0] === 'workOrders') remitosDeOrden.set(p[1], [...(remitosDeOrden.get(p[1]) ?? []), d])
    if (p[0] === 'workEstimates') remitosDeEstimate.set(p[1], [...(remitosDeEstimate.get(p[1]) ?? []), d])
  }

  const cadenas = []
  for (const e of estimates) {
    const ords = ordenesDe.get(e.id) ?? []
    cadenas.push({
      estimate: e,
      ordenes: ords,
      remitos: [...(remitosDeEstimate.get(e.id) ?? []), ...ords.flatMap((o) => remitosDeOrden.get(o.id) ?? [])],
    })
  }
  // Una orden sin presupuesto es una cadena que arranca en la orden; un remito
  // sin padre, una que arranca en el remito. Ninguno se descarta: son servicios
  // que existieron.
  for (const o of orders) {
    if (!tipoYId(o['parent-document-path'])) {
      cadenas.push({ estimate: null, ordenes: [o], remitos: remitosDeOrden.get(o.id) ?? [] })
    }
  }
  for (const d of deliveryNotes) {
    if (!tipoYId(d['parent-document-path'])) cadenas.push({ estimate: null, ordenes: [], remitos: [d] })
  }
  return cadenas
}

/** Los documentos de la cadena, del más viejo al más nuevo del flujo. */
export const documentosDe = (ch) => [ch.estimate, ...ch.ordenes, ...ch.remitos].filter(Boolean)

/** Clase de la cadena, sólo para contar y reportar. */
export function claseDeCadena(ch) {
  const e = Boolean(ch.estimate)
  const o = ch.ordenes.length > 0
  const r = ch.remitos.length > 0
  if (e && o && r) return 'COMPLETA'
  if (e && o) return 'EST+ORT'
  if (e && r) return 'EST+REM'
  if (o && r) return 'ORT+REM'
  if (e) return 'SOLO_EST'
  if (o) return 'SOLO_ORT'
  return 'SOLO_REM'
}

/** El documento raíz: el que le da identidad a la cadena. */
export function raizDe(ch) {
  const d = ch.estimate ?? ch.ordenes[0] ?? ch.remitos[0]
  const tipo = ch.estimate ? 'workEstimates' : ch.ordenes[0] ? 'workOrders' : 'workDeliveryNotes'
  return { doc: d, tipo, sigla: SIGLA[tipo] }
}

/** Los ids de activo de STEL que toca la cadena, sin repetir. */
export function activosDe(ch) {
  const ids = new Set()
  for (const d of documentosDe(ch)) for (const a of d.assets ?? []) ids.add(a.id)
  return [...ids]
}

/**
 * Identidad del servicio: `we23822940#1064129`.
 *
 * Es la raíz de la cadena más el activo, y las dos partes son IDs internos de
 * STEL. El número visible (`ORT00001`, `COTI-T00001`) queda como etiqueta: si
 * STEL renumerara, el historial se duplicaría entero sin que nadie lo note.
 *
 * Va por activo y no por cadena porque una cadena puede cubrir 13 equipos, y
 * el historial que le importa a alguien es el de SU equipo.
 */
export function claveDeServicio(ch, activoStelId) {
  const { sigla, doc } = raizDe(ch)
  return `${sigla}${doc.id}#${activoStelId}`
}

const soloFecha = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null)
const minima = (fechas) => fechas.filter(Boolean).sort()[0] ?? null
const maxima = (fechas) => fechas.filter(Boolean).sort().at(-1) ?? null

/** Los estados de STEL que sabemos leer. Cualquier otro es un STOP, no un default. */
export const ESTADOS_STEL = {
  831756: { doc: 'workEstimates', nombre: 'Pendiente' },
  831765: { doc: 'workEstimates', nombre: 'Cerrada' },
  831761: { doc: 'workOrders', nombre: 'Pendiente' },
  831758: { doc: 'workOrders', nombre: 'Cerrada' },
  831773: { doc: 'workDeliveryNotes', nombre: 'Pendiente de facturar' },
  831730: { doc: 'workDeliveryNotes', nombre: 'Facturada' },
}

export const nombreEstado = (id) => ESTADOS_STEL[id]?.nombre ?? null

/**
 * En qué estado quedó el servicio, leído de los documentos y de nada más.
 *
 * La evidencia es el documento que existe, no un campo de estado inventado:
 *   · hay remito  → el equipo volvió al cliente: el servicio terminó;
 *   · hay orden y no hay remito → el trabajo se ordenó y todavía no volvió;
 *   · sólo hay presupuesto pendiente → nunca se aprobó.
 *
 * La aprobación de la cotización tampoco se inventa: que exista una orden de
 * trabajo O un remito ES la aprobación. Nada en STEL dice «rechazado», así que
 * `rejected` no se usa nunca.
 */
export function estadoDeServicio(ch) {
  const est = ch.estimate
  const ord = ch.ordenes[0] ?? null
  const rem = ch.remitos[0] ?? null

  const fechas = documentosDe(ch).map((d) => soloFecha(d.date))
  const received_at = minima(fechas)

  // Un estado que no conocemos no se aproxima: se reporta y se deja afuera.
  const desconocidos = documentosDe(ch)
    .map((d) => d['document-state-id'])
    .filter((id) => !(id in ESTADOS_STEL))
  if (desconocidos.length > 0) {
    return { importable: false, motivo: `estado STEL desconocido: ${desconocidos.join(', ')}`, received_at }
  }

  const huboTrabajo = Boolean(ord || rem)
  const base = {
    importable: true,
    received_at,
    on_hold: false,
    // STEL no guarda torque ni mediciones en estos documentos. Marcar la etapa
    // como requerida obligaría a inventar una medición para poder cerrarla.
    torque_required: false,
    repair_required: huboTrabajo,
    quote_currency_code: (rem ?? ord ?? est)?.['currency-code'] ?? null,
  }

  if (rem) {
    return {
      ...base,
      status: 'closed',
      stage: 'closing',
      quote_status: est ? 'approved' : 'pending',
      quote_approved_at: est ? soloFecha((ord ?? rem).date) : null,
      repaired_at: soloFecha((ord ?? rem).date),
      delivered_at: soloFecha(maxima(ch.remitos.map((r) => r.date))),
      facturado: nombreEstado(rem['document-state-id']) === 'Facturada',
      confianza: est && ord ? 'alta' : 'media',
      razon: est && ord ? 'cadena completa: presupuesto, orden y remito' : 'entregado, con la cadena incompleta en STEL',
    }
  }

  if (ord) {
    return {
      ...base,
      status: 'open',
      stage: 'repair',
      quote_status: est ? 'approved' : 'pending',
      quote_approved_at: est ? soloFecha(ord.date) : null,
      repaired_at: null,
      delivered_at: null,
      facturado: false,
      confianza: 'alta',
      razon: 'hay orden de trabajo y todavía no hay remito: el equipo no volvió',
    }
  }

  if (est && nombreEstado(est['document-state-id']) === 'Pendiente') {
    return {
      ...base,
      status: 'open',
      stage: 'quotation',
      quote_status: 'pending',
      quote_approved_at: null,
      repaired_at: null,
      delivered_at: null,
      facturado: false,
      confianza: 'alta',
      razon: 'presupuesto pendiente: nunca se aprobó ni se trabajó',
    }
  }

  // Presupuesto cerrado sin orden ni remito: «Cerrada» en STEL no dice si se
  // ganó o se perdió. Adivinarlo sería inventar historia.
  return {
    importable: false,
    motivo: 'presupuesto cerrado sin orden ni remito: STEL no dice si se aprobó o se perdió',
    received_at,
  }
}

/** Qué es cada línea de un documento de STEL. */
export function clasificarLinea(l) {
  if (l?.deleted) return 'borrada'
  if (l?.['line-type'] === 'SECTION') return 'seccion'
  const t = tipoYId(l?.['item-path'])?.[0] ?? null
  if (t === 'products') return 'producto'
  if (t === 'services') return 'servicio'
  return 'sin-item'
}

/**
 * El texto técnico del servicio, armado con lo que hay y señalando de dónde
 * salió cada parte.
 *
 * STEL no tiene campos de diagnóstico ni de trabajo realizado: lo que hay es
 * el título del documento y la descripción de cada línea de servicio. Se
 * copian tal cual, con su origen, en vez de partirlos con heurísticas.
 */
export function textoTecnico(ch) {
  const trozos = []
  for (const d of documentosDe(ch)) {
    const ref = d['full-reference'] ?? String(d.id)
    if (d.title) trozos.push({ origen: ref, campo: 'title', texto: d.title })
    for (const l of d.lines ?? []) {
      const clase = clasificarLinea(l)
      if (clase === 'borrada') continue
      const texto = [l['item-name'], l['item-description']].filter(Boolean).join('\n')
      if (texto) trozos.push({ origen: ref, campo: clase === 'seccion' ? 'seccion' : 'linea', texto })
    }
    if (d['private-comments']) trozos.push({ origen: ref, campo: 'private-comments', texto: d['private-comments'] })
  }
  return trozos
}

/**
 * Los importes de la cadena se pueden repartir por activo o no.
 *
 * Con un solo activo el reparto es exacto: el documento entero es de ese
 * equipo. Con varios NO se puede: medimos que las unidades de las líneas no
 * siguen a la cantidad de activos (11 equipos y una línea de 48 unidades), así
 * que cualquier división sería un número inventado en un historial.
 */
export function importesAtribuibles(ch) {
  const activos = activosDe(ch)
  if (activos.length !== 1) return { atribuible: false, activos: activos.length }
  const doc = ch.remitos[0] ?? ch.ordenes[0] ?? ch.estimate
  const lineas = (doc.lines ?? []).filter((l) => clasificarLinea(l) !== 'borrada')
  return {
    atribuible: true,
    activos: 1,
    moneda: doc['currency-code'] ?? null,
    subtotal: doc['subtotal-amount'] ?? 0,
    total: doc['total-amount'] ?? 0,
    lineas: lineas.filter((l) => l['line-type'] === 'ITEM').length,
  }
}
