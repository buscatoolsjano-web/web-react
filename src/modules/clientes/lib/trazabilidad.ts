import type { EventoDeCliente } from '../types'

/**
 * Un evento de auditoría, dicho en castellano (Fase 17 · E4).
 *
 * Función pura: entra la fila de `sales_audit` tal como vino, sale un título y
 * una lista de detalles listos para leer. La regla que ordena todo el archivo:
 *
 *   **nunca se muestra un UUID.**
 *
 * Un id no le dice nada a nadie. Cuando el evento es sobre un contacto o una
 * dirección, el diff trae su nombre —E4 lo agregó también a las ediciones—, y
 * cuando cambió un campo que apunta a otra fila (vendedor, tarifa) se dice
 * *que* cambió sin cantar el id: el valor está en la ficha, a un clic.
 */

const ACCIONES: Record<string, string> = {
  created: 'Se creó el cliente',
  updated: 'Se editaron los datos del cliente',
  deactivated: 'Se dio de baja el cliente',
  reactivated: 'Se reactivó el cliente',
  contact_added: 'Se agregó un contacto',
  contact_updated: 'Se editó un contacto',
  contact_removed: 'Se borró un contacto',
  address_added: 'Se agregó una dirección',
  address_updated: 'Se editó una dirección',
  address_removed: 'Se borró una dirección',
  attachment_added: 'Se adjuntó un archivo',
  attachment_deleted: 'Se borró un adjunto',
  review_resolved: 'Se dio por revisado',
}

/** Los campos de la ficha, con el nombre que tienen en pantalla. */
const CAMPOS: Record<string, string> = {
  legal_name: 'la razón social',
  trade_name: 'el nombre comercial',
  tax_id: 'el CUIT',
  emails: 'los emails',
  email_domains: 'los dominios',
  industry: 'el rubro',
  phone: 'el teléfono',
  customer_type: 'el tipo de cliente',
  payment_terms: 'la forma de pago',
  default_currency: 'la moneda',
  salesperson_id: 'el vendedor',
  default_price_list_id: 'la tarifa',
  notes: 'las notas',
  status: 'el estado',
  full_name: 'el nombre',
  role: 'el cargo',
  email: 'el email',
  fax: 'el fax',
  is_default: 'la marca de principal',
  active: 'si está activo',
  kind: 'el tipo de dirección',
  street: 'la calle',
  city: 'la ciudad',
  state: 'la provincia',
  postal_code: 'el código postal',
  country_code: 'el país',
}

/**
 * Campos cuyo valor es un id: se dice que cambiaron, no a qué.
 *
 * «El vendedor pasó de 6f2a…-91c a 0b74…-3d2» no es información: es ruido con
 * forma de dato.
 */
const REFERENCIAS = new Set(['salesperson_id', 'default_price_list_id'])

const TIPOS_DE_DIRECCION: Record<string, string> = {
  shipping: 'entrega',
  billing: 'facturación',
  both: 'entrega y facturación',
  other: 'otra',
}

const CLASES_DE_ADJUNTO: Record<string, string> = {
  other: 'General',
  customer_po: 'Orden de compra',
  invoice: 'Fiscal',
  receipt: 'Comprobante',
  photo: 'Foto',
  quote_pdf: 'Cotización',
  remito: 'Remito',
}

export interface EventoLegible {
  id: string
  titulo: string
  /** Qué cambió, una frase por cosa. Puede venir vacío. */
  detalles: string[]
  cuando: string
  quien: string
}

function esCambio(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === 'object' && v !== null && ('from' in v || 'to' in v)
}

/**
 * Un valor suelto, listo para leer. `null` y `''` son «nada».
 *
 * Un objeto no se imprime: `String({})` es `[object Object]`, que en una
 * pantalla es peor que no decir nada. Se dice que cambió y se termina.
 */
function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'nada'
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (Array.isArray(v)) {
    return v.length === 0 ? 'nada' : v.map((x) => valor(x)).join(', ')
  }
  if (typeof v === 'object') return 'otro valor'
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v)
}

/** Qué contacto o dirección: el nombre, nunca el id. */
function sujeto(diff: Record<string, unknown>): string | null {
  const contacto = diff['contacto']
  if (typeof contacto === 'string' && contacto !== '') return contacto
  const direccion = diff['direccion']
  if (typeof direccion === 'string' && direccion !== '') {
    const tipo = diff['tipo']
    const etiqueta = typeof tipo === 'string' ? TIPOS_DE_DIRECCION[tipo] : undefined
    return etiqueta ? `${direccion} (${etiqueta})` : direccion
  }
  const archivo = diff['archivo']
  if (typeof archivo === 'string' && archivo !== '') return archivo
  return null
}

export function presentarEvento(e: EventoDeCliente): EventoLegible {
  const diff: Record<string, unknown> = e.diff ?? {}
  const quien = e.quien ?? 'Proceso del sistema'
  const detalles: string[] = []

  const nombre = sujeto(diff)
  let titulo = ACCIONES[e.accion] ?? 'Cambio registrado'
  if (nombre !== null) titulo = `${titulo}: ${nombre}`

  if (e.accion === 'attachment_added' || e.accion === 'attachment_deleted') {
    const clase = typeof diff['clase'] === 'string' ? CLASES_DE_ADJUNTO[diff['clase']] : undefined
    if (clase) detalles.push(clase)
  }

  // El alta de un contacto o una dirección dice si nació como principal; no
  // hay un «cambió de nada a X» que valga la pena leer.
  if (e.accion === 'contact_added' || e.accion === 'address_added') {
    if (diff['principal'] === true) detalles.push('Quedó marcado como principal')
  }

  for (const [campo, cambio] of Object.entries(diff)) {
    if (!esCambio(cambio)) continue
    const etiqueta = CAMPOS[campo] ?? campo
    if (REFERENCIAS.has(campo)) {
      const antes = cambio.from
      const despues = cambio.to
      if (!antes && despues) detalles.push(`Se asignó ${etiqueta}`)
      else if (antes && !despues) detalles.push(`Se quitó ${etiqueta}`)
      else detalles.push(`Cambió ${etiqueta}`)
      continue
    }
    if (campo === 'is_default') {
      detalles.push(cambio.to === true ? 'Pasó a ser el principal' : 'Dejó de ser el principal')
      continue
    }
    if (campo === 'active') {
      detalles.push(cambio.to === true ? 'Se reactivó' : 'Se desactivó')
      continue
    }
    if (campo === 'kind') {
      const de = TIPOS_DE_DIRECCION[String(cambio.from)] ?? valor(cambio.from)
      const a = TIPOS_DE_DIRECCION[String(cambio.to)] ?? valor(cambio.to)
      detalles.push(`Cambió ${etiqueta}: de ${de} a ${a}`)
      continue
    }
    detalles.push(`Cambió ${etiqueta}: de ${valor(cambio.from)} a ${valor(cambio.to)}`)
  }

  if (e.desde !== null || e.hasta !== null) {
    detalles.push(`Estado: de ${valor(e.desde)} a ${valor(e.hasta)}`)
  }

  return { id: e.id, titulo, detalles, cuando: e.cuando, quien }
}
