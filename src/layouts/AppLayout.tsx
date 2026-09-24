import { useEffect, useId, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useIsMobile, useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { EmpresaSelector } from '@/features/empresa/EmpresaSelector'
import { BotonApariencia } from '@/features/apariencia/BotonApariencia'
import { moduloDeRuta } from '@/features/apariencia/opciones'
import { Icon } from '@/components/icons/Icon'
import { IconButton } from '@/components/ui/IconButton'
import { navegacionPara } from './navegacion'
import { PanelNav } from './PanelNav'
import { BarraCompacta } from './BarraCompacta'
import { MenuUsuario } from './MenuUsuario'
import { EstadoEmpresa } from './EstadoEmpresa'
import { nombreVisible } from './sesion'
import styles from './Shell.module.css'

/** Mismo punto de corte que la escala de tokens: 768–1023 es tablet. */
const TABLET = '(min-width: 768px) and (max-width: 1023px)'

/**
 * Si el menú de escritorio quedó contraído (Fase 28 · E3).
 *
 * Se guarda por navegador y no en la base: es una preferencia de cómo se ve
 * ESTA pantalla, no un dato de la empresa. Leer `localStorage` puede tirar
 * excepción (ventana privada, cookies bloqueadas), así que va con red.
 */
const LLAVE_MENU = 'buscatools.menu-colapsado'

function leerColapsada(): boolean {
  try {
    return localStorage.getItem(LLAVE_MENU) === '1'
  } catch {
    return false
  }
}

/**
 * Shell de la app (Fase 13 · E2).
 *
 * - ≥ 1024px: sidebar clara de 240px con la navegación agrupada.
 * - 768–1023px: barra compacta de 64px; el panel completo se abre encima.
 * - < 768px: el panel completo es un cajón que abre la hamburguesa.
 *
 * La navegación sale de `navegacion.ts`, filtrada por el rol de la empresa
 * activa con las mismas reglas de Fase 1. Ocultar un enlace no es un control
 * de acceso: eso lo hace RLS.
 */
export function AppLayout() {
  const isMobile = useIsMobile()
  const isTablet = useMediaQuery(TABLET)
  const { user, session, salir } = useAuth()
  const empresa = useEmpresa()
  const { pathname } = useLocation()
  const [cajon, setCajon] = useState<{ abierto: boolean; modulo: string | null }>({ abierto: false, modulo: null })
  const [colapsada, setColapsada] = useState(leerColapsada)
  const idCajon = useId()
  const disparador = useRef<HTMLElement | null>(null)
  const panelCajon = useRef<HTMLDivElement>(null)

  const grupos = navegacionPara(empresa.activa?.rol ?? '')
  const conCajon = isMobile || isTablet

  // Cerrar el cajón al cruzar de breakpoint o al cambiar de ruta. Se ajusta
  // DURANTE el render (patrón de React para estado derivado), no en un efecto.
  const [visto, setVisto] = useState({ conCajon, pathname })
  if (visto.conCajon !== conCajon || visto.pathname !== pathname) {
    setVisto({ conCajon, pathname })
    if (cajon.abierto) setCajon({ abierto: false, modulo: null })
  }

  const abrirCajon = (modulo: string | null) => {
    disparador.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCajon({ abierto: true, modulo })
  }
  const cerrarCajon = () => setCajon({ abierto: false, modulo: null })

  const alternarMenu = () => {
    setColapsada((antes) => {
      try {
        localStorage.setItem(LLAVE_MENU, antes ? '0' : '1')
      } catch {
        // Sin `localStorage` el menú igual se contrae; lo que no sobrevive es
        // la próxima visita. No es motivo para no hacer nada.
      }
      return !antes
    })
  }

  // Cajón abierto: sin scroll de fondo, foco adentro, Escape cierra y el foco
  // vuelve a quien lo abrió. El resto del shell queda `inert` (ver JSX).
  const abierto = cajon.abierto && conCajon
  useEffect(() => {
    if (!abierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelCajon.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCajon({ abierto: false, modulo: null })
    }
    document.addEventListener('keydown', tecla)
    const quien = disparador.current
    return () => {
      document.body.style.overflow = previo
      document.removeEventListener('keydown', tecla)
      if (quien?.isConnected) quien.focus()
    }
  }, [abierto])

  // Identidad por módulo (Fase 14): Ventas verde, Compras azul, Mantenimiento
  // grafito. Va en el <html> para que los diálogos (portal en body) la hereden.
  const modulo = moduloDeRuta(pathname)
  useEffect(() => {
    const raiz = document.documentElement
    if (modulo) raiz.dataset.modulo = modulo
    else delete raiz.dataset.modulo
    return () => {
      delete raiz.dataset.modulo
    }
  }, [modulo])

  const email = user?.email ?? ''

  return (
    <div className={styles.shell}>
      <header className={styles.header} inert={abierto || undefined}>
        {isMobile && (
          <IconButton
            icon="menu"
            aria-label="Abrir menú"
            aria-expanded={abierto}
            aria-controls={idCajon}
            className={styles.hamburguesa}
            onClick={() => abrirCajon(null)}
          />
        )}
        <Link to="/" className={styles.marca} aria-label="Buscatools ERP, ir al inicio">
          <span className={styles.logoFondo}>
            <img src={`${import.meta.env.BASE_URL}brand/buscatools-logo.png`} alt="" className={styles.logo} width={1400} height={673} />
          </span>
          <span className={styles.marcaErp} aria-hidden="true">
            ERP
          </span>
        </Link>
        <span className={styles.espaciador} />
        {session && (
          <div className={styles.sesion}>
            <EmpresaSelector />
            <BotonApariencia className={styles.botonHeader} />
            <MenuUsuario email={email} nombre={nombreVisible(user)} empresa={empresa.activa?.companyName ?? null} rol={empresa.activa?.rol ?? null} onSalir={() => void salir()} />
          </div>
        )}
      </header>

      <div className={styles.cuerpo}>
        {/* Escritorio: el menú entero, o la barra de íconos si se contrajo.
            La barra es la MISMA de tablet, con su botón de arriba devolviendo
            el menú: una sola forma de verse angosto, no dos. */}
        {!conCajon &&
          (colapsada ? (
            <aside className={styles.sidebarCompacta}>
              <BarraCompacta grupos={grupos} expandida={false} onExpandir={alternarMenu} />
            </aside>
          ) : (
            <aside className={styles.sidebar}>
              <div className={styles.sidebarCabecera}>
                <button type="button" className={styles.colapsar} onClick={alternarMenu} title="Contraer el menú">
                  <Icon name="chevron-left" size={16} />
                  <span>Contraer</span>
                </button>
              </div>
              <PanelNav grupos={grupos} />
            </aside>
          ))}
        {isTablet && (
          <aside className={styles.sidebarCompacta} inert={abierto || undefined}>
            <BarraCompacta grupos={grupos} expandida={abierto} onExpandir={abrirCajon} />
          </aside>
        )}

        {abierto && (
          <>
            <button type="button" className={styles.velo} aria-label="Cerrar menú" tabIndex={-1} onClick={cerrarCajon} />
            <div ref={panelCajon} id={idCajon} className={styles.cajon} role="dialog" aria-modal="true" aria-label="Menú principal">
              <div className={styles.cajonCabecera}>
                <span className={styles.cajonTitulo}>Menú</span>
                <IconButton icon="x" aria-label="Cerrar menú" onClick={cerrarCajon} />
              </div>
              <PanelNav grupos={grupos} abrir={cajon.modulo} onNavegar={cerrarCajon} />
            </div>
          </>
        )}

        <main className={styles.main} inert={abierto || undefined}>
          {session ? (
            <EstadoEmpresa cargando={empresa.cargando} error={empresa.error} sinEmpresa={!empresa.activa} onReintentar={empresa.reintentar} onSalir={() => void salir()}>
              <Outlet />
            </EstadoEmpresa>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  )
}
