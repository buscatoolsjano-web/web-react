import type { HojaDeCatalogo, ImagenProducto } from '../types'

/**
 * De dónde sale «la hoja del catálogo» de un producto.
 *
 * Hay **dos fuentes reales** en la base, y ninguna se inventa acá:
 *
 * 1. **`attributes.catalogo_id` + `attributes.catalogo_pagina`** — es el dato
 *    que traía el sistema anterior. Lo tienen **48** productos, todos del
 *    catálogo `durofix`. No hay PDF cargado para ellos: se sabe el catálogo y
 *    la página, y eso es lo que se muestra.
 *
 * 2. **La imagen `shared_diagram`** — la página del catálogo escaneada, que
 *    varios productos comparten. La URL la nombra:
 *    `…/diagrams/page-008-fam-0.png` es la página 8. La tienen **3.526**
 *    productos.
 *
 * Las dos juntas cubren 3.574 de 21.828 productos. Para el resto **no hay
 * hoja de catálogo**, y la pantalla lo dice en vez de dibujar un visor vacío.
 *
 * Todo esto es lectura pura: no se toca ni se migra nada.
 */
const PAGINA_EN_URL = /page-0*(\d+)-fam-(\d+)/i

export function hojaDeCatalogo(
  atributos: Record<string, unknown>,
  imagenes: readonly ImagenProducto[],
): HojaDeCatalogo | null {
  // El diagrama compartido es la página en sí: se puede mostrar.
  const diagrama = imagenes.find((i) => i.kind === 'shared_diagram')
  if (diagrama) {
    const m = PAGINA_EN_URL.exec(diagrama.url)
    return {
      catalogo: null,
      pagina: m?.[1] ? Number(m[1]) : null,
      familia: m?.[2] ? Number(m[2]) : null,
      imagenUrl: diagrama.url,
    }
  }

  // El dato del sistema anterior: catálogo y página, sin imagen.
  const catalogo = texto(atributos['catalogo_id'])
  const pagina = texto(atributos['catalogo_pagina'])
  if (catalogo || pagina) {
    const n = Number(pagina)
    return {
      catalogo,
      pagina: Number.isFinite(n) && n > 0 ? n : null,
      familia: null,
      imagenUrl: null,
    }
  }

  return null
}

function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}
