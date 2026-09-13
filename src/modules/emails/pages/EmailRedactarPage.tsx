import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Composer } from '../components/Composer'
import { useCuentas } from '../hooks/useEmails'
import { useParamsUrl } from '../hooks/useParamsUrl'
import { puedeUsarEmails } from '../lib/permisos'
import { esperarHiloIndexado } from '../services/redactar'
import type { OpcionesComposer } from '../hooks/useComposer'
import styles from '../components/Emails.module.css'

/**
 * Un mail nuevo, o cualquier borrador recuperado de Gmail (`?borrador=`).
 *
 * El From no se elige acá: es la cuenta. Con una sola cuenta no hay selector.
 */
export function EmailRedactarPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Emails</h1>
        <p className={styles.vacio}>Tu rol en esta empresa no tiene acceso a la bandeja de correo.</p>
      </div>
    )
  }
  return <Redactar />
}

function Redactar() {
  const [params, cambiarUrl] = useParamsUrl()
  const navigate = useNavigate()
  const cuentas = useCuentas()
  const cuenta = (cuentas.data ?? []).find((c) => c.id === params.get('cuenta')) ?? cuentas.data?.[0] ?? null
  const [enviadoA, setEnviadoA] = useState<string | null>(null)
  const [tardando, setTardando] = useState(false)

  // Se congelan al montar: cambiar la URL (borrador/envío) no reinicia el composer.
  const [inicial] = useState(() => ({ borrador: params.get('borrador'), envio: params.get('envio') }))

  const opciones = useMemo<OpcionesComposer | null>(() => {
    if (!cuenta) return null
    return {
      accountId: cuenta.id,
      propia: cuenta.direccion,
      modo: 'nuevo',
      threadId: null,
      refMensaje: null,
      draftId: inicial.borrador,
      clientRequestId: inicial.envio,
      alCambiarUrl: cambiarUrl,
    }
  }, [cuenta, inicial, cambiarUrl])

  // Al enviarse, se espera a que el sync indexe el hilo nuevo y se abre.
  useEffect(() => {
    if (!enviadoA || !cuenta) return
    const t = setTimeout(() => setTardando(true), 15_000)
    const cancelar = esperarHiloIndexado(cuenta.id, enviadoA, (id) => void navigate(`/emails/${id}`, { replace: true }))
    return () => {
      clearTimeout(t)
      cancelar()
    }
  }, [enviadoA, cuenta, navigate])

  return (
    <div className={styles.page}>
      <Link to="/emails" className={styles.volver}>
        ← Volver a la bandeja
      </Link>
      {cuentas.isPending ? (
        <p className={styles.nota}>Cargando…</p>
      ) : !cuenta || !opciones ? (
        <div className={styles.vacio}>
          <p>Esta empresa no tiene ninguna cuenta de correo conectada.</p>
        </div>
      ) : enviadoA ? (
        <div className={styles.vacio} role="status">
          <p>Enviado. Abriendo el hilo en cuanto Gmail lo sincronice…</p>
          {tardando ? (
            <p>
              Está tardando más de lo normal. El mail salió igual:{' '}
              <Link to="/emails">volvé a la bandeja</Link> y va a aparecer ahí.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className={styles.subtitulo}>Desde {cuenta.direccion}</p>
          <Composer
            opciones={opciones}
            titulo={inicial.borrador ? 'Borrador' : 'Nuevo email'}
            onCerrar={() => void navigate('/emails')}
            onEnviado={setEnviadoA}
          />
        </>
      )}
    </div>
  )
}
