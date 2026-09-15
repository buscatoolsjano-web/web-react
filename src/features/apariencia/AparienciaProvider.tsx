import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { AparienciaContext, type AparienciaContextValue } from './aparienciaContext'
import {
  APARIENCIA_ORIGINAL,
  aplicarApariencia,
  esOriginal,
  guardarAparienciaLocal,
  leerAparienciaGuardada,
  type Apariencia,
} from './opciones'
import { guardarApariencia, leerApariencia } from '@/services/apariencia/apariencia'

/**
 * Apariencia del usuario con sesión.
 *
 * - Fuente de verdad: `profiles.appearance` (mismo usuario en otro
 *   dispositivo → misma apariencia).
 * - Cambiar: se aplica al instante (vista previa optimista) y se guarda. Si
 *   el servidor lo rechaza, se vuelve a lo último confirmado y se informa.
 * - Sin sesión: siempre el original Buscatools (login, recuperar contraseña).
 * - «Restaurar original» guarda NULL: el original es la ausencia de preferencia.
 */
export function AparienciaProvider({ children }: { children: ReactNode }) {
  const { session, cargando } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id ?? null
  const [optimista, setOptimista] = useState<Apariencia | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cola = useRef(Promise.resolve())
  const pendientes = useRef(0)

  const { data: servidor } = useQuery({
    queryKey: ['apariencia', userId],
    queryFn: () => leerApariencia(userId!),
    enabled: userId !== null,
    staleTime: Infinity,
  })

  const confirmada = userId ? (servidor ?? leerAparienciaGuardada(userId) ?? APARIENCIA_ORIGINAL) : APARIENCIA_ORIGINAL
  const apariencia = userId ? (optimista ?? confirmada) : APARIENCIA_ORIGINAL

  // Mientras se recupera la sesión persistida no se toca nada: main.tsx ya
  // aplicó la caché y pintar el original en el medio sería un destello.
  useEffect(() => {
    if (cargando && !userId) return
    aplicarApariencia(apariencia)
  }, [apariencia, cargando, userId])

  useEffect(() => {
    if (userId && servidor) guardarAparienciaLocal(userId, servidor)
  }, [userId, servidor])

  const persistir = useCallback(
    (siguiente: Apariencia) => {
      if (!userId) return
      setOptimista(siguiente)
      setError(null)
      pendientes.current += 1
      setGuardando(true)
      cola.current = cola.current.then(async () => {
        try {
          // La base toma el usuario del JWT: no se manda ningún id.
          await guardarApariencia(esOriginal(siguiente) ? null : siguiente)
          queryClient.setQueryData(['apariencia', userId], siguiente)
          guardarAparienciaLocal(userId, siguiente)
          setOptimista((actual) => (actual === siguiente ? null : actual))
        } catch (e) {
          setOptimista(null)
          setError(e instanceof Error ? e.message : 'No se pudo guardar la apariencia.')
        } finally {
          pendientes.current -= 1
          if (pendientes.current === 0) setGuardando(false)
        }
      })
    },
    [userId, queryClient],
  )

  const valor = useMemo<AparienciaContextValue>(
    () => ({
      apariencia,
      cambiar: (cambios) => persistir({ ...apariencia, ...cambios, version: 1 }),
      restaurar: () => persistir(APARIENCIA_ORIGINAL),
      guardando,
      error,
      disponible: userId !== null,
    }),
    [apariencia, persistir, guardando, error, userId],
  )

  return <AparienciaContext.Provider value={valor}>{children}</AparienciaContext.Provider>
}
