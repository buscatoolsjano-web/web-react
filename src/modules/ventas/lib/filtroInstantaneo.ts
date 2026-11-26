import type { ProductoListado } from '@/modules/catalogo/types'

/** Para comparar sin mayúsculas ni tildes: «Tecna» = «TECNA», «inspección» = «inspeccion». */
function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Lo que ya está en pantalla, filtrado con lo que se acaba de escribir
 * (2026-11, «tendría que devolver resultados al instante»).
 *
 * Mientras viaja la búsqueda nueva, en vez de mostrar la lista de la búsqueda
 * anterior tal cual, se la filtra en el navegador: si se escribió «vpph2»
 * después de «vpph», quedan sólo los que dicen «vpph2». Es inmediato. Cuando
 * llega la respuesta del servidor —que busca también en la descripción y
 * ordena por relevancia— se muestra esa.
 */
export function filtrarAlInstante(productos: readonly ProductoListado[], texto: string): ProductoListado[] {
  const tokens = normalizar(texto).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return [...productos]
  return productos.filter((p) => {
    const heno = normalizar(`${p.sku} ${p.nombre}`)
    return tokens.every((t) => heno.includes(t))
  })
}
