/**
 * Cómo se lee el registro de borrados (Fase 40).
 *
 * La base guarda nombres de entidad en inglés porque son los de las tablas;
 * acá se traducen una sola vez. Si aparece uno que no está en el mapa se
 * muestra tal cual en vez de esconderlo: un borrado sin nombre lindo sigue
 * siendo un borrado que hay que poder ver.
 */

export const ENTIDADES_BORRABLES: { valor: string; etiqueta: string }[] = [
  { valor: 'sales_quote', etiqueta: 'Cotización' },
  { valor: 'sales_order', etiqueta: 'Pedido' },
  { valor: 'delivery', etiqueta: 'Remito' },
  { valor: 'purchase_order', etiqueta: 'Orden de compra' },
  { valor: 'goods_receipt', etiqueta: 'Recepción' },
  { valor: 'supplier_invoice', etiqueta: 'Factura de compra' },
  { valor: 'maintenance_order', etiqueta: 'Orden de trabajo' },
  { valor: 'maintenance_asset', etiqueta: 'Equipo' },
  { valor: 'customer', etiqueta: 'Cliente' },
  { valor: 'supplier', etiqueta: 'Proveedor' },
  { valor: 'product', etiqueta: 'Producto' },
  { valor: 'attachment', etiqueta: 'Adjunto' },
  { valor: 'customer_contact', etiqueta: 'Contacto' },
  { valor: 'customer_address', etiqueta: 'Dirección' },
]

const POR_VALOR = new Map(ENTIDADES_BORRABLES.map((e) => [e.valor, e.etiqueta]))

export function etiquetaDeEntidad(valor: string): string {
  return POR_VALOR.get(valor) ?? valor
}

/**
 * «Borrado» y «Baja» no son lo mismo y la diferencia importa.
 *
 * El borrado se llevó la fila; la baja la dejó ahí con su fecha de baja. Quien
 * mira el registro para recuperar algo necesita saber cuál de las dos fue:
 * una se reactiva con un clic y la otra hay que rehacerla a mano.
 */
export function etiquetaDeAccion(accion: string): string {
  return accion === 'deactivate' ? 'Baja' : 'Borrado'
}

/** `2026-10-05T18:22:36Z` → `05/10/2026 15:22`, en la hora de quien mira. */
export function formatearMomento(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Los campos de la copia que vale la pena mostrar primero.
 *
 * La fila entera puede tener cuarenta columnas, la mitad internas (`updated_by`,
 * `search_vector`, snapshots). Mostrarlas todas es no mostrar ninguna. Estas
 * son las que contestan «¿qué era esto?» sin abrir el JSON.
 */
const DESTACADOS = [
  'number',
  'sku',
  'legal_name',
  'trade_name',
  'full_name',
  'file_name',
  'name',
  'street',
  'status',
  'commercial_status',
  'total',
  'currency_code',
  'quote_date',
  'order_date',
  'delivery_date',
  'email',
  'phone',
]

/**
 * Un valor de la copia, como texto.
 *
 * `String(objeto)` da «[object Object]», que es peor que no mostrar nada: el
 * que mira cree que ése era el valor guardado.
 */
function aTexto(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v) ?? ''
}

export interface CampoDeCopia {
  clave: string
  valor: string
}

export function resumenDeCopia(copia: Record<string, unknown>): CampoDeCopia[] {
  const salida: CampoDeCopia[] = []
  for (const clave of DESTACADOS) {
    const v = copia[clave]
    if (v === null || v === undefined || v === '') continue
    salida.push({ clave, valor: aTexto(v) })
  }
  return salida
}
