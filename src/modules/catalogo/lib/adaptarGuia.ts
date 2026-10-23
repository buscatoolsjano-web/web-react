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
    })),
  }
}

/**
 * Todas las categorías con su conteo, para el primer paso de la guía. El conteo
 * sale de las facetas (por id de categoría, que es como filtra el ERP); si una
 * categoría no está en las facetas, va con 0.
 */
export function categoriasParaGuia(
  categorias: readonly CategoriaResumen[],
  facetas: Facetas | undefined,
): CategoriaPublica[] {
  const cuentaPorId = new Map((facetas?.categorias ?? []).map((o) => [o.valor, o.cantidad]))
  return categorias.map((c) => ({
    slug: c.slug,
    nombre: c.nombre,
    productos: cuentaPorId.get(c.id) ?? 0,
  }))
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
