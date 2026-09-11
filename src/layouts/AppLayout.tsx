import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { EmpresaSelector } from '@/features/empresa/EmpresaSelector'
import { cx } from '@/utils/cx'
import styles from './AppLayout.module.css'

/** Los roles que escriben en Compras. Es el conjunto de la RLS de la sección. */
const ESCRIBEN_COMPRAS = ['admin', 'employee'] as const

/**
 * Los roles de Mantenimiento. Hoy el mismo conjunto que Compras, pero por su
 * propia razón: `app.current_maintenance_company_ids()` es admin + employee.
 * Son dos helpers distintos y pueden divergir, así que son dos constantes.
 */
const ESCRIBEN_MANTENIMIENTO = ['admin', 'employee'] as const

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
const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/catalogo', label: 'Catálogo', end: false },
  // Ventas entra por sus tres subsecciones, igual que en el legacy: la
  // sección sola nunca tuvo pantalla propia.
  { to: '/ventas/cotizaciones', label: 'Cotizaciones', end: false },
  { to: '/ventas/pedidos', label: 'Pedidos', end: false },
  { to: '/ventas/entregas', label: 'Notas de entrega', end: false },
  { to: '/clientes', label: 'Clientes', end: false },
  // Compras. Sólo admin y employee: `roles` filtra el enlace para no ofrecerle
  // a un vendedor una pantalla que RLS le va a devolver vacía. Ocultar el
  // enlace es una cortesía, no el control de acceso: las ocho tablas de
  // Compras usan `app.current_writer_company_ids()`.
  { to: '/compras/proveedores', label: 'Proveedores', end: false, roles: ESCRIBEN_COMPRAS },
  { to: '/compras/pedidos', label: 'Pedidos de compra', end: false, roles: ESCRIBEN_COMPRAS },
  { to: '/compras/recepciones', label: 'Notas de entrada', end: false, roles: ESCRIBEN_COMPRAS },
  { to: '/compras/facturas', label: 'Facturas de proveedor', end: false, roles: ESCRIBEN_COMPRAS },
  // Mantenimiento. El rol `technician` existe en el CHECK de
  // `company_memberships` pero tiene cero miembros y no llegó a la RLS: cuando
  // exista alguien con ese rol se agrega acá y en el helper, no sólo acá.
  {
    to: '/mantenimiento/activos',
    label: 'Equipos',
    end: false,
    roles: ESCRIBEN_MANTENIMIENTO,
  },
  {
    to: '/mantenimiento/ordenes',
    label: 'Órdenes de servicio',
    end: false,
    roles: ESCRIBEN_MANTENIMIENTO,
  },
] as const

const PROXIMAMENTE = [
  'WhatsApp',
  'Emails',
  'Informes',
  'Configuración',
] as const

export function AppLayout() {
  const isMobile = useIsMobile()
  const { user, session, salir } = useAuth()
  const { activa } = useEmpresa()
  const [drawerAbierto, setDrawerAbierto] = useState(false)

  // Un ítem sin `roles` lo ve cualquiera; uno con `roles`, sólo esos.
  const rol = activa?.rol ?? ''
  const navVisible = NAV.filter(
    (item) => !('roles' in item) || (item.roles as readonly string[]).includes(rol),
  )

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
        {session && (
          <div className={styles.sesion}>
            <EmpresaSelector />
            <span className={styles.email} title={user?.email ?? ''}>
              {user?.email}
            </span>
            <button type="button" className={styles.salir} onClick={() => void salir()}>
              Salir
            </button>
          </div>
        )}
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
            {navVisible.map((item) => (
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
