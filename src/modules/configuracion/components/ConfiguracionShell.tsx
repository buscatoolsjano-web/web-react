import { NavLink, Outlet } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { puedeVerConfiguracion, seccionesVisibles } from '../lib/permisos'
import styles from './Configuracion.module.css'

/**
 * Esqueleto de Configuración: navegación interna + la subsección.
 *
 * Las secciones visibles dependen del rol (lib/permisos). Auditoría se agrega
 * cuando exista; no se muestra como «próximamente» para no ofrecer pantallas
 * que no hay.
 */

export function ConfiguracionShell() {
  const { activa, cargando } = useEmpresa()

  if (cargando) return <SkeletonRows rows={4} columns={2} label="Cargando…" />
  if (!puedeVerConfiguracion(activa?.rol)) {
    return (
      <div className={styles.page}>
        <PageHeader title="Configuración" />
        <EmptyState icon="settings" title="Sin acceso a Configuración" description="Tu rol en esta empresa no tiene acceso a Configuración." />
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.subnav} aria-label="Secciones de configuración">
        <p className={styles.subnavTitulo}>Configuración</p>
        {seccionesVisibles(activa?.rol).map((s) => (
          <NavLink key={s.to} to={s.to} className={({ isActive }) => cx(styles.subnavItem, isActive && styles.subnavActivo)}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <div className={styles.page}>
        <Outlet />
      </div>
    </div>
  )
}
