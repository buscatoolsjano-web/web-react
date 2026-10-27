import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { useEmpresa } from './useEmpresa'
import { ModalNuevaEmpresa } from './ModalNuevaEmpresa'
import styles from './EmpresaSelector.module.css'

/**
 * Empresa activa, siempre visible en el header.
 *
 * Con una sola membresía y sin poder crear empresas es un texto (no hay entre
 * qué elegir). En cuanto hay dos o más —o la persona es administradora y puede
 * crear una nueva— pasa a ser un desplegable: la lista de empresas y, al pie y
 * sólo para admins, «Agregar empresa».
 *
 * Es un «disclosure» (como el menú de usuario), no un `role="menu"`: adentro
 * van botones normales con su propio nombre accesible. El rol que se muestra es
 * el de ESA membresía —ser admin en una empresa no da permisos en la otra—.
 */
export function EmpresaSelector() {
  const { membresias, activa, cambiarEmpresa, recargar } = useEmpresa()
  const [abierto, setAbierto] = useState(false)
  const [modal, setModal] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)
  const idPanel = useId()

  // Crear empresas es cosa de administradores. Alcanza con serlo en ALGUNA
  // empresa: crear una nueva no es una acción de ninguna en particular. La base
  // vuelve a exigirlo en `config_crear_empresa`, así que esto sólo decide si se
  // ofrece el botón.
  const puedeAgregar = membresias.some((m) => m.rol === 'admin')

  useEffect(() => {
    if (!abierto) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false)
        disparador.current?.focus()
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

  if (!activa) return null

  // Texto fijo: una sola empresa y nada que agregar.
  if (membresias.length <= 1 && !puedeAgregar) {
    return (
      <span className={styles.unica} title={`${activa.companyName} · ${etiquetaRol(activa.rol)}`}>
        <Icon name="building" size={16} className={styles.icono} />
        <span className="sr-only">Empresa activa: </span>
        <span className={styles.nombre}>{activa.companyName}</span>
        <span className={styles.rol}>{etiquetaRol(activa.rol)}</span>
      </span>
    )
  }

  const elegir = (companyId: string) => {
    cambiarEmpresa(companyId)
    setAbierto(false)
    disparador.current?.focus()
  }

  const abrirModal = () => {
    setAbierto(false)
    setModal(true)
  }

  const cerrarModal = () => {
    setModal(false)
    disparador.current?.focus()
  }

  const alCrear = async (companyId: string) => {
    setModal(false)
    // La membresía nueva la creó la base; hay que tenerla en la lista ANTES de
    // saltar a ella, si no `cambiarEmpresa` cae en la primera por no encontrarla.
    await recargar()
    cambiarEmpresa(companyId)
    disparador.current?.focus()
  }

  return (
    <div
      ref={raiz}
      className={styles.wrap}
      onBlur={(e) => {
        if (abierto && raiz.current && e.relatedTarget && !raiz.current.contains(e.relatedTarget)) setAbierto(false)
      }}
    >
      <button
        ref={disparador}
        type="button"
        className={styles.disparador}
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={() => setAbierto((v) => !v)}
      >
        <Icon name="building" size={16} className={styles.icono} />
        <span className="sr-only">Empresa activa: </span>
        <span className={styles.nombre}>{activa.companyName}</span>
        <span className={styles.rol}>{etiquetaRol(activa.rol)}</span>
        <Icon name="chevron-down" size={16} className={styles.flecha} />
      </button>

      {abierto && (
      <div id={idPanel} className={styles.panel}>
        <ul className={styles.lista}>
          {membresias.map((m) => {
            const actual = m.companyId === activa.companyId
            return (
              <li key={m.companyId}>
                <button
                  type="button"
                  className={cx(styles.opcion, actual && styles.opcionActual)}
                  aria-current={actual || undefined}
                  onClick={() => elegir(m.companyId)}
                >
                  <Icon name="check" size={16} className={styles.tilde} aria-hidden={!actual} />
                  <span className={styles.opcionNombre}>{m.companyName}</span>
                  <span className={styles.opcionRol}>{etiquetaRol(m.rol)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {puedeAgregar && (
          <button type="button" className={styles.agregar} onClick={abrirModal}>
            <Icon name="plus" size={16} />
            Agregar empresa
          </button>
        )}
      </div>
      )}

      {modal && <ModalNuevaEmpresa onClose={cerrarModal} onCreada={(id) => void alCrear(id)} />}
    </div>
  )
}
