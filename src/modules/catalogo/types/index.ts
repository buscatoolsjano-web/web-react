/**
 * Cómo se ordena el catálogo (Fase 22 · paridad, #13).
 *
 * Los que llevan `_desc` son la misma columna al revés. Las cinco columnas
 * ordenables son las que `search_products` sabe ordenar: SKU, Producto,
 * Marca, Categoría y Serie. **Stock y Precio no están**, y no es un olvido:
 * no viven en `products` —están en `stock_balances` y en `product_prices`—
 * y el precio además depende de qué lista de precios se esté mirando, que la
 * RPC no recibe. El legacy puede ordenar por stock porque tiene los 21.775
 * productos en memoria.
 */
export const ORDENES_CATALOGO = [
  'relevancia',
  'nombre', 'nombre_desc',
  'sku', 'sku_desc',
  'marca', 'marca_desc',
  'categoria', 'categoria_desc',
  'serie', 'serie_desc',
] as const

export type OrdenCatalogo = (typeof ORDENES_CATALOGO)[number]

/** Las columnas que se pueden ordenar, sin la dirección. */
export const COLUMNAS_ORDENABLES = ['sku', 'nombre', 'marca', 'categoria', 'serie'] as const

/** Estado completo del catálogo. Vive en la URL, no en useState. */
export interface FiltrosCatalogo {
  q: string
  /** id de marca, no el nombre. */
  marca: string | null
  /** id de categoría. */
  categoria: string | null
  /**
   * Subcategoría (`products.product_type`). Es multi-valor porque un mismo
   * subtipo puede convivir con otros dentro de la categoría elegida.
   */
  subtipos: string[]
  serie: string | null
  /**
   * Filtros por atributo. Multi-valor: OR dentro de la clave, AND entre
   * claves. Un link viejo con `?encastre=1/4+HEX` se sigue leyendo: un valor
   * suelto entra como array de uno.
   */
  atributos: Record<string, string[]>
  /** Rangos numéricos: `{ largo: { min: 25, max: 50 } }`. */
  rangos: Record<string, RangoNumerico>
  pagina: number
  porPagina: number
  orden: OrdenCatalogo
}

export interface RangoNumerico {
  min: number | null
  max: number | null
}

export const FILTROS_INICIALES: FiltrosCatalogo = {
  q: '',
  marca: null,
  categoria: null,
  subtipos: [],
  serie: null,
  atributos: {},
  rangos: {},
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
  /** `false` cuando su marca está fuera del catálogo (Fase 22 · B). */
  enCatalogo: boolean
  id: string
  sku: string
  nombre: string
  serie: string | null
  tipo: string | null
  esKit: boolean
  necesitaRevision: boolean
  marca: MarcaResumen | null
  categoria: { id: string; nombre: string; slug: string } | null
  atributos: Record<string, unknown>
  /** null = sin precio en la lista vigente. Se muestra "Consultar". */
  precio: number | null
  /** Sólo se completa para roles internos. */
  stock: StockProducto | null
  /** Sólo para roles externos: booleano de la vista product_availability. */
  disponible: boolean | null
  /**
   * Imagen principal para el listado. null cuando el producto no tiene
   * ninguna FOTO: un diagrama de catálogo compartido no cuenta como foto.
   */
  imagen: ImagenProducto | null
}

/**
 * Imagen de producto. `thumbUrl` sólo está poblada cuando la verificación
 * offline la encontró con HTTP 200: nunca se deriva reescribiendo la URL.
 */
export interface ImagenProducto {
  url: string
  thumbUrl: string | null
  kind: 'product_image' | 'shared_diagram' | 'technical_diagram' | 'unknown'
  posicion: number
  esPrincipal: boolean
}

export interface ProductoDetalle extends ProductoListado {
  /** Todas las imágenes, ordenadas por `posicion`. */
  imagenes: ImagenProducto[]
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

// ── Facetas ────────────────────────────────────────────────────────────────

export interface OpcionFaceta {
  valor: string
  etiqueta: string
  cantidad: number
}

export interface FacetaAtributo {
  key: string
  label: string
  unidad: string | null
  /** 'enum' → seleccionable; 'range' → min/máx. Lo decide la cardinalidad. */
  clase: 'enum' | 'range'
  opciones: OpcionFaceta[]
  /** Sólo para 'range': extremos reales del conjunto actual. */
  min: number | null
  max: number | null
}

export interface Facetas {
  total: number
  marcas: OpcionFaceta[]
  categorias: OpcionFaceta[]
  subtipos: OpcionFaceta[]
  atributos: FacetaAtributo[]
}

// ── Fase 21 · E1: lo que el modal del producto necesita ────────────────────

/**
 * Un movimiento de stock del producto. **Sólo lectura**: el catálogo mira el
 * historial, nunca lo escribe.
 */
export interface MovimientoDeStock {
  id: string
  fecha: string
  /** `opening_balance`, `sale_delivery`, `adjustment`… tal como los guarda la base. */
  tipo: string
  /** Positiva entra, negativa sale. El signo es el dato, no el color. */
  cantidad: number
  origenTipo: string | null
  origenId: string | null
  notas: string | null
}

/**
 * La hoja del catálogo donde aparece el producto.
 *
 * `imagenUrl` es la página escaneada cuando existe; `catalogo` + `pagina`, el
 * dato que traía el sistema anterior. Puede haber una sin la otra.
 */
export interface HojaDeCatalogo {
  catalogo: string | null
  pagina: number | null
  familia: number | null
  imagenUrl: string | null
}
