import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { LARGO_MINIMO, validarContrasenaNueva } from '@/services/auth/contrasena'
import { contrasenaPendiente } from '@/services/auth/contrasenaPendiente'
import { definirContrasena, procesarEnlaceDeAuth, type ResultadoEnlace } from '@/services/auth/session'
import { useAuth } from '../useAuth'
import styles from './LoginPage.module.css'

/**
 * Destino de los enlaces de invitación y de recuperación.
 *
 * El enlace ya trae una sesión válida (la procesa `procesarEnlaceDeAuth`); acá
 * la persona elige su contraseña. No se guarda nada: la contraseña va directo
 * a Supabase Auth con `updateUser`.
 *
 * Fase 13 · E6: sólo presentación. El procesamiento del enlace, la sesión, la
 * validación y `definirContrasena` son los mismos.
 */
export function DefinirContrasenaPage() {
  const { session, cargando } = useAuth()
  const [enlace, setEnlace] = useState<ResultadoEnlace | null>(null)

  useEffect(() => {
    let vivo = true
    void procesarEnlaceDeAuth().then((r) => {
      if (vivo) setEnlace(r)
    })
    return () => {
      vivo = false
    }
  }, [])

  // Con un enlace válido la sesión llega un instante después (onAuthStateChange).
  if (enlace === null || cargando || (enlace.ok && !session)) {
    return (
      <div className={styles.verificando} role="status">
        <Spinner size={20} />
        <span>Verificando el enlace…</span>
      </div>
    )
  }

  if (!enlace.ok && enlace.codigo !== 'sin_enlace') {
    const vencido = enlace.codigo === 'enlace_vencido'
    return (
      <div className={styles.wrap}>
        <header className={styles.cabecera}>
          <h1 className={styles.title}>{vencido ? 'El enlace venció' : 'El enlace no sirve'}</h1>
        </header>
        <Alert tone="danger" role="alert" title={vencido ? 'El enlace venció o ya se usó.' : 'El enlace no es válido.'}>
          <p>Pedí uno nuevo. Si era una invitación, pedile a un administrador que la reenvíe.</p>
        </Alert>
        <div className={styles.acciones}>
          <LinkButton to="/auth/recuperar" variant="primary">
            Pedir un enlace nuevo
          </LinkButton>
          <LinkButton to="/auth/login" variant="secondary">
            Iniciar sesión
          </LinkButton>
        </div>
      </div>
    )
  }

  const motivo = enlace.ok ? enlace.motivo : contrasenaPendiente()
  if (!session || (motivo !== 'invite' && motivo !== 'recovery')) {
    // Sin enlace de invitación o recuperación, ni un cambio pendiente: nada que hacer acá.
    return session ? <Navigate to="/" replace /> : <Navigate to="/auth/login" replace />
  }

  return <FormularioContrasena esInvitacion={motivo === 'invite'} email={session.user.email ?? ''} />
}

export function FormularioContrasena({ esInvitacion, email }: { esInvitacion: boolean; email: string }) {
  const navigate = useNavigate()
  const [contrasena, setContrasena] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<'editando' | 'guardando' | 'listo'>('editando')

  async function guardar(e: FormEvent) {
    e.preventDefault()
    const invalida = validarContrasenaNueva(contrasena, confirmacion)
    if (invalida) {
      setError(invalida)
      return
    }
    setError(null)
    setEstado('guardando')
    const r = await definirContrasena(contrasena)
    if (!r.ok) {
      setError(r.error ?? 'No se pudo guardar la contraseña.')
      setEstado('editando')
      return
    }
    setContrasena('')
    setConfirmacion('')
    setEstado('listo')
  }

  if (estado === 'listo') {
    return (
      <div className={styles.wrap}>
        <header className={styles.cabecera}>
          <h1 className={styles.title}>Contraseña guardada</h1>
        </header>
        <Alert tone="success" role="status" title="Ya podés usar el sistema.">
          <p>La próxima vez ingresá con {email} y tu contraseña nueva.</p>
        </Alert>
        <Button block onClick={() => void navigate('/', { replace: true })}>
          Entrar al sistema
        </Button>
      </div>
    )
  }

  const guardando = estado === 'guardando'
  return (
    <div className={styles.wrap}>
      <header className={styles.cabecera}>
        <h1 className={styles.title}>{esInvitacion ? 'Bienvenido: elegí tu contraseña' : 'Elegí una contraseña nueva'}</h1>
        <p className={styles.subtitle}>
          Cuenta: <strong>{email}</strong>
        </p>
      </header>

      <form onSubmit={(e) => void guardar(e)} className={styles.form} noValidate>
        {/* El usuario oculto ayuda a los gestores de contraseñas a asociarla a la cuenta. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <Field label="Contraseña nueva" help={`Al menos ${LARGO_MINIMO} caracteres. Mejor si combina letras, números y símbolos.`}>
          <Input type="password" name="new-password" autoComplete="new-password" minLength={LARGO_MINIMO} required value={contrasena} onChange={(e) => setContrasena(e.target.value)} disabled={guardando} />
        </Field>
        <Field label="Repetir contraseña">
          <Input type="password" name="confirm-password" autoComplete="new-password" required value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} disabled={guardando} />
        </Field>

        {error && <Alert tone="danger" role="alert" title={error} />}

        <Button type="submit" block loading={guardando} disabled={!contrasena || !confirmacion}>
          {guardando ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </form>
    </div>
  )
}
