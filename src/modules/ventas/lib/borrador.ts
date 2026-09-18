import type { DocumentoDetalle, LineaDocumento } from '../types'

/**
 * El borrador de edición de una cotización.
 *
 * Hasta la E1 cada campo se escribía solo al perder el foco. Eso hacía
 * imposible un «Descartar» honesto —lo escrito ya estaba— y dejaba el
 * documento a medio guardar si algo fallaba en el medio.
 *
 * Acá todo vive en memoria hasta que la persona aprieta Guardar. Este archivo
 * es puro: no importa la base, no hace red y no conoce React. Por eso se puede
 * probar que **antes de Guardar no hay ni una escritura**.
 */

export interface CabeceraBorrador {
  customerId: string
  contactoId: string
  /**
   * La dirección de entrega del PEDIDO (Fase 17 · E3). Vacío = sin elegir, y
   * entonces el remito cae en la principal del cliente al emitirse.
   *
   * La cotización no la tiene: es la promesa de un precio, no de una entrega.
   * Para ella este campo queda siempre vacío y no se manda.
   */
  direccionEntregaId: string
  vendedorId: string
  listaPrecioId: string
  titulo: string
  fecha: string
  validaHasta: string
  moneda: string
  tipoCambio: string
  formaPago: string
  descuentoPct: string
  percepcionPct: string
  notas: string
}

export type CampoCabecera = keyof CabeceraBorrador

/**
 * Una línea del borrador.
 *
 * `id` es `null` en las que todavía no existen en la base. La identidad de una
 * línea es su `id`, no su posición: en el sistema anterior el índice ERA la
 * identidad y de ahí salieron los desfases que hubo que reconstruir a mano.
 * `clave` existe sólo para que React tenga algo estable mientras la línea no
 * tiene id.
 */
export interface LineaBorrador {
  clave: string
  id: string | null
  numeroLinea: number
  tipoLinea: 'item' | 'service' | 'chapter'
  productId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  cantidad: number
  precioUnitario: number
  descuentoPct: number
  tratamientoImpuesto: string
  tasaImpuesto: number
}

export interface Borrador {
  cabecera: CabeceraBorrador
  lineas: LineaBorrador[]
  /** El `updated_at` que se leyó al entrar. Es el testigo de concurrencia. */
  esperado: string
}

const texto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function aLineaBorrador(l: LineaDocumento): LineaBorrador {
  return {
    clave: l.id,
    id: l.id,
    numeroLinea: l.numeroLinea ?? 0,
    tipoLinea: l.tipoLinea,
    productId: l.productId,
    sku: l.sku,
    nombre: l.nombre,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario ?? 0,
    descuentoPct: l.descuentoPct ?? 0,
    tratamientoImpuesto: l.tratamientoImpuesto ?? 'vat_21',
    tasaImpuesto: l.tasaImpuesto ?? 0,
  }
}

/**
 * Las columnas del PEDIDO. Son casi las mismas que las de la cotización, con
 * dos diferencias: la fecha es `order_date` y no hay validez.
 */
const COLUMNA_PEDIDO: Partial<Record<CampoCabecera, string>> = {
  customerId: 'customer_id',
  contactoId: 'contact_id',
  direccionEntregaId: 'shipping_address_id',
  vendedorId: 'salesperson_id',
  listaPrecioId: 'price_list_id',
  titulo: 'title',
  fecha: 'order_date',
  moneda: 'currency_code',
  tipoCambio: 'exchange_rate',
  formaPago: 'payment_terms',
  descuentoPct: 'discount_pct',
  percepcionPct: 'perception_pct',
  notas: 'notes',
}

/** El estado exacto del documento al entrar en edición. Es lo que restaura Descartar. */
export function crearBorrador(doc: DocumentoDetalle, lineas: readonly LineaDocumento[]): Borrador {
  return {
    cabecera: {
      customerId: doc.clienteId ?? '',
      contactoId: doc.contactoId ?? '',
      direccionEntregaId: doc.direccionEntregaId ?? '',
      vendedorId: doc.vendedorId ?? '',
      listaPrecioId: doc.listaPrecioId ?? '',
      titulo: doc.titulo ?? '',
      fecha: doc.fecha.slice(0, 10),
      validaHasta: doc.validaHasta?.slice(0, 10) ?? '',
      moneda: doc.moneda ?? '',
      tipoCambio: texto(doc.tipoCambio),
      formaPago: doc.formaPago ?? '',
      descuentoPct: texto(doc.descuentoPct),
      percepcionPct: texto(doc.percepcionPct),
      notas: doc.notas ?? '',
    },
    lineas: [...lineas].sort((a, b) => (a.numeroLinea ?? 0) - (b.numeroLinea ?? 0)).map(aLineaBorrador),
    esperado: doc.actualizadoEn,
  }
}

/**
 * El borrador de una cotización que TODAVÍA NO EXISTE (Fase 15 · E3).
 *
 * Es el mismo `Borrador` del editor: los mismos campos, los mismos cambios y
 * el mismo «no se escribe nada hasta Guardar». Lo único distinto es que no hay
 * documento previo, así que `esperado` va vacío: no hay concurrencia que
 * controlar contra una fila que no existe.
 *
 * Sin moneda por defecto y sin vendedor «el que está mirando»: los dos son
 * datos del negocio y se eligen.
 */
export function borradorNuevo(hoy: string, formaPago = ''): Borrador {
  return {
    cabecera: {
      customerId: '',
      contactoId: '',
      direccionEntregaId: '',
      vendedorId: '',
      listaPrecioId: '',
      titulo: '',
      fecha: hoy,
      validaHasta: '',
      moneda: '',
      tipoCambio: '',
      formaPago,
      descuentoPct: '',
      percepcionPct: '',
      notas: '',
    },
    lineas: [],
    esperado: '',
  }
}

/** Lo que falta para poder crear. Vacío: se puede guardar. */
export function faltaParaCrear(b: Borrador): string[] {
  const falta: string[] = []
  if (b.cabecera.customerId === '') falta.push('Elegí un cliente.')
  if (b.cabecera.moneda === '') falta.push('Elegí la moneda del documento.')
  return falta
}

// ── Cambios ────────────────────────────────────────────────────────────────

export function cambiarCampo(b: Borrador, campo: CampoCabecera, valor: string): Borrador {
  return { ...b, cabecera: { ...b.cabecera, [campo]: valor } }
}

/**
 * Cambiar de cliente arrastra el contacto.
 *
 * Un contacto pertenece a UN cliente. Si se cambia el cliente y el contacto
 * elegido era del anterior, queda colgando: la base lo rechazaría
 * (`CONTACTO_DE_OTRO_CLIENTE`) y, peor, la pantalla mostraría un nombre que ya
 * no corresponde. Se limpia acá y la UI lo avisa.
 *
 * Con la dirección de entrega pasa lo mismo y es peor: mandar la mercadería al
 * domicilio de otro cliente. También se limpia (Fase 17 · E3).
 *
 * Lo que NO se toca son las líneas: los precios ya cargados son del documento,
 * no del cliente.
 */
export function cambiarCliente(b: Borrador, customerId: string): { borrador: Borrador; contactoLimpiado: boolean } {
  if (b.cabecera.customerId === customerId) return { borrador: b, contactoLimpiado: false }
  const habia = b.cabecera.contactoId !== ''
  return {
    borrador: {
      ...b,
      cabecera: { ...b.cabecera, customerId, contactoId: '', direccionEntregaId: '' },
    },
    contactoLimpiado: habia,
  }
}

/**
 * Cambiar de moneda puede dejar la tarifa incompatible.
 *
 * Una lista en dólares sobre un documento en pesos exigiría un tipo de cambio
 * que nadie definió. La base lo rechaza (`TARIFA_OTRA_MONEDA`); acá se limpia
 * antes para que la persona lo vea en el momento y no al guardar.
 */
export function cambiarMoneda(
  b: Borrador,
  moneda: string,
  monedaDeLaLista: string | null,
): { borrador: Borrador; tarifaLimpiada: boolean } {
  const incompatible = b.cabecera.listaPrecioId !== '' && monedaDeLaLista !== null && monedaDeLaLista !== moneda
  return {
    borrador: {
      ...b,
      cabecera: { ...b.cabecera, moneda, listaPrecioId: incompatible ? '' : b.cabecera.listaPrecioId },
    },
    tarifaLimpiada: incompatible,
  }
}

export type CampoLinea = keyof Pick<
  LineaBorrador,
  'sku' | 'nombre' | 'descripcion' | 'cantidad' | 'precioUnitario' | 'descuentoPct' | 'tratamientoImpuesto' | 'tasaImpuesto'
>

export function cambiarLinea(b: Borrador, clave: string, campo: CampoLinea, valor: string | number | null): Borrador {
  return {
    ...b,
    lineas: b.lineas.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)),
  }
}

/** El próximo número de línea libre. Nunca reusa uno: el orden es un dato. */
export function proximoNumero(b: Borrador): number {
  return b.lineas.reduce((max, l) => Math.max(max, l.numeroLinea), 0) + 1
}

export function agregarLinea(b: Borrador, l: Omit<LineaBorrador, 'clave' | 'id' | 'numeroLinea'>): Borrador {
  return {
    ...b,
    lineas: [
      ...b.lineas,
      { ...l, clave: `nueva-${crypto.randomUUID()}`, id: null, numeroLinea: proximoNumero(b) },
    ],
  }
}

/** Quitar del borrador. La fila sigue en la base hasta que se guarde. */
export function quitarLinea(b: Borrador, clave: string): Borrador {
  return { ...b, lineas: b.lineas.filter((l) => l.clave !== clave) }
}

/** Intercambia dos líneas vecinas, y con ellas su número. */
export function moverLinea(b: Borrador, clave: string, direccion: -1 | 1): Borrador {
  const i = b.lineas.findIndex((l) => l.clave === clave)
  const j = i + direccion
  if (i < 0 || j < 0 || j >= b.lineas.length) return b
  const lineas = [...b.lineas]
  const a = lineas[i]!
  const c = lineas[j]!
  lineas[i] = { ...c, numeroLinea: a.numeroLinea }
  lineas[j] = { ...a, numeroLinea: c.numeroLinea }
  return { ...b, lineas: lineas.sort((x, y) => x.numeroLinea - y.numeroLinea) }
}

// ── Cambios pendientes ─────────────────────────────────────────────────────

const mismaLinea = (a: LineaBorrador, b: LineaBorrador) =>
  a.id === b.id &&
  a.numeroLinea === b.numeroLinea &&
  a.productId === b.productId &&
  a.sku === b.sku &&
  a.nombre === b.nombre &&
  (a.descripcion ?? '') === (b.descripcion ?? '') &&
  Number(a.cantidad) === Number(b.cantidad) &&
  Number(a.precioUnitario) === Number(b.precioUnitario) &&
  Number(a.descuentoPct) === Number(b.descuentoPct) &&
  a.tratamientoImpuesto === b.tratamientoImpuesto

/**
 * ¿Hay algo que guardar?
 *
 * Se compara contra el snapshot inicial, no contra un contador de pulsaciones:
 * escribir una letra y borrarla deja el documento igual, y Guardar tiene que
 * quedar apagado.
 */
export function hayCambios(actual: Borrador, original: Borrador): boolean {
  for (const k of Object.keys(actual.cabecera) as CampoCabecera[]) {
    if (actual.cabecera[k] !== original.cabecera[k]) return true
  }
  if (actual.lineas.length !== original.lineas.length) return true
  return actual.lineas.some((l, i) => !mismaLinea(l, original.lineas[i]!))
}

// ── Payload ────────────────────────────────────────────────────────────────

/**
 * Las columnas reales de la COTIZACIÓN.
 *
 * Es parcial porque hay campos del borrador que la cotización no tiene: la
 * dirección de entrega es del pedido. Un campo sin columna no se manda, y no
 * hace falta acordarse de excluirlo en cada payload.
 */
const COLUMNA: Partial<Record<CampoCabecera, string>> = {
  customerId: 'customer_id',
  contactoId: 'contact_id',
  vendedorId: 'salesperson_id',
  listaPrecioId: 'price_list_id',
  titulo: 'title',
  fecha: 'quote_date',
  validaHasta: 'valid_until',
  moneda: 'currency_code',
  tipoCambio: 'exchange_rate',
  formaPago: 'payment_terms',
  descuentoPct: 'discount_pct',
  percepcionPct: 'perception_pct',
  notas: 'notes',
}

/** Los que van como número; vacío es `null`, no cero. */
const NUMERICOS: CampoCabecera[] = ['tipoCambio', 'descuentoPct', 'percepcionPct']

function valorDeCampo(campo: CampoCabecera, valor: string): string | number | null {
  if (valor === '') return campo === 'customerId' || campo === 'moneda' ? valor : null
  if (NUMERICOS.includes(campo)) {
    const n = Number(valor.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return valor
}

export interface PayloadGuardado {
  cabecera: Record<string, string | number | null>
  lineas: Record<string, unknown>[]
}

/**
 * Lo que se le manda a la RPC.
 *
 * De la cabecera van SÓLO los campos que cambiaron: lo que no viaja, el
 * servidor lo deja como estaba. Las líneas van completas —el estado deseado—
 * porque el servidor tiene que poder deducir qué borrar, y una lista de
 * órdenes tipo «borrá la línea X» sería una superficie para pedir el borrado
 * de líneas ajenas.
 */
export function aPayload(actual: Borrador, original: Borrador): PayloadGuardado {
  const cabecera: Record<string, string | number | null> = {}
  for (const k of Object.keys(actual.cabecera) as CampoCabecera[]) {
    const columna = COLUMNA[k]
    if (columna && actual.cabecera[k] !== original.cabecera[k]) {
      cabecera[columna] = valorDeCampo(k, actual.cabecera[k])
    }
  }

  return {
    cabecera,
    lineas: actual.lineas.map((l) => ({
      id: l.id,
      line_no: l.numeroLinea,
      line_type: l.tipoLinea,
      product_id: l.productId,
      sku_snapshot: l.sku,
      name_snapshot: l.nombre,
      description_snapshot: l.descripcion,
      quantity: Number(l.cantidad),
      unit_price: Number(l.precioUnitario),
      discount_pct: Number(l.descuentoPct),
      tax_treatment: l.tratamientoImpuesto,
      tax_rate_snapshot: Number(l.tasaImpuesto),
    })),
  }
}

/**
 * Lo que se le manda a `crear_cotizacion`.
 *
 * A diferencia del guardado, acá va la cabecera COMPLETA: no hay documento
 * previo del que heredar lo que falte. Los vacíos viajan como `null` (menos
 * cliente y moneda, que son obligatorios y los valida el servidor), y las
 * líneas van sin `id` porque todavía no existen.
 *
 * Sigue sin viajar nada de sistema: ni empresa, ni número, ni serie, ni
 * estado, ni totales. Eso lo pone el servidor.
 */
export function aPayloadCreacion(b: Borrador): PayloadGuardado {
  const cabecera: Record<string, string | number | null> = {}
  for (const k of Object.keys(b.cabecera) as CampoCabecera[]) {
    const columna = COLUMNA[k]
    if (columna) cabecera[columna] = valorDeCampo(k, b.cabecera[k])
  }

  return {
    cabecera,
    lineas: b.lineas.map((l, i) => ({
      line_no: i + 1,
      line_type: l.tipoLinea,
      product_id: l.productId,
      sku_snapshot: l.sku,
      name_snapshot: l.nombre,
      description_snapshot: l.descripcion,
      quantity: Number(l.cantidad),
      unit_price: Number(l.precioUnitario),
      discount_pct: Number(l.descuentoPct),
      tax_treatment: l.tratamientoImpuesto,
      tax_rate_snapshot: Number(l.tasaImpuesto),
    })),
  }
}

/**
 * Lo que se le manda a `guardar_pedido`: sólo la cabecera que cambió, con los
 * nombres de `sales_orders`, y las líneas completas. La validez no existe en
 * el pedido, así que ni siquiera se ofrece.
 */
export function aPayloadPedido(actual: Borrador, original: Borrador): PayloadGuardado {
  const cabecera: Record<string, string | number | null> = {}
  for (const k of Object.keys(actual.cabecera) as CampoCabecera[]) {
    const columna = COLUMNA_PEDIDO[k]
    if (columna && actual.cabecera[k] !== original.cabecera[k]) {
      cabecera[columna] = valorDeCampo(k, actual.cabecera[k])
    }
  }
  return { cabecera, lineas: aPayload(actual, original).lineas }
}

/** Lo que se le manda a `crear_pedido`: la cabecera completa y líneas sin id. */
export function aPayloadCreacionPedido(b: Borrador): PayloadGuardado {
  const cabecera: Record<string, string | number | null> = {}
  for (const k of Object.keys(b.cabecera) as CampoCabecera[]) {
    const columna = COLUMNA_PEDIDO[k]
    if (columna) cabecera[columna] = valorDeCampo(k, b.cabecera[k])
  }
  return { cabecera, lineas: aPayloadCreacion(b).lineas }
}

/** Las líneas del borrador con la forma que espera la tabla de lectura. */
export function comoLineasDocumento(b: Borrador): LineaDocumento[] {
  return b.lineas.map((l) => ({
    id: l.clave,
    numeroLinea: l.numeroLinea,
    tipoLinea: l.tipoLinea,
    productId: l.productId,
    sku: l.sku,
    nombre: l.nombre,
    descripcion: l.descripcion,
    cantidad: Number(l.cantidad),
    precioUnitario: Number(l.precioUnitario),
    descuentoPct: Number(l.descuentoPct),
    tratamientoImpuesto: l.tratamientoImpuesto,
    tasaImpuesto: Number(l.tasaImpuesto),
    ordenLineaId: null,
  }))
}
