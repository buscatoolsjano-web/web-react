/**
 * Sacar del texto lo que la tarjeta de abajo ya muestra (Fase 69). PURO.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 *
 * «¿Qué hay de ph1?» devolvía veintinueve renglones de «SKU — nombre. Precio.
 * Disponible: N», escribiéndose de a poco en pantalla, y DEBAJO las mismas
 * veintinueve como tarjetas con foto y botones. Dos veces lo mismo: hay que
 * leer la lista entera para después mirar las tarjetas igual, y la espera se
 * alarga por el solo hecho de escribir lo que ya estaba resuelto.
 *
 * ── Dónde se arregla de verdad, y por qué igual está esto ───────────────────
 *
 * Se arregla en el prompt: ahí se le dice al modelo que la pantalla dibuja las
 * tarjetas y que no las enumere. Eso es lo que hace que la respuesta NAZCA
 * corta, y es lo único que acorta la espera —lo que no se escribe no se paga—.
 *
 * Pero un prompt es una instrucción, no una garantía: algún modelo, algún día,
 * va a enumerar igual. Esto es la red abajo. Saca sólo RENGLONES DE LISTA que
 * nombran algo que ya tiene tarjeta; no toca prosa, no toca renglones que
 * hablan de otra cosa, y si no reconoce nada no cambia nada.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No se guarda podado: el hilo que se le manda al asistente en la pregunta
 * siguiente lleva el texto ENTERO. Si se guardara recortado, un «¿y el tercero
 * de la lista?» llegaría sin la lista. Esto es cómo se MUESTRA, no qué se dijo.
 */

/** Lo que ya tiene tarjeta, en lo poco que hace falta para reconocerlo. */
export interface LoQueYaSeVe {
  /** Los SKU de las tarjetas de producto. */
  skus: readonly string[]
  /** Los correos: alcanza con el remitente y el asunto. */
  correos: readonly { asunto: string; de: string | null }[]
}

/**
 * ¿Este renglón es un ítem de lista?
 *
 * Sólo se podan ítems. Una frase suelta que nombra un SKU —«el único con stock
 * es SP.VPPH1/70»— es un argumento, no una repetición, y sacarla dejaría la
 * respuesta sin su conclusión.
 */
const ES_ITEM = /^\s*(?:[-*•·]|\d{1,2}[.)])\s+/

/** Un asunto tan corto que podría aparecer de casualidad no sirve para reconocer. */
const MINIMO_ASUNTO = 10

const normalizar = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function podarDuplicados(texto: string, ya: LoQueYaSeVe): string {
  if (texto === '') return texto
  const skus = ya.skus.map((s) => s.toLowerCase()).filter((s) => s !== '')
  const marcas = ya.correos.flatMap((c) => {
    const m: string[] = []
    /* Sólo la dirección: el remitente llega como «"STEL Order"
       <no-reply@…>» y el modelo escribe la dirección sola. */
    const de = /[^\s<>"]+@[^\s<>"]+/.exec(normalizar(c.de ?? ''))?.[0]
    if (de) m.push(de)
    const asunto = normalizar(c.asunto)
    /* Del asunto alcanza el principio: el modelo lo corta, le agrega comillas
       o lo traduce de la mitad para adelante, pero el arranque lo copia. */
    if (asunto.length >= MINIMO_ASUNTO) m.push(asunto.slice(0, 30))
    return m
  })
  if (skus.length === 0 && marcas.length === 0) return texto

  const quedan = texto.split('\n').filter((linea) => {
    if (!ES_ITEM.test(linea)) return true
    const l = normalizar(linea)
    if (skus.some((s) => l.includes(s))) return false
    return !marcas.some((m) => l.includes(m))
  })

  /* Los renglones vacíos que quedaron sueltos se juntan: podar el medio de una
     lista deja tres saltos seguidos y un agujero en la burbuja. */
  return quedan
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
