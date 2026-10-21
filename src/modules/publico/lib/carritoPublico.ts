/**
 * El carrito del sitio público (Fase 87 · E3). PURO.
 *
 * ── POR QUÉ NO ES EL CARRITO DEL ERP ────────────────────────────────────────
 *
 * El del catálogo interno guarda `{productId, sku, nombre, cantidad}`, y ese
 * `productId` es el uuid del producto. Las funciones públicas NO devuelven
 * ningún id interno —a propósito, es la mitad de por qué la puerta es
 * angosta—, así que acá no hay con qué llenarlo.
 *
 * Y mejor así: lo que identifica a un producto para quien consulta de afuera
 * es el SKU, que es lo que va a escribir en el mail y lo que la persona de
 * ventas va a buscar. El uuid no le sirve a nadie de los dos.
 *
 * ── Y POR QUÉ ES OTRA CLAVE DE `localStorage` ───────────────────────────────
 *
 * Porque son dos carritos de dos personas distintas en el mismo navegador.
 * Alguien de la casa puede estar armando una cotización en el ERP y abrir el
 * sitio público en otra pestaña para ver cómo se ve: compartir la clave
 * mezclaría las dos listas, y la del ERP tiene un campo que la pública no
 * puede completar.
 */

export interface ItemPublico {
  /** Lo que identifica al producto de cara afuera. */
  sku: string
  /** Para poder volver a la ficha desde el carrito. */
  slug: string
  categoriaSlug: string
  nombre: string
  cantidad: number
  /**
   * La foto, para que el carrito se vea profesional (Fase 87 · E3b).
   *
   * Se guarda al agregar y no se pide de nuevo en la página del pedido:
   * ésta es la URL del proveedor, que es pública, y pedir la ficha de cada
   * renglón sería una consulta por producto para una foto que ya teníamos.
   * Opcional porque un producto puede no tener foto.
   */
  imagen?: string | null
}

export type CarritoPublico = readonly ItemPublico[]

/** Distinta de la del ERP, a propósito. Ver arriba. */
export const CLAVE_CARRITO_PUBLICO = 'bt-carrito-publico'

/**
 * Tope de renglones.
 *
 * Un pedido de cotización de doscientos renglones no es un pedido: es alguien
 * probando, o un robot. Y del otro lado hay una persona que lo tiene que
 * leer.
 */
export const MAXIMO_RENGLONES = 50

/** Y de unidades por renglón, por la misma razón. */
export const MAXIMO_CANTIDAD = 9999

const acotar = (n: number): number =>
  Math.min(MAXIMO_CANTIDAD, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)))

/**
 * Poner una cantidad exacta. Cero —o menos— saca el renglón.
 *
 * No existe el estado «está en el carrito con cantidad 0»: es la misma regla
 * que el carrito del ERP, y la que hace que el `−` que llega a cero borre la
 * fila en vez de dejar una vacía.
 */
export function ponerCantidad(
  carrito: CarritoPublico,
  producto: Omit<ItemPublico, 'cantidad'>,
  cantidad: number,
): CarritoPublico {
  const n = acotar(cantidad)
  const estaba = carrito.some((i) => i.sku === producto.sku)

  if (n === 0) return carrito.filter((i) => i.sku !== producto.sku)
  if (estaba) return carrito.map((i) => (i.sku === producto.sku ? { ...i, cantidad: n } : i))
  // El tope se aplica sólo al AGREGAR uno nuevo: cambiarle la cantidad a uno
  // que ya está nunca puede hacer crecer la lista.
  if (carrito.length >= MAXIMO_RENGLONES) return carrito
  return [...carrito, { ...producto, cantidad: n }]
}

export function sumar(
  carrito: CarritoPublico,
  producto: Omit<ItemPublico, 'cantidad'>,
  cuantos = 1,
): CarritoPublico {
  return ponerCantidad(carrito, producto, cantidadDe(carrito, producto.sku) + cuantos)
}

export function restar(carrito: CarritoPublico, sku: string, cuantos = 1): CarritoPublico {
  const item = carrito.find((i) => i.sku === sku)
  if (!item) return carrito
  return ponerCantidad(carrito, item, item.cantidad - cuantos)
}

export function quitar(carrito: CarritoPublico, sku: string): CarritoPublico {
  return carrito.filter((i) => i.sku !== sku)
}

export function cantidadDe(carrito: CarritoPublico, sku: string): number {
  return carrito.find((i) => i.sku === sku)?.cantidad ?? 0
}

/** Cuántas unidades en total. Es el número del globito. */
export function unidades(carrito: CarritoPublico): number {
  return carrito.reduce((n, i) => n + i.cantidad, 0)
}

/**
 * Leer lo guardado, descartando lo que no tenga forma.
 *
 * Todo lo que viene de `localStorage` lo pudo editar cualquiera a mano, y un
 * renglón sin SKU o con una cantidad de texto reventaría la pantalla del
 * carrito. Se descarta el renglón, no el carrito: perder uno es molesto,
 * perder la lista entera porque uno estaba mal es peor.
 */
export function leerCarrito(crudo: string | null): CarritoPublico {
  if (!crudo) return []
  try {
    const datos: unknown = JSON.parse(crudo)
    if (!Array.isArray(datos)) return []
    const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
    return datos
      .map((d): ItemPublico | null => {
        const o = (d ?? {}) as Record<string, unknown>
        const sku = texto(o['sku'])
        const cantidad = acotar(Number(o['cantidad']))
        if (sku === '' || cantidad === 0) return null
        return {
          sku,
          slug: texto(o['slug']),
          categoriaSlug: texto(o['categoriaSlug']),
          nombre: texto(o['nombre']) || sku,
          imagen: texto(o['imagen']) || null,
          cantidad,
        }
      })
      .filter((i): i is ItemPublico => i !== null)
      .slice(0, MAXIMO_RENGLONES)
  } catch {
    return []
  }
}

export function escribirCarrito(carrito: CarritoPublico): string {
  return JSON.stringify(carrito)
}
