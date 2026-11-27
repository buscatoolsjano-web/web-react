import { supabase } from '@/services/supabase/client'

/**
 * Módulos por empresa (2026-11-27): lo que pide la pantalla a la base.
 * Las reglas —quién puede, qué módulos existen— las aplica la base
 * (`config_soy_admin_general`, `config_modulos_empresa`).
 */

/** ¿La persona es administradora general? */
export async function soyAdminGeneral(): Promise<boolean> {
  const { data, error } = await supabase.rpc('config_soy_admin_general')
  if (error) throw new Error(error.message)
  return data === true
}

/** `null` = todos los módulos; una lista = sólo esos además de lo básico. */
export async function guardarModulosEmpresa(companyId: string, modulos: readonly string[] | null): Promise<void> {
  const { error } = await supabase.rpc('config_modulos_empresa', {
    p_company: companyId,
    p_modulos: modulos === null ? null : [...modulos],
  })
  if (error) {
    throw new Error(
      error.message.includes('sin_permiso')
        ? 'Sólo un administrador general puede cambiar los módulos.'
        : 'No se pudieron guardar los módulos.',
    )
  }
}
