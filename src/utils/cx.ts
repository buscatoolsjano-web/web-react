/** Une clases CSS ignorando las vacías. Evita concatenaciones frágiles. */
export function cx(...clases: (string | undefined | null | false)[]): string {
  return clases.filter(Boolean).join(' ')
}
