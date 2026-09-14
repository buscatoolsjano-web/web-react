import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { iniciales } from './sesion'
import styles from './Shell.module.css'

export interface MenuUsuarioProps {
  email: string
  nombre: string | null
  empresa: string | null
  rol: string | null
  onSalir: () => void
}

/**
 * Menú de la sesión (patrón «disclosure»): botón con iniciales que abre un
 * panel con la identidad y «Cerrar sesión». Escape o un click afuera lo
 * cierran y el foco vuelve al botón.
 */
export function MenuUsuario({ email, nombre, empresa, rol, onSalir }: MenuUsuarioProps) {
  const [abierto, setAbierto] = useState(false)
  const idPanel = useId()
  const raiz = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const salir = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!abierto) return
    salir.current?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false)
        boton.current?.focus()
      }
    }
    const afuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('mousedown', afuera)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.removeEventListener('mousedown', afuera)
    }
  }, [abierto])

  return (
    <div
      ref={raiz}
      className={styles.usuario}
      onBlur={(e) => {
        // Tab fuera del panel lo cierra (sin robar el foco).
        if (abierto && raiz.current && e.relatedTarget && !raiz.current.contains(e.relatedTarget)) setAbierto(false)
      }}
    >
      <button ref={boton} type="button" className={styles.usuarioBoton} aria-expanded={abierto} aria-controls={idPanel} onClick={() => setAbierto((v) => !v)}>
        <span className={styles.avatar} aria-hidden="true">
          {iniciales(nombre, email)}
        </span>
        <span className="sr-only">Cuenta de {nombre ?? email}</span>
        <Icon name="chevron-down" size={16} className={styles.usuarioFlecha} />
      </button>
      <div id={idPanel} className={styles.usuarioPanel} hidden={!abierto}>
        <div className={styles.usuarioDatos}>
          {nombre && <p className={styles.usuarioNombre}>{nombre}</p>}
          <p className={styles.usuarioEmail}>{email}</p>
          {empresa && (
            <p className={styles.usuarioEmpresa}>
              {empresa}
              {rol && ` · ${etiquetaRol(rol)}`}
            </p>
          )}
        </div>
        <button ref={salir} type="button" className={styles.usuarioSalir} onClick={onSalir}>
          <Icon name="log-out" size={16} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
