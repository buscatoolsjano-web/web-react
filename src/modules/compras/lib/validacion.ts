/**
 * Validación y normalización del formulario de proveedor.
 *
 * Todo función pura: no toca la red ni el DOM. Lo que **impide** guardar mal
 * no es esto —es la base: `uq_suppliers_cuit_norm`, el CHECK del país, los
 * NOT NULL y RLS—. Esto es para que la persona se entere antes de apretar
 * Guardar.
 */

/** El CUIT, reducido a sus dígitos. Es la forma en la que se compara. */
export function normalizarCuit(cuit: string | null | undefined): string {
  return (cuit ?? '').replace(/\D/g, '')
}

/** Un CUIT informado tiene once dígitos. Ni diez ni doce. */
export function pareceCuit(cuit: string | null | undefined): boolean {
  return normalizarCuit(cuit).length === 11
}

export function esEmail(texto: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim())
}

/** El país va en mayúsculas: es lo que exige `suppliers_country_code_check`. */
export function normalizarPais(pais: string | null | undefined): string {
  return (pais ?? '').trim().toUpperCase()
}

export interface DatosProveedor {
  razonSocial: string
  nombreComercial: string
  cuit: string
  email: string
  telefono: string
  /** Dirección en una sola línea. NO se parte en calle / ciudad / CP. */
  direccion: string
  pais: string
  actividad: string
  agente: string
  formaPago: string
  monedaPorDefecto: string
  notas: string
}

export const PROVEEDOR_VACIO: DatosProveedor = {
  razonSocial: '',
  nombreComercial: '',
  cuit: '',
  email: '',
  telefono: '',
  direccion: '',
  pais: '',
  actividad: '',
  agente: '',
  formaPago: '',
  monedaPorDefecto: '',
  notas: '',
}

export interface ErrorDeCampo {
  campo: keyof DatosProveedor
  mensaje: string
}

/**
 * Qué está mal antes de guardar.
 *
 * `cuitOriginal` es el que tenía el proveedor cuando se abrió el formulario.
 * Si el CUIT **no cambió**, no se valida el formato. Hoy los 142 migrados no
 * tienen ninguno, así que la regla no se usa; está por la misma razón que en
 * Clientes: el día que aparezca un dato legacy raro, corregir un teléfono no
 * tiene que obligar a inventar un CUIT.
 */
export function validarProveedor(
  datos: DatosProveedor,
  cuitOriginal: string | null = null,
): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = []

  if (datos.razonSocial.trim() === '') {
    errores.push({ campo: 'razonSocial', mensaje: 'La razón social es obligatoria.' })
  }

  const cuit = datos.cuit.trim()
  const cambio = normalizarCuit(cuit) !== normalizarCuit(cuitOriginal)
  if (cuit !== '' && cambio && !pareceCuit(cuit)) {
    errores.push({
      campo: 'cuit',
      mensaje: `Un CUIT tiene 11 dígitos y éste tiene ${normalizarCuit(cuit).length}.`,
    })
  }

  if (datos.email.trim() !== '' && !esEmail(datos.email)) {
    errores.push({ campo: 'email', mensaje: `«${datos.email.trim()}» no parece un email.` })
  }

  const pais = normalizarPais(datos.pais)
  if (pais !== '' && !/^[A-Z]{2}$/.test(pais)) {
    errores.push({ campo: 'pais', mensaje: 'El país va con su código de dos letras: AR, ES, IT…' })
  }

  return errores
}

// ── Pedido de compra ───────────────────────────────────────────────────────

export interface DatosPedidoCompra {
  proveedorId: string
  moneda: string
  tipoCambio: string
  fecha: string
  /** ETA. Vacío = no se conoce; se guarda como NULL, no como una fecha inventada. */
  fechaEstimada: string
  formaPago: string
  notas: string
}

export function pedidoVacio(hoy: string): DatosPedidoCompra {
  return {
    proveedorId: '',
    moneda: '',
    tipoCambio: '',
    fecha: hoy,
    fechaEstimada: '',
    formaPago: '',
    notas: '',
  }
}

export type CampoPedido = keyof DatosPedidoCompra

export interface ErrorDePedido {
  campo: CampoPedido
  mensaje: string
}

/** Las tres monedas que existen en `currencies`. */
export const MONEDAS = ['USD', 'ARS', 'EUR'] as const

/**
 * Qué está mal antes de guardar el pedido.
 *
 * El proveedor y la moneda son obligatorios en la base (`NOT NULL` los dos, y
 * la moneda además es FK a `currencies`). Validarlos acá es para que la
 * persona lo vea antes de apretar Guardar, no para reemplazar al servidor.
 *
 * La ETA puede quedar vacía: **no se conoce** es un dato válido y distinto de
 * inventar una fecha.
 */
export function validarPedido(d: DatosPedidoCompra): ErrorDePedido[] {
  const errores: ErrorDePedido[] = []

  if (d.proveedorId.trim() === '') {
    errores.push({ campo: 'proveedorId', mensaje: 'Elegí un proveedor.' })
  }
  if (d.moneda.trim() === '') {
    errores.push({ campo: 'moneda', mensaje: 'La moneda es obligatoria.' })
  } else if (!(MONEDAS as readonly string[]).includes(d.moneda)) {
    errores.push({ campo: 'moneda', mensaje: `«${d.moneda}» no es una moneda conocida.` })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) {
    errores.push({ campo: 'fecha', mensaje: 'La fecha del pedido es obligatoria.' })
  }
  if (d.fechaEstimada !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaEstimada)) {
    errores.push({ campo: 'fechaEstimada', mensaje: 'La fecha estimada no es una fecha.' })
  }
  if (d.fechaEstimada !== '' && d.fecha !== '' && d.fechaEstimada < d.fecha) {
    errores.push({
      campo: 'fechaEstimada',
      mensaje: 'La fecha estimada de llegada es anterior a la del pedido.',
    })
  }
  if (d.tipoCambio.trim() !== '') {
    const n = Number(d.tipoCambio.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      errores.push({ campo: 'tipoCambio', mensaje: 'El tipo de cambio tiene que ser mayor que cero.' })
    }
  }

  return errores
}
