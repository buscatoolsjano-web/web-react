import type { UltimoPrecio } from '@/modules/clientes/types'
import { formatearFecha, formatearImporte } from './formato'

/**
 * El último precio que se le cobró a este cliente por este producto, puesto a
 * trabajar en la línea de la cotización (Fase 40).
 *
 * PARA QUÉ. Un vendedor que vuelve a cotizarle lo mismo al mismo cliente no
 * tiene cómo saber a cuánto se lo vendió la última vez: tiene que acordarse o
 * ir a buscar el documento. Y los precios se mueven. Caso real, mismo cliente
 * y mismo producto en USD: 49,40 el 4 de mayo y 22,20 el 19 de mayo. Hay 430
 * pares cliente+producto con pedido confirmado y 88 que ya se repitieron.
 *
 * **EL DATO NO ES NUEVO.** Lo calcula `ultimo_precio_cliente`, que ya existía
 * y que la ficha del cliente ya muestra (`modules/clientes/services/precios`).
 * Acá no se define un «último precio» distinto: se usa EL MISMO y se lo trae
 * hasta donde se carga el precio. Escribí una segunda versión con otra
 * política —pedido antes que cotización, sin borradores— y la tiré: el
 * vendedor habría visto un número en la línea y otro en la ficha del cliente
 * para la misma pregunta, que es peor que no tener la función.
 *
 * Lo que sí se decide acá es qué hacer con ese dato: con qué precio entra una
 * línea nueva y qué se le avisa a quien lo cambia.
 */

/**
 * Cuánto tienen que diferir dos precios para considerarlos distintos.
 *
 * Los importes se guardan con cuatro decimales (22.2000) y el campo de la
 * pantalla edita con los que haga falta. Sin tolerancia, un 22.2 tipeado a
 * mano contra un 22.2000 de la base dispararía el aviso por un error de punto
 * flotante, y un aviso que aparece cuando no cambió nada deja de mirarse.
 */
const TOLERANCIA = 0.005

export function mismoPrecio(a: number, b: number): boolean {
  return Math.abs(a - b) < TOLERANCIA
}

/**
 * El precio con el que entra una línea nueva.
 *
 * El histórico del cliente le gana a la tarifa, y es el punto de todo esto: la
 * tarifa dice cuánto vale el producto, el histórico dice cuánto le cobramos a
 * ESTE cliente. Cuando no hay histórico —la enorme mayoría de los casos— no
 * cambia nada y sigue mandando la tarifa.
 *
 * Un histórico sin precio se ignora: la fila existe pero no dice nada.
 */
export function precioParaLineaNueva(
  historico: UltimoPrecio | undefined,
  precioDeTarifa: number | null,
): { precio: number; deHistorico: boolean } {
  if (historico && historico.ultimoPrecio !== null) {
    return { precio: historico.ultimoPrecio, deHistorico: true }
  }
  return { precio: precioDeTarifa ?? 0, deHistorico: false }
}

export type TonoAviso = 'historico' | 'igual'

export interface AvisoPrecio {
  tono: TonoAviso
  texto: string
}

/**
 * Qué decirle a quien está editando la línea.
 *
 * Dos casos, y los dos importan:
 *
 *  · `igual`: el precio es el del último documento. Se dice en gris, para que
 *    se entienda de dónde salió el número que apareció solo. Un precio que se
 *    completa sin explicación es un precio en el que nadie confía.
 *  · `historico`: alguien lo cambió —o la tarifa propuso otra cosa—. Va en
 *    naranja con el monto anterior, el documento y la fecha, que es lo que
 *    hace falta para decidir si el cambio está bien.
 *
 * Devuelve `null` cuando no hay histórico o no tiene precio: no hay nada que
 * comparar y no se inventa un aviso.
 */
export function avisoDePrecio(
  historico: UltimoPrecio | undefined,
  precioActual: number,
): AvisoPrecio | null {
  if (!historico || historico.ultimoPrecio === null) return null

  const monto = formatearImporte(historico.ultimoPrecio, historico.moneda)

  if (mismoPrecio(precioActual, historico.ultimoPrecio)) {
    return { tono: 'igual', texto: `Es el último precio de este cliente.` }
  }

  const fecha = historico.ultimaFecha ? ` del ${formatearFecha(historico.ultimaFecha)}` : ''
  const de = historico.ultimoTipo === 'pedido' ? 'pedido' : 'cotización'
  const doc = historico.ultimoDocumento ? ` ${historico.ultimoDocumento}` : ''
  return {
    tono: 'historico',
    texto: `Último precio: ${monto} · ${de}${doc}${fecha}`,
  }
}

/**
 * El histórico de un producto en la moneda del documento.
 *
 * `ultimo_precio_cliente` devuelve UNA FILA POR PRODUCTO Y POR MONEDA, a
 * propósito: un producto cotizado en USD y en ARS tiene dos últimos precios
 * distintos y no existe uno que mezcle los dos. Acá se elige el de la moneda
 * del documento y punto: traer el de otra moneda obligaría a convertir con un
 * tipo de cambio que nadie confirmó, que es como el legacy dejó 104
 * documentos sin él.
 */
export function porProductoEnMoneda(
  filas: readonly UltimoPrecio[],
  moneda: string | null,
): Map<string, UltimoPrecio> {
  const salida = new Map<string, UltimoPrecio>()
  if (!moneda) return salida
  const buscada = moneda.trim().toUpperCase()
  for (const f of filas) {
    if (f.productId === null) continue
    if ((f.moneda ?? '').trim().toUpperCase() !== buscada) continue
    // La RPC ya devuelve una sola fila por producto y moneda; si llegaran dos,
    // se queda la primera, que viene ordenada por fecha descendente.
    if (!salida.has(f.productId)) salida.set(f.productId, f)
  }
  return salida
}
