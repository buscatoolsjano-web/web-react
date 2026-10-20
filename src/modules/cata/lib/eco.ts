/**
 * Distinguir a Cata de quien la llama (Fase 85). PURO.
 *
 * ── EL PROBLEMA ─────────────────────────────────────────────────────────────
 *
 * El micrófono oye el parlante. Cata saludó —«preguntame por cualquier
 * producto del catálogo: si lo tenemos, a cuánto está y si hay stock»— y el
 * reconocedor lo transcribió como si lo hubiera dicho la persona, pegado a lo
 * que la persona sí dijo:
 *
 *   «Pregúntame por cualquier producto Del catálogo si lo tenemos A cuánto
 *    está ese ariestón»
 *
 * Y Cata se contestó a sí misma.
 *
 * ── POR QUÉ NO ALCANZA CON CERRAR EL MICRÓFONO ──────────────────────────────
 *
 * Porque se pidió lo contrario: «si yo hablo mientras ella está hablando, la
 * quiero interrumpir». Interrumpir exige el micrófono ABIERTO justo cuando
 * suena el parlante, que es exactamente cuando entra el eco. Las dos cosas no
 * se pueden tener cerrando el micrófono; hay que saber distinguir.
 *
 * La cancelación de eco del navegador no sirve acá: la API de voz no deja
 * elegir el flujo de audio, y con parlantes abiertos —no auriculares— el eco
 * llega igual, como se vio.
 *
 * ── CÓMO SE DISTINGUE ───────────────────────────────────────────────────────
 *
 * Comparando contra lo que Cata está diciendo en ese momento, que lo sabemos
 * porque se lo acabamos de mandar al sintetizador. Si lo que se oyó son
 * palabras que están EN ESE TEXTO y en ese orden, es el parlante.
 *
 * Se compara por palabras y no por la frase entera porque la transcripción
 * nunca vuelve igual: cambia las mayúsculas, se come la puntuación, parte
 * «preguntame» en «pregúntame» y se saltea pedazos. Lo que sí conserva es el
 * orden.
 */

/**
 * Sin acentos, sin puntuación y en minúscula: así vuelve la transcripción.
 *
 * El punto y la barra se conservan ADENTRO de una palabra, porque ahí son
 * parte del dato —«SP.PH2», «3/8»— y no puntuación. Al borde sí se van: con
 * «Cata.» pegado al punto final de la frase, la palabra no coincidía con
 * «Cata» y el eco se cortaba justo ahí.
 */
function palabras(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9/.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^[./]+|[./]+$/g, ''))
    .filter((p) => p !== '')
}

/**
 * Lo que queda de lo oído después de sacarle el eco.
 *
 * Sirve para el caso mezclado: el reconocedor manda el saludo y la pregunta
 * pegados, y tirar la frase entera sería tirar la pregunta. Se saca el prefijo
 * que coincide con el parlante y se devuelve lo demás.
 *
 * Sólo el PREFIJO, no las palabras sueltas del medio: la persona empieza a
 * hablar cuando Cata ya arrancó, así que el eco está al principio y lo suyo
 * viene después. Sacar coincidencias sueltas del medio destrozaría una
 * pregunta que casualmente repita una palabra —«¿y del catálogo de Ingersoll?»
 * perdería «del catálogo»—.
 */
export function sinEco(oido: string, dicho: string): string {
  const a = oido.split(/\s+/).filter((p) => p !== '')
  const b = palabras(dicho)
  if (a.length === 0 || b.length === 0) return oido

  let i = 0
  let corte = 0
  for (let k = 0; k < a.length; k += 1) {
    const p = palabras(a[k] ?? '')[0]
    if (p === undefined) continue
    const donde = b.indexOf(p, i)
    if (donde === -1) break
    i = donde + 1
    corte = k + 1
  }
  return a.slice(corte).join(' ')
}

/**
 * Cuántas palabras tiene que sobrar para que cuente como que alguien habló.
 *
 * Una sola palabra suelta que no estaba en el parlante es casi siempre un
 * error de transcripción del propio eco —«si» por «sí», un artículo de más—,
 * no alguien interrumpiendo. Dos ya es una intención.
 */
const MINIMO_PARA_SER_ALGUIEN = 2

/**
 * Y cuántas tiene que haber coincidido para creer que eso era el parlante.
 *
 * Sin este piso, una interrupción que ARRANQUE con una palabra que Cata
 * acababa de decir perdería esa palabra: «doce dólares, carísimo» quedaría en
 * «carísimo» y de ahí en nada. Tres palabras seguidas y en orden ya no son
 * casualidad.
 */
const MINIMO_PARA_SER_ECO = 3

const cuantas = (t: string): number => t.split(/\s+/).filter((p) => p !== '').length

/**
 * Lo que de verdad dijo la persona, de todo lo que entró por el micrófono
 * mientras Cata hablaba. Vacío si no dijo nada: era todo eco.
 */
export function loQueDijoLaPersona(oido: string, dicho: string): string {
  if (dicho.trim() === '') return oido

  const resto = sinEco(oido, dicho)
  // Coincidió poco: no era el parlante, era casualidad. Se devuelve entero.
  if (cuantas(oido) - cuantas(resto) < MINIMO_PARA_SER_ECO) return oido
  // Casi todo coincidió y lo que sobra no alcanza para ser una frase: era
  // eco, con alguna palabra suelta mal transcripta.
  if (cuantas(resto) < MINIMO_PARA_SER_ALGUIEN) return ''
  return resto
}
