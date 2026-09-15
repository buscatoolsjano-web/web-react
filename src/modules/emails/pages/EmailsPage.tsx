import { useMemo } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Pagination } from '@/components/tables/Pagination'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FiltrosEmails } from '../components/FiltrosEmails'
import { ListadoEmails } from '../components/ListadoEmails'
import { SinAccesoEmails } from '../components/SinAccesoEmails'
import { useAsignables, useBandeja, useCuentas, useFiltrosEmails } from '../hooks/useEmails'
import { useRealtimeEmails } from '../hooks/useRealtimeEmails'
import { TAMANOS_BANDEJA } from '../lib/filtros'
import { puedeUsarEmails } from '../lib/permisos'
import styles from '../components/Emails.module.css'

const HILO = { singular: 'hilo', plural: 'hilos' }

/**
 * La bandeja.
 *
 * Sale de `email_threads`, nunca de Gmail: metadata, paginada en el servidor,
 * de a 25. El legacy mandaba 766 kB por request, 716 de ellos en `body_text`.
 *
 * Fase 13 · E5: sigue siendo una bandeja —filas densas de remitente, asunto,
 * extracto y fecha—, ahora con PageHeader, FilterBar, Pagination y estados
 * comunes. Nada de la carga ni del tiempo real cambió.
 */
export function EmailsPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) return <SinAccesoEmails titulo="Emails" />
  return <Bandeja />
}

function Bandeja() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosEmails()
  const cuentas = useCuentas()
  const asignables = useAsignables()
  const bandeja = useBandeja(filtros)
  const { canal, reconectar } = useRealtimeEmails()

  const buzones = useMemo(
    () => new Map((cuentas.data ?? []).map((c) => [c.id, c.direccion] as const)),
    [cuentas.data],
  )
  const conError = (cuentas.data ?? []).filter((c) => c.errorSync)
  const total = bandeja.data?.total ?? 0
  const sinLeer = bandeja.data?.totalSinLeer ?? 0
  const unaCuenta = cuentas.data?.length === 1 ? cuentas.data[0] : null
  const filas = bandeja.data?.filas ?? []
  const actualizando = bandeja.isFetching && !bandeja.isPending

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Emails"
        subtitle={
          bandeja.isPending
            ? 'Cargando…'
            : `${total} ${total === 1 ? HILO.singular : HILO.plural} · ${sinLeer} sin leer${unaCuenta ? ` · ${unaCuenta.direccion}` : ''}`
        }
        actions={
          <>
            <Button
              variant="ghost"
              icon={<Icon name="refresh" size={16} />}
              onClick={reconectar}
              loading={actualizando}
              disabled={bandeja.isFetching}
              aria-label="Actualizar la bandeja"
            >
              {actualizando ? 'Actualizando…' : 'Actualizar'}
            </Button>
            <LinkButton to="/emails/borradores" icon={<Icon name="edit" size={16} />}>
              Borradores
            </LinkButton>
            <LinkButton to="/emails/redactar" variant="primary" icon={<Icon name="plus" size={16} />}>
              Nuevo email
            </LinkButton>
          </>
        }
      />

      {canal === 'caido' ? (
        <Alert
          tone="warning"
          role="status"
          title="La actualización en vivo se desconectó"
          action={
            <Button variant="secondary" size="sm" onClick={reconectar}>
              Reconectar
            </Button>
          }
        >
          <p>Lo nuevo no va a aparecer solo.</p>
        </Alert>
      ) : null}

      {conError.map((c) => (
        <Alert key={c.id} tone="warning" role="status" title={`La sincronización de ${c.direccion} tuvo un problema`}>
          <p>
            {c.errorSyncEn ? `Desde el ${new Date(c.errorSyncEn).toLocaleString('es-AR')}. ` : ''}Puede faltar correo reciente hasta que se recupere.
          </p>
        </Alert>
      ))}

      <FiltrosEmails
        filtros={filtros}
        hayFiltros={hayFiltros}
        cuentas={cuentas.data ?? []}
        asignables={asignables.data ?? []}
        onAplicar={aplicar}
        onLimpiar={limpiar}
      />

      {bandeja.error ? (
        <ErrorState
          title="No se pudo leer la bandeja."
          description={bandeja.error.message}
          onRetry={() => void bandeja.refetch()}
          retrying={bandeja.isFetching}
        />
      ) : cuentas.data && cuentas.data.length === 0 ? (
        <EmptyState icon="mail" title="Sin cuenta de correo" description="Esta empresa no tiene ninguna cuenta de correo conectada." />
      ) : bandeja.isPending ? (
        <div className={styles.lista}>
          <SkeletonRows rows={6} columns={3} label="Cargando la bandeja…" />
        </div>
      ) : total === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Ningún hilo coincide con los filtros"
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState icon="inbox" title="La bandeja está vacía" />
        )
      ) : filas.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No hay hilos en esta página"
          action={
            <Button variant="secondary" onClick={() => aplicar({ pagina: 1 })}>
              Ir a la primera página
            </Button>
          }
        />
      ) : (
        <ListadoEmails filas={filas} buzones={buzones} />
      )}

      {total > 0 ? (
        <Pagination
          label="Paginación de la bandeja"
          offset={(filtros.pagina - 1) * filtros.porPagina}
          pageSize={filtros.porPagina}
          total={total}
          noun={HILO}
          loading={bandeja.isFetching}
          onChange={(offset) => aplicar({ pagina: Math.floor(offset / filtros.porPagina) + 1 })}
          pageSizeOptions={TAMANOS_BANDEJA}
          onPageSizeChange={(porPagina) => aplicar({ porPagina })}
        />
      ) : null}
    </div>
  )
}
