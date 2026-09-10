/**
 * Tipos del módulo de Clientes.
 *
 * La entrega 1 es de SÓLO LECTURA: acá no hay nada que describa una
 * escritura. El alta y la edición son la entrega 3.
 */

/** Una fila del listado. Las columnas son las del listado legacy. */
export interface ClienteListado {
  id: string
  /** `CLI00001`. Es la referencia del legacy, no la identidad: ésa es el uuid. */
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  cuit: string | null
  emails: string[]
  dominios: string[]
  rubro: string | null
  telefono: string | null
  /** `true` si vino de la migración. */
  esHistorico: boolean
  necesitaRevision: boolean
  motivosRevision: string[]
  /** `deleted_at` no nulo: el cliente está dado de baja, no borrado. */
  dadoDeBaja: boolean
}

export interface PaginaDeClientes {
  filas: ClienteListado[]
  total: number
}

export type OrdenClientes = 'nombre' | 'referencia' | 'cuit' | 'rubro'
export type DireccionOrden = 'asc' | 'desc'

export interface FiltrosClientes {
  /** Búsqueda libre: nombre, nombre comercial, referencia, CUIT o email. */
  q: string
  rubro: string | null
  /** Sólo los que la migración dejó marcados. */
  soloRevision: boolean
  /** Incluir los dados de baja. Por defecto NO se ven. */
  incluirBajas: boolean
  pagina: number
  porPagina: number
  orden: OrdenClientes
  direccion: DireccionOrden
}

export const FILTROS_INICIALES: FiltrosClientes = {
  q: '',
  rubro: null,
  soloRevision: false,
  incluirBajas: false,
  pagina: 1,
  porPagina: 25,
  orden: 'nombre',
  direccion: 'asc',
}

export interface ContactoCliente {
  id: string
  nombre: string
  cargo: string | null
  email: string | null
  telefono: string | null
  fax: string | null
  esPrincipal: boolean
  notas: string | null
}

export interface DireccionCliente {
  id: string
  /** `shipping` | `billing` | `both`, tal como los acepta el CHECK. */
  tipo: string
  calle: string
  ciudad: string | null
  provincia: string | null
  codigoPostal: string | null
  /** Código de dos letras: `country_code`. */
  pais: string | null
  notas: string | null
  esPrincipal: boolean
  /** La dirección en una línea, para mostrarla sin armarla en cada lugar. */
  texto: string
}

export interface AliasDeProducto {
  id: string
  /** Cómo lo llama el cliente. */
  textoCliente: string
  sku: string | null
  nombreProducto: string | null
}

export interface CandidatoDeOc {
  id: string
  archivo: string | null
  detectadoEn: string | null
  estado: string | null
}

/** Un documento del historial del cliente. */
export interface DocumentoDeCliente {
  id: string
  tipo: 'cotizacion' | 'pedido' | 'entrega'
  numero: string
  fecha: string
  estado: string
  moneda: string | null
  total: number | null
}

/**
 * Un total por moneda.
 *
 * Nunca hay un total global. El panel del legacy sumaba ARS + USD + EUR en un
 * solo número y ese número no significaba nada.
 */
export interface TotalPorMoneda {
  /** `null` = los documentos históricos que no dicen en qué moneda están. */
  moneda: string | null
  documentos: number
  total: number
}

export interface ClienteDetalle {
  id: string
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  nombreLegacy: string | null
  cuit: string | null
  emails: string[]
  dominios: string[]
  rubro: string | null
  telefono: string | null
  tipo: string
  estado: string
  condicionDePago: string | null
  monedaPorDefecto: string | null
  descuentoPct: number
  limiteDeCredito: number | null
  vendedor: string | null
  notas: string | null
  esHistorico: boolean
  origenLegacy: string | null
  necesitaRevision: boolean
  motivosRevision: string[]
  dadoDeBaja: boolean
  creadoEn: string
}

export interface RelacionadosCliente {
  direcciones: DireccionCliente[]
  alias: AliasDeProducto[]
  candidatosDeOc: CandidatoDeOc[]
}
