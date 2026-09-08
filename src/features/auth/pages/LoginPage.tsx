import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { iniciarSesion } from '@/services/auth/session'
import { useAuth } from '../useAuth'
import styles from './LoginPage.module.css'

/**
 * Login real contra Supabase Auth.
 *
 * No se guarda nada: ni el email, ni el password, ni un flag de "logueado".
 * El SDK maneja el token. Si el usuario refresca, la sesión vuelve sola.
 *
 * PENDIENTE (fuera del alcance de esta entrega): recuperación de
 * contraseña. Requiere configurar el template de email y la URL de retorno
 * en el proyecto Supabase.
 */
export function LoginPage() {
  const { session, cargando } = useAuth()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const destino = params.get('next') ?? '/'

  // Ya hay sesión: no tiene sentido mostrar el formulario.
  if (!cargando && session) return <Navigate to={destino} replace />

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)

    const r = await iniciarSesion(email, password)

    // Si salió bien, AuthProvider recibe el evento y el <Navigate> de arriba
    // hace la redirección. No navegamos a mano para no competir con él.
    if (!r.ok) {
      setError(r.error ?? 'No se pudo iniciar sesión.')
      setEnviando(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Iniciar sesión</h1>
      <p className={styles.subtitle}>Sistema de gestión BUSCATOOLS</p>

      <form onSubmit={(e) => void manejarSubmit(e)} className={styles.form} noValidate>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input
            className={styles.input}
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={enviando}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Contraseña</span>
          <input
            className={styles.input}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={enviando}
          />
        </label>

        {error && <StatusMessage tono="error" titulo={error} />}

        <Button type="submit" block disabled={enviando || !email || !password}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>

      <p className={styles.nota}>
        ¿Olvidaste tu contraseña? Por ahora, pedile el restablecimiento a un administrador.
      </p>
    </div>
  )
}
