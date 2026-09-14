import { Icon } from '@/components/icons/Icon'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { useEmpresa } from './useEmpresa'
import styles from './EmpresaSelector.module.css'

/**
 * Empresa activa, siempre visible en el header.
 *
 * Con una sola membresía es un texto (no hay entre qué elegir). Con dos o más
 * (el caso de Jano) es un desplegable, y el rol mostrado es el de ESA
 * membresía — ser admin en una empresa no da permisos en la otra.
 */
export function EmpresaSelector() {
  const { membresias, activa, cambiarEmpresa } = useEmpresa()

  if (!activa) return null

  if (membresias.length === 1) {
    return (
      <span className={styles.unica} title={`${activa.companyName} · ${etiquetaRol(activa.rol)}`}>
        <Icon name="building" size={16} className={styles.icono} />
        <span className="sr-only">Empresa activa: </span>
        <span className={styles.nombre}>{activa.companyName}</span>
        <span className={styles.rol}>{etiquetaRol(activa.rol)}</span>
      </span>
    )
  }

  return (
    <label className={styles.wrap}>
      <Icon name="building" size={16} className={styles.icono} />
      <span className="sr-only">Empresa activa</span>
      <select className={styles.select} value={activa.companyId} onChange={(e) => cambiarEmpresa(e.target.value)}>
        {membresias.map((m) => (
          <option key={m.companyId} value={m.companyId}>
            {m.companyName} · {etiquetaRol(m.rol)}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className={styles.flecha} />
    </label>
  )
}
