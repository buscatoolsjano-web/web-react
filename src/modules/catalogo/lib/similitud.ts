import type { ColumnaComparable } from './familias'
import { columnasDe } from './familias'
import type { ProductoListado } from '../types'

/**
 * Comparar dos productos de la misma familia, campo por campo.
 *
 * Fase 22 · Etapa B. Lo delicado acá no es pintar verde o rojo: es **no pintar
 * rojo cuando no sabemos**. Decirle a alguien que dos productos difieren en el
 * largo porque uno dice «1.6 MTS» y el otro «1600 mm» es peor que no decir
 * nada, porque parece un dato.
 */

export type Veredicto = 'igual' | 'distinto' | 'sin-dato'

export interface CeldaComparada {
  clave: string
  etiqueta: string
  /** Lo que se muestra, siempre el valor original del producto. */
  texto: string
  /** `null` en las columnas de identidad: se muestran pero no se comparan. */
  veredicto: Veredicto | null
}

// ── Normalización ──────────────────────────────────────────────────────────

const FACTORES: Record<string, Record<string, number>> = {
  // a milímetros
  longitud: { mm: 1, cm: 10, m: 1000, mt: 1000, mts: 1000, metro: 1000, metros: 1000, '"': 25.4, in: 25.4, pulg: 25.4 },
  // a gramos
  masa: { g: 1, gr: 1, kg: 1000, kgs: 1000, k: 1000 },
  // a newton-metro
  torque: { nm: 1, 'n·m': 1, 'n.m': 1, ncm: 0.01, kgfm: 9.80665, 'kgf·m': 9.80665, lbfin: 0.112985, lbin: 0.112985 },
  // a rpm
  velocidad: { rpm: 1, 'min-1': 1, 'r/min': 1 },
}

/**
 * Un valor a su magnitud canónica, o `null` si no es una magnitud.
 *
 * «1.6 MTS», «1,6 m» y «1600 mm» dan los tres 1600. Un «1/4 HEX» da `null`:
 * es un encastre, no una medida, y forzarlo a número lo convertiría en 0,25.
 *
 * `unidadImplicita` es la de la COLUMNA, no la de la magnitud, y eso no es un
 * detalle: el `largo` de una punta está cargado en milímetros («200») y el
 * recorrido de un balanceador en metros («1.6»). Con un valor por magnitud,
 * ese 1,6 se leía como 1,6 mm y un recorrido idéntico salía en rojo.
 */
export function aCanonico(
  valor: unknown,
  magnitud: string | undefined,
  unidadImplicita?: string,
): number | null {
  if (!magnitud || valor === null || valor === undefined) return null
  const factores = FACTORES[magnitud]
  if (!factores) return null
  const t = comoTexto(valor).trim().toLowerCase().replace(',', '.')
  // Una fracción («1/4») nunca es una magnitud acá: es un encastre en pulgadas
  // nominales, que se compara como texto.
  if (t.includes('/') && !/^\d+(\.\d+)?\s*(r\/min)$/.test(t)) return null
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-z°·."']*)$/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const u = (m[2] || '').replace(/\s/g, '') || (unidadImplicita ?? '').toLowerCase()
  const f = factores[u]
  return f === undefined ? null : n * f
}

/**
 * Un valor cualquiera a texto, sin '[object Object]'.
 *
 * `attributes` es jsonb: puede traer un objeto anidado. Que aparezca como
 * '[object Object]' en una celda del comparador sería peor que no mostrarlo.
 */
export function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(comoTexto).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return typeof v === 'string' ? v : ''
}

/** Para comparar texto: sin acentos, sin separadores, en mayúsculas. */
export function aTextoComparable(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  const bruto = comoTexto(valor)
  return bruto
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s._-]+/g, '')
    .trim()
}

/** `true` cuando el producto no tiene ese dato. El 0 sí es un dato. */
export function sinDato(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'string') return v.trim() === '' || v.trim() === '—'
  return false
}

// ── Leer un valor del producto ─────────────────────────────────────────────

/** El valor crudo de una columna del comparador, mirando donde corresponda. */
export function valorDe(p: ProductoListado, col: ColumnaComparable): unknown {
  if (col.origen === 'columna') {
    if (col.clave === 'marca') return p.marca?.nombre ?? null
    if (col.clave === 'sku') return p.sku
    if (col.clave === 'tipo') return p.tipo
    if (col.clave === 'serie') return p.serie
    // Categoría sólo aparece al comparar a mano productos de familias
    // distintas (#42): ahí es lo que explica por qué las demás filas no
    // coinciden.
    if (col.clave === 'categoria') return p.categoria?.nombre ?? null
    return null
  }
  return p.atributos?.[col.clave] ?? null
}

/** Lo que se muestra: el valor original, con su unidad si la definición la da. */
export function textoDe(p: ProductoListado, col: ColumnaComparable): string {
  const v = valorDe(p, col)
  if (sinDato(v)) return '—'
  const bruto = comoTexto(v)
  // Si el valor ya trae la unidad escrita no se la duplica: «200 mm mm» no.
  if (!col.unidad || /[a-z]/i.test(bruto.replace(/^[\d.,\s/]+/, ''))) return bruto
  return `${bruto} ${col.unidad}`
}

// ── El veredicto ───────────────────────────────────────────────────────────

/**
 * Compara el valor del similar contra el del principal.
 *
 * Reglas, en orden:
 *
 *   1. si **cualquiera** de los dos no tiene el dato → `sin-dato`. Nunca rojo:
 *      no sabemos que difieren, sabemos que no sabemos (B10);
 *   2. si los dos son la misma magnitud → se comparan los números canónicos,
 *      así «1.6 MTS» y «1600 mm» coinciden (B9);
 *   3. si no, se comparan como texto normalizado — no fuzzy, no parecido:
 *      igual o distinto.
 */
export function compararValor(
  principal: ProductoListado,
  similar: ProductoListado,
  col: ColumnaComparable,
): Veredicto | null {
  /*
   * Una columna de identidad no se compara, y por eso devuelve `null` y no
   * `sin-dato`.
   *
   * Antes devolvía `sin-dato`, que en pantalla se lee «modelo sin datos para
   * comparar». Es falso: el modelo está ahí, escrito en la celda. Lo que pasa
   * es que compararlo no dice nada —dos productos distintos nunca comparten
   * modelo—, y eso no es lo mismo que no saber.
   *
   * `null` significa «esta fila no lleva veredicto»: la celda muestra el
   * valor y ningún símbolo.
   */
  if (col.identidad) return null
  const a = valorDe(principal, col)
  const b = valorDe(similar, col)
  if (sinDato(a) || sinDato(b)) return 'sin-dato'

  const ca = aCanonico(a, col.magnitud, col.unidad)
  const cb = aCanonico(b, col.magnitud, col.unidad)
  if (ca !== null && cb !== null) return ca === cb ? 'igual' : 'distinto'

  return aTextoComparable(a) === aTextoComparable(b) ? 'igual' : 'distinto'
}

/**
 * Una fila del comparador.
 *
 * `esPrincipal` no se compara contra sí mismo: pintar todo verde en la fila
 * del producto que uno está mirando no dice nada y compite visualmente con lo
 * que sí importa (B11).
 */
export function filaComparada(
  principal: ProductoListado,
  producto: ProductoListado,
  slugFamilia: string | null | undefined,
  esPrincipal: boolean,
): CeldaComparada[] {
  return columnasDe(slugFamilia).map((col) => ({
    clave: col.clave,
    etiqueta: col.etiqueta,
    texto: textoDe(producto, col),
    veredicto: esPrincipal ? ('sin-dato' as const) : compararValor(principal, producto, col),
  }))
}

// ── Orden de los similares ─────────────────────────────────────────────────

/**
 * Cercanía técnica, determinista y explicable.
 *
 * No hay porcentaje a la vista (B12): un «87 % de coincidencia» es un número
 * inventado que la gente cree. El score existe sólo para ordenar.
 *
 * Suma, por cada columna de la familia: 2 si coinciden, 0 si difieren, y 1 si
 * alguno no tiene el dato — «no sé» queda entre «sí» y «no», que es donde
 * está. Desempata el orden que ya trajo el servidor.
 */
export function cercania(
  principal: ProductoListado,
  similar: ProductoListado,
  slugFamilia: string | null | undefined,
): number {
  return columnasDe(slugFamilia).reduce((n, col) => {
    const v = compararValor(principal, similar, col)
    return n + (v === 'igual' ? 2 : v === 'sin-dato' ? 1 : 0)
  }, 0)
}
