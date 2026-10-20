/**
 * Lo escrito pasado a lo dicho (Fase 85). PURO.
 *
 * El prompt de Cata ya le pide que no escriba asteriscos ni listas, y casi
 * siempre obedece. Casi. Cuando no, `speechSynthesis` lo lee literal:
 * «asterisco asterisco V P P H» —los lectores de voz no saltean los símbolos,
 * los pronuncian—. Esto es la red abajo del prompt, y existe porque un prompt
 * es una pedido y no una garantía.
 *
 * No traduce ni reescribe: saca los símbolos que no se dicen y pone los puntos
 * que hacen que la voz respire. Lo que se MUESTRA en la pantalla es el texto
 * original, con sus asteriscos si los tiene: esto es sólo lo que se dice.
 */

/**
 * El texto listo para decir en voz alta.
 *
 * El orden importa: primero se van los bloques de código —que pueden tener
 * cualquier cosa adentro—, después los símbolos de resalte, y recién al final
 * se arreglan los espacios, para no dejar los huecos de lo que se quitó.
 */
export function textoParaDecir(texto: string): string {
  return (
    texto
      // Un bloque de código no se dice. Si quedó uno, es un listado y lo que
      // hay que decir es que hay un listado, no el listado.
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      // Los resaltes: el texto se queda, los asteriscos se van. `**SKU**` es
      // lo que `PROMPT_COMUN` le enseñó a escribir, así que aparece seguido.
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Un enlace en markdown: se dice el texto, no la dirección.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Las viñetas y los títulos de principio de línea. El punto es para que
      // la voz haga la pausa que el renglón hacía en la pantalla: sin él,
      // tres renglones se dicen como una sola frase interminable.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*[-*•][ \t]+/gm, '')
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, '. ')
      // Y los espacios que dejó todo lo anterior, incluido el punto doble que
      // aparece cuando un renglón ya terminaba en punto.
      .replace(/\.\s*\./g, '.')
      .replace(/[ \t]{2,}/g, ' ')
      // Un punto suelto no es una pausa, es un ruido: queda cuando lo que se
      // quitó era todo el renglón —un bloque de código, una viñeta vacía— y
      // sólo sobrevivió el punto que marcaba el salto.
      .replace(/\s+\./g, '.')
      .replace(/^[.\s]+/, '')
      .trim()
  )
}

/**
 * Lo que se dice cuando el micrófono oyó algo que no se entiende.
 *
 * Está acá y no en el componente porque es texto que se DICE, y todo lo que se
 * dice se prueba.
 */
export const SALUDO =
  'Hola, soy Cata. Preguntame por cualquier producto del catálogo: si lo tenemos, a cuánto está y si hay stock.'

/** Lo que se dice al colgar. Corto: nadie espera a que termine. */
export const DESPEDIDA = 'Listo, cualquier cosa me llamás.'
