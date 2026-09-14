import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { solicitarRecuperacion } from '@/services/auth/session'
import styles from './LoginPage.module.css'

/**
 * «¿Olvidaste tu contraseña?» con el mecanismo oficial de Supabase Auth.
 *
 * El mensaje de éxito es el mismo exista o no la cuenta: decir «ese email no
 * está registrado» permitiría averiguar quién tiene cuenta.
 */
export function RecuperarPage() {
  const [email, setEmail] = useState('')
  const [estado, setEstado] = useState<'editando' | 'enviando' | 'enviado' | 'limite' | 'sin_red' | 'error'>('editando')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEstado('enviando')
    setEstado(await solicitarRecuperacion(email))
  }

  if (estado === 'enviado') {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>Revisá tu correo</h1>
        <StatusMessage
          tono="ok"
          titulo="Si existe una cuenta asociada, vas a recibir un correo."
          detalle="Abrí el enlace para elegir una contraseña nueva. Si no llega en unos minutos, revisá spam o pedilo de nuevo."
        />
        <p className={styles.nota}>
          <Link to="/auth/login">Volver a iniciar sesión</Link>
        </p>
      </div>
    )
  }

  const enviando = estado === 'enviando'
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Recuperar contraseña</h1>
      <p className={styles.subtitle}>Te mandamos un enlace para elegir una contraseña nueva.</p>

      <form onSubmit={(e) => void enviar(e)} className={styles.form} noValidate>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input
            className={styles.input}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={enviando}
          />
        </label>

        {estado === 'limite' && (
          <StatusMessage tono="error" titulo="Se pidieron demasiados correos." detalle="Esperá unos minutos y volvé a intentar." />
        )}
        {estado === 'sin_red' && <StatusMessage tono="error" titulo="No se pudo contactar al servidor. Revisá la conexión." />}
        {estado === 'error' && <StatusMessage tono="error" titulo="No se pudo procesar el pedido. Intentá más tarde." />}

        <Button type="submit" block disabled={enviando || !email.includes('@')}>
          {enviando ? 'Enviando…' : 'Enviar enlace'}
        </Button>
      </form>

      <p className={styles.nota}>
        <Link to="/auth/login">Volver a iniciar sesión</Link>
      </p>
    </div>
  )
}
