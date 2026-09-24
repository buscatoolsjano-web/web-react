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
  borrarEtiqueta,
  clienteVinculado,
  eliminarHilo,
  etiquetarHilo,
  guardarEtiqueta,
  listarBandeja,
  listarEtiquetas,
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
  ColorEtiqueta,
  EstadoTrabajo,
  EtiquetaEmail,
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
  etiquetas: (companyId: string | null) => ['emails', companyId, 'etiquetas'] as const,
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

// ── Etiquetas (Fase 28 · E8) ──────────────────────────────────────────────

export function useEtiquetas() {
  const companyId = useCompany()
  return useQuery({
    queryKey: claves.etiquetas(companyId),
    queryFn: () => listarEtiquetas(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useGuardarEtiqueta() {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: { id: string | null; nombre: string; color: ColorEtiqueta }) =>
      guardarEtiqueta(companyId!, datos),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: claves.etiquetas(companyId) })
      // Renombrar cambia lo que dicen los chips de cada fila.
      void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
    },
  })
}

/**
 * Borrar una etiqueta la saca de todos los hilos que la tenían.
 *
 * Por eso las páginas que no se están mirando se tiran en vez de invalidarse:
 * el evento de tiempo real las reescribiría con los chips viejos.
 */
export function useBorrarEtiqueta() {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labelId: string) => borrarEtiqueta(labelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: claves.etiquetas(companyId) })
      void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
      qc.removeQueries({ queryKey: claves.bandeja(companyId), type: 'inactive' })
    },
  })
}

/**
 * Poner o sacar una etiqueta de un hilo.
 *
 * La fila se parchea en la caché: con una etiqueta puesta el hilo no cambia de
 * lugar ni de página, así que volver a pedir 25 filas para pintar un chip
 * sería pagar la bandeja entera. La excepción es estar filtrando POR esa
 * etiqueta, donde el hilo sí entra o sale de la vista.
 */
export function useEtiquetarHilo(filtros: FiltrosEmails) {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fila, etiqueta, poner }: { fila: FilaBandeja; etiqueta: EtiquetaEmail; poner: boolean }) =>
      etiquetarHilo(fila.accountId, fila.gmailThreadId, etiqueta.id, poner),
    onSuccess: (_r, { fila, etiqueta, poner }) => {
      if (filtros.etiqueta !== null) {
        void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
        qc.removeQueries({ queryKey: claves.bandeja(companyId), type: 'inactive' })
        return
      }
      parchearFilas(qc, companyId, (f) => f.id === fila.id, {
        etiquetas: poner
          ? [...fila.etiquetas, etiqueta].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
          : fila.etiquetas.filter((e) => e.id !== etiqueta.id),
      })
    },
  })
}

/**
 * Asignar desde la bandeja, sin abrir el hilo (Fase 28 · E8).
 *
 * Es la MISMA RPC que el panel del hilo: una sola forma de asignar. Acá se
 * parchea la fila porque asignar no la mueve de lugar —salvo que se esté
 * filtrando por asignación, donde sí puede sacarla de la vista.
 */
export function useAsignarDesdeBandeja(filtros: FiltrosEmails) {
  const companyId = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fila, usuario }: { fila: FilaBandeja; usuario: string | null; nombre: string | null }) =>
      asignar(fila.accountId, fila.gmailThreadId, usuario),
    onSuccess: (_r, { fila, usuario, nombre }) => {
      void qc.invalidateQueries({ queryKey: claves.estado(companyId, fila.accountId, fila.gmailThreadId) })
      if (filtros.asignado !== null) {
        void qc.invalidateQueries({ queryKey: claves.bandeja(companyId) })
        qc.removeQueries({ queryKey: claves.bandeja(companyId), type: 'inactive' })
        return
      }
      parchearFilas(qc, companyId, (f) => f.id === fila.id, { asignadoA: usuario, asignadoNombre: nombre })
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
