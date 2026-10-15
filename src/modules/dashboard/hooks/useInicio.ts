import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { guardarInicio, leerInicio } from '../services/inicio'
import {
  INICIO_POR_DEFECTO,
  mover,
  normalizarInicio,
  paraGuardar,
  redimensionar,
  type ClaveWidget,
  type Widget,
} from '../lib/widgets'

/**
 * El inicio de cada uno: leerlo, acomodarlo y que quede guardado (Fase 76).
 *
 * ── Se guarda SOLO, en cada cambio ──────────────────────────────────────────
 *
 * No hay botón de guardar. Subir un widget es un gesto chico y reversible, y
 * un «¿guardar los cambios?» después de cada flecha sería más trabajo que el
 * cambio. Igual que la apariencia, que se aplica al tocarla.
 *
 * ── Y se ve antes de que el servidor conteste ───────────────────────────────
 *
 * El cambio entra en la caché —`setQueryData`— y recién después sale el pedido.
 * Una flecha que tarda 200 ms en moverse se siente rota, y se la aprieta dos
 * veces. Si el guardado falla, `error` lo dice y lo que se ve sigue siendo lo
 * último que se pidió: nada se pierde de vista, pero la próxima recarga va a
 * traer lo viejo, y por eso hay que avisarlo.
 */
export function useInicio(disponibles: readonly ClaveWidget[]) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const qc = useQueryClient()
  const clave = ['inicio', userId] as const

  const guardado = useQuery({
    queryKey: clave,
    queryFn: () => leerInicio(userId!),
    enabled: userId !== null,
    // Es una preferencia propia: no cambia salvo que la cambie uno mismo, y en
    // ese caso la escribe esta misma pantalla.
    staleTime: Infinity,
  })

  const guardar = useMutation({
    mutationFn: guardarInicio,
    onSuccess: (v) => qc.setQueryData(clave, v),
  })

  const widgets = useMemo(
    () => normalizarInicio(guardado.data, disponibles),
    [guardado.data, disponibles],
  )

  const aplicar = useCallback(
    (nuevos: readonly Widget[]) => {
      const valor = paraGuardar(nuevos)
      qc.setQueryData(clave, valor)
      guardar.mutate(valor)
    },
    // `clave` es un array nuevo en cada render: lo que importa es el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, guardar, userId],
  )

  return {
    widgets,
    cargando: guardado.isPending && userId !== null,
    error: guardar.error?.message ?? null,
    subir: (c: ClaveWidget) => aplicar(mover(widgets, c, -1)),
    bajar: (c: ClaveWidget) => aplicar(mover(widgets, c, 1)),
    agrandar: (c: ClaveWidget) => aplicar(redimensionar(widgets, c, 1)),
    achicar: (c: ClaveWidget) => aplicar(redimensionar(widgets, c, -1)),
    /** Vuelve al de fábrica: se guarda `null`, no una copia del default. */
    restaurar: () => {
      qc.setQueryData(clave, null)
      guardar.mutate(null)
    },
    /** El de fábrica, para comparar y decidir si ofrecer «Restaurar». */
    porDefecto: INICIO_POR_DEFECTO,
  }
}
