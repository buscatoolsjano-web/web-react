/**
 * El carrito del catálogo (Fase 22 · paridad, #50).
 *
 * Es lo que el legacy llama «carrito interno» (`erp_internal_carrito`) y es
 * **el camino por el que nace una cotización**: en el catálogo hay un
 * `− [n] +` por fila, una barra flotante abajo a la derecha con ítems y
 * total, y un botón «Ver cotización».
 *
 * Qué guarda el legacy, medido en `app.js:2020` y `:17529`: **sólo `{sku,
 * qty}`**. El nombre y el precio los resuelve al leer, contra `PRODUCTOS`.
 * Acá se guarda además el `productId` y el nombre —el id porque en React la
 * identidad del producto es el uuid y no el SKU, y el nombre para poder
 * dibujar la barra sin ir a la base—. **El precio NO se guarda**: lo resuelve
 * Ventas con la tarifa del documento, que es donde vive esa regla. Congelarlo
 * acá sería decidir en el catálogo algo que decide la cotización.
 *
 * Tampoco se guarda nada de la serie ni de la autoridad de numeración: eso
 * nace con el documento, no con la selección.
 */

export interface ItemCarrito {
  productId: string
  sku: string
  nombre: string
  cantidad: number
}

export type Carrito = readonly ItemCarrito[]

/** La clave de `localStorage`. El legacy usa `erp_internal_carrito`. */
export const CLAVE_CARRITO = 'bt-carrito-catalogo'

/** Tope de seguridad: un carrito de mil líneas no es una cotización. */
export const MAXIMO_ITEMS = 200

/**
 * Poner una cantidad exacta.
 *
 * Cero —o menos— saca el producto, igual que el legacy: ahí el `−` baja hasta
 * 0 y `_iCatSetQty` borra la fila. No existe el estado «está en el carrito
 * con cantidad 0».
 */
export function ponerCantidad(
  carrito: Carrito,
  producto: { id: string; sku: string; nombre: string },
  cantidad: number,
): Carrito {
  const n = Math.floor(Number(cantidad))
  const limpio = Number.isFinite(n) ? n : 0
  const sinEl = carrito.filter((i) => i.productId !== producto.id)
  if (limpio <= 0) return sinEl
  if (sinEl.length >= MAXIMO_ITEMS && sinEl.length === carrito.length) return carrito
  const previo = carrito.find((i) => i.productId === producto.id)
  const item: ItemCarrito = {
    productId: producto.id,
    sku: producto.sku,
    nombre: producto.nombre,
    cantidad: limpio,
  }
  // Se conserva la posición: el legacy tampoco reordena al cambiar cantidad.
  return previo ? carrito.map((i) => (i.productId === producto.id ? item : i)) : [...sinEl, item]
}

/** Sumar uno, como el botón `+`. */
export function sumar(carrito: Carrito, producto: { id: string; sku: string; nombre: string }): Carrito {
  return ponerCantidad(carrito, producto, cantidadDe(carrito, producto.id) + 1)
}

/** Restar uno, como el botón `−`. Nunca baja de cero. */
export function restar(carrito: Carrito, producto: { id: string; sku: string; nombre: string }): Carrito {
  return ponerCantidad(carrito, producto, cantidadDe(carrito, producto.id) - 1)
}

export function cantidadDe(carrito: Carrito, productId: string): number {
  return carrito.find((i) => i.productId === productId)?.cantidad ?? 0
}

/** Cuántas unidades hay en total (el número «Ítems» de la barra del legacy). */
export function unidades(carrito: Carrito): number {
  return carrito.reduce((n, i) => n + i.cantidad, 0)
}

/**
 * Lo que se lee de `localStorage`, validado.
 *
 * Nunca se confía en lo guardado: puede venir de una versión anterior, de
 * otra pestaña, o de alguien que lo editó a mano. Una fila sin `productId` o
 * con cantidad no numérica se descarta en vez de romper la pantalla.
 */
export function leerCarrito(crudo: string | null): Carrito {
  if (!crudo) return []
  try {
    const datos: unknown = JSON.parse(crudo)
    if (!Array.isArray(datos)) return []
    return datos
      .flatMap((x): ItemCarrito[] => {
        if (typeof x !== 'object' || x === null) return []
        const o = x as Record<string, unknown>
        const cantidad = Math.floor(Number(o['cantidad']))
        if (typeof o['productId'] !== 'string' || o['productId'] === '') return []
        if (!Number.isFinite(cantidad) || cantidad <= 0) return []
        return [{
          productId: o['productId'],
          sku: typeof o['sku'] === 'string' ? o['sku'] : '',
          nombre: typeof o['nombre'] === 'string' ? o['nombre'] : '',
          cantidad,
        }]
      })
      .slice(0, MAXIMO_ITEMS)
  } catch {
    return []
  }
}

export function escribirCarrito(carrito: Carrito): string {
  return JSON.stringify(carrito)
}
