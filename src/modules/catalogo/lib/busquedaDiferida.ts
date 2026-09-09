/**
 * ¿Hay que volcar el texto del buscador a la URL?
 *
 * Vive acá y no dentro del componente para poder testearlo. El bug que
 * motivó esta función se escapó dos veces por no tener una prueba.
 *
 * El buscador mantiene tres valores que no siempre coinciden:
 *
 *   textoInput     lo que la persona escribió, al instante
 *   textoDiferido  lo mismo, 300 ms después (para no consultar por tecla)
 *   qEnUrl         lo que dice la URL, que es la fuente de verdad
 *
 * La trampa: cuando la URL cambia POR FUERA —un link con `?q=`, o los
 * botones atrás/adelante— el input se sincroniza en el acto pero el valor
 * diferido sigue con el anterior durante 300 ms. Si en esa ventana se
 * propaga el diferido, se pisa la URL con el valor viejo y la búsqueda
 * desaparece.
 *
 * Por eso la primera condición: sólo se propaga cuando el debounce YA
 * alcanzó al input. Mientras van desfasados, el diferido no representa
 * ninguna intención de la persona.
 */
export function debePropagarBusqueda(
  textoInput: string,
  textoDiferido: string,
  qEnUrl: string,
): boolean {
  // El debounce todavía no alcanzó: el valor diferido es viejo.
  if (textoDiferido !== textoInput) return false

  // Ya alcanzó. Se propaga sólo si difiere de lo que dice la URL.
  return textoDiferido.trim() !== qEnUrl
}
