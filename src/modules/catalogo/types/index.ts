/**
 * Cómo se ordena el catálogo (Fase 22 · paridad, #13; stock en Fase 25 · E2).
 *
 * Los que llevan `_desc` son la misma columna al revés. Siete columnas: SKU,
 * Producto, Marca, Categoría, Serie y los dos saldos de stock. Los saldos los
 * ordena la base desde la Fase 25 · E2 —`search_products` los trae con un
 * lateral sobre `stock_balances`, y sólo cuando el orden los pide—, con los
 * «sin saldo» al final en las dos direcciones.
 *
 * **Precio sigue afuera**, y no es un olvido: vive en `product_prices` y
 * depende de qué lista se esté mirando, que la RPC no recibe.
 *
 * Ordenar por stock es sólo para roles internos: `stock_balances` no la puede
 * leer un rol externo (policy `stockbal_select`), así que pedirlo desde afuera
 * no ordena nada ni filtra nada — y la pantalla tampoco lo ofrece.
 */
export const ORDENES_CATALOGO = [
  'relevancia',
  'nombre', 'nombre_desc',
  'sku', 'sku_desc',
  'marca', 'marca_desc',
  'categoria', 'categoria_desc',
  'serie', 'serie_desc',
  'stock_real', 'stock_real_desc',
  'stock_virtual', 'stock_virtual_desc',
] as const

/**
 * Orden del catálogo.
 *
 * Además de las columnas fijas, `attr:<clave>` ordena por un atributo —y
 * `attr:<clave>_desc` al revés— (Fase 28 · E7). No se enumeran: las claves
 * salen de `product_attribute_definitions`, que es dato y no código.
 */
export type OrdenCatalogo = (typeof ORDENES_CATALOGO)[number] | `attr:${string}`

/** `attr:encastre` → `encastre`; cualquier otra cosa → null. */
export function claveDeAtributoOrdenado(orden: OrdenCatalogo): string | null {
  const campo = orden.endsWith('_desc') ? orden.slice(0, -5) : orden
  return campo.startsWith('attr:') ? campo.slice(5) : null
}

/** Las columnas que se pueden ordenar, sin la dirección. */
export const COLUMNAS_ORDENABLES = ['sku', 'nombre', 'marca', 'categoria', 'serie', 'stock_real', 'stock_virtual'] as const

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
  /**
   * `false` cuando su marca (Fase 22 · B) o su categoría (Fase 25 · E1) están
   * fuera del catálogo.
   */
  enCatalogo: boolean
  /** Cuál de los dos interruptores lo dejó afuera. `null` si está adentro. */
  motivoFueraDelCatalogo: 'marca' | 'categoria' | 'ambas' | null
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
  /** El nombre del catálogo impreso («Catálogo SPEEDRILL»), si se lo conoce. */
  etiqueta: string | null
  pagina: number | null
  familia: number | null
  imagenUrl: string | null
}
