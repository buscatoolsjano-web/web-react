import type { DefinicionAtributo } from '../types'

/**
 * Qué se puede cambiar en masa, y cómo (Fase 137).
 *
 * Puro: no sabe de React ni de la base. Decide qué campos se ofrecen, cómo se
 * traduce cada uno al parámetro de la RPC `editar_productos_masivo`, y qué dice
 * el cartel de confirmación. Dos ideas lo guían:
 *
 *  · se cambia UN campo a UN valor para TODOS los elegidos. No es un editor
 *    completo repetido N veces: es la herramienta para «a estos 40 ponéles la
 *    misma marca», que es lo que falta y lo que hace a mano es tedioso;
 *  · la referencia (`sku`) NO está acá a propósito. Es la clave única por
 *    empresa: ponerle el mismo valor a varios los haría colisionar. Corregir
 *    referencias es uno por uno.
 */

/** El tipo de control que la pantalla muestra para elegir el valor. */
export type TipoCampo = 'marca' | 'categoria' | 'texto' | 'atributo'

export interface CampoMasivo {
  /** Identifica la opción en la pantalla. Para atributos es `attr.<key>`. */
  clave: string
  etiqueta: string
  tipo: TipoCampo
  /** El `p_campo` que entiende la RPC. */
  rpc: string
  /** Sólo los atributos: qué key del jsonb se toca. */
  atributoKey?: string
  /** La unidad del atributo, para mostrarla al lado del valor. */
  unidad?: string | null
}

/** Los campos fijos (columnas de `products`), en el orden en que se ofrecen. */
export const CAMPOS_FIJOS: readonly CampoMasivo[] = [
  { clave: 'brand_id', etiqueta: 'Marca', tipo: 'marca', rpc: 'brand_id' },
  { clave: 'category_id', etiqueta: 'Categoría', tipo: 'categoria', rpc: 'category_id' },
  { clave: 'product_type', etiqueta: 'Tipo', tipo: 'texto', rpc: 'product_type' },
  { clave: 'series', etiqueta: 'Serie', tipo: 'texto', rpc: 'series' },
  { clave: 'origin_country', etiqueta: 'Origen', tipo: 'texto', rpc: 'origin_country' },
]

/** Un atributo del catálogo como opción de edición masiva. */
export function campoDeAtributo(d: DefinicionAtributo): CampoMasivo {
  return {
    clave: `attr.${d.key}`,
    etiqueta: d.label,
    tipo: 'atributo',
    rpc: `attr.${d.key}`,
    atributoKey: d.key,
    unidad: d.unidad,
  }
}

/** Todas las opciones: las columnas fijas y después las características. */
export function camposMasivos(definiciones: readonly DefinicionAtributo[]): CampoMasivo[] {
  return [...CAMPOS_FIJOS, ...definiciones.map(campoDeAtributo)]
}

/**
 * ¿Se puede aplicar el cambio tal como está?
 *
 * La categoría es NOT NULL en la base: vaciarla en masa rompería el update y no
 * tiene sentido. Todo lo demás admite vacío (que para una columna es NULL y
 * para un atributo es borrar la clave).
 */
export function puedeAplicar(campo: CampoMasivo | null, valor: string, cuantos: number): boolean {
  if (campo === null || cuantos === 0) return false
  if (campo.tipo === 'categoria' && valor.trim() === '') return false
  return true
}

/** El cartel de confirmación, en castellano y sin ambigüedad. */
export function describirCambio(
  campo: CampoMasivo,
  valorTexto: string,
  cuantos: number,
): string {
  const n = `${cuantos} ${cuantos === 1 ? 'producto' : 'productos'}`
  const limpio = valorTexto.trim()
  if (limpio === '') {
    // Vaciar: distinto para una columna (queda sin dato) que para un atributo.
    return campo.tipo === 'atributo'
      ? `Vas a BORRAR «${campo.etiqueta}» en ${n}.`
      : `Vas a dejar «${campo.etiqueta}» sin dato en ${n}.`
  }
  return `Vas a poner «${campo.etiqueta}» = «${limpio}» en ${n}.`
}
