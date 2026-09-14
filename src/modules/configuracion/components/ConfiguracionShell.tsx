import { NavLink, Outlet } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { puedeVerConfiguracion } from '../lib/permisos'
import styles from './Configuracion.module.css'

/**
 * Esqueleto de Configuración: navegación interna + la subsección.
 *
 * Hoy tiene una sola entrada. Empresa, Listas de precios, Marcas y categorías y
 * Auditoría se agregan acá cuando existan (Entrega 0, plan T); no se muestran
 * como «próximamente» para no ofrecer pantallas que no hay.
 */
const SECCIONES = [{ to: '/configuracion/usuarios', label: 'Usuarios' }] as const

export function ConfiguracionShell() {
  const { activa, cargando } = useEmpresa()

  if (cargando) return <p className={styles.nota}>Cargando…</p>
  if (!puedeVerConfiguracion(activa?.rol)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Configuración</h1>
        <p className={styles.vacio}>Tu rol en esta empresa no tiene acceso a Configuración.</p>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.subnav} aria-label="Secciones de configuración">
        <p className={styles.subnavTitulo}>Configuración</p>
        {SECCIONES.map((s) => (
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
