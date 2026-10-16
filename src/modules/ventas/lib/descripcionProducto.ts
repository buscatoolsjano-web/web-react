import { columnasDe, type ColumnaComparable } from '@/modules/catalogo/lib/familias'
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
  serie: string | null
  /** El `slug` de la categoría: decide en qué ORDEN se lee la descripción. */
  categoria: string | null
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

  /*
   * SI LA FAMILIA SE CONOCE, MANDA ELLA (Fase 82).
   *
   * Lo pedido: «que la descripción de todos los productos sea concatenada
   * para que todos respeten el mismo orden; todos los de puntas y tubos con
   * marca, modelo, serie, encastre y largo, y lo mismo con cada categoría».
   *
   * Esa tabla ya existe y es `ATRIBUTOS_POR_FAMILIA`: la misma que usa el
   * comparador del catálogo para decidir qué distingue a una familia de
   * otra. Se reusa en vez de escribir una segunda, porque dos listas de «qué
   * describe a una punta» se separan el día que alguien toca una sola.
   *
   * Sin familia conocida —12.588 productos en «otros»— sigue valiendo el
   * orden general de abajo: marca, modelo, origen, NCM, tipo y los atributos
   * filtrables que tenga.
   */
  const columnas = columnasDe(datos.categoria)
  if (columnas.length > 0) {
    for (const col of columnas) {
      agregar(etiquetaDe(col, definiciones), valorDe(col, datos))
      if (partes.length >= MAXIMO_PARTES) break
    }
    return partes.slice(0, MAXIMO_PARTES)
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

/**
 * El valor de una columna de la familia, para la línea impresa.
 *
 * `modelo` NO es el SKU acá, aunque el comparador lo muestre así: el SKU ya
 * está en la primera columna del documento, y repetirlo como «Modelo» gasta
 * un dato de los pocos que entran. En el documento, Modelo es `model_code`,
 * que es como lo pide el cliente.
 */
function valorDe(col: ColumnaComparable, datos: DatosProductoImpreso): string | null {
  if (col.origen === 'columna') {
    switch (col.clave) {
      case 'marca':
        return datos.marca
      case 'sku':
        return datos.modelo
      case 'tipo':
        return datos.tipo
      case 'serie':
        return datos.serie
      default:
        return null
    }
  }
  const valor = comoTexto(datos.atributos[col.clave])
  if (valor === null) return null
  const unidad = col.unidad ?? unidadDe(col.clave, [])
  return unidad ? `${valor} ${unidad}` : valor
}

/** La etiqueta del catálogo gana sobre la de la tabla: es la que ve el resto
 *  de la app, y la de la tabla es sólo un valor por defecto. */
function etiquetaDe(col: ColumnaComparable, definiciones: readonly DefinicionAtributo[]): string {
  if (col.origen !== 'atributo') return col.etiqueta
  return definiciones.find((d) => d.key === col.clave)?.label ?? col.etiqueta
}

function unidadDe(clave: string, definiciones: readonly DefinicionAtributo[]): string | null {
  return definiciones.find((d) => d.key === clave)?.unidad ?? null
}
