import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { escribirFiltros, hayFiltrosActivos, leerFiltros } from '../lib/filtros'
import { ErrorContenido } from '../lib/errores'
import {
  asignar,
  buscarClientes,
  cambiarEstado,
  clienteVinculado,
  eliminarHilo,
  listarBandeja,
  listarCuentas,
  marcarLeido,
  obtenerEstado,
  obtenerHilo,
  sugerenciasCliente,
  usuariosAsignables,
  vincularCliente,
} from '../services/bandeja'
import { traerHilo } from '../services/contenido'
import type {
  ClaseSugerencia,
  EstadoTrabajo,
  FilaBandeja,
  FiltrosEmails,
  HiloIndice,
  PaginaBandeja,
} from '../types'

/**
 * `companyId` va primero en cada clave, como en el resto de los módulos: dos
 * empresas nunca comparten caché, y cambiar de empresa no deja filas de la
 * otra en pantalla.
 */
export const claves = {
  todo: (companyId: string | null) => ['emails', companyId] as const,
  bandeja: (companyId: string | null) => ['emails', companyId, 'bandeja'] as const,
  cuentas: (companyId: string | null) => ['emails', companyId, 'cuentas'] as const,
  hilo: (companyId: string | null, id: string | undefined) => ['emails', companyId, 'hilo', id] as const,
  estado: (companyId: string | null, accountId: string | undefined, thread: string | undefined) =>
    ['emails', companyId, 'estado', accountId, thread] as const,
  asignables: (companyId: string | null) => ['emails', companyId, 'asignables'] as const,
  sugerencias: (companyId: string | null, accountId: string | undefined, thread: string | undefined) =>
    ['emails', companyId, 'sugerencias', accountId, thread] as const,
  cliente: (companyId: string | null, clienteId: string | null) =>
    ['emails', companyId, 'cliente', clienteId] as const,
  contenido: (accountId: string | undefined, thread: string | undefined) =>
    ['emails-contenido', accountId, thread] as const,
}

function useCompany(): string | null {
  return useEmpresa().activa?.companyId ?? null
}

export function useFiltrosEmails() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosEmails>) => {
      const siguiente = { ...leerFiltros(params), ...cambios }
      // Filtrar desde la página 9 dejaría la lista vacía sin explicación.
      if (cambios.pagina === undefined) siguiente.pagina = 1
      setParams(escribirFiltros(siguiente), { replace: true })
    },
    [params, setParams],
  )
  // «Limpiar filtros» no te muda de carpeta: seguís donde estabas, sin recortes.
  const limpiar = useCallback(() => {
    const p = new URLSearchParams()
    const { carpeta } = leerFiltros(params)
    if (carpeta !== 'todos') p.set('carpeta', carpeta)
    setParams(p, { replace: true })
  }, [params, setParams])

  return { filtros, aplicar, limpiar, hayFiltros: hayFiltrosActivos(filtros) }
}

export function useCuentas() {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.cuentas(companyId),
    queryFn: () => listarCuentas(companyId!),
    enabled: companyId !== null,
    staleTime: 60_000,
  })
}

export function useBandeja(filtros: FiltrosEmails) {
  const companyId = useCompany()
  return useQuery<PaginaBandeja>({
    queryKey: [...claves.bandeja(companyId), filtros],
    queryFn: () => listarBandeja(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) =>
      consultaPrevia?.queryKey[1] === companyId ? previa : undefined,
    // Realtime mantiene la lista al día: no hace falta volver a pedirla sola.
    staleTime: 5 * 60_000,
  })
}

export function useHiloIndice(id: string | undefined) {
  const companyId = useCompany()
  return useQuery<HiloIndice | null>({
    queryKey: claves.hilo(companyId, id),
    queryFn: () => obtenerHilo(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 60_000,
  })
}

export function useEstadoHilo(hilo: HiloIndice | null | undefined) {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.estado(companyId, hilo?.accountId, hilo?.gmailThreadId),
    queryFn: () => obtenerEstado(hilo!.accountId, hilo!.gmailThreadId),
    enabled: !!hilo,
    staleTime: 60_000,
  })
}

export function useAsignables() {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.asignables(companyId),
    queryFn: () => usuariosAsignables(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useSugerencias(hilo: HiloIndice | null | undefined, activo: boolean) {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.sugerencias(companyId, hilo?.accountId, hilo?.gmailThreadId),
    queryFn: () => sugerenciasCliente(hilo!.accountId, hilo!.gmailThreadId),
    enabled: !!hilo && activo,
    staleTime: 5 * 60_000,
  })
}

export function useClienteVinculado(clienteId: string | null) {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.cliente(companyId, clienteId),
    queryFn: () => clienteVinculado(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 60_000,
  })
}

export function useBuscarClientes(texto: string) {
  const companyId = useCompany()
  return useQuery({
    queryKey: ['emails', companyId, 'buscar-cliente', texto.trim()],
    queryFn: () => buscarClientes(companyId!, texto),
    enabled: companyId !== null && texto.trim().length >= 2,
    staleTime: 30_000,
  })
}

/**
 * El contenido, desde Gmail vía Cloud Run.
 *
 * `gcTime: 0`: al salir del hilo, el cuerpo se descarta de la memoria. Sin
 * reintentos automáticos: un 429 reintentado en loop es exactamente lo que no
 * hay que hacerle a la cuota. La persona tiene un botón.
 */
export function useContenidoHilo(hilo: HiloIndice | null | undefined) {
  return useQuery({
    queryKey: claves.contenido(hilo?.accountId, hilo?.gmailThreadId),
    queryFn: ({ signal }) => traerHilo(hilo!.accountId, hilo!.gmailThreadId, signal),
    enabled: !!hilo,
    retry: (intentos, error) => intentos < 1 && error instanceof ErrorContenido && error.codigo === 'sin_red',
    staleTime: Infinity,
    gcTime: 0,
  })
}

// ── Mutaciones ────────────────────────────────────────────────────────────

/** Parchea la fila en todas las páginas cacheadas de la bandeja. */
export function parchearFilas(
  qc: ReturnType<typeof useQueryClient>,
  companyId: string | null,
  coincide: (f: FilaBandeja) => boolean,
  cambio: Partial<FilaBandeja>,
): void {
  qc.setQueriesData<PaginaBandeja>({ queryKey: claves.bandeja(companyId) }, (pagina) => {
    if (!pagina) return pagina
    let tocada = false
    const filas = pagina.filas.map((f) => {
      if (!coincide(f)) return f
      tocada = true
      return { ...f, ...cambio }
    })
    if (!tocada) return pagina
    const antes = pagina.filas.filter((f) => coincide(f) && f.sinLeer).length
    const despues = filas.filter((f) => coincide(f) && f.sinLeer).length
    return { ...pagina, filas, totalSinLeer: Math.max(0, pagina.totalSinLeer - (antes - despues)) }
  })
}

export function useMarcarLeido() {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (h: HiloIndice) => marcarLeido(h.accountId, h.gmailThreadId),
    onSuccess: (_r, h) => parchearFilas(qc, companyId, (f) => f.id === h.id, { sinLeer: false }),
  })
}

/**
 * Eliminar un hilo de la bandeja del ERP, o devolverlo (Fase 28 · E2).
 *
 * No se parchea la fila: el hilo cambia de carpeta, así que la página que se
 * está mirando ya no es la misma. Se vuelve a pedir, y de paso se corrige el
 * total, que con un parche quedaría mintiendo.
 *
 * Las carpetas que NO se están mirando se tiran de la caché en vez de
 * invalidarlas. Invalidar no alcanza: el evento de tiempo real llega enseguida
 * y `parchearFilas` las vuelve a escribir, y escribir una consulta le borra la
 * marca de inválida sin haberla pedido de nuevo. Así quedaba «Eliminados» en
 * cero después de eliminar. Tirarlas no se puede deshacer, y cuesta cero
 * requests: se piden recién cuando alguien abre esa carpeta.
 */
export function useEliminarHilo() {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fila, eliminar }: { fila: FilaBandeja; eliminar: boolean }) =>
      eliminarHilo(fila.accountId, fila.gmailThreadId, eliminar),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
      qc.removeQueries({ queryKey: claves.bandeja(companyId), type: 'inactive' })
      // El globito rojo del menú cuenta sin leer: lo eliminado no cuenta más.
      void qc.invalidateQueries({ queryKey: ['nav', companyId, 'sin-leer', 'emails'] })
    },
  })
}

function useInvalidarTrabajo() {
  const companyId = useCompany()
  const qc = useQueryClient()
  return (h: HiloIndice) => {
    void qc.invalidateQueries({ queryKey: claves.estado(companyId, h.accountId, h.gmailThreadId) })
    void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
  }
}

export function useAsignar(hilo: HiloIndice | null | undefined) {
  const invalidar = useInvalidarTrabajo()
  return useMutation({
    mutationFn: (usuario: string | null) => asignar(hilo!.accountId, hilo!.gmailThreadId, usuario),
    onSettled: () => hilo && invalidar(hilo),
  })
}

export function useCambiarEstado(hilo: HiloIndice | null | undefined) {
  const invalidar = useInvalidarTrabajo()
  return useMutation({
    mutationFn: (estado: EstadoTrabajo) => cambiarEstado(hilo!.accountId, hilo!.gmailThreadId, estado),
    onSettled: () => hilo && invalidar(hilo),
  })
}

export function useVincular(hilo: HiloIndice | null | undefined) {
  const invalidar = useInvalidarTrabajo()
  return useMutation({
    mutationFn: (c: { id: string; contactoId: string | null; origen: ClaseSugerencia | 'manual' } | null) =>
      vincularCliente(hilo!.accountId, hilo!.gmailThreadId, c),
    onSettled: () => hilo && invalidar(hilo),
  })
}
