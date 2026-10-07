import type { DefinicionAtributo } from '../types'

/**
 * Alta de producto (Fase 26 · E3).
 *
 * Réplica del «Nuevo producto» del legacy (`app.js:14085` el formulario,
 * `:14448` el guardado), con las diferencias que impone el esquema y que están
 * documentadas una por una en `CAMPOS_QUE_NO_ESTAN`.
 *
 * Todo lo de acá es **lógica pura, sin red**: vive en `lib/` para que los tests
 * corran sin `.env`, igual que el resto del módulo.
 */

/** Los tres estados que la base acepta (`products_status_check`). */
export const ESTADOS_PRODUCTO = [
  { valor: 'active', etiqueta: 'Activo' },
  { valor: 'draft', etiqueta: 'Borrador' },
  { valor: 'discontinued', etiqueta: 'Descatalogado' },
] as const

export type EstadoProducto = (typeof ESTADOS_PRODUCTO)[number]['valor']

/**
 * Lo que el formulario del legacy pide y acá **no se puede guardar todavía**,
 * con el motivo exacto. La pantalla lo muestra: es la diferencia entre «no lo
 * hicimos» y «no se puede hasta decidir X».
 *
 * ESTA LISTA ENVEJECE, y cuando envejece miente en la peor dirección: dice que
 * algo no se puede justo al lado del campo que lo hace. Pasó con dos renglones
 * —subir una imagen y los componentes del kit— que siguieron acá meses después
 * de estar resueltos; alguien pudo no haber subido una foto por leer que no se
 * podía. Antes de agregar algo acá, y cada vez que se toca el alta, conviene
 * verificar los que quedan contra la base.
 */
export const CAMPOS_QUE_NO_ESTAN = [
  {
    campo: 'Precio de venta y tarifa',
    motivo:
      'el maestro de precios es STEL: `product_prices` se llena desde el sync y es de sólo lectura para el ERP. Cargarlo acá crearía dos precios para el mismo producto.',
  },
  {
    campo: 'Precio de costo',
    motivo: 'no hay tabla de costos en la base.',
  },
  {
    campo: 'Stock inicial, mínimo y máximo',
    motivo:
      '`stock_balances` es de sólo lectura y es a propósito: el saldo lo mueve un movimiento —una recepción, una entrega—, nunca una carga a mano. No existe todavía la operación de ajuste de inventario, que es la que haría falta. Mínimo y máximo no tienen dónde guardarse.',
  },
] as const

export interface FormularioNuevoProducto {
  sku: string
  nombre: string
  modelo: string
  descripcion: string
  descripcionLarga: string
  estado: EstadoProducto
  marcaId: string
  categoriaId: string
  tipo: string
  serie: string
  esKit: boolean
  /** Atributos de la categoría elegida, por clave. Texto tal como se escribió. */
  atributos: Record<string, string>
  codigoBarras: string
  origen: string
  ncm: string
  /** En gramos, como la columna. El legacy pide kilos (ver `gramosDesdeKg`). */
  pesoG: string
  volumenCm3: string
  /** La imagen principal, por URL. */
  imagenUrl: string
}

export const FORMULARIO_VACIO: FormularioNuevoProducto = {
  sku: '',
  nombre: '',
  modelo: '',
  descripcion: '',
  descripcionLarga: '',
  estado: 'active',
  marcaId: '',
  categoriaId: '',
  tipo: '',
  serie: '',
  esKit: false,
  atributos: {},
  codigoBarras: '',
  origen: '',
  ncm: '',
  pesoG: '',
  volumenCm3: '',
  imagenUrl: '',
}

/**
 * La referencia sugerida, con la misma regla que el legacy (`app.js:13653`):
 * las dos primeras LETRAS de la marca, un punto, y el modelo en mayúsculas.
 *
 * Sin modelo, el legacy usa la hora en base 36 para no repetir. Se replica,
 * incluido que sin marca el prefijo es `PRO`. Es una sugerencia: se puede
 * escribir cualquier otra cosa encima.
 */
export function skuSugerido(marca: string | null, modelo: string, ahora = Date.now()): string {
  const m = modelo.trim().toUpperCase()
  const letras = (marca ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase()
  if (letras) {
    if (m) return `${letras}.${m}`
    return `${letras}-${ahora.toString(36).toUpperCase().slice(-4)}`
  }
  return `PRO-${ahora.toString(36).toUpperCase().slice(-5)}`
}

/**
 * La referencia que sale SOLA de la marca y el modelo: `SP.VPPH2/150`.
 *
 * Se separa de `skuSugerido` porque son dos cosas distintas. Ésta es
 * **determinística**: con los mismos datos da siempre lo mismo, así puede ser
 * el valor de un campo derivado que se recalcula en cada tecla. `skuSugerido`
 * inventa un sufijo con la hora cuando falta el modelo, y un campo que cambia
 * solo mientras se escribe es un campo que nadie puede leer.
 *
 * Devuelve `''` cuando no alcanza para armarla —sin marca, o sin modelo—, y ahí
 * la pantalla deja escribirla a mano. No inventa un prefijo: `PRO-` no dice
 * nada de lo que es el producto.
 */
export function referenciaDerivada(marca: string | null, modelo: string): string {
  const letras = (marca ?? '')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 2)
    .toUpperCase()
  const m = modelo.trim().toUpperCase()
  return letras.length === 2 && m !== '' ? `${letras}.${m}` : ''
}

/** Espacios de más colapsados, como hace la base con los nombres de maestros. */
const limpiar = (v: string) => v.trim().replace(/\s+/g, ' ')

export interface ErroresNuevoProducto {
  sku?: string
  marcaId?: string
  modelo?: string
  nombre?: string
  categoriaId?: string
  imagenUrl?: string
  pesoG?: string
  volumenCm3?: string
}

/**
 * Qué falta o está mal, antes de molestar al servidor.
 *
 * El legacy sólo exige SKU y nombre. Acá la **categoría también es
 * obligatoria**, y no es una regla que elegimos: `products.category_id` es NOT
 * NULL. Es mejor pedirla en el formulario que recibir un error de la base.
 */
export function validarNuevoProducto(f: FormularioNuevoProducto): ErroresNuevoProducto {
  const e: ErroresNuevoProducto = {}
  if (limpiar(f.sku) === '') e.sku = 'Escribí una referencia.'
  else if (limpiar(f.sku).length > 64) e.sku = 'Máximo 64 caracteres.'
  // La marca y el modelo son obligatorios porque la referencia SALE de ellos.
  // Dejarlos opcionales devolvía el catálogo al texto libre: sin marca no hay
  // prefijo, y sin prefijo cada quien inventaba su propio código.
  if (f.marcaId === '') e.marcaId = 'Elegí una marca: la referencia sale de ella.'
  if (limpiar(f.modelo) === '') e.modelo = 'Escribí el modelo: la referencia sale de él.'
  if (limpiar(f.nombre) === '') e.nombre = 'Escribí un nombre.'
  if (f.categoriaId === '') e.categoriaId = 'Elegí una categoría: la base la exige.'
  if (f.imagenUrl.trim() !== '' && !/^https?:\/\//i.test(f.imagenUrl.trim())) {
    e.imagenUrl = 'La dirección tiene que empezar con http:// o https://'
  }
  const entero = (v: string) => v.trim() === '' || /^\d+$/.test(v.trim())
  if (!entero(f.pesoG)) e.pesoG = 'Un número entero de gramos, sin decimales.'
  if (!entero(f.volumenCm3)) e.volumenCm3 = 'Un número entero de cm³, sin decimales.'
  return e
}

export const hayErrores = (e: ErroresNuevoProducto) => Object.keys(e).length > 0

/** Kilos a gramos, porque el legacy pide kilos y la columna guarda gramos. */
export function gramosDesdeKg(kg: string): string {
  const n = Number(kg.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 1000)) : ''
}

/**
 * Los atributos del jsonb.
 *
 * Un valor que parece número entra como número, como hace el legacy
 * (`app.js:14491`: `parseFloat`, y si no es número queda el texto). Lo vacío no
 * entra: una clave con cadena vacía es peor que la clave ausente, porque el
 * filtro del catálogo la cuenta como valor.
 */
export function atributosParaGuardar(
  escritos: Record<string, string>,
  codigoBarras: string,
): Record<string, string | number> {
  const salida: Record<string, string | number> = {}
  for (const [clave, crudo] of Object.entries(escritos)) {
    const v = crudo.trim()
    if (v === '') continue
    const n = Number(v.replace(',', '.'))
    salida[clave] = Number.isFinite(n) && v !== '' && /^[\d.,+-]+$/.test(v) ? n : v
  }
  // El legacy guarda el código de barras dentro de los atributos
  // (`app.js:14486`) porque tampoco tiene columna. Se hace igual.
  const barras = codigoBarras.trim()
  if (barras !== '') salida['barcode'] = barras
  return salida
}

/** La fila de `products` tal como se inserta. */
export interface FilaNuevoProducto {
  sku: string
  name: string
  model_code: string | null
  description: string | null
  description_long: string | null
  status: EstadoProducto
  brand_id: string | null
  category_id: string
  product_type: string | null
  series: string | null
  is_kit: boolean
  attributes: Record<string, string | number>
  origin_country: string | null
  ncm_code: string | null
  weight_g: number | null
  volume_cm3: number | null
}

const oNulo = (v: string) => (limpiar(v) === '' ? null : limpiar(v))
const entero = (v: string) => (v.trim() === '' ? null : Number(v.trim()))

/**
 * El formulario convertido en fila.
 *
 * `company_id` NO se pone acá: lo pone el servicio con la empresa activa, que
 * es lo único que RLS deja escribir. `needs_review` tampoco: un producto que
 * alguien carga a mano no es un dato a revisar de la migración, y la base ya lo
 * deja en false.
 */
export function filaDesdeFormulario(f: FormularioNuevoProducto): FilaNuevoProducto {
  return {
    sku: limpiar(f.sku),
    name: limpiar(f.nombre),
    model_code: oNulo(f.modelo),
    description: oNulo(f.descripcion),
    description_long: f.descripcionLarga.trim() === '' ? null : f.descripcionLarga.trim(),
    status: f.estado,
    brand_id: f.marcaId === '' ? null : f.marcaId,
    category_id: f.categoriaId,
    product_type: oNulo(f.tipo),
    series: oNulo(f.serie),
    is_kit: f.esKit,
    attributes: atributosParaGuardar(f.atributos, f.codigoBarras),
    origin_country: oNulo(f.origen),
    ncm_code: oNulo(f.ncm),
    weight_g: entero(f.pesoG),
    volume_cm3: entero(f.volumenCm3),
  }
}

/**
 * Los atributos que se ofrecen al cargar, para la categoría elegida.
 *
 * A diferencia del filtro del catálogo, acá se ofrecen **todos** los de la
 * categoría y no sólo los filtrables: al cargar un producto se quiere poder
 * escribir cualquier dato que la categoría tenga definido.
 */
export function atributosDeLaCategoria(
  definiciones: readonly DefinicionAtributo[],
  categoriaId: string,
  porCategoria: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): DefinicionAtributo[] {
  if (categoriaId === '' || !porCategoria) return []
  const claves = porCategoria.get(categoriaId)
  if (!claves || claves.size === 0) return []
  return definiciones.filter((d) => claves.has(d.key)).sort((a, b) => a.posicion - b.posicion)
}

/** Quién puede crear productos. Lo vuelve a decidir RLS (`products_write`). */
export function puedeCrearProductos(rol: string | undefined): boolean {
  return rol === 'admin' || rol === 'employee'
}
