import type { DefinicionAtributo } from '@/modules/catalogo/types'

/** Lo que hace falta de un producto para armar la línea del documento. */
export interface DatosProductoImpreso {
  /** Miniatura si existe; si no, la imagen original. `null` = sin foto. */
  foto: string | null
  marca: string | null
  modelo: string | null
  origen: string | null
  ncm: string | null
  tipo: string | null
  atributos: Record<string, unknown>
}

/** Un dato de la descripción: «Encastre» + «1/4 HEX». */
export interface ParteDescripcion {
  etiqueta: string
  valor: string
}

/**
 * Cuántos datos entran antes de que la descripción deje de ser útil.
 *
 * El corte visual son tres renglones (CSS), pero el HTML igual llevaría todo:
 * con veinte atributos el navegador maqueta veinte y muestra tres. Se corta
 * acá para no pagar por lo que no se va a ver.
 */
export const MAXIMO_PARTES = 10

/** Un escalar del jsonb, como texto. Cualquier otra cosa se descarta. */
function comoTexto(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  return null
}

/**
 * La descripción de una línea, como la arma el sistema anterior.
 *
 * El orden es el suyo (`app.js:25420`): **Marca, Modelo, Origen, NCM** y
 * después los atributos que distinguen al producto dentro de su familia —
 * encastre, medida, largo, capacidad—.
 *
 * Una diferencia, y es a mejor: el legacy tiene un mapa escrito a mano de qué
 * atributo mostrar por categoría (`_CAT_FIELDS`), con tres categorías
 * cargadas y el resto sin nada. Acá se usan los atributos **filtrables** de
 * `product_attribute_definitions`, que son justamente los que describen a una
 * familia, salen de los datos y no envejecen. Un producto de una categoría que
 * el legacy no tenía en su mapa acá igual muestra sus datos.
 *
 * Los que no se muestran nunca son los de gestión —el id del catálogo, la
 * página, el nombre de marca para mostrar—: no describen el producto, y en un
 * documento que ve el cliente sobran.
 */
export function partesDeDescripcion(
  datos: DatosProductoImpreso | undefined,
  definiciones: readonly DefinicionAtributo[],
): ParteDescripcion[] {
  if (!datos) return []

  const partes: ParteDescripcion[] = []
  const agregar = (etiqueta: string, valor: string | null) => {
    if (valor !== null && valor.trim() !== '') partes.push({ etiqueta, valor: valor.trim() })
  }

  agregar('Marca', datos.marca)
  agregar('Modelo', datos.modelo)
  agregar('Origen', datos.origen)
  agregar('NCM', datos.ncm)
  agregar('Tipo', datos.tipo)

  for (const def of definiciones) {
    if (!def.filtrable) continue
    const valor = comoTexto(datos.atributos[def.key])
    if (valor === null) continue
    agregar(def.label, def.unidad ? `${valor} ${def.unidad}` : valor)
    if (partes.length >= MAXIMO_PARTES) break
  }

  return partes.slice(0, MAXIMO_PARTES)
}
