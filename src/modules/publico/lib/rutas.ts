/**
 * Las URLs del sitio público (Fase 87 · E2). PURO.
 *
 * ── POR QUÉ IMPORTAN MÁS QUE LAS OTRAS ──────────────────────────────────────
 *
 * Las del ERP las escribe el menú y nadie las lee. Éstas son el producto: son
 * lo que queda indexado, lo que alguien pega en un mail y lo que aparece
 * debajo del título en el buscador. Una URL es texto que se lee.
 *
 * Por eso no se arman con el SKU —`/catalogo/SP.2520%2F8B`, con el punto y la
 * barra convertidos en basura— sino con el slug que la base ya calcula y que
 * no cambia nunca: `/productos/puntas-y-tubos/speedrill-ph2-phillips`.
 *
 * ── LA FORMA, Y POR QUÉ NO HAY AMBIGÜEDAD ───────────────────────────────────
 *
 *   /productos                      todo el catálogo
 *   /productos/:categoria           una categoría
 *   /productos/:categoria/:producto una ficha
 *
 * Un segmento después de `/productos` es SIEMPRE una categoría y dos son
 * SIEMPRE una ficha. No hace falta ningún prefijo que los distinga —ni
 * `/p/`, ni `/c/`— porque la profundidad ya los distingue, y un prefijo es
 * una palabra sin sentido en el medio de la URL.
 */

export const RAIZ_PUBLICA = '/productos'

/** El catálogo entero. */
export function rutaCatalogo(): string {
  return RAIZ_PUBLICA
}

/** Una categoría, por su slug público. */
export function rutaCategoria(slug: string): string {
  return `${RAIZ_PUBLICA}/${slug}`
}

/**
 * La ficha de un producto.
 *
 * Lleva la categoría adelante aunque la base lo encuentre sólo con su slug.
 * Dos razones, las dos de posicionamiento: la URL cuenta de qué es el
 * producto antes de abrirla, y el camino hace de migaja —categoría, después
 * producto— que es lo que los buscadores dibujan debajo del título.
 */
export function rutaProductoPublico(categoriaSlug: string, slug: string): string {
  return `${RAIZ_PUBLICA}/${categoriaSlug}/${slug}`
}

/**
 * La misma ruta pero con barra final, que es la forma CANÓNICA (Fase 88).
 *
 * GitHub Pages sirve el HTML prerenderizado de una ficha desde
 * `/productos/x/y/index.html`, y la dirección que lo trae con 200 directo
 * —sin la redirección 301 que agrega la barra— es `/productos/x/y/`. Por eso
 * la etiqueta canónica, el `og:url`, el sitemap y la carpeta del prerender
 * usan TODOS esta forma: una sola, para que el buscador no vea la misma ficha
 * en dos direcciones.
 *
 * Los enlaces de ADENTRO de la app no la usan: ésos navegan sin pedirle nada
 * a GitHub, así que la barra final sólo sería ruido. La raíz se deja igual.
 */
export function conBarraFinal(path: string): string {
  if (path === '/' || path.endsWith('/')) return path
  return `${path}/`
}

/**
 * Si esta dirección es del sitio público.
 *
 * Decide QUÉ CÁSCARA se dibuja: la del ERP —con su barra lateral y sus
 * paneles— o la pública. Va acá, pura y probada, y no adentro del
 * componente que elige: equivocarse es mostrarle la barra lateral del ERP a
 * alguien que no inició sesión, o la cáscara pública a quien está
 * trabajando.
 *
 * La raíz es pública: es la landing. Quien trabaja acá entra por `/inicio`,
 * que es donde está el tablero.
 */
export function esRutaPublica(pathname: string): boolean {
  if (pathname === '/') return true
  return pathname === RAIZ_PUBLICA || pathname.startsWith(`${RAIZ_PUBLICA}/`)
}

/**
 * La dirección canónica de una ficha.
 *
 * Una ficha se puede abrir con la categoría equivocada en el camino
 * —`/productos/balanceadores/speedrill-ph2-phillips`— porque la base la
 * encuentra igual, por el slug. Si eso se dejara pasar, el mismo producto
 * tendría tantas URLs como categorías haya, y un buscador que encuentra el
 * mismo contenido en ocho direcciones reparte el crédito entre las ocho o
 * directamente desconfía.
 *
 * Devuelve `null` cuando la que se pidió ya es la buena, para que quien
 * llama no redirija sobre sí mismo.
 */
export function rutaCanonica(
  pedida: { categoria: string; producto: string },
  real: { categoriaSlug: string; slug: string },
): string | null {
  if (pedida.categoria === real.categoriaSlug && pedida.producto === real.slug) return null
  return rutaProductoPublico(real.categoriaSlug, real.slug)
}
