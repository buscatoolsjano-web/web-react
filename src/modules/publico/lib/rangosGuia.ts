/** Un extremo de rango que se setea o se quita (null = quitar la clave). */
export type CambioRango = { min: number | null; max: number | null } | null

/**
 * Aplica cambios de rango sobre los rangos actuales (Fase 215): cada clave se
 * reemplaza, y `null` la borra. La usan las pantallas que pasan `onRangos` a la
 * guía (el catálogo del ERP y el modal de ventas).
 */
export function aplicarCambiosDeRango(
  actual: Record<string, { min: number | null; max: number | null }>,
  cambios: Record<string, CambioRango>,
): Record<string, { min: number | null; max: number | null }> {
  const siguiente = { ...actual }
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null) delete siguiente[k]
    else siguiente[k] = v
  }
  return siguiente
}
