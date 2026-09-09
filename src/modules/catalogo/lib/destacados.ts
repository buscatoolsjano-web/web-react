/**
 * Claves que no aportan nada en una card y sólo ocupan lugar.
 *
 * `modelo` tiene 512 valores distintos sobre 513 productos: es prácticamente
 * un identificador. `sufijos` y las claves internas del importador son
 * metadatos, no características del producto.
 */
const OCULTAS = new Set([
  'modelo',
  'sufijos',
  'marca_disp',
  'categoria_full',
  'catalogo_id',
  'catalogo_pagina',
  'codigo',
  'longitud_raw',
])

/**
 * Uno o dos atributos para mostrar en la card mobile.
 *
 * No hay una lista de casos por categoría en el código. Se toman los
 * primeros atributos que el producto realmente tiene, en el orden en que
 * vienen del jsonb, que es el orden en que los cargó el importador desde el
 * legacy. Para un balanceador eso da medida y capacidad; para una punta,
 * encastre y largo.
 *
 * Si mañana se quiere otro orden, se cambia `position` en
 * `product_attribute_definitions`, que es dato y no código.
 */
export function atributosDestacados(
  atributos: Record<string, unknown>,
  cuantos: number,
): { key: string; valor: string }[] {
  const salida: { key: string; valor: string }[] = []

  for (const [key, bruto] of Object.entries(atributos)) {
    if (salida.length >= cuantos) break
    if (OCULTAS.has(key)) continue

    const valor = aTexto(bruto)
    // '-' es el marcador de ausencia del legacy; mostrarlo sería peor que
    // no mostrar nada.
    if (valor === null || valor === '' || valor === '-') continue

    salida.push({ key, valor })
  }

  return salida
}

function aTexto(v: unknown): string | null {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const partes = v.map(aTexto).filter((x): x is string => x !== null && x !== '')
    return partes.length > 0 ? partes.join(' · ') : null
  }
  return null
}
