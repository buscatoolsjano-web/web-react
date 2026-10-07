import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorPlantilla, listarPlantillas, misDatosDeFirma, miUsuarioId, previsualizar } from '../services/plantillas'

/**
 * Plantillas de correo (Fase 41 · E2), por TanStack Query como el resto de
 * Configuración: una sola fuente de verdad en caché y nada de efectos que
 * escriban estado a mano.
 */

export const clavesPlantillas = {
  lista: (c: string | null) => ['configuracion', c, 'plantillas'] as const,
  misDatos: () => ['configuracion', 'mis-datos-de-firma'] as const,
  usuario: () => ['sesion', 'usuario-id'] as const,
  previa: (c: string | null, contenido: string, html: boolean) =>
    ['configuracion', c, 'plantilla-previa', html, contenido] as const,
}

const sinReintentoPorPermiso = (intentos: number, error: Error) =>
  !(error instanceof ErrorPlantilla && ['sin_permiso', 'sin_sesion'].includes(error.codigo)) && intentos < 1

const useCompany = () => useEmpresa().activa?.companyId ?? null

export function usePlantillas() {
  const c = useCompany()
  return useQuery({
    queryKey: clavesPlantillas.lista(c),
    queryFn: () => listarPlantillas(c!),
    enabled: c !== null,
    retry: sinReintentoPorPermiso,
  })
}

export function useMisDatosDeFirma() {
  return useQuery({ queryKey: clavesPlantillas.misDatos(), queryFn: misDatosDeFirma, retry: sinReintentoPorPermiso })
}

/** El id de quien está mirando: con eso se sabe cuál plantilla es suya. */
export function useUsuarioId() {
  return useQuery({
    queryKey: clavesPlantillas.usuario(),
    queryFn: miUsuarioId,
    staleTime: Infinity,
  })
}

/**
 * La vista previa, resuelta por el servidor y con freno.
 *
 * El `contenido` es parte de la clave, así que cada texto distinto se cachea y
 * volver atrás no vuelve a viajar. Los 400 ms los pone quien llama, con un
 * valor retrasado: desde acá cada viaje cuesta unos 220 ms fijos y no tiene
 * sentido pagarlos por cada tecla.
 */
export function usePrevia(contenido: string, html: boolean) {
  const c = useCompany()
  return useQuery({
    queryKey: clavesPlantillas.previa(c, contenido, html),
    queryFn: () => previsualizar(c!, contenido, html),
    enabled: c !== null,
    retry: false,
    staleTime: 5 * 60_000,
  })
}
