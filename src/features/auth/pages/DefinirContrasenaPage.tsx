import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
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
      <div className={styles.wrap}>
        <p className={styles.subtitle} role="status">
          Verificando el enlace…
        </p>
      </div>
    )
  }

  if (!enlace.ok && enlace.codigo !== 'sin_enlace') {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>El enlace no sirve</h1>
        <StatusMessage
          tono="error"
          titulo={enlace.codigo === 'enlace_vencido' ? 'El enlace venció o ya se usó.' : 'El enlace no es válido.'}
          detalle="Pedí uno nuevo. Si era una invitación, pedile a un administrador que la reenvíe."
        />
        <p className={styles.nota}>
          <Link to="/auth/recuperar">Pedir un enlace nuevo</Link> · <Link to="/auth/login">Iniciar sesión</Link>
        </p>
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

function FormularioContrasena({ esInvitacion, email }: { esInvitacion: boolean; email: string }) {
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
        <h1 className={styles.title}>Contraseña guardada</h1>
        <StatusMessage tono="ok" titulo="Ya podés usar el sistema." detalle={`La próxima vez ingresá con ${email} y tu contraseña nueva.`} />
        <div className={styles.form} style={{ marginTop: 'var(--space-4)' }}>
          <Button block onClick={() => void navigate('/', { replace: true })}>
            Entrar al sistema
          </Button>
        </div>
      </div>
    )
  }

  const guardando = estado === 'guardando'
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{esInvitacion ? 'Bienvenido: elegí tu contraseña' : 'Elegí una contraseña nueva'}</h1>
      <p className={styles.subtitle}>
        Cuenta: <strong>{email}</strong>
      </p>

      <form onSubmit={(e) => void guardar(e)} className={styles.form} noValidate>
        {/* El usuario oculto ayuda a los gestores de contraseñas a asociarla a la cuenta. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <label className={styles.field}>
          <span className={styles.label}>Contraseña nueva</span>
          <input
            className={styles.input}
            type="password"
            name="new-password"
            autoComplete="new-password"
            minLength={LARGO_MINIMO}
            required
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            disabled={guardando}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Repetir contraseña</span>
          <input
            className={styles.input}
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            required
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            disabled={guardando}
          />
        </label>
        <p className={styles.nota} style={{ margin: 0, textAlign: 'left' }}>
          Al menos {LARGO_MINIMO} caracteres. Mejor si combina letras, números y símbolos.
        </p>

        {error && <StatusMessage tono="error" titulo={error} />}

        <Button type="submit" block disabled={guardando || !contrasena || !confirmacion}>
          {guardando ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </form>
    </div>
  )
}
