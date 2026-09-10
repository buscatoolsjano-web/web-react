/**
 * Los rubros del sistema anterior.
 *
 * En el legacy `RUBROS_SEED` son cuatro, y la ficha del cliente los ofrece en
 * un `<select>` construido con `getRubrosDisponibles()`. La configuración
 * editable vivía en `localStorage` bajo `buscatools_rubros_config` y **en el
 * perfil real nunca se guardó**: lo que existe son estos cuatro nombres, que
 * son código, no datos de nadie.
 *
 * Cada rubro llevaba además una lista de marcas y una plantilla de asunto y
 * cuerpo de mail. Eso no es una taxonomía de clientes: es la configuración de
 * **mandar un mail con catálogos adjuntos**, una función que todavía no está
 * migrada. Cuando exista, la configuración se define ahí; migrarla ahora sería
 * guardar una preferencia de una pantalla que no se puede abrir.
 *
 * Por eso acá el rubro sigue siendo `customers.industry`, una columna de texto
 * que puede estar vacía, y esta lista es sólo una sugerencia: si un cliente
 * tiene un rubro que no está —o el equipo empieza a usar otros— se escribe y
 * listo. No hay tabla `industries`.
 */
export const RUBROS_SUGERIDOS = [
  'Gomería / Neumáticos',
  'Industrial / Metalúrgica',
  'Automotriz / Taller mecánico',
  'Herramientas / Ferretería',
] as const

/**
 * Las opciones del selector: las sugeridas más la que ya tenga el cliente.
 *
 * Sin esto, abrir la ficha de un cliente cuyo rubro no está en la lista y
 * guardar sin tocar nada le borraría el rubro — que es exactamente el tipo de
 * pérdida silenciosa que no queremos.
 */
export function opcionesDeRubro(actual: string | null | undefined): string[] {
  const lista = [...RUBROS_SUGERIDOS] as string[]
  const a = (actual ?? '').trim()
  if (a !== '' && !lista.includes(a)) lista.unshift(a)
  return lista
}
