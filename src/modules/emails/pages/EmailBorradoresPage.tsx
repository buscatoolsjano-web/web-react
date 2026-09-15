import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { SinAccesoEmails } from '../components/SinAccesoEmails'
import { useCuentas } from '../hooks/useEmails'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { puedeUsarEmails } from '../lib/permisos'
import { hiloIndexado, listarBorradores } from '../services/redactar'
import type { ResumenBorradorGmail } from '../types'
import styles from '../components/Emails.module.css'

const ETIQUETA_MODO: Record<string, string> = {
  nuevo: 'Nuevo',
  responder: 'Respuesta',
  responder_todos: 'Respuesta a todos',
  reenviar: 'Reenvío',
}

/**
 * Los borradores del buzón, leídos de Gmail. No hay copia local: si alguien
 * crea uno desde Gmail, aparece acá también. La identificación de cada
 * borrador (`draft_id`, hilo y modo) no cambió.
 */
export function EmailBorradoresPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) return <SinAccesoEmails titulo="Borradores" />
  return <Borradores />
}

function Borradores() {
  const cuentas = useCuentas()
  const cuenta = cuentas.data?.[0] ?? null
  const navigate = useNavigate()
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const borradores = useQuery({
    queryKey: ['emails-borradores', cuenta?.id],
    queryFn: () => listarBorradores(cuenta!.id, null),
    enabled: !!cuenta,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  const abrir = async (b: ResumenBorradorGmail) => {
    if (!cuenta) return
    setAbriendo(b.draft_id)
    // Una respuesta se retoma dentro de su hilo, si el hilo ya está en la bandeja.
    if (b.modo && b.modo !== 'nuevo') {
      const id = await hiloIndexado(cuenta.id, b.thread_id).catch(() => null)
      if (id) {
        void navigate(`/emails/${id}?componer=${b.modo}&borrador=${encodeURIComponent(b.draft_id)}`)
        return
      }
    }
    void navigate(`/emails/redactar?borrador=${encodeURIComponent(b.draft_id)}`)
  }

  const error = borradores.error
  const lista = borradores.data ?? []
  return (
    <div className={doc.listado}>
      <PageHeader
        back={{ to: '/emails', label: 'Bandeja' }}
        title="Borradores"
        subtitle={`Guardados en Gmail${cuenta ? ` · ${cuenta.direccion}` : ''}`}
        actions={
          <LinkButton to="/emails/redactar" variant="primary" icon={<Icon name="plus" size={16} />}>
            Nuevo email
          </LinkButton>
        }
      />

      {borradores.isPending && cuenta ? (
        <div className={styles.lista}>
          <p className={styles.cargandoTexto} role="status">
            <Spinner size={16} />
            Leyendo los borradores de Gmail…
          </p>
          <SkeletonRows rows={3} columns={2} />
        </div>
      ) : error ? (
        <ErrorState
          title={mensajeDeError(error instanceof ErrorContenido ? error.codigo : 'desconocido')}
          onRetry={() => void borradores.refetch()}
          retrying={borradores.isFetching}
        />
      ) : lista.length === 0 ? (
        <EmptyState icon="edit" title="No hay borradores" description="Los borradores que se guarden desde el ERP o desde Gmail aparecen acá." />
      ) : (
        <ul className={styles.lista} aria-label="Borradores">
          {lista.map((b) => (
            <li key={b.draft_id}>
              <button type="button" className={styles.filaBoton} onClick={() => void abrir(b)} disabled={abriendo !== null}>
                <span className={styles.remitente}>{b.para.length ? `Para: ${b.para.join(', ')}` : '(sin destinatarios)'}</span>
                <span className={styles.centro}>
                  <span className={styles.asunto}>{b.asunto || '(sin asunto)'}</span>
                  <span className={styles.meta}>
                    {b.modo ? <Badge tone="neutral">{ETIQUETA_MODO[b.modo]}</Badge> : null}
                    {b.fecha ? <span>{new Date(b.fecha).toLocaleString('es-AR')}</span> : null}
                  </span>
                </span>
                <span className={styles.derecha}>
                  {abriendo === b.draft_id ? (
                    <>
                      <Spinner size={16} /> Abriendo…
                    </>
                  ) : (
                    <>
                      Abrir <Icon name="chevron-right" size={16} />
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
