import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ROLES_ASIGNABLES, etiquetaRol, validarInvitacion, type ErroresInvitacion } from '../lib/usuarios'
import { Dialogo } from './Dialogo'
import styles from './Configuracion.module.css'

export interface FormularioInvitacionProps {
  empresa: string
  enviando: boolean
  error: string | null
  onEnviar: (d: { email: string; nombre: string | null; rol: string }) => void
  onCerrar: () => void
}

/**
 * Invitar a una persona a la empresa activa. Si el email ya tiene cuenta (por
 * ejemplo, trabaja en otra empresa del grupo) no se crea otra: se le agrega el
 * acceso. Eso lo decide el servidor.
 */
export function FormularioInvitacion({ empresa, enviando, error, onEnviar, onCerrar }: FormularioInvitacionProps) {
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState('employee')
  const [errores, setErrores] = useState<ErroresInvitacion>({})

  function enviar(e: FormEvent) {
    e.preventDefault()
    const v = validarInvitacion({ email, nombre, rol })
    if (!v.ok) {
      setErrores(v.errores)
      return
    }
    setErrores({})
    onEnviar({ email: v.email, nombre: v.nombre, rol: v.rol })
  }

  return (
    <Dialogo
      titulo={`Invitar a ${empresa}`}
      onCerrar={onCerrar}
      bloqueado={enviando}
      pie={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-invitacion" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Invitar'}
          </Button>
        </>
      }
    >
      <form id="form-invitacion" onSubmit={enviar} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <label className={styles.campo}>
          <span className={styles.etiqueta}>Email</span>
          <input
            className={styles.control}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={enviando}
            aria-invalid={!!errores.email}
          />
          {errores.email && <span className={styles.errorCampo}>{errores.email}</span>}
        </label>
        <label className={styles.campo}>
          <span className={styles.etiqueta}>Nombre (opcional)</span>
          <input
            className={styles.control}
            type="text"
            autoComplete="off"
            maxLength={120}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={enviando}
          />
          {errores.nombre && <span className={styles.errorCampo}>{errores.nombre}</span>}
        </label>
        <label className={styles.campo}>
          <span className={styles.etiqueta}>Rol en {empresa}</span>
          <select className={styles.control} value={rol} onChange={(e) => setRol(e.target.value)} disabled={enviando}>
            {ROLES_ASIGNABLES.map((r) => (
              <option key={r} value={r}>
                {etiquetaRol(r)}
              </option>
            ))}
          </select>
          {errores.rol && <span className={styles.errorCampo}>{errores.rol}</span>}
        </label>
        <p className={styles.nota}>
          Recibe un correo de Supabase para elegir su contraseña. Si ya tiene cuenta, sólo se le agrega el acceso a esta
          empresa.
        </p>
        {error && <StatusMessage tono="error" titulo={error} />}
      </form>
    </Dialogo>
  )
}
