import type { Column } from './types'

/**
 * El ancho de las columnas (Fase 58 · E6).
 *
 * EL PEDIDO. «Es importante que las columnas respeten su tamaño, porque si no
 * algunos quedan muy grandes y no va, o algunos quedan muy chicos y tampoco va.
 * Pero también quiero yo poder ir modificando el tamaño de las columnas, tipo
 * ir agarrando y ampliarlo, achicarlo».
 *
 * POR QUÉ NO LOS RESPETABA. La tabla no declaraba `table-layout`, así que valía
 * el `auto` del navegador: ahí el `width` de una columna es una SUGERENCIA que
 * se ignora en cuanto el contenido es más ancho. Una celda con un nombre largo
 * se comía el espacio de las demás. Con `table-layout: fixed` los anchos se
 * cumplen exactamente, y el texto que no entra se corta con puntos suspensivos
 * en vez de empujar al resto.
 *
 * `fixed` SE ACTIVA SÓLO en las tablas que piden anchos ajustables. Hay unas
 * cuarenta tablas en la app y la mayoría anda bien con el `auto`: cambiárselo a
 * todas de una vez sería mover algo que nadie pidió mover.
 *
 * LOS ANCHOS SON DE CADA PERSONA Y DE SU NAVEGADOR. Van a `localStorage` y no a
 * la base: es una preferencia de cómo se mira una tabla, no un dato de la
 * empresa, y no tiene por qué viajar a São Paulo ni imponerse a los demás.
 */

/** Lo más angosto que puede quedar una columna sin dejar de ser legible. */
export const MIN_PX = 56
/** Lo más ancho, para que una columna no empuje a todas las demás fuera. */
export const MAX_PX = 720

/** Ancho por tipo de dato cuando la columna no declara uno. */
const POR_TIPO: Record<NonNullable<Column<unknown>['tipo']>, number> = {
  // Lo que ocupa una fecha corta («05/10/2026») más el aire de la celda.
  fecha: 112,
  // Un importe de seis cifras con separadores.
  numero: 128,
  // Un chip de estado: «Invitación pendiente» es el más largo que hay.
  estado: 160,
  // Una referencia o un número de documento.
  codigo: 144,
  texto: 220,
}

/** El ancho de arranque de una columna, en píxeles. */
export function anchoInicial(c: Column<unknown>): number {
  // Un `width` declarado en px manda: la página ya decidió.
  const enPx = /^(\d+(?:\.\d+)?)px$/.exec((c.width ?? '').trim())
  if (enPx) return acotar(Number(enPx[1]))

  if (c.tipo) return POR_TIPO[c.tipo]

  /*
   * Sin tipo, la alineación es la pista que hay: una columna alineada a la
   * derecha es un número en la práctica totalidad de los casos. No es una
   * adivinanza elegante, pero da un ancho mejor que repartir todo en partes
   * iguales, que es lo que hace `fixed` sin anchos.
   */
  if (c.align === 'right') return POR_TIPO.numero
  if (c.align === 'center') return POR_TIPO.estado
  return POR_TIPO.texto
}

export function acotar(px: number): number {
  if (!Number.isFinite(px)) return POR_TIPO.texto
  return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(px)))
}

/**
 * Aplica un arrastre: el ancho de `clave` pasa a ser el que tenía más el
 * desplazamiento del mouse, acotado.
 *
 * Sólo toca la columna arrastrada. Repartir la diferencia entre las vecinas
 * haría que agarrar un borde moviera dos columnas, y con `fixed` la tabla
 * simplemente se ensancha y aparece el scroll horizontal que ya existe.
 */
export function aplicarArrastre(
  anchos: Readonly<Record<string, number>>,
  clave: string,
  anchoAlEmpezar: number,
  deltaPx: number,
): Record<string, number> {
  return { ...anchos, [clave]: acotar(anchoAlEmpezar + deltaPx) }
}

/**
 * Los anchos de todas las columnas, mezclando lo guardado con los iniciales.
 *
 * Una clave guardada que ya no existe se descarta, y una columna nueva estrena
 * su ancho inicial: así cambiar las columnas de una pantalla no deja la tabla
 * con huecos ni con anchos de una columna que se fue.
 */
export function anchosDe(
  columnas: readonly Column<unknown>[],
  guardados: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of columnas) {
    const g = guardados[c.key]
    out[c.key] = g !== undefined ? acotar(g) : anchoInicial(c)
  }
  return out
}

// ── Lo guardado en el navegador ─────────────────────────────────────────────

const PREFIJO = 'buscatools.anchos.'

/**
 * Lee los anchos guardados.
 *
 * Todo envuelto en try/catch y devolviendo `{}` ante cualquier cosa rara: en
 * una ventana privada, con las cookies del sitio bloqueadas o con el
 * almacenamiento lleno, `localStorage` tira una excepción al leer. Una tabla no
 * se puede quedar sin dibujar porque no se pudo recordar un ancho.
 */
export function leerAnchos(id: string): Record<string, number> {
  try {
    const crudo = localStorage.getItem(PREFIJO + id)
    if (!crudo) return {}
    const datos: unknown = JSON.parse(crudo)
    if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(datos as Record<string, unknown>)) {
      // Se valida cada valor: lo guardado lo pudo editar cualquiera a mano, y
      // un `width: "borrado"` dejaría la tabla sin columnas.
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = acotar(v)
    }
    return out
  } catch {
    return {}
  }
}

export function guardarAnchos(id: string, anchos: Readonly<Record<string, number>>): void {
  try {
    localStorage.setItem(PREFIJO + id, JSON.stringify(anchos))
  } catch {
    // Sin guardar: los anchos valen para esta sesión y se vuelven a los
    // iniciales al recargar. Peor sería romper el arrastre.
  }
}

export function olvidarAnchos(id: string): void {
  try {
    localStorage.removeItem(PREFIJO + id)
  } catch {
    /* ídem */
  }
}
