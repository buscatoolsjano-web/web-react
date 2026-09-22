/**
 * El estado del informe vive en la URL (Fase 21 · E3).
 *
 * Antes sólo viajaba `?mes=`; la moneda, la métrica, la dimensión y el período
 * del ranking eran `useState`. Eso significa que un informe **no se podía
 * compartir**: mandar el link mandaba otra pantalla, recargar perdía lo que
 * uno estaba mirando y «atrás» salía de Informes en vez de deshacer el último
 * cambio. Un informe que no se puede pasar por chat no sirve para discutir un
 * número con alguien.
 *
 * Dos claves están RESERVADAS y no son filtros: `cliente` y `producto` abren
 * la ficha encima. Es la distinción que ya falló una vez en Catálogo, donde
 * `?producto=` se leía como filtro y el overlay se abría con la lista
 * filtrada debajo.
 */

export type VistaInformes = 'comercial' | 'stock'
export type MetricaInformes = 'cotizaciones' | 'pedidos' | 'entregas'
export type DimensionRanking = 'clientes' | 'productos'
export type MedidaRanking = 'importe' | 'cantidad'
export type PeriodoRanking = 'mes' | '12m'

export interface FiltrosInformes {
  vista: VistaInformes
  /** `YYYY-MM`, o `null` = mes en curso. */
  mes: string | null
  /** El código de moneda, o `null` = la primera con datos. */
  moneda: string | null
  /** Qué se está midiendo: es lo que define el universo de la pantalla. */
  metrica: MetricaInformes
  estado: string | null
  serie: string | null
  origen: string | null
  dimension: DimensionRanking
  medida: MedidaRanking
  periodo: PeriodoRanking
  /** Página de la sección Documentos, base 1. */
  pagina: number
}

export const FILTROS_INFORMES_INICIALES: FiltrosInformes = {
  vista: 'comercial',
  mes: null,
  moneda: null,
  metrica: 'cotizaciones',
  estado: null,
  serie: null,
  origen: null,
  dimension: 'clientes',
  medida: 'importe',
  periodo: 'mes',
  pagina: 1,
}

/**
 * Las claves que NO son filtros.
 *
 * Están acá y no sueltas en un componente porque el contrato es de la URL
 * entera: `escribirFiltros` no las toca nunca, así que cerrar un drawer o
 * cambiar un filtro con la ficha abierta no se pisan entre sí.
 */
export const CLAVES_OVERLAY = ['cliente', 'producto'] as const
export type ClaveOverlay = (typeof CLAVES_OVERLAY)[number]

const VISTAS: VistaInformes[] = ['comercial', 'stock']
const METRICAS: MetricaInformes[] = ['cotizaciones', 'pedidos', 'entregas']
const DIMENSIONES: DimensionRanking[] = ['clientes', 'productos']
const MEDIDAS: MedidaRanking[] = ['importe', 'cantidad']
const PERIODOS: PeriodoRanking[] = ['mes', '12m']

const unoDe = <T extends string>(v: string | null, opciones: T[], porDefecto: T): T =>
  v !== null && (opciones as string[]).includes(v) ? (v as T) : porDefecto

/** `YYYY-MM` o `null`. Cualquier otra cosa es «sin mes», no un error. */
export function leerMesInforme(v: string | null): string | null {
  return v !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null
}

/** Texto libre acotado: una moneda o una serie no tienen 200 caracteres. */
const texto = (v: string | null): string | null => {
  const t = (v ?? '').trim()
  return t === '' || t.length > 40 ? null : t
}

export function leerFiltrosInformes(p: URLSearchParams): FiltrosInformes {
  const pagina = Number(p.get('pagina'))
  return {
    vista: unoDe(p.get('vista'), VISTAS, 'comercial'),
    mes: leerMesInforme(p.get('mes')),
    moneda: texto(p.get('moneda')),
    metrica: unoDe(p.get('metrica'), METRICAS, 'cotizaciones'),
    estado: texto(p.get('estado')),
    serie: texto(p.get('serie')),
    origen: texto(p.get('origen')),
    dimension: unoDe(p.get('dimension'), DIMENSIONES, 'clientes'),
    medida: unoDe(p.get('medida'), MEDIDAS, 'importe'),
    periodo: unoDe(p.get('periodo'), PERIODOS, 'mes'),
    pagina: Number.isInteger(pagina) && pagina >= 1 && pagina <= 9999 ? pagina : 1,
  }
}

/**
 * Los filtros a la URL, sin escribir lo que ya es el valor por defecto.
 *
 * Una URL con once parámetros que dicen lo mismo que ninguno es ilegible y no
 * se puede leer de un vistazo para saber qué se está mirando.
 *
 * `previos` conserva TODO lo que no es filtro —empezando por `cliente` y
 * `producto`—, que es lo que hace que cambiar de moneda con la ficha abierta
 * no la cierre, y que cerrarla no pierda los filtros.
 */
export function escribirFiltrosInformes(f: FiltrosInformes, previos?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(previos ?? undefined)
  const poner = (k: string, v: string | null, def: string | null) => {
    if (v === null || v === def) p.delete(k)
    else p.set(k, v)
  }
  poner('vista', f.vista, 'comercial')
  poner('mes', f.mes, null)
  poner('moneda', f.moneda, null)
  poner('metrica', f.metrica, 'cotizaciones')
  poner('estado', f.estado, null)
  poner('serie', f.serie, null)
  poner('origen', f.origen, null)
  poner('dimension', f.dimension, 'clientes')
  poner('medida', f.medida, 'importe')
  poner('periodo', f.periodo, 'mes')
  poner('pagina', f.pagina > 1 ? String(f.pagina) : null, null)
  return p
}

/**
 * Qué ficha está abierta encima, si hay alguna.
 *
 * Se lee aparte de los filtros a propósito: son dos cosas con vidas
 * distintas. Los filtros dicen qué informe se está mirando; el overlay, qué
 * se abrió encima sin dejar de mirarlo.
 */
export function leerOverlay(p: URLSearchParams): { tipo: ClaveOverlay; id: string } | null {
  for (const k of CLAVES_OVERLAY) {
    const v = p.get(k)
    if (v && v.trim() !== '') return { tipo: k, id: v }
  }
  return null
}

/** Abre una ficha sin tocar ningún filtro. */
export function abrirOverlay(p: URLSearchParams, tipo: ClaveOverlay, id: string): URLSearchParams {
  const n = new URLSearchParams(p)
  for (const k of CLAVES_OVERLAY) n.delete(k)
  n.set(tipo, id)
  return n
}

/** Cierra la ficha y **conserva todo el resto de la URL** (§2). */
export function cerrarOverlay(p: URLSearchParams): URLSearchParams {
  const n = new URLSearchParams(p)
  for (const k of CLAVES_OVERLAY) n.delete(k)
  return n
}

/**
 * Los filtros que el usuario puso a mano, para poder ofrecer «limpiar».
 *
 * `metrica`, `dimension`, `medida` y `periodo` no cuentan: siempre valen algo
 * y no son un filtro que se pueda sacar.
 */
export function filtrosActivos(f: FiltrosInformes): number {
  return [f.moneda, f.estado, f.serie, f.origen].filter((v) => v !== null).length
}
