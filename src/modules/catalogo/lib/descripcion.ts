/**
 * La descripción de un producto trae un link pegado al final.
 *
 * En la base, 104 de las 21.784 descripciones terminan así:
 *
 *   Balanceador industrial ... para herramientas livianas.
 *   \n<a href="https://www.buscatool.com/.../catalogo.pdf"><strong>Ver catálogo técnico (PDF)</strong></a>
 *
 * —un salto de línea real, después un `\n` LITERAL (barra invertida y ene, dos
 * caracteres), y después el ancla. React lo mostraba tal cual, así que en la
 * ficha de `IR.BMDS-2` se leía «\n<a href=...>» a la vista.
 *
 * El legacy ya resolvía esto en `_descSplitLink` (app.js:28648) y lo resolvía
 * bien: separaba el texto del link y **escapaba los dos** antes de
 * insertarlos. Nunca metía el HTML crudo en la página. Esto es el mismo
 * comportamiento, con la ventaja de que en React el escapado es el
 * comportamiento por omisión y no hay nada que recordar.
 *
 * Lo que NO se hace es quitar etiquetas a lo bruto: otras 70 descripciones
 * usan `<` como signo de menor —«<2.5 m», «<93%RH», «<+2°C»— y un limpiador
 * de tags se las comería. Por eso el reconocimiento es de UNA estructura
 * concreta al final del texto, no una pasada genérica de sanitizado.
 */

/** Sólo http y https salen como link. Nada de `javascript:` ni `data:`. */
const PROTOCOLO_SEGURO = /^https?:\/\//i

/**
 * La misma forma que reconocía el legacy: separador, ancla, y fin del texto.
 *
 * El separador admite el `\n` literal o un salto real, porque el dato tiene
 * los dos. El ancla tiene que ser lo ÚLTIMO: un `<a>` en el medio de un
 * párrafo sería otra cosa y se deja como texto.
 */
const ENLACE_AL_FINAL = /^([\s\S]*?)(?:\\n|\r?\n)\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*$/i

/** Las etiquetas de adentro del ancla —`<strong>`— se descartan. */
const ETIQUETAS = /<\/?[^>]+>/g

export type DescripcionPartida = {
  texto: string
  enlace: { url: string; etiqueta: string } | null
}

export function partirDescripcion(descripcion: string | null | undefined): DescripcionPartida {
  const crudo = String(descripcion ?? '')
  const m = ENLACE_AL_FINAL.exec(crudo)
  if (!m) return { texto: crudo.trim(), enlace: null }

  const url = (m[2] ?? '').trim()
  // Un href que no sea http(s) se descarta, pero el texto igual se limpia:
  // mostrar «\n<a href="javascript:...">» sería lo peor de los dos mundos.
  if (!PROTOCOLO_SEGURO.test(url)) return { texto: (m[1] ?? '').trim(), enlace: null }

  const etiqueta = (m[3] ?? '').replace(ETIQUETAS, '').trim()
  return {
    texto: (m[1] ?? '').trim(),
    enlace: { url, etiqueta: etiqueta || 'Ver más' },
  }
}
