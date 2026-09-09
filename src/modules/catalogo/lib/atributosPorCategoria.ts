import type { DefinicionAtributo } from '../types'

/**
 * Atributos que se ofrecen como filtro para una categoría.
 *
 * Vive en `lib/` y NO en `services/` a propósito: es lógica pura, sin red.
 * Los módulos de `services/` importan el cliente de Supabase, que valida el
 * entorno al importarse — un test que los toque necesitaría `.env`, y en CI
 * no hay. Esta separación es la que mantiene la suite corriendo sin
 * configuración.
 *
 * Sin categoría elegida se muestran todos los filtrables: no hay forma de
 * saber cuáles aplican. Con categoría, sólo los suyos — que es la diferencia
 * entre ofrecer 15 filtros o los 3 que sirven.
 *
 * Si la categoría no tiene ninguna relación cargada, se cae a mostrarlos
 * todos en vez de no mostrar ninguno: es preferible un filtro de más que una
 * pantalla sin filtros.
 */
export function filtrarAtributosDeCategoria(
  definiciones: readonly DefinicionAtributo[],
  categoriaId: string | null,
  porCategoria?: Map<string, Set<string>>,
): DefinicionAtributo[] {
  const filtrables = definiciones.filter((d) => d.filtrable)
  if (!categoriaId || !porCategoria) return filtrables

  const permitidas = porCategoria.get(categoriaId)
  if (!permitidas || permitidas.size === 0) return filtrables

  return filtrables.filter((d) => permitidas.has(d.key))
}
