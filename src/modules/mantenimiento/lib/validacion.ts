import type { DatosActivo } from '../services/activos'
import type { DatosOrden } from '../services/ordenes'

/**
 * Validación de los formularios de Mantenimiento.
 *
 * La regla de fondo: **acá sólo se valida lo que la base también exige**. Si
 * el schema deja pasar un equipo sin serial y sin dueño, esta pantalla también
 * lo deja pasar. Inventar obligatoriedad en el front no protege nada —la base
 * sigue aceptando lo mismo desde cualquier otro lado— y sí impide cargar un
 * caso real que el legacy manejaba sin problema.
 */

export interface ErrorDeCampo {
  campo: string
  mensaje: string
}

const vacio = (s: string): boolean => s.trim() === ''

/** `2026-09-10` y que además exista como fecha. */
function fechaValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * Un equipo.
 *
 * **Nada es obligatorio salvo la coherencia de las fechas de garantía.** Ni el
 * serial, ni el dueño, ni el producto, ni la marca:
 *
 *   · El serial es nullable y no es único. El legacy nunca lo garantizó, y de
 *     las tres fichas reales del histórico ninguna tenía un serial confiable.
 *   · El dueño es nullable por decisión explícita: una herramienta puede
 *     entrar al taller antes de saber de quién es.
 *   · El producto es opcional: hay herramientas que no están en el catálogo.
 *
 * La referencia `EQ00001` no se valida porque no se escribe: la emite
 * `next_document_number` del lado del servidor.
 */
export function validarActivo(d: DatosActivo): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = []

  for (const [campo, valor] of [
    ['garantiaDesde', d.garantiaDesde],
    ['garantiaHasta', d.garantiaHasta],
  ] as const) {
    if (!vacio(valor) && !fechaValida(valor)) {
      errores.push({ campo, mensaje: 'La fecha no es válida.' })
    }
  }

  if (
    !vacio(d.garantiaDesde) &&
    !vacio(d.garantiaHasta) &&
    fechaValida(d.garantiaDesde) &&
    fechaValida(d.garantiaHasta) &&
    d.garantiaHasta < d.garantiaDesde
  ) {
    errores.push({
      campo: 'garantiaHasta',
      mensaje: 'El fin de la garantía no puede ser anterior a su comienzo.',
    })
  }

  return errores
}

/**
 * Una orden.
 *
 * Acá sí hay obligatorios, y son los `not null` de `maintenance_orders`:
 *
 *   · **El equipo**, que es de qué herramienta se habla.
 *   · **El cliente**, que se precarga del dueño actual del equipo y después
 *     queda congelado. Si el equipo no tiene dueño hay que elegirlo a mano:
 *     una orden sin cliente no se puede facturar ni entregar.
 *   · **El tipo de servicio** y **la fecha de ingreso**.
 */
export function validarOrden(d: DatosOrden): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = []

  if (vacio(d.activoId)) {
    errores.push({ campo: 'activoId', mensaje: 'Elegí el equipo que entra al taller.' })
  }
  if (vacio(d.clienteId)) {
    errores.push({
      campo: 'clienteId',
      mensaje:
        'La orden necesita un cliente. Si el equipo todavía no tiene dueño, elegilo acá: queda guardado en la orden aunque después el equipo cambie de manos.',
    })
  }
  if (vacio(d.tipoServicio)) {
    errores.push({ campo: 'tipoServicio', mensaje: 'Elegí el tipo de servicio.' })
  }
  if (vacio(d.fechaIngreso)) {
    errores.push({ campo: 'fechaIngreso', mensaje: 'La fecha de ingreso es obligatoria.' })
  } else if (!fechaValida(d.fechaIngreso)) {
    errores.push({ campo: 'fechaIngreso', mensaje: 'La fecha de ingreso no es válida.' })
  }

  return errores
}

/** El mensaje de un campo, o `null` si ese campo está bien. */
export function errorDe(errores: readonly ErrorDeCampo[], campo: string): string | null {
  return errores.find((e) => e.campo === campo)?.mensaje ?? null
}

/**
 * Una línea de cotización.
 *
 * La regla de fondo sigue siendo la misma: sólo se valida lo que la base
 * también exige. El `line_total` no se valida porque no se manda — lo calcula
 * el servidor—, y la moneda no se pide acá porque la exige un trigger sobre la
 * orden, no sobre la línea.
 */
export function validarLinea(d: {
  descripcion: string
  cantidad: number
  precioUnitario: number
  productoId: string | null
  tipo: string
}): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = []

  // Una línea sin producto y sin texto no dice nada: el cliente recibiría un
  // renglón con un importe y sin concepto.
  if (d.productoId === null && vacio(d.descripcion)) {
    errores.push({
      campo: 'descripcion',
      mensaje: 'Poné una descripción, o elegí un producto del catálogo.',
    })
  }
  if (!Number.isFinite(d.cantidad) || d.cantidad <= 0) {
    errores.push({ campo: 'cantidad', mensaje: 'La cantidad tiene que ser mayor que cero.' })
  }
  if (!Number.isFinite(d.precioUnitario) || d.precioUnitario < 0) {
    errores.push({ campo: 'precioUnitario', mensaje: 'El precio no puede ser negativo.' })
  }
  return errores
}

/**
 * Un repuesto.
 *
 * El producto y el depósito son obligatorios —los dos son `not null`— y el
 * costo es opcional. Si hay costo, hay moneda: es el CHECK
 * `chk_mop_costo_moneda`, y se avisa acá para no mandar una fila que la base
 * va a rechazar igual.
 */
export function validarRepuesto(d: {
  productoId: string | null
  depositoId: string | null
  cantidad: number
  costoUnitario: number | null
  monedaCosto: string | null
}): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = []

  if (d.productoId === null) {
    errores.push({ campo: 'productoId', mensaje: 'Elegí el repuesto del catálogo.' })
  }
  if (d.depositoId === null) {
    errores.push({ campo: 'depositoId', mensaje: 'Elegí de qué depósito sale.' })
  }
  if (!Number.isFinite(d.cantidad) || d.cantidad <= 0) {
    errores.push({ campo: 'cantidad', mensaje: 'La cantidad tiene que ser mayor que cero.' })
  }
  if (d.costoUnitario !== null) {
    if (!Number.isFinite(d.costoUnitario) || d.costoUnitario < 0) {
      errores.push({ campo: 'costoUnitario', mensaje: 'El costo no puede ser negativo.' })
    }
    if (d.monedaCosto === null || d.monedaCosto === '') {
      errores.push({
        campo: 'monedaCosto',
        mensaje: 'Si cargás un costo, decí en qué moneda. Un número sin moneda no es un costo.',
      })
    }
  }
  return errores
}
