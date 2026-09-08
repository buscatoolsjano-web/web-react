import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cx } from '@/utils/cx'
import styles from './AppLayout.module.css'

/**
 * Navegación provisoria de FASE 1.
 *
 * Solo Dashboard está montado. El resto son los módulos previstos, listados
 * como referencia visual del shell.
 *
 * En Fase 2.5 esta lista pasa a filtrarse por permisos: las secciones sin
 * permiso NO se renderizan. No se ocultan con CSS — ese fue el error del
 * legacy, donde los permisos eran `el.style.display = 'none'`.
 */
const NAV = [{ to: '/', label: 'Dashboard', end: true }] as const

const PROXIMAMENTE = [
  'Catálogo',
  'Ventas',
  'Clientes',
  'Compras',
  'Mantenimiento',
  'WhatsApp',
  'Emails',
  'Informes',
  'Configuración',
] as const

export function AppLayout() {
  const isMobile = useIsMobile()
  const [drawerAbierto, setDrawerAbierto] = useState(false)

  // Al cruzar el breakpoint, cerrar el drawer.
  //
  // Se ajusta DURANTE el render (patrón oficial de React para estado
  // derivado de props/estado externo) y no en un useEffect: llamar a
  // setState dentro de un efecto provoca un render en cascada.
  // https://react.dev/learn/you-might-not-need-an-effect
  const [eraMobile, setEraMobile] = useState(isMobile)
  if (eraMobile !== isMobile) {
    setEraMobile(isMobile)
    setDrawerAbierto(false)
  }

  // Bloquear el scroll del fondo mientras el drawer está abierto.
  useEffect(() => {
    if (!isMobile || !drawerAbierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previo
    }
  }, [isMobile, drawerAbierto])

  const sidebarVisible = !isMobile || drawerAbierto

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.burger}
          onClick={() => setDrawerAbierto((v) => !v)}
          aria-label={drawerAbierto ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={drawerAbierto}
        >
          &#9776;
        </button>
        <span className={styles.brand}>BUSCATOOLS</span>
        <span className={styles.headerSpacer} />
        <span className={styles.headerMeta}>v0.1.0 · Fase 1</span>
      </header>

      <div className={styles.body}>
        {isMobile && drawerAbierto && (
          <button
            type="button"
            className={styles.overlay}
            aria-label="Cerrar menú"
            onClick={() => setDrawerAbierto(false)}
          />
        )}

        <aside
          className={cx(styles.sidebar, sidebarVisible && styles.sidebarOpen)}
          aria-hidden={isMobile && !drawerAbierto}
        >
          <p className={styles.sidebarTitle}>Módulos</p>
          <nav className={styles.nav}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cx(styles.navItem, isActive && styles.navItemActive)}
                // Cerrar el drawer al navegar: en mobile taparía el contenido.
                onClick={() => setDrawerAbierto(false)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <p className={cx(styles.sidebarTitle, styles.sidebarTitleSpaced)}>Próximamente</p>
          <nav className={styles.nav} aria-label="Módulos pendientes de migración">
            {PROXIMAMENTE.map((label) => (
              <span key={label} className={cx(styles.navItem, styles.navItemDisabled)}>
                {label}
              </span>
            ))}
          </nav>
        </aside>

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
