import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  ErrorMaestro,
  cambiarEstadoMarca,
  crearCategoria,
  crearMarca,
  eliminarCategoria,
  eliminarMarca,
  listarAtributos,
  listarCategorias,
  listarClientesDeLista,
  listarItemsDeLista,
  listarListasPrecios,
  listarMarcas,
  renombrarCategoria,
  type ConsultaItems,
} from '../services/maestros'

export const clavesMaestros = {
  marcas: (c: string | null) => ['configuracion', c, 'marcas'] as const,
  categorias: (c: string | null) => ['configuracion', c, 'categorias'] as const,
  atributos: (c: string | null) => ['configuracion', c, 'atributos'] as const,
  listas: (c: string | null) => ['configuracion', c, 'listas-precios'] as const,
  clientes: (c: string | null, l: string) => ['configuracion', c, 'listas-precios', l, 'clientes'] as const,
  items: (c: string | null, l: string, q: ConsultaItems) => ['configuracion', c, 'listas-precios', l, 'items', q] as const,
}

const sinReintentoPorPermiso = (intentos: number, error: Error) =>
  !(error instanceof ErrorMaestro && ['sin_permiso', 'no_encontrado'].includes(error.codigo)) && intentos < 1

const useCompany = () => useEmpresa().activa?.companyId ?? null

export function useMarcas() {
  const c = useCompany()
  return useQuery({ queryKey: clavesMaestros.marcas(c), queryFn: () => listarMarcas(c!), enabled: c !== null, retry: sinReintentoPorPermiso })
}

export function useCategorias() {
  const c = useCompany()
  return useQuery({ queryKey: clavesMaestros.categorias(c), queryFn: () => listarCategorias(c!), enabled: c !== null, retry: sinReintentoPorPermiso })
}

export function useAtributos() {
  const c = useCompany()
  return useQuery({ queryKey: clavesMaestros.atributos(c), queryFn: () => listarAtributos(c!), enabled: c !== null, staleTime: 5 * 60_000, retry: sinReintentoPorPermiso })
}

export function useListasPrecios() {
  const c = useCompany()
  return useQuery({ queryKey: clavesMaestros.listas(c), queryFn: () => listarListasPrecios(c!), enabled: c !== null, staleTime: 60_000, retry: sinReintentoPorPermiso })
}

export function useClientesDeLista(listaId: string) {
  const c = useCompany()
  return useQuery({ queryKey: clavesMaestros.clientes(c, listaId), queryFn: () => listarClientesDeLista(c!, listaId), enabled: c !== null, retry: sinReintentoPorPermiso })
}

/** Una página por consulta; mientras llega la siguiente se sigue viendo la anterior. */
export function useItemsDeLista(listaId: string, q: ConsultaItems) {
  const c = useCompany()
  return useQuery({
    queryKey: clavesMaestros.items(c, listaId, q),
    queryFn: () => listarItemsDeLista(c!, listaId, q),
    enabled: c !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: sinReintentoPorPermiso,
  })
}

/**
 * Escrituras de marcas y categorías. Siempre se relee de la base al terminar
 * (bien o mal): los conteos y el estado real los da el servidor. También se
 * invalida el Catálogo, que filtra por marcas activas y categorías.
 */
export function useAccionesMaestros() {
  const qc = useQueryClient()
  const c = useCompany()
  const refrescar = (clave: readonly unknown[]) => async () => {
    await qc.invalidateQueries({ queryKey: clave })
    await qc.invalidateQueries({ queryKey: ['catalogo'] })
  }
  const marcas = refrescar(clavesMaestros.marcas(c))
  const categorias = refrescar(clavesMaestros.categorias(c))

  return {
    crearMarca: useMutation({ mutationFn: (nombre: string) => crearMarca(c!, nombre), onSettled: marcas }),
    estadoMarca: useMutation({ mutationFn: (v: { id: string; activa: boolean }) => cambiarEstadoMarca(c!, v.id, v.activa), onSettled: marcas }),
    eliminarMarca: useMutation({ mutationFn: (id: string) => eliminarMarca(c!, id), onSettled: marcas }),
    crearCategoria: useMutation({ mutationFn: (nombre: string) => crearCategoria(c!, nombre), onSettled: categorias }),
    renombrarCategoria: useMutation({
      mutationFn: (v: { id: string; esperado: string; nombre: string }) => renombrarCategoria(c!, v.id, v.esperado, v.nombre),
      onSettled: categorias,
    }),
    eliminarCategoria: useMutation({ mutationFn: (id: string) => eliminarCategoria(c!, id), onSettled: categorias }),
  }
}
