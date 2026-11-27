import { useQuery } from '@tanstack/react-query'
import { enSegundoPlano, META_SEGUNDO_PLANO } from '@/lib/segundoPlano'
import { soyAdminGeneral } from '@/services/empresa/modulos'
import { useEmpresa } from './useEmpresa'

/**
 * ¿La persona es administradora GENERAL? (módulos por empresa, 2026-11-27)
 *
 * No alcanza con ser admin de una empresa: el admin de un distribuidor es admin
 * de SU empresa y no puede crear empresas ni cambiar módulos. Eso lo decide
 * `app.general_admins` en la base, que es también la que lo vuelve a exigir en
 * `config_crear_empresa` y `config_modulos_empresa`; esto sólo decide si se
 * ofrecen los botones.
 *
 * Sólo se pregunta si es admin de alguna empresa (un general siempre lo es), y
 * en segundo plano: no dibuja la pantalla.
 */
export function useAdminGeneral(): boolean {
  const { membresias } = useEmpresa()
  const esAdminDeAlguna = membresias.some((m) => m.rol === 'admin')
  const q = useQuery({
    queryKey: ['config', 'soy-admin-general'],
    queryFn: () => enSegundoPlano(soyAdminGeneral),
    meta: META_SEGUNDO_PLANO,
    enabled: esAdminDeAlguna,
    staleTime: 30 * 60_000,
  })
  return q.data === true
}
