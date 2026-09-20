import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FILTROS_INICIALES } from '../types'
import {
  candidatosDeOc,
  contactosDeCliente,
  direccionesDeCliente,
  documentosDeCliente,
  gruposCuitLegacy,
  listarClientes,
  obtenerCliente,
  rubrosUsados,
  tarifasDeEmpresa,
  vendedoresDeEmpresa,
} from '../services/clientes'
import { productosDelCliente } from '../services/productos'
import { eventosDeCliente } from '../services/trazabilidad'
import { listarAdjuntos } from '../services/adjuntos'
import {
  clientesSimilares,
  valeLaPenaBuscar,
  type EntradaDeBusqueda,
} from '../services/duplicados'
import type {
  AdjuntoCliente,
  ClienteSimilar,
  CandidatoDeOc,
  ClienteDetalle,
  ContactoCliente,
  DireccionCliente,
  EventoDeCliente,
  FiltrosClientes,
  PaginaDeClientes,
  PaginaDeDocumentos,
  PaginaDeProductos,
} from '../types'

/**
 * `companyId` es lo primero de cada clave de caché, igual que en Ventas y en
 * el Catálogo. Dos empresas nunca comparten entrada, y `placeholderData` sólo
 * conserva la página anterior si es de la MISMA empresa: si no, las filas de
 * una quedaban en pantalla bajo el encabezado de la otra.
 */
export function useClientes(filtros: FiltrosClientes) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeClientes>({
    queryKey: ['clientes', companyId, 'listado', filtros],
    queryFn: () => listarClientes(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useCliente(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ClienteDetalle | null>({
    queryKey: ['clientes', companyId, 'detalle', id],
    queryFn: () => obtenerCliente(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useContactos(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ContactoCliente[]>({
    queryKey: ['clientes', companyId, 'contactos', clienteId],
    queryFn: () => contactosDeCliente(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

/**
 * El historial documental, paginado (Fase 17 · E4).
 *
 * `habilitado` es lo que hace que la consulta **no** salga hasta que alguien
 * abre la pestaña: abrir la ficha de Grupo Mirgor ya no trae sus 258
 * documentos para no mostrarlos.
 */
export function useHistorial(
  clienteId: string | undefined,
  opciones: { pagina: number; porPagina: number; tipo: string | null; habilitado: boolean },
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const { pagina, porPagina, tipo, habilitado } = opciones

  return useQuery<PaginaDeDocumentos>({
    queryKey: ['clientes', companyId, 'historial', clienteId, tipo, pagina, porPagina],
    queryFn: () => documentosDeCliente(clienteId!, { tipo, pagina, porPagina }),
    enabled: habilitado && companyId !== null && !!clienteId,
    // Cambiar de página no tiene que parpadear en blanco, pero la página de
    // OTRO cliente no se muestra jamás bajo este encabezado.
    placeholderData: (previa, consultaPrevia) =>
      consultaPrevia?.queryKey[3] === clienteId ? previa : undefined,
    staleTime: 30_000,
  })
}

/**
 * Las direcciones. Se piden **siempre**: la principal va en la cabecera.
 * Son pocas por cliente y la consulta es una sola.
 */
export function useDirecciones(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<DireccionCliente[]>({
    queryKey: ['clientes', companyId, 'direcciones', clienteId],
    queryFn: () => direccionesDeCliente(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

/**
 * Los candidatos de orden de compra. Lazy: existen en 19 clientes de 1.010, y
 * pedirlos al abrir cada ficha era pagar por algo que el 98% no tiene.
 */
export function useCandidatosDeOc(clienteId: string | undefined, habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<CandidatoDeOc[]>({
    queryKey: ['clientes', companyId, 'oc', clienteId],
    queryFn: () => candidatosDeOc(companyId!, clienteId!),
    enabled: habilitado && companyId !== null && !!clienteId,
    staleTime: 5 * 60_000,
  })
}

/** Qué compra el cliente (Fase 17 · E4). Lazy y paginado. */
export function useProductosDelCliente(
  clienteId: string | undefined,
  opciones: { texto: string; pagina: number; porPagina: number; habilitado: boolean },
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const { texto, pagina, porPagina, habilitado } = opciones

  return useQuery<PaginaDeProductos>({
    queryKey: ['clientes', companyId, 'productos', clienteId, texto, pagina, porPagina],
    queryFn: () => productosDelCliente(clienteId!, { texto, pagina, porPagina }),
    enabled: habilitado && companyId !== null && !!clienteId,
    placeholderData: (previa, consultaPrevia) =>
      consultaPrevia?.queryKey[3] === clienteId ? previa : undefined,
    staleTime: 60_000,
  })
}

/** La trazabilidad. Lazy: es la pestaña que menos se abre. */
export function useTrazabilidad(
  clienteId: string | undefined,
  opciones: { pagina: number; porPagina: number; habilitado: boolean },
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const { pagina, porPagina, habilitado } = opciones

  return useQuery<{ eventos: EventoDeCliente[]; hayMas: boolean }>({
    queryKey: ['clientes', companyId, 'trazabilidad', clienteId, pagina, porPagina],
    queryFn: () =>
      eventosDeCliente(companyId!, clienteId!, {
        limite: porPagina,
        desplazamiento: (pagina - 1) * porPagina,
      }),
    enabled: habilitado && companyId !== null && !!clienteId,
    placeholderData: (previa, consultaPrevia) =>
      consultaPrevia?.queryKey[3] === clienteId ? previa : undefined,
    staleTime: 30_000,
  })
}

/** Los adjuntos del cliente. Lazy. */
export function useAdjuntosDeCliente(clienteId: string | undefined, habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<AdjuntoCliente[]>({
    queryKey: ['clientes', companyId, 'adjuntos', clienteId],
    queryFn: () => listarAdjuntos(companyId!, clienteId!),
    enabled: habilitado && companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

/**
 * La cola de revisión (Fase 17 · E5).
 *
 * Es el mismo listado de siempre con `soloRevision`, paginado del lado del
 * servidor: no se traen los 1.010 clientes para filtrar 40 en el navegador, y
 * el día que sean 400 la pantalla no cambia.
 */
export function useColaDeRevision(opciones: { pagina: number; porPagina: number }) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const { pagina, porPagina } = opciones

  return useQuery<PaginaDeClientes>({
    queryKey: ['clientes', companyId, 'revision', pagina, porPagina],
    queryFn: () =>
      listarClientes(companyId!, {
        ...FILTROS_INICIALES,
        soloRevision: true,
        pagina,
        porPagina,
      }),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) =>
      consultaPrevia?.queryKey[1] === companyId ? previa : undefined,
    staleTime: 30_000,
  })
}

/**
 * El CUIT del sistema anterior de los clientes que la cola está mostrando
 * (Fase 19 · E3B).
 *
 * Va después de la cola y sólo con los ids de ESA página: no se traen las
 * evidencias de todos los clientes para mostrar 25. Con la cola vacía no sale
 * ninguna consulta.
 *
 * La clave incluye los ids, así que cambiar de página pide lo suyo y volver
 * atrás lo encuentra en caché.
 */
export function useGruposCuitLegacy(clienteIds: readonly string[]) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const ids = [...clienteIds].sort()

  return useQuery({
    queryKey: ['clientes', companyId, 'cuit-legacy', ids],
    queryFn: () => gruposCuitLegacy(ids),
    enabled: companyId !== null && ids.length > 0,
    staleTime: 5 * 60_000,
  })
}

/**
 * Clientes que se parecen al que se está cargando (Fase 17 · E5).
 *
 * No sale hasta que hay algo con lo que buscar —un CUIT completo, un email, un
 * teléfono de seis dígitos o cuatro letras de nombre—, así que escribir la
 * primera letra no dispara nada. La caché guarda por entrada exacta: volver a
 * un valor ya consultado no vuelve a preguntar.
 */
export function useClientesSimilares(entrada: EntradaDeBusqueda) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const habilitado = companyId !== null && valeLaPenaBuscar(entrada)

  return useQuery<ClienteSimilar[]>({
    queryKey: [
      'clientes',
      companyId,
      'similares',
      entrada.nombre ?? '',
      entrada.cuit ?? '',
      entrada.email ?? '',
      entrada.telefono ?? '',
      entrada.excluir ?? '',
    ],
    queryFn: () => clientesSimilares(companyId!, entrada),
    enabled: habilitado,
    staleTime: 60_000,
  })
}

export function useRubros() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<string[]>({
    queryKey: ['clientes', companyId, 'rubros'],
    queryFn: () => rubrosUsados(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

/**
 * Vendedores y tarifas de la empresa, para los dos desplegables comerciales
 * de la ficha (Fase 17 · E1). Se piden una sola vez y se cachean: cambian
 * cuando alguien entra o sale del equipo, no cuando se edita un cliente.
 */
export function useOpcionesComerciales(habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  const vendedores = useQuery({
    queryKey: ['clientes', companyId, 'vendedores'],
    queryFn: () => vendedoresDeEmpresa(companyId!),
    enabled: habilitado && companyId !== null,
    staleTime: 10 * 60_000,
  })
  const tarifas = useQuery({
    queryKey: ['clientes', companyId, 'tarifas'],
    queryFn: () => tarifasDeEmpresa(companyId!),
    enabled: habilitado && companyId !== null,
    staleTime: 10 * 60_000,
  })
  return { vendedores: vendedores.data ?? [], tarifas: tarifas.data ?? [] }
}
