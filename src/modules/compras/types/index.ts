/**
 * Tipos del módulo de Compras.
 *
 * La entrega 2 es sólo el maestro de proveedores. Los pedidos de compra, las
 * recepciones y las facturas de proveedor tienen su schema desde la entrega 1
 * pero todavía no tienen pantalla: lo que aparece de ellos acá es el estado
 * «no hay ninguno», que es un dato verdadero y no un placeholder.
 */

/** Una fila del listado de proveedores. */
export interface ProveedorListado {
  id: string
  /** `PROV00008`. Es la referencia del legacy, no la identidad: ésa es el uuid. */
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  /** Código de dos letras. */
  pais: string | null
  telefono: string | null
  email: string | null
  formaPago: string | null
  /** `active` | `inactive`. */
  estado: string
  /** `true` si vino de la migración del maestro legacy. */
  esHistorico: boolean
  necesitaRevision: boolean
  motivosRevision: string[]
  /** `deleted_at` no nulo: el proveedor está dado de baja, no borrado. */
  dadoDeBaja: boolean
}

export interface PaginaDeProveedores {
  filas: ProveedorListado[]
  total: number
}

export type OrdenProveedores = 'nombre' | 'referencia' | 'pais' | 'formaPago'
export type DireccionOrden = 'asc' | 'desc'

export interface FiltrosProveedores {
  /** Búsqueda libre: razón social, nombre comercial, referencia o email. */
  q: string
  /** `''` = todos, `active`, `inactive`. */
  estado: string
  /** Sólo los que la migración dejó marcados. */
  soloRevision: boolean
  /** Incluir los dados de baja. Por defecto NO se ven. */
  incluirBajas: boolean
  pagina: number
  porPagina: number
  orden: OrdenProveedores
  direccion: DireccionOrden
}

export const FILTROS_INICIALES: FiltrosProveedores = {
  q: '',
  estado: '',
  soloRevision: false,
  incluirBajas: false,
  pagina: 1,
  porPagina: 25,
  orden: 'nombre',
  direccion: 'asc',
}

export interface ProveedorDetalle {
  id: string
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  cuit: string | null
  email: string | null
  telefono: string | null
  /** La dirección del legacy, ENTERA y tal cual. Nunca se partió. */
  direccion: string | null
  pais: string | null
  actividad: string | null
  /** En el legacy es siempre «BUSCATOOLS». Es un dato histórico, no un permiso. */
  agente: string | null
  formaPago: string | null
  monedaPorDefecto: string | null
  notas: string | null
  estado: string
  esHistorico: boolean
  origenLegacy: string | null
  necesitaRevision: boolean
  motivosRevision: string[]
  dadoDeBaja: boolean
  creadoEn: string
}

/** Qué hay de este proveedor en el circuito de compras. */
export interface ComprasDelProveedor {
  pedidos: number
  recepciones: number
  facturas: number
}

/** Un evento de `purchases_audit`. */
export interface EventoDeProveedor {
  id: number
  accion: string
  estadoAnterior: string | null
  estadoNuevo: string | null
  autor: string | null
  fecha: string
  diff: Record<string, unknown> | null
}
