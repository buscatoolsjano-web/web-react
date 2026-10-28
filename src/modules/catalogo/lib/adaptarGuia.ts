import type {
  CategoriaPublica,
  FacetasPublicas,
  OpcionFaceta as OpcionPublica,
} from '@/modules/publico/services/catalogoPublico'
import type { CategoriaResumen, Facetas } from '../types'

/**
 * Adaptadores ERP → público (Fase 133).
 *
 * «Que el filtro del ERP sea como el de la web, con fotos y guiado.» El
 * componente `GuiaFiltros` ya existe para el sitio público; para reusarlo acá
 * sólo hay que entregarle los datos del ERP con la forma que espera. Las
 * diferencias son de nombres (`subtipos`→`tipos`, `{valor,etiqueta,cantidad}`→
 * `{nombre,cuantos}`), no de fondo: los dos salen de los mismos productos.
 *
 * PURO, para probarlo sin montar nada.
 */

const op = (o: { valor: string; etiqueta: string; cantidad: number }): OpcionPublica => ({
  slug: o.valor,
  nombre: o.etiqueta,
  cuantos: o.cantidad,
})

/** Las facetas del ERP con la forma de las públicas, para `GuiaFiltros`. */
export function facetasParaGuia(f: Facetas | undefined): FacetasPublicas | undefined {
  if (!f) return undefined
  return {
    total: f.total,
    marcas: (f.marcas ?? []).map(op),
    categorias: (f.categorias ?? []).map(op),
    series: (f.series ?? []).map(op),
    // En el ERP el `product_type` se llama «subtipo»; para la guía es el tipo.
    // El tipo se busca por su NOMBRE (grupoDe, foto), así que va el `valor`.
    tipos: (f.subtipos ?? []).map((o) => ({ slug: o.valor, nombre: o.valor, cuantos: o.cantidad })),
    atributos: (f.atributos ?? []).map((a) => ({
      key: a.key,
      label: a.label,
      unidad: a.unidad,
      cubiertos: a.opciones.reduce((n, o) => n + o.cantidad, 0),
      opciones: a.opciones.map((o) => ({ valor: o.valor, cuantos: o.cantidad })),
      // La clase (lista o rango) viaja para que la guía sepa cuáles puede
      // mostrar con tiles y cuáles son numéricos de rango (Fase 204).
      clase: a.clase,
      min: a.min,
      max: a.max,
    })),
  }
}

/**
 * El slug con el que la guía habla de una categoría: el público si lo tiene.
 *
 * Los slugs del ERP son singulares (`punta`, `balanceador`); los del sitio
 * —y las fotos de `fotosDeOpcion.generated.json` y las portadas— van por el
 * slug público, plural (`puntas-y-tubos`). Usar el público acá es lo que hace
 * que las fotos del ERP sean las MISMAS que las de la web, igual que la web usa
 * `coalesce(slug_publico, slug)`.
 */
export const slugGuia = (c: Pick<CategoriaResumen, 'slug' | 'slugPublico'>): string =>
  c.slugPublico ?? c.slug

/**
 * Todas las categorías con su conteo, para el primer paso de la guía. El conteo
 * sale de las facetas (por id de categoría, que es como filtra el ERP); si una
 * categoría no está en las facetas, va con 0. La portada —la foto que eligió un
 * admin para el catálogo público— se pasa por el slug público; si no hay, la
 * guía cae sola a la foto del JSON y después al ícono dibujado.
 */
export function categoriasParaGuia(
  categorias: readonly CategoriaResumen[],
  facetas: Facetas | undefined,
  portadasPorSlug?: ReadonlyMap<string, string>,
): CategoriaPublica[] {
  const cuentaPorId = new Map((facetas?.categorias ?? []).map((o) => [o.valor, o.cantidad]))
  return categorias.map((c) => {
    const slug = slugGuia(c)
    return {
      slug,
      nombre: c.nombre,
      productos: cuentaPorId.get(c.id) ?? 0,
      portadaUrl: portadasPorSlug?.get(slug) ?? null,
    }
  })
}

/** Los atributos filtrados del ERP (multi-valor) como los espera la guía (uno). */
export function atributosParaGuia(atributos: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, vs] of Object.entries(atributos)) {
    const v = vs[0]
    if (v !== undefined && v !== '') out[k] = v
  }
  return out
}
