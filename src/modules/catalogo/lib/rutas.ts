/**
 * La URL de la ficha de un producto.
 *
 * Vivía como una constante local dentro de `ListadoProductos`, y con la
 * planilla de precios pasó a hacer falta en dos módulos (Fase 54). Una segunda
 * definición es una que se va a separar de la primera el día que cambie la
 * ruta, así que hay una sola.
 *
 * El SKU se escapa porque los de este catálogo tienen barras y puntos
 * —`SP.2520/8B`—, y sin escapar la barra parte la URL en dos segmentos.
 */
export function rutaProducto(sku: string): string {
  return `/catalogo/${encodeURIComponent(sku)}`
}
