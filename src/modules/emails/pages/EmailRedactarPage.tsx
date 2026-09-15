import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Composer } from '../components/Composer'
import { SinAccesoEmails } from '../components/SinAccesoEmails'
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
  if (!puedeUsarEmails(activa?.rol)) return <SinAccesoEmails titulo="Nuevo email" />
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

  const titulo = inicial.borrador ? 'Borrador' : 'Nuevo email'

  return (
    <div className={`${doc.pagina} ${styles.paginaAngosta}`}>
      <PageHeader back={{ to: '/emails', label: 'Bandeja' }} title={titulo} subtitle={cuenta ? `Desde ${cuenta.direccion}` : undefined} />
      {cuentas.isPending ? (
        <div className={styles.lista}>
          <SkeletonRows rows={4} columns={1} label="Cargando…" />
        </div>
      ) : !cuenta || !opciones ? (
        <EmptyState icon="mail" title="Sin cuenta de correo" description="Esta empresa no tiene ninguna cuenta de correo conectada." />
      ) : enviadoA ? (
        <div className={styles.enviadoCaja} role="status">
          <p className={styles.cargandoTexto}>
            <Spinner size={16} />
            Enviado. Abriendo el hilo en cuanto Gmail lo sincronice…
          </p>
          {tardando ? (
            <p className={styles.nota}>
              Está tardando más de lo normal. El mail salió igual: <Link to="/emails">volvé a la bandeja</Link> y va a aparecer ahí.
            </p>
          ) : null}
        </div>
      ) : (
        <Composer opciones={opciones} titulo={titulo} mostrarTitulo={false} onCerrar={() => void navigate('/emails')} onEnviado={setEnviadoA} />
      )}
    </div>
  )
}
