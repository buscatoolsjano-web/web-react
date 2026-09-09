import type { ProductoParaLinea } from '../services/productosParaLinea'

import type { LineaDocumento } from '../types'

/**
 * Construcción de líneas nuevas.
 *
 * Cada línea nace con su propio identificador. En el alta es un uuid local
 * que se descarta al guardar —la base asigna el suyo—, pero mientras se
 * edita ya es una identidad de verdad: mover o borrar una línea no depende
 * de su posición en un array.
 */

let contador = 0

function nuevoId(): string {
  // `crypto.randomUUID` no existe en contextos no seguros ni en algunos
  // navegadores viejos; el contador alcanza porque estos ids sólo viven
  // dentro de esta pantalla.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  contador += 1
  return `tmp-${Date.now()}-${contador}`
}

const BASE: Omit<LineaDocumento, 'id' | 'numeroLinea'> = {
  tipoLinea: 'item',
  productId: null,
  sku: null,
  nombre: null,
  descripcion: null,
  cantidad: 1,
  precioUnitario: 0,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
}

export function lineaDeProducto(
  p: ProductoParaLinea,
  precio: number | null,
  numeroLinea: number,
): LineaDocumento {
  return {
    ...BASE,
    id: nuevoId(),
    numeroLinea,
    productId: p.id,
    sku: p.sku,
    nombre: p.nombre,
    // Sin precio en la moneda del documento se agrega en 0 y se completa a
    // mano: es preferible a convertir sin un tipo de cambio confirmado.
    precioUnitario: precio ?? 0,
  }
}

export function lineaLibre(numeroLinea: number): LineaDocumento {
  return { ...BASE, id: nuevoId(), numeroLinea }
}

export function lineaCapitulo(numeroLinea: number): LineaDocumento {
  return {
    ...BASE,
    id: nuevoId(),
    numeroLinea,
    tipoLinea: 'chapter',
    nombre: 'Nuevo capítulo',
    cantidad: 1,
    precioUnitario: 0,
    tratamientoImpuesto: 'not_taxed',
    tasaImpuesto: 0,
  }
}

/** Renumera 1..n conservando el orden actual. */
export function renumerar(lineas: readonly LineaDocumento[]): LineaDocumento[] {
  return lineas.map((l, i) => ({ ...l, numeroLinea: i + 1 }))
}

/** Mueve una línea una posición. Devuelve la misma lista si no se puede. */
export function mover(
  lineas: readonly LineaDocumento[],
  id: string,
  direccion: -1 | 1,
): LineaDocumento[] {
  const i = lineas.findIndex((l) => l.id === id)
  const j = i + direccion
  if (i < 0 || j < 0 || j >= lineas.length) return [...lineas]
  const copia = [...lineas]
  const a = copia[i]
  const b = copia[j]
  if (!a || !b) return copia
  copia[i] = b
  copia[j] = a
  return renumerar(copia)
}
