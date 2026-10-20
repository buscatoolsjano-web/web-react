/**
 * La voz de Cata, con `speechSynthesis` (Fase 85).
 *
 * ── POR QUÉ ÉSTA Y NO UNA COMPRADA ──────────────────────────────────────────
 *
 * Porque es gratis y ya está instalada. «Por ahora que sea todo gratis»: una
 * voz de las buenas —ElevenLabs, OpenAI TTS— se paga por carácter dicho, y
 * para saber si una llamada sirve no hace falta que la voz sea linda, hace
 * falta que hable. `speechSynthesis` viene en el navegador, no pide clave y no
 * manda el texto a ningún lado.
 *
 * Suena a robot, y se nota. Cambiarla después es cambiar este archivo solo:
 * nada de lo que está arriba sabe cómo se produce el sonido.
 */

/** Lo único que nos interesa de una voz del sistema. */
export interface VozPosible {
  name: string
  lang: string
}

/**
 * Qué voz usar, de las que tenga la máquina.
 *
 * El orden no es capricho. El castellano de España dice «vosotros tenéis» con
 * la zeta, y para alguien de acá eso no suena como alguien de la empresa: hace
 * ruido antes de que se entienda lo que dijo. Así que primero Argentina,
 * después cualquier latinoamericana, y España sólo si no hay otra.
 *
 * Es puro para poder probarlo: la lista de voces de cada máquina es distinta y
 * no hay forma de verlas todas a mano.
 */
export function elegirVoz(voces: readonly VozPosible[]): VozPosible | null {
  const enCastellano = voces.filter((v) => v.lang.toLowerCase().startsWith('es'))
  if (enCastellano.length === 0) return null

  const porPrefijo = (prefijos: readonly string[]): VozPosible | undefined =>
    enCastellano.find((v) => prefijos.some((p) => v.lang.toLowerCase().startsWith(p)))

  return (
    porPrefijo(['es-ar']) ??
    // `es-419` es «español de Latinoamérica» y es lo que suelen traer Chrome y
    // Android cuando no hay una argentina.
    porPrefijo(['es-419', 'es-us', 'es-mx', 'es-cl', 'es-uy', 'es-co', 'es-pe']) ??
    enCastellano.find((v) => !v.lang.toLowerCase().startsWith('es-es')) ??
    enCastellano[0] ??
    null
  )
}

/** Si esta máquina puede hablar. */
export function hayVoz(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Decir algo en voz alta. Resuelve cuando terminó de decirlo.
 *
 * ── LAS DOS TRAMPAS ─────────────────────────────────────────────────────────
 *
 * 1. `getVoices()` devuelve vacío la primera vez: las voces se cargan solas y
 *    avisan con `voiceschanged`. Si se pide la voz antes de eso, habla con la
 *    del sistema, que puede estar en inglés leyendo castellano. Por eso se
 *    espera el evento una vez.
 *
 * 2. `onend` no siempre llega. Si la pestaña se oculta, o si el texto es muy
 *    largo, Chrome a veces no dispara nada, y la promesa quedaría colgada para
 *    siempre: la llamada se quedaría en «hablando» y no volvería a escuchar
 *    nunca. El reloj de seguridad la resuelve igual. Está calculado sobre el
 *    largo del texto porque un corte a los cinco segundos partiría al medio
 *    una respuesta larga.
 */
export async function decir(texto: string): Promise<void> {
  if (!hayVoz() || texto.trim() === '') return

  const sintesis = window.speechSynthesis
  // Lo que estuviera diciendo ya no importa: lo nuevo lo reemplaza. Sin esto
  // las respuestas se encolan y se escucha la anterior antes de la de ahora.
  sintesis.cancel()

  const voces = await vocesListas(sintesis)
  const elegida = elegirVoz(voces.map((v) => ({ name: v.name, lang: v.lang })))

  const frase = new SpeechSynthesisUtterance(texto)
  frase.lang = 'es-AR'
  /*
   * Un poco más rápido que el habla normal.
   *
   * «Cuando habla tarda bastante.» Lo que más pesa ahí es cuánto dice —eso se
   * arregla en el prompt—, pero el ritmo también: la voz del sistema lee
   * parejo y más lento que una persona contándote algo, y encima no hace las
   * pausas que uno hace. A 1,15 suena a alguien apurado pero se entiende; más
   * arriba se empastan los SKU, que es justo lo que hay que poder anotar.
   */
  frase.rate = 1.15
  const voz = voces.find((v) => v.name === elegida?.name)
  if (voz) frase.voice = voz

  await new Promise<void>((listo) => {
    let cerrado = false
    const cerrar = () => {
      if (cerrado) return
      cerrado = true
      clearTimeout(reloj)
      listo()
    }
    // ~15 caracteres por segundo es el ritmo de `rate: 1.15`, medido con el
    // saludo. Más cinco segundos de colchón para el arranque.
    const reloj = setTimeout(cerrar, 5_000 + (texto.length / 15) * 1_000)
    frase.onend = cerrar
    frase.onerror = cerrar
    sintesis.speak(frase)
  })
}

/** Callar en el acto. Es lo que tiene que pasar al colgar. */
export function callar(): void {
  if (hayVoz()) window.speechSynthesis.cancel()
}

/**
 * Las voces, esperando a que el navegador las cargue si hace falta.
 *
 * Con un corte de medio segundo: si el evento no llega —pasa en algún
 * navegador—, mejor hablar con la voz que haya que no hablar.
 */
function vocesListas(sintesis: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const ya = sintesis.getVoices()
  if (ya.length > 0) return Promise.resolve(ya)

  return new Promise((listo) => {
    const terminar = () => {
      sintesis.removeEventListener('voiceschanged', terminar)
      clearTimeout(reloj)
      listo(sintesis.getVoices())
    }
    const reloj = setTimeout(terminar, 500)
    sintesis.addEventListener('voiceschanged', terminar)
  })
}
