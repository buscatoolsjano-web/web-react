import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  ErrorRegla,
  borrarRegla,
  crearEtiqueta,
  guardarRegla,
  listarAsignables,
  listarEtiquetas,
  listarReglas,
} from '../services/reglasCorreo'

/**
 * Reglas de correo (Fase 70 · E2), por TanStack Query como el resto de
 * Configuración.
 *
 * El aplicar retroactivo NO está acá: es una secuencia de tandas con su propio
 * avance, no una consulta que se cachea. Vive en `AplicarRegla`.
 */

export const clavesReglas = {
  lista: (c: string | null) => ['configuracion', c, 'reglas-correo'] as const,
  etiquetas: (c: string | null) => ['configuracion', c, 'etiquetas-correo'] as const,
  asignables: (c: string | null) => ['configuracion', c, 'asignables-correo'] as const,
}

const sinReintentoPorPermiso = (intentos: number, error: Error) =>
  !(error instanceof ErrorRegla && ['sin_permiso', 'no_existe'].includes(error.codigo)) && intentos < 1

const useCompany = () => useEmpresa().activa?.companyId ?? null

export function useReglasCorreo() {
  const c = useCompany()
  return useQuery({
    queryKey: clavesReglas.lista(c),
    queryFn: () => listarReglas(c!),
    enabled: c !== null,
    retry: sinReintentoPorPermiso,
  })
}

export function useEtiquetasCorreo() {
  const c = useCompany()
  return useQuery({
    queryKey: clavesReglas.etiquetas(c),
    queryFn: () => listarEtiquetas(c!),
    enabled: c !== null,
    retry: sinReintentoPorPermiso,
  })
}

export function useAsignablesCorreo() {
  const c = useCompany()
  return useQuery({
    queryKey: clavesReglas.asignables(c),
    queryFn: () => listarAsignables(c!),
    enabled: c !== null,
    staleTime: 5 * 60_000,
    retry: sinReintentoPorPermiso,
  })
}

export function useAccionesReglas() {
  const c = useCompany()
  const qc = useQueryClient()
  const refrescar = () => qc.invalidateQueries({ queryKey: clavesReglas.lista(c) })

  return {
    /* La empresa la pone el hook y no la pantalla: es la activa, y pasarla a
       mano en cada llamada es una invitación a mandar la equivocada. */
    guardar: useMutation({
      mutationFn: (r: Omit<Parameters<typeof guardarRegla>[0], 'companyId'>) =>
        guardarRegla({ ...r, companyId: c! }),
      onSuccess: refrescar,
    }),
    borrar: useMutation({ mutationFn: borrarRegla, onSuccess: refrescar }),
    /* La etiqueta se crea desde la misma pantalla: la regla suele ser su
       primer uso, y mandar a alguien a otra pantalla a crearla —y volver— es
       perder el formulario a medio llenar. */
    crearEtiqueta: useMutation({
      mutationFn: (nombre: string) => crearEtiqueta(c!, nombre),
      onSuccess: () => qc.invalidateQueries({ queryKey: clavesReglas.etiquetas(c) }),
    }),
  }
}
