import { Outlet } from 'react-router-dom'
import styles from './AuthLayout.module.css'

/**
 * Layout de las pantallas sin sesión: iniciar sesión, recuperar y definir
 * contraseña.
 *
 * Fase 13 · E6: la entrada oficial a Buscatools ERP. Logo PNG oficial (sin
 * alterar el archivo) y el nombre del producto; sin decoración de «marketing».
 * En mobile el formulario va directo, sin tarjeta flotante.
 */
export function AuthLayout() {
  return (
    <div className={styles.wrap}>
      <main className={styles.card}>
        <div className={styles.marca}>
          <img
            src={`${import.meta.env.BASE_URL}brand/buscatools-logo.png`}
            alt="Buscatools"
            className={styles.logo}
            width={1400}
            height={673}
          />
          <span className={styles.producto}>ERP</span>
        </div>
        <Outlet />
      </main>
      <p className={styles.pie}>Buscatools ERP · Sistema de gestión interno</p>
    </div>
  )
}
