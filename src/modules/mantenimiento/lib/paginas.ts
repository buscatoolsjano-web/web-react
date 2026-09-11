/**
 * Los tamaños de página de los listados de Mantenimiento.
 *
 * Viven acá y no en un hook para que el paginador no arrastre a los filtros:
 * es un dato, no una llamada.
 */
export const TAMANOS_DE_PAGINA = [10, 25, 50, 100] as const
