/**
 * La clave con la que se comparan dos alias de producto.
 *
 * Vive en `lib/` y no en el servicio a propósito: `services/memoria.ts`
 * importa el cliente de Supabase, que lee las variables de entorno al
 * importarse, y una función pura no tiene por qué arrastrar eso. La suite
 * `test:isolated` corre sin `.env` justamente para detectar ese acoplamiento
 * —ya nos pasó con `TRATAMIENTOS` en Ventas—.
 */

/**
 * Es la misma normalización que usó la migración: minúsculas, todo lo que no
 * sea letra o número pasa a espacio, y se colapsa. Así «SP.553 tubo» y
 * «sp 553 tubo» son el mismo alias y el índice único los detecta.
 */
export function normalizarClave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface DatosAlias {
  codigoCliente: string
  descripcionCliente: string
  /**
   * El producto es obligatorio: la columna es NOT NULL. Se deja nullable acá
   * porque el formulario empieza sin producto elegido, y el servicio corta
   * antes de llegar a la base.
   */
  productId: string | null
}

/**
 * La clave sale del código del cliente si lo hay y, si no, de su descripción.
 *
 * El legacy sólo tenía la descripción —el texto tal cual venía en la orden de
 * compra—; el modelo nuevo separa código y descripción, y el código, cuando
 * existe, es lo que de verdad identifica al producto para ese cliente.
 */
export function claveDe(datos: DatosAlias): string {
  return normalizarClave(datos.codigoCliente.trim() || datos.descripcionCliente)
}
