export type OrdenCatalogo = 'relevancia' | 'nombre' | 'sku'

/** Estado completo del catálogo. Vive en la URL, no en useState. */
export interface FiltrosCatalogo {
  q: string
  /** id de marca, no el nombre. */
  marca: string | null
  /** id de categoría. */
  categoria: string | null
  serie: string | null
  /** Filtros dinámicos por atributo: clave del jsonb → valor. */
  atributos: Record<string, string>
  pagina: number
  porPagina: number
  orden: OrdenCatalogo
}

export const FILTROS_INICIALES: FiltrosCatalogo = {
  q: '',
  marca: null,
  categoria: null,
  serie: null,
  atributos: {},
  pagina: 1,
  porPagina: 50,
  orden: 'nombre',
}

/** Las opciones del legacy, sin el 500 (que existía sólo porque ya se habían bajado todos). */
export const OPCIONES_POR_PAGINA = [25, 50, 100] as const

export interface MarcaResumen {
  id: string
  nombre: string
}

export interface CategoriaResumen {
  id: string
  nombre: string
  slug: string
  necesitaRevision: boolean
}

export interface DefinicionAtributo {
  key: string
  label: string
  unidad: string | null
  tipo: 'text' | 'number' | 'boolean'
  filtrable: boolean
  posicion: number
}

export interface ListaDePrecios {
  id: string
  nombre: string
  moneda: string
  esPorDefecto: boolean
}

/** Saldo de stock agregado sobre todos los depósitos. Sólo para roles internos. */
export interface StockProducto {
  real: number
  virtual: number
}

export interface ProductoListado {
  id: string
  sku: string
  nombre: string
  serie: string | null
  tipo: string | null
  esKit: boolean
  necesitaRevision: boolean
  marca: MarcaResumen | null
  categoria: { id: string; nombre: string } | null
  atributos: Record<string, unknown>
  /** null = sin precio en la lista vigente. Se muestra "Consultar". */
  precio: number | null
  /** Sólo se completa para roles internos. */
  stock: StockProducto | null
  /** Sólo para roles externos: booleano de la vista product_availability. */
  disponible: boolean | null
}

export interface ProductoDetalle extends ProductoListado {
  modelo: string | null
  descripcion: string | null
  descripcionLarga: string | null
  origen: string | null
  ncm: string | null
  pesoG: number | null
  volumenCm3: number | null
}

export interface PaginaDeProductos {
  productos: ProductoListado[]
  total: number
}

/** Un atributo ya resuelto para mostrar: etiqueta legible, valor y unidad. */
export interface AtributoPresentable {
  key: string
  label: string
  valor: string
  unidad: string | null
}
