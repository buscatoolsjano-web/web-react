import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { solicitarRecuperacion } from '@/services/auth/session'
import styles from './LoginPage.module.css'

/**
 * «¿Olvidaste tu contraseña?» con el mecanismo oficial de Supabase Auth.
 *
 * El mensaje de éxito es el mismo exista o no la cuenta: decir «ese email no
 * está registrado» permitiría averiguar quién tiene cuenta.
 *
 * Fase 13 · E6: sólo presentación. Mismos estados (editando, enviando,
 * enviado, límite, sin red, error) y el mismo `solicitarRecuperacion`.
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
        <header className={styles.cabecera}>
          <h1 className={styles.title}>Revisá tu correo</h1>
        </header>
        <Alert tone="success" role="status" title="Si existe una cuenta asociada, vas a recibir un correo.">
          <p>Abrí el enlace para elegir una contraseña nueva. Si no llega en unos minutos, revisá spam o pedilo de nuevo.</p>
        </Alert>
        <LinkButton to="/auth/login" variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
          Volver a iniciar sesión
        </LinkButton>
      </div>
    )
  }

  const enviando = estado === 'enviando'
  return (
    <div className={styles.wrap}>
      <header className={styles.cabecera}>
        <h1 className={styles.title}>Recuperar contraseña</h1>
        <p className={styles.subtitle}>Te mandamos un enlace para elegir una contraseña nueva.</p>
      </header>

      <form onSubmit={(e) => void enviar(e)} className={styles.form} noValidate>
        <Field label="Email">
          <Input type="email" name="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={enviando} />
        </Field>

        {estado === 'limite' && (
          <Alert tone="danger" role="alert" title="Se pidieron demasiados correos.">
            <p>Esperá unos minutos y volvé a intentar.</p>
          </Alert>
        )}
        {estado === 'sin_red' && <Alert tone="danger" role="alert" title="No se pudo contactar al servidor. Revisá la conexión." />}
        {estado === 'error' && <Alert tone="danger" role="alert" title="No se pudo procesar el pedido. Intentá más tarde." />}

        <Button type="submit" block loading={enviando} disabled={!email.includes('@')}>
          {enviando ? 'Enviando…' : 'Enviar enlace'}
        </Button>
      </form>

      <nav className={styles.enlaces} aria-label="Otras opciones">
        <Link to="/auth/login" className={styles.enlace}>
          Volver a iniciar sesión
        </Link>
      </nav>
    </div>
  )
}
