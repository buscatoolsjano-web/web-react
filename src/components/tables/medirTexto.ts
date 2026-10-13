/**
 * Medir cuánto ocupa un texto, de verdad (Fase 66).
 *
 * POR QUÉ UN CANVAS Y NO CONTAR CARACTERES. En la tipografía del ERP una «i»
 * y una «W» no miden ni parecido: estimar por cantidad de letras da columnas
 * cortas de más para los nombres en mayúsculas —que es casi todo el
 * catálogo— y largas de más para el resto. `measureText` usa la fuente real y
 * cuesta microsegundos; cincuenta filas por ocho columnas se miden sin que se
 * note.
 *
 * El canvas NO se agrega al documento: `getContext('2d')` sobre un canvas
 * suelto alcanza para medir, y así no hay un elemento de más en el árbol.
 */

let lienzo: CanvasRenderingContext2D | null = null
let intentado = false

function contexto(): CanvasRenderingContext2D | null {
  if (intentado) return lienzo
  intentado = true
  try {
    lienzo = document.createElement('canvas').getContext('2d')
  } catch {
    // En jsdom no hay canvas de verdad. Medir es una mejora, no un requisito:
    // sin esto las columnas usan su ancho por omisión y la tabla anda igual.
    lienzo = null
  }
  return lienzo
}

/**
 * Un medidor con la tipografía de un elemento REAL de la tabla.
 *
 * Se lee del elemento y no de una constante porque la tabla usa dos tamaños
 * —el encabezado es más chico que las celdas— y porque un cambio de tipografía
 * en los tokens tiene que llegar acá solo. Una constante copiada es una que se
 * queda vieja y empieza a medir mal sin que nadie lo note.
 *
 * Devuelve `null` si no se puede medir, y entonces quien llama usa sus anchos
 * de siempre: una tabla no se queda sin dibujar porque no haya canvas.
 */
export function medidorDe(el: Element | null): ((texto: string) => number) | null {
  const ctx = contexto()
  if (!ctx || !el) return null

  const cs = getComputedStyle(el)
  const familia = cs.fontFamily
  const tamano = cs.fontSize
  if (!familia || !tamano) return null
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${tamano} / ${cs.lineHeight} ${familia}`

  const cache = new Map<string, number>()
  return (texto: string): number => {
    const ya = cache.get(texto)
    if (ya !== undefined) return ya
    // La caché importa: una columna de cincuenta filas suele tener diez
    // valores distintos («13 Nm» repetido), y en el catálogo se vuelve a medir
    // en cada página.
    const px = ctx.measureText(texto).width
    cache.set(texto, px)
    return px
  }
}
