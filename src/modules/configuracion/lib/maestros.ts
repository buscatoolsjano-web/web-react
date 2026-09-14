/**
 * Configuración → maestros del catálogo (Entrega 3): listas de precios, marcas,
 * categorías y atributos.
 *
 * Todo lo de acá son AYUDAS de interfaz. Quién puede escribir, los duplicados y
 * si algo está en uso lo decide la base (RPC `config_*`); la pantalla sólo evita
 * ofrecer una acción que va a fallar y explica por qué.
 */

export const NOMBRE_MAX = 80

export interface Marca {
  id: string
  nombre: string
  activa: boolean
  productos: number
  equipos: number
}

export interface Categoria {
  id: string
  nombre: string
  slug: string
  enRevision: boolean
  productos: number
  atributos: number
  subcategorias: number
}

export interface Atributo {
  clave: string
  etiqueta: string
  tipo: string
  unidad: string | null
  filtrable: boolean
  categorias: string[]
  productos: number
}

export interface ListaPrecios {
  id: string
  nombre: string
  moneda: string
  porDefecto: boolean
  items: number
  itemsVigentes: number
  preciosCero: number
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  clientes: number
}

export type Vigencia = 'vigente' | 'futura' | 'vencida'

export interface ItemPrecio {
  id: string
  productoId: string
  sku: string
  nombre: string
  marca: string | null
  importe: number
  desde: string
  hasta: string | null
  vigencia: Vigencia
  estadoProducto: string
}

/** Por qué cada maestro se escribe o no desde el ERP. Una sola fuente para las pantallas y el doc. */
export const AUTORIDAD = {
  listas: {
    titulo: 'Sólo lectura: los precios no se administran desde el ERP todavía.',
    detalle:
      'No está decidido quién es el maestro de precios (STEL o el ERP). Los precios de «Lista base» se calcularon en la migración desde el catálogo legacy. Hasta esa decisión, las listas y sus precios se consultan pero no se editan acá.',
  },
  atributos: {
    titulo: 'Sólo lectura: los atributos son la estructura de los productos.',
    detalle:
      'Cada atributo es una clave dentro de los datos de miles de productos. Cambiar su clave o su tipo, o borrarlo, obliga a migrar esos productos: queda para la fase de Catálogo.',
  },
  marcasNombre:
    'El nombre de una marca no se edita: la importación de productos reconoce las marcas por su nombre y un cambio crearía una marca duplicada. Una marca con productos no se elimina: se desactiva.',
  categorias:
    'Renombrar cambia sólo el nombre visible: la clave interna (slug), que usa la importación, no cambia. Una categoría con productos o atributos no se elimina.',
} as const

/** trim + espacios internos colapsados, igual que la base. No cambia mayúsculas ni acentos. */
export function normalizarNombre(v: string): string {
  return v.trim().replace(/\s+/g, ' ')
}

export function claveNombre(v: string): string {
  return normalizarNombre(v).toLocaleLowerCase('es')
}

export function validarNombre(v: string): string | null {
  const n = normalizarNombre(v)
  if (!n) return 'Escribí un nombre.'
  if (n.length > NOMBRE_MAX) return `Máximo ${NOMBRE_MAX} caracteres.`
  return null
}

/** Otro elemento con el mismo nombre (sin distinguir mayúsculas ni espacios). */
export function buscarDuplicado<T extends { id: string; nombre: string }>(lista: readonly T[], nombre: string, excluirId?: string): T | null {
  const clave = claveNombre(nombre)
  if (!clave) return null
  return lista.find((x) => x.id !== excluirId && claveNombre(x.nombre) === clave) ?? null
}

export function contiene(texto: string, busqueda: string): boolean {
  const b = claveNombre(busqueda)
  return !b || claveNombre(texto).includes(b)
}

export type FiltroEstado = 'todas' | 'activas' | 'inactivas'

export function filtrarMarcas(lista: readonly Marca[], busqueda: string, estado: FiltroEstado): Marca[] {
  return lista.filter((m) => contiene(m.nombre, busqueda) && (estado === 'todas' || (estado === 'activas') === m.activa))
}

export function filtrarCategorias(lista: readonly Categoria[], busqueda: string): Categoria[] {
  return lista.filter((c) => contiene(c.nombre, busqueda) || contiene(c.slug, busqueda))
}

export function filtrarAtributos(lista: readonly Atributo[], busqueda: string): Atributo[] {
  return lista.filter((a) => contiene(a.etiqueta, busqueda) || contiene(a.clave, busqueda) || a.categorias.some((c) => contiene(c, busqueda)))
}

export interface Permiso {
  ok: boolean
  motivo: string | null
}

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-AR')} ${n === 1 ? uno : varios}`

export function puedeEliminarMarca(m: Pick<Marca, 'productos' | 'equipos'>): Permiso {
  if (m.productos > 0) return { ok: false, motivo: `Tiene ${plural(m.productos, 'producto', 'productos')}: se desactiva, no se elimina.` }
  if (m.equipos > 0) return { ok: false, motivo: `La usan ${plural(m.equipos, 'equipo', 'equipos')} de mantenimiento.` }
  return { ok: true, motivo: null }
}

export function puedeEliminarCategoria(c: Pick<Categoria, 'productos' | 'atributos' | 'subcategorias'>): Permiso {
  if (c.productos > 0) return { ok: false, motivo: `Tiene ${plural(c.productos, 'producto', 'productos')}.` }
  if (c.atributos > 0) return { ok: false, motivo: `Tiene ${plural(c.atributos, 'atributo vinculado', 'atributos vinculados')}.` }
  if (c.subcategorias > 0) return { ok: false, motivo: `Tiene ${plural(c.subcategorias, 'subcategoría', 'subcategorías')}.` }
  return { ok: true, motivo: null }
}

export function textoDesactivar(m: Pick<Marca, 'nombre' | 'productos'>): string {
  const base = `«${m.nombre}» deja de aparecer en los filtros del Catálogo.`
  return m.productos > 0
    ? `${base} Sus ${plural(m.productos, 'producto', 'productos')} la siguen teniendo como marca, y los documentos no cambian. Se puede reactivar.`
    : `${base} Se puede reactivar.`
}

const MENSAJES: Record<string, string> = {
  sin_permiso: 'Tu rol no puede hacer esta acción.',
  nombre_duplicado: 'Ya existe otra con ese nombre (sin distinguir mayúsculas ni espacios).',
  conflicto_version: 'Otra persona la modificó mientras la editabas. Cerrá el diálogo y volvé a intentar.',
  no_encontrado: 'Ya no existe: puede que otra persona la haya eliminado.',
  datos_invalidos: 'El dato no es válido.',
  campos_no_permitidos: 'La pantalla envió un dato que no se acepta.',
  sin_red: 'No hay conexión. Probá de nuevo.',
  desconocido: 'No se pudo completar la acción.',
}

/** Mensaje legible de un código de la base (`en_uso:<productos>:<...>` incluido). */
export function mensajeErrorMaestro(codigo: string): string {
  if (codigo.startsWith('en_uso')) {
    const [, a = '0', b = '0', c] = codigo.split(':')
    const productos = Number(a)
    if (c !== undefined) {
      return `No se puede eliminar: tiene ${plural(productos, 'producto', 'productos')}, ${plural(Number(b), 'atributo vinculado', 'atributos vinculados')} y ${plural(Number(c), 'subcategoría', 'subcategorías')}.`
    }
    return `No se puede eliminar: la usan ${plural(productos, 'producto', 'productos')} y ${plural(Number(b), 'equipo', 'equipos')}. Desactivala.`
  }
  const base = codigo.split(':')[0] ?? ''
  if (base === 'datos_invalidos' && codigo.endsWith(':name')) return `El nombre no es válido (1 a ${NOMBRE_MAX} caracteres).`
  return MENSAJES[base] ?? MENSAJES.desconocido!
}

export function presentarVigencia(v: Vigencia): { etiqueta: string; tono: 'ok' | 'alerta' | 'neutro' } {
  if (v === 'futura') return { etiqueta: 'Futura', tono: 'alerta' }
  if (v === 'vencida') return { etiqueta: 'Vencida', tono: 'neutro' }
  return { etiqueta: 'Vigente', tono: 'ok' }
}

export function normalizarVigencia(v: string): Vigencia {
  return v === 'futura' || v === 'vencida' ? v : 'vigente'
}

/** Importe con su moneda, sin convertir y sin redondear a 2 lo que tiene 4. */
export function formatearPrecio(importe: number, moneda: string): string {
  return `${moneda} ${importe.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

export function formatearFechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export function textoVigenciaLista(l: Pick<ListaPrecios, 'vigenciaDesde' | 'vigenciaHasta' | 'items'>): string {
  if (l.items === 0) return 'Sin precios'
  const desde = `desde ${formatearFechaCorta(l.vigenciaDesde)}`
  return l.vigenciaHasta ? `${desde} hasta ${formatearFechaCorta(l.vigenciaHasta)}` : `${desde}, sin fin`
}

const TIPOS: Record<string, string> = { text: 'Texto', number: 'Número', boolean: 'Sí / No' }
export function etiquetaTipoAtributo(t: string, unidad: string | null): string {
  const base = TIPOS[t] ?? t
  return unidad ? `${base} (${unidad})` : base
}

export const POR_PAGINA = 50

export function rangoPagina(desplazamiento: number, filas: number, total: number): string {
  if (total === 0) return '0 precios'
  return `${(desplazamiento + 1).toLocaleString('es-AR')}–${(desplazamiento + filas).toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}`
}
