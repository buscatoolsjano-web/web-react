import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { iniciarSesion } from '@/services/auth/session'
import { useAuth } from '../useAuth'
import styles from './LoginPage.module.css'

/**
 * Login real contra Supabase Auth.
 *
 * No se guarda nada: ni el email, ni el password, ni un flag de "logueado".
 * El SDK maneja el token. Si el usuario refresca, la sesión vuelve sola.

 * La recuperación de contraseña es `/auth/recuperar` (Fase 12, entrega 1).
 *
 * Fase 13 · E6: sólo presentación (Field, Button, Alert). Mismo submit, mismo
 * `iniciarSesion`, mismo destino `next`.
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
      <header className={styles.cabecera}>
        <h1 className={styles.title}>Iniciar sesión</h1>
        <p className={styles.subtitle}>Ingresá con tu email y tu contraseña.</p>
      </header>

      <form onSubmit={(e) => void manejarSubmit(e)} className={styles.form} noValidate>
        <Field label="Email">
          <Input type="email" name="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={enviando} />
        </Field>

        <Field label="Contraseña">
          <Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={enviando} />
        </Field>

        {error && <Alert tone="danger" role="alert" title={error} />}

        <Button type="submit" block loading={enviando} disabled={!email || !password}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>

      <nav className={styles.enlaces} aria-label="Ayuda para ingresar">
        <Link to="/auth/recuperar" className={styles.enlace}>
          ¿Olvidaste tu contraseña?
        </Link>
      </nav>
    </div>
  )
}
