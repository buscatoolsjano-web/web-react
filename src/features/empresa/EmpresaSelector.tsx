import { useEmpresa } from './useEmpresa'
import styles from './EmpresaSelector.module.css'

/**
 * Selector de empresa activa.
 *
 * Con una sola membresía no se renderiza el <select>: no hay entre qué
 * elegir. Con dos o más (el caso de Jano) aparece el desplegable, y el rol
 * mostrado es el de ESA membresía — ser admin en una empresa no da permisos
 * en la otra.
 */
export function EmpresaSelector() {
  const { membresias, activa, cambiarEmpresa } = useEmpresa()

  if (!activa) return null

  if (membresias.length === 1) {
    return (
      <span className={styles.unica}>
        {activa.companyName}
        <span className={styles.rol}>{activa.rol}</span>
      </span>
    )
  }

  return (
    <label className={styles.wrap}>
      <span className="sr-only">Empresa activa</span>
      <select
        className={styles.select}
        value={activa.companyId}
        onChange={(e) => cambiarEmpresa(e.target.value)}
      >
        {membresias.map((m) => (
          <option key={m.companyId} value={m.companyId}>
            {m.companyName} · {m.rol}
          </option>
        ))}
      </select>
    </label>
  )
}
