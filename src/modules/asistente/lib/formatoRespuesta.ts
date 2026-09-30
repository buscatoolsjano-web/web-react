/**
 * Lo poco de markdown que usa el asistente (Fase 31 · E4).
 *
 * El modelo escribe `**así**` para resaltar, y sin esto se ven los asteriscos
 * en pantalla. La tentación es meter una librería de markdown; no hace falta y
 * además traería HTML arbitrario del modelo a la página.
 *
 * Esto sólo entiende negritas y devuelve PEDAZOS, no HTML: quien lo usa arma
 * elementos de React con ellos, así que no hay forma de que el texto del
 * modelo inyecte nada. Es la diferencia entre resaltar una palabra y darle al
 * modelo permiso de escribir en el DOM.
 */

export interface Pedazo {
  texto: string
  negrita: boolean
}

/**
 * Parte un texto en pedazos normales y en negrita.
 *
 * Los asteriscos sin cerrar se dejan COMO TEXTO en vez de adivinar dónde
 * terminaba: un modelo que escribe `**` de más no puede hacer que media
 * respuesta cambie de aspecto.
 */
export function pedazos(texto: string): Pedazo[] {
  const salida: Pedazo[] = []
  let resto = texto

  while (resto.length > 0) {
    const abre = resto.indexOf('**')
    if (abre === -1) break

    const cierra = resto.indexOf('**', abre + 2)
    if (cierra === -1) break

    // Lo de antes, tal cual; lo de adentro, en negrita.
    if (abre > 0) salida.push({ texto: resto.slice(0, abre), negrita: false })
    const adentro = resto.slice(abre + 2, cierra)
    // `****` no resalta nada: se deja como texto para no comerse caracteres.
    if (adentro === '') salida.push({ texto: '****', negrita: false })
    else salida.push({ texto: adentro, negrita: true })
    resto = resto.slice(cierra + 2)
  }

  if (resto.length > 0) salida.push({ texto: resto, negrita: false })
  return salida.length > 0 ? salida : [{ texto, negrita: false }]
}
