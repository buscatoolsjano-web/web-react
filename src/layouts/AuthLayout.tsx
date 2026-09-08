import { Outlet } from 'react-router-dom'
import styles from './AuthLayout.module.css'

/**
 * Layout de las pantallas sin sesión (login, recuperar contraseña).
 *
 * FASE 1: solo la estructura. El formulario real de Supabase Auth es
 * Fase 2.5 — ver ADR-004.
 */
export function AuthLayout() {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.brand}>BUSCATOOLS</p>
        <Outlet />
      </div>
    </div>
  )
}
