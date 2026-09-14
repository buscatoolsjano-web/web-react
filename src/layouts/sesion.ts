import type { User } from '@supabase/supabase-js'

/** «Juan Pérez» → «JP»; sin nombre, la primera letra del email. */
export function iniciales(nombre: string | null, email: string): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length >= 2) return `${partes[0]![0]}${partes[partes.length - 1]![0]}`.toUpperCase()
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase()
  return (email[0] ?? '?').toUpperCase()
}

/** Nombre para mostrar: `full_name` de los metadatos si es texto; si no, null. */
export function nombreVisible(user: Pick<User, 'user_metadata'> | null): string | null {
  const n: unknown = user?.user_metadata?.full_name
  return typeof n === 'string' && n.trim() ? n.trim() : null
}
