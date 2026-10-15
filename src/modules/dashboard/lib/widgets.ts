/**
 * El inicio como una lista de widgets que cada uno acomoda (Fase 76). PURO.
 *
 * «Quiero que todos los módulos del inicio sean widgets modificables por
 * usuario, para que cada uno pueda agrandar, achicar, subir y bajar lo que
 * quiera.»
 *
 * Acá viven el vocabulario y las cuatro operaciones. Nada de React, nada de
 * red: una disposición es una LISTA ORDENADA, mover es cambiar de lugar y
 * redimensionar es cambiar una palabra. Que sea puro es lo que permite probar
 * las reglas que importan —que nada se pierda, que nada se duplique— sin
 * dibujar nada.
 */

/**
 * Los bloques que se pueden acomodar.
 *
 * El renglón del período NO está, y no es un olvido: es el marco —de qué mes
 * se habla y contra qué se compara— y sin él ni el gráfico ni los números de
 * abajo se leen bien. Un marco que se puede mandar al fondo deja de ser un
 * marco.
 */
export const WIDGETS = ['accesos', 'evolucion', 'kpis', 'atencion', 'miTrabajo', 'equipo', 'ultimos'] as const
export type ClaveWidget = (typeof WIDGETS)[number]

export const TAMANOS = ['chico', 'normal', 'grande'] as const
export type TamanoWidget = (typeof TAMANOS)[number]

export interface Widget {
  clave: ClaveWidget
  tamano: TamanoWidget
}

/** Cómo se nombra cada uno cuando hay que decir «subiste Accesos rápidos». */
export const ETIQUETA_WIDGET: Record<ClaveWidget, string> = {
  accesos: 'Accesos rápidos',
  evolucion: 'Evolución comercial',
  kpis: 'Situación del mes',
  atencion: 'Atención hoy',
  miTrabajo: 'Lo tuyo',
  equipo: 'Pendiente del resto',
  ultimos: 'Últimos documentos',
}

/**
 * El inicio que ve quien nunca tocó nada (Fase 76).
 *
 * DOS CAMBIOS PEDIDOS, Y LOS DOS SON SOBRE ESTE ORDEN:
 *
 *  · Los accesos rápidos estaban ABAJO DE TODO y ahora abren la pantalla.
 *    «Para que sea más accesible»: son los enlaces que se usan todos los días,
 *    y estaban después de seis bloques de análisis.
 *
 *  · El gráfico queda donde estaba —«está PERFECTO»— pero en `normal`, que es
 *    un escalón más chico que el alto con el que nació. Agrandarlo lo devuelve
 *    exactamente a como estaba.
 */
export const INICIO_POR_DEFECTO: readonly Widget[] = [
  { clave: 'accesos', tamano: 'normal' },
  { clave: 'evolucion', tamano: 'normal' },
  { clave: 'kpis', tamano: 'normal' },
  { clave: 'atencion', tamano: 'normal' },
  { clave: 'miTrabajo', tamano: 'normal' },
  { clave: 'equipo', tamano: 'normal' },
  { clave: 'ultimos', tamano: 'normal' },
]

const esClave = (v: unknown): v is ClaveWidget => (WIDGETS as readonly string[]).includes(v as string)
const esTamano = (v: unknown): v is TamanoWidget => (TAMANOS as readonly string[]).includes(v as string)

/**
 * Lo guardado, convertido en algo que se puede dibujar.
 *
 * Hace tres cosas, y las tres existen por un caso concreto:
 *
 *  1. DESCARTA lo que no reconoce —una clave de un widget que ya no existe, un
 *     tamaño inventado—. La base valida la forma pero no la lista de claves, a
 *     propósito: el que decide qué widgets hay es el código, no una migración.
 *
 *  2. NO REPITE. Dos entradas con la misma clave dibujarían el mismo bloque
 *     dos veces, cada uno con su botón de subir, y mover uno movería el otro.
 *
 *  3. AGREGA AL FINAL lo que falta. Es la regla que hace que esto siga
 *     funcionando dentro de un año: quien acomodó su inicio hoy y mañana el
 *     tablero gana un bloque nuevo, lo ve aparecer abajo. Sin esto, el widget
 *     nuevo sería invisible para todos los que ya habían guardado algo —el
 *     error clásico de este patrón, y el más difícil de notar, porque para
 *     quien lo programó se ve perfecto—.
 */
export function normalizarInicio(guardado: unknown, disponibles: readonly ClaveWidget[] = WIDGETS): Widget[] {
  const lista = leerLista(guardado)
  const vistas = new Set<ClaveWidget>()
  const salida: Widget[] = []

  for (const w of lista) {
    if (!disponibles.includes(w.clave) || vistas.has(w.clave)) continue
    vistas.add(w.clave)
    salida.push(w)
  }
  for (const w of INICIO_POR_DEFECTO) {
    if (disponibles.includes(w.clave) && !vistas.has(w.clave)) salida.push({ ...w })
  }
  return salida
}

function leerLista(guardado: unknown): Widget[] {
  if (typeof guardado !== 'object' || guardado === null) return []
  const o = guardado as Record<string, unknown>
  if (!Array.isArray(o['widgets'])) return []
  return (o['widgets'] as unknown[]).flatMap((x) => {
    if (typeof x !== 'object' || x === null) return []
    const w = x as Record<string, unknown>
    return esClave(w['clave']) && esTamano(w['tamano'])
      ? [{ clave: w['clave'], tamano: w['tamano'] }]
      : []
  })
}

/** Lo que se manda a guardar. La versión viaja para poder migrar sin adivinar. */
export function paraGuardar(widgets: readonly Widget[]): { version: number; widgets: Widget[] } {
  return { version: 1, widgets: widgets.map((w) => ({ clave: w.clave, tamano: w.tamano })) }
}

/**
 * Mover uno de lugar.
 *
 * `delta` es −1 para subir y 1 para bajar. En el borde no hace nada y no es un
 * error: el botón está deshabilitado, y si llegara igual, quedarse quieto es
 * mejor que dar la vuelta —nadie espera que subir el primero lo mande al final—.
 */
export function mover(widgets: readonly Widget[], clave: ClaveWidget, delta: -1 | 1): Widget[] {
  const i = widgets.findIndex((w) => w.clave === clave)
  const j = i + delta
  if (i === -1 || j < 0 || j >= widgets.length) return [...widgets]
  const copia = [...widgets]
  const [sacado] = copia.splice(i, 1)
  copia.splice(j, 0, sacado!)
  return copia
}

/**
 * Agrandar o achicar un escalón.
 *
 * Tres tamaños y no un número libre: lo que se pidió es «agrandar y achicar»,
 * y tres escalones se entienden sin explicación. Un ancho en píxeles habría
 * que explicarlo, y en una pantalla angosta no significaría nada.
 */
export function redimensionar(widgets: readonly Widget[], clave: ClaveWidget, delta: -1 | 1): Widget[] {
  return widgets.map((w) => {
    if (w.clave !== clave) return w
    const i = TAMANOS.indexOf(w.tamano) + delta
    if (i < 0 || i >= TAMANOS.length) return w
    return { ...w, tamano: TAMANOS[i]! }
  })
}

export const sePuedeSubir = (widgets: readonly Widget[], clave: ClaveWidget) =>
  widgets.findIndex((w) => w.clave === clave) > 0

export const sePuedeBajar = (widgets: readonly Widget[], clave: ClaveWidget) => {
  const i = widgets.findIndex((w) => w.clave === clave)
  return i !== -1 && i < widgets.length - 1
}

export const sePuedeAgrandar = (w: Widget) => w.tamano !== 'grande'
export const sePuedeAchicar = (w: Widget) => w.tamano !== 'chico'

/** ¿Está igual que el de fábrica? Decide si ofrecer «Restaurar». */
export function esElDeFabrica(widgets: readonly Widget[]): boolean {
  if (widgets.length !== INICIO_POR_DEFECTO.length) return false
  return widgets.every((w, i) => {
    const d = INICIO_POR_DEFECTO[i]!
    return w.clave === d.clave && w.tamano === d.tamano
  })
}
