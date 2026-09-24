import type { HojaDeCatalogo, ImagenProducto } from '../types'

/**
 * De dónde sale «la hoja del catálogo» de un producto.
 *
 * Hay **dos fuentes reales** en la base, y ninguna se inventa acá:
 *
 * 1. **`attributes.catalogo_id` + `attributes.catalogo_pagina`** — la página
 *    del catálogo impreso donde aparece el producto. Es el dato del sistema
 *    anterior, y desde la Fase 25 · E6 está para los 1.716 productos que el
 *    legacy sabía ubicar: 1.418 de SPEEDRILL, 285 de TECNA (repartidos en tres
 *    catálogos), 13 de TORERO por serie y los 48 de DUROFIX que ya lo tenían.
 *    Con el catálogo y la página se arma la imagen de la página escaneada.
 *
 * 2. **La imagen `shared_diagram`** — la lámina de despiece que varios
 *    productos comparten, que llegó con las imágenes de apexbits. La URL la
 *    nombra: `…/diagrams/page-008-fam-0.png` es la página 8. La tienen 3.526
 *    productos.
 *
 * **La 1 gana cuando están las dos**, y ése es el cambio de la Fase 25 · E6:
 * lo que se pidió es «la hoja del catálogo donde aparecía ese producto», que
 * es la página del catálogo impreso. La lámina compartida es el respaldo para
 * los miles de productos que no están en ningún catálogo mapeado.
 *
 * Todo esto es lectura pura: no se toca ni se migra nada desde acá.
 */
const PAGINA_EN_URL = /page-0*(\d+)-fam-(\d+)/i

/**
 * Los catálogos impresos, calcados de `_CATALOGOS_INFO` del legacy
 * (`app.js:16654`), con la cantidad de páginas de cada uno.
 *
 * `local` distingue de dónde sale la imagen:
 *
 *  · Cinco catálogos están publicados en `janoguarini.github.io/catalogos-buscatools`,
 *    que es de donde los tomaba el legacy y de donde se siguen tomando.
 *  · **DUROFIX no está ahí** (da 404): el legacy llevaba sus 12 páginas
 *    embebidas en base64 dentro del propio `app.js`. Se extrajeron a
 *    `public/catalogos/` con `scripts/fase25-e6-hojas-legacy-extraer.mjs`, así
 *    que esas salen de esta misma app.
 */
export const CATALOGOS: Record<string, { etiqueta: string; paginas: number; local?: boolean }> = {
  nogravity: { etiqueta: 'No Gravity', paginas: 12 },
  generale: { etiqueta: 'Bilanciatori (general)', paginas: 36 },
  food: { etiqueta: 'Food Industry', paginas: 20 },
  speedrill: { etiqueta: 'Catálogo SPEEDRILL', paginas: 168 },
  torero: { etiqueta: 'Serie LTR y LTU', paginas: 1 },
  durofix: { etiqueta: 'DUROFIX Pro-Assembly', paginas: 12, local: true },
}

const BASE_REMOTA = 'https://janoguarini.github.io/catalogos-buscatools/'

/**
 * La imagen de una página, con el mismo nombre de archivo que el legacy
 * (`app.js:16830`).
 *
 * SPEEDRILL rellena a 3 dígitos porque su catálogo tiene 168 páginas; el resto
 * a 2. No es una convención que podamos elegir: es cómo se llaman los archivos.
 *
 * Devuelve `null` cuando no se puede armar —catálogo desconocido, o página
 * fuera del catálogo—, y entonces la pantalla dice que la hoja no está cargada
 * en vez de pedir una imagen que va a dar 404.
 */
export function urlDeHoja(catalogo: string | null, pagina: number | null): string | null {
  if (!catalogo || pagina === null) return null
  const info = CATALOGOS[catalogo]
  if (!info || pagina < 1 || pagina > info.paginas) return null
  const nombre = `${catalogo}-${String(pagina).padStart(catalogo === 'speedrill' ? 3 : 2, '0')}.jpg`
  return info.local ? `${import.meta.env.BASE_URL}catalogos/${nombre}` : `${BASE_REMOTA}${nombre}`
}

export function hojaDeCatalogo(
  atributos: Record<string, unknown>,
  imagenes: readonly ImagenProducto[],
): HojaDeCatalogo | null {
  // 1 · la página del catálogo impreso, que es lo que se pidió.
  const catalogo = texto(atributos['catalogo_id'])
  const pagina = entero(atributos['catalogo_pagina'])
  if (catalogo || pagina !== null) {
    const info = catalogo ? CATALOGOS[catalogo] : undefined
    return {
      catalogo,
      etiqueta: info?.etiqueta ?? null,
      pagina,
      familia: null,
      imagenUrl: urlDeHoja(catalogo, pagina),
    }
  }

  // 2 · el respaldo: la lámina compartida, que es una página en sí misma.
  const diagrama = imagenes.find((i) => i.kind === 'shared_diagram')
  if (diagrama) {
    const m = PAGINA_EN_URL.exec(diagrama.url)
    return {
      catalogo: null,
      etiqueta: null,
      pagina: m?.[1] ? Number(m[1]) : null,
      familia: m?.[2] ? Number(m[2]) : null,
      imagenUrl: diagrama.url,
    }
  }

  return null
}

function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

/** Un número de página sólo si es un entero positivo; si no, no hay página. */
function entero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(texto(v))
  return Number.isInteger(n) && n > 0 ? n : null
}
