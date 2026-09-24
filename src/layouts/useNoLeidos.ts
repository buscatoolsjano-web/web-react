import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ROLES_EMAILS } from '@/modules/emails/lib/permisos'
import { ROLES_WHATSAPP } from '@/modules/whatsapp/lib/permisos'
import { contarSinLeer } from '@/modules/emails/services/bandeja'
import { contarNoLeidos } from '@/modules/whatsapp/services/conversaciones'

/** Cuántos sin leer hay en cada bandeja. `0` también cuando no llegó todavía. */
export interface NoLeidos {
  emails: number
  whatsapp: number
}

/** Cada dos minutos. Es un contador, no una bandeja: no hace falta al segundo. */
const CADA = 2 * 60_000

/**
 * Los sin leer del menú (Fase 27 · E3).
 *
 * Dos consultas propias y livianas, una por bandeja, que **no** reemplazan a
 * las de cada módulo: acá sólo se necesita un número.
 *
 * Se piden sólo si el rol puede entrar a esa bandeja. Un vendedor no ve Emails,
 * así que pedir su contador sería una consulta que la base va a rechazar por
 * RLS y un número que nadie va a ver.
 *
 * Los errores se tragan a propósito: que falle un contador no puede romper el
 * menú. Si no se pudo leer, el badge no aparece — que es exactamente lo mismo
 * que muestra cuando no hay nada sin leer.
 */
export function useNoLeidos(): NoLeidos {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const rol = activa?.rol ?? ''
  // Los no leídos de WhatsApp son POR USUARIO, así que el id va en la clave.
  const usuarioId = useAuth().user?.id ?? null

  const emails = useQuery({
    queryKey: ['nav', companyId, 'sin-leer', 'emails'],
    queryFn: () => contarSinLeer(companyId!),
    enabled: companyId !== null && (ROLES_EMAILS as readonly string[]).includes(rol),
    refetchInterval: CADA,
    staleTime: CADA,
    retry: false,
  })

  const whatsapp = useQuery({
    queryKey: ['nav', companyId, 'sin-leer', 'whatsapp', usuarioId],
    queryFn: () => contarNoLeidos(companyId!, usuarioId),
    enabled: companyId !== null && (ROLES_WHATSAPP as readonly string[]).includes(rol),
    refetchInterval: CADA,
    staleTime: CADA,
    retry: false,
  })

  return { emails: emails.data ?? 0, whatsapp: whatsapp.data ?? 0 }
}
