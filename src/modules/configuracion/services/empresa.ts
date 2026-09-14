import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import type { CampoEditable, DatosEmpresa } from '../lib/empresa'

/**
 * Configuración → Empresa.
 *
 *   · leer y editar datos: RPC con el JWT de la persona (`config_empresa_*`),
 *     con lista blanca y concurrencia optimista por `updated_at`;
 *   · logo: Edge Function `config-empresa-logo`, que valida los bytes y es la
 *     única que escribe en el bucket privado `empresa-logos`;
 *   · ver el logo: URL firmada de corta duración (el bucket no es público).
 *
 * Nunca se hace UPDATE directo de `companies`: la base ya no lo permite.
 */

export class ErrorEmpresa extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorEmpresa'
  }
}

const CODIGOS = ['sin_permiso', 'conflicto_version', 'datos_invalidos', 'campos_no_permitidos'] as const

function deErrorRpc(e: { message: string }): ErrorEmpresa {
  const base = e.message.split(':')[0] ?? ''
  if ((CODIGOS as readonly string[]).includes(base)) return new ErrorEmpresa(e.message)
  if (/failed to fetch|network/i.test(e.message)) return new ErrorEmpresa('sin_red')
  return new ErrorEmpresa('desconocido')
}

export async function obtenerEmpresa(companyId: string): Promise<DatosEmpresa> {
  const { data, error } = await supabase.rpc('config_empresa_obtener', { p_company: companyId })
  if (error) throw deErrorRpc(error)
  const fila = data?.[0]
  if (!fila) throw new ErrorEmpresa('sin_permiso')
  return fila
}

export async function actualizarEmpresa(
  companyId: string,
  version: string,
  datos: Partial<Record<CampoEditable, string | null>>,
): Promise<{ version: string; campos: string[] }> {
  const { data, error } = await supabase.rpc('config_empresa_actualizar', {
    p_company: companyId,
    p_esperado: version,
    p_datos: datos,
  })
  if (error) throw deErrorRpc(error)
  const fila = data?.[0]
  if (!fila) throw new ErrorEmpresa('desconocido')
  return { version: fila.updated_at, campos: fila.campos }
}

interface RespuestaLogo {
  resultado?: 'logo_actualizado' | 'logo_eliminado'
  logo_path?: string | null
  version?: string
  error?: string
}

async function llamarLogo(form: FormData): Promise<{ logoPath: string | null; version: string }> {
  const respuesta = await supabase.functions.invoke<RespuestaLogo>('config-empresa-logo', { body: form })
  const data: RespuestaLogo | null = respuesta.data
  const error: unknown = respuesta.error
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const json = (await (error.context as Response).json().catch(() => null)) as RespuestaLogo | null
      throw new ErrorEmpresa(json?.error ?? ((error.context as Response).status === 401 ? 'sesion_invalida' : 'desconocido'))
    }
    if (error instanceof FunctionsFetchError) throw new ErrorEmpresa('sin_red')
    throw new ErrorEmpresa('desconocido')
  }
  if (!data?.resultado || !data.version) throw new ErrorEmpresa('desconocido')
  return { logoPath: data.logo_path ?? null, version: data.version }
}

export function subirLogo(companyId: string, version: string, archivo: File) {
  const form = new FormData()
  form.append('accion', 'subir')
  form.append('company_id', companyId)
  form.append('version', version)
  form.append('archivo', archivo)
  return llamarLogo(form)
}

export function quitarLogo(companyId: string, version: string) {
  const form = new FormData()
  form.append('accion', 'eliminar')
  form.append('company_id', companyId)
  form.append('version', version)
  return llamarLogo(form)
}

/** URL firmada por 10 minutos. La lectura la autoriza la RLS del bucket (miembros de la empresa). */
export async function urlLogo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('empresa-logos').createSignedUrl(path, 600)
  if (error || !data) throw new ErrorEmpresa('logo_no_disponible')
  return data.signedUrl
}
