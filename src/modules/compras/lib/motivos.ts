/**
 * Los motivos con los que la migración marcó un proveedor para revisión.
 *
 * Hoy hay uno solo. Se escribe entero para que la persona sepa qué hacer, no
 * sólo que «algo pasa».
 */
const EXPLICACIONES: Record<string, string> = {
  LEGACY_EMAIL_EN_NOTAS:
    'Las notas de este proveedor tienen al menos un email escrito adentro. No se extrajo automáticamente: hay que mirarlo y, si corresponde, cargarlo en el campo Email.',
}

export function explicarMotivo(motivo: string): string {
  return EXPLICACIONES[motivo] ?? motivo
}

/** `A | B` → `['A','B']`. Vacío o nulo, lista vacía. */
export function separarMotivos(texto: string | null): string[] {
  if (!texto) return []
  return texto
    .split('|')
    .map((m) => m.trim())
    .filter((m) => m !== '')
}
