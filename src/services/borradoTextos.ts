/** Lo de borrar que no necesita la base: sirve en pantallas y en tests sin Supabase. */

/** El mínimo que acepta la base. Un motivo de dos letras no es un motivo. */
export const MINIMO_MOTIVO = 4

/**
 * Los motivos de siempre, a un clic (Fase 40).
 *
 * Pedir un motivo escrito en cada borrado es fricción, y la fricción se paga
 * con basura: «a», «asd», «borrar». Con cuatro botones el caso normal son dos
 * clics y el registro queda clasificado; el que tiene algo distinto que decir
 * sigue teniendo la caja de texto, que es lo que de verdad importa guardar.
 */
export const MOTIVOS_FRECUENTES = [
  'Era una prueba',
  'Está duplicado',
  'Error de carga',
  'Lo pidió el cliente',
] as const

export const MENSAJES_BORRADO: Record<string, string> = {
  DELETION_REASON_REQUIRED: 'Escribí por qué se borra: queda registrado.',
  DELETION_ENTITY_UNKNOWN: 'Eso no se puede borrar desde acá.',
  DELETION_NOT_FOUND: 'Ya no está. Puede que alguien lo haya borrado antes.',
  DELETION_BLOCKED: 'No se borró nada: no tenés permiso sobre eso.',
}

export function mensajeDeBorrado(e: unknown): string {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const codigo = Object.keys(MENSAJES_BORRADO).find((c) => texto.includes(c))
  if (codigo) return MENSAJES_BORRADO[codigo]!
  return texto || 'No se pudo borrar.'
}
