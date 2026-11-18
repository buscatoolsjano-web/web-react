/**
 * El precio del ERP contra las listas del proveedor. PURO.
 *
 * «Costo y precio en la ficha, con aviso cuando el precio de venta quedó por
 * debajo de la última lista, o cuando la lista subió y el precio no.» Sólo se
 * comparan importes en la MISMA moneda: un precio en USD contra un costo en
 * EUR no dice nada sin un tipo de cambio, y un aviso falso es peor que
 * ninguno.
 */

export interface ListaDelProducto {
  fuente: string
  fecha: string
  costo: number | null
  monedaCosto: string | null
  venta: number | null
  monedaVenta: string | null
  /** El precio principal de la lista (el que se compara entre versiones). */
  ancla: number | null
  moneda: string | null
  fechaAnterior: string | null
  ventaAnterior: number | null
  anclaAnterior: number | null
}

export type Gravedad = 'peligro' | 'atencion' | 'info'

export interface AvisoDePrecio {
  gravedad: Gravedad
  texto: string
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`
const mismaMoneda = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase()

/** Cuánto cambió la lista entre la versión anterior y la última, en %. */
export function variacionDeLista(l: ListaDelProducto): number | null {
  const ahora = l.venta ?? l.ancla
  const antes = l.venta !== null ? l.ventaAnterior : l.anclaAnterior
  if (ahora === null || antes === null || antes === 0) return null
  return ((ahora - antes) / antes) * 100
}

export function avisosDePrecio(
  precio: number | null,
  moneda: string | null,
  listas: readonly ListaDelProducto[],
): AvisoDePrecio[] {
  const avisos: AvisoDePrecio[] = []
  for (const l of listas) {
    const enMoneda = (m: string | null) => precio !== null && precio > 0 && mismaMoneda(moneda, m)
    if (l.costo !== null && enMoneda(l.monedaCosto) && precio! < l.costo) {
      avisos.push({
        gravedad: 'peligro',
        texto: `El precio de venta está por debajo del costo de ${l.fuente} (${pct(((precio! - l.costo) / l.costo) * 100)}).`,
      })
    } else if (l.venta !== null && enMoneda(l.monedaVenta) && precio! < l.venta * 0.995) {
      avisos.push({
        gravedad: 'atencion',
        texto: `El precio de venta está por debajo del de la lista de ${l.fuente} (${pct(((precio! - l.venta) / l.venta) * 100)}).`,
      })
    }
    const v = variacionDeLista(l)
    if (v !== null && v >= 1) {
      avisos.push({ gravedad: 'info', texto: `La lista de ${l.fuente} subió ${pct(v)} en la versión del ${l.fecha}.` })
    }
  }
  return avisos
}
