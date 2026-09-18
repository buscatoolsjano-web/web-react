import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Paginador } from '../components/Paginador'
import { useColaDeRevision } from '../hooks/useClientes'
import { useResolverRevision } from '../hooks/useEdicionClientes'
import { permisosDe } from '../lib/permisos'
import { explicarMotivo } from '../lib/motivos'
import { formatearCuit, nombreVisible } from '../lib/formato'
import type { ClienteListado } from '../types'
import styles from './ClientesRevisarPage.module.css'

const CLIENTE = { singular: 'cliente', plural: 'clientes' }

/**
 * La cola de revisión (Fase 17 · E5).
 *
 * Los 40 clientes marcados los marcó **el importador**, no una persona: son
 * los casos que la migración no pudo decidir sola —un CUIT que aparecía en dos
 * registros del legacy, un cliente que sólo existía en la agenda de contactos,
 * varios registros viejos apuntando al mismo cliente—.
 *
 * Lo que hace esta pantalla es juntarlos en un lugar y ofrecer lo único que
 * corresponde: **abrir el cliente y mirar**, o dar el motivo por revisado. No
 * fusiona ni borra. Y los motivos que se resuelven solos cuando aparece el dato
 * —«falta el CUIT», por ejemplo— ya los limpia un trigger: acá no hay que hacer
 * nada con ellos.
 */
export function ClientesRevisarPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(25)
  const [resolviendo, setResolviendo] = useState<string | null>(null)

  const cola = useColaDeRevision({ pagina, porPagina })
  const volver = { to: '/clientes', label: 'Clientes' }

  const filas = cola.data?.filas ?? []
  const total = cola.data?.total ?? 0

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={volver}
        title="Clientes para revisar"
        subtitle="Casos que la migración no pudo decidir sola. Se revisan de a uno."
      />

      {cola.error ? (
        <ErrorState
          title="No se pudo leer la cola."
          description={cola.error.message}
          onRetry={() => void cola.refetch()}
          retrying={cola.isFetching}
        />
      ) : cola.isPending ? (
        <SkeletonRows rows={5} columns={3} label="Cargando la cola…" />
      ) : filas.length === 0 ? (
        <EmptyState
          icon="check"
          title="No hay clientes para revisar"
          description="Cuando la migración o una carga marque algo que necesita mirada humana, aparece acá."
          action={<LinkButton to="/clientes">Ir al listado</LinkButton>}
        />
      ) : (
        <>
          <p className={styles.resumen}>
            {total === 1 ? '1 cliente marcado' : `${total} clientes marcados`} para revisar.
          </p>

          <ul className={styles.lista}>
            {filas.map((c) => (
              <FilaDeRevision
                key={c.id}
                cliente={c}
                puedeResolver={permisos.resolverRevision}
                resolviendo={resolviendo === c.id}
                onResolviendo={setResolviendo}
              />
            ))}
          </ul>

          <Paginador
            pagina={pagina}
            porPagina={porPagina}
            total={total}
            cargando={cola.isFetching}
            sustantivo={CLIENTE}
            onIr={setPagina}
            onTamano={(n) => {
              setPorPagina(n)
              setPagina(1)
            }}
          />
        </>
      )}
    </div>
  )
}

interface FilaProps {
  cliente: ClienteListado
  puedeResolver: boolean
  resolviendo: boolean
  onResolviendo: (id: string | null) => void
}

function FilaDeRevision({ cliente, puedeResolver, resolviendo, onResolviendo }: FilaProps) {
  const resolver = useResolverRevision(cliente.id)

  return (
    <li className={styles.item}>
      <div className={styles.cabecera}>
        <Link className={styles.nombre} to={`/clientes/${cliente.id}`}>
          {nombreVisible(cliente.razonSocial, cliente.nombreComercial)}
        </Link>
        {cliente.dadoDeBaja ? <Badge tone="danger" outline>Dado de baja</Badge> : null}
      </div>

      <p className={styles.meta}>
        {[
          cliente.referencia,
          cliente.cuit ? formatearCuit(cliente.cuit) : 'sin CUIT',
          cliente.esHistorico ? 'migrado del sistema anterior' : null,
        ]
          .filter((x) => x !== null)
          .join(' · ')}
      </p>

      <ul className={styles.motivos}>
        {cliente.motivosRevision.map((m) => (
          <li key={m} className={styles.motivo}>
            <Icon name="info" size={16} />
            <span>{explicarMotivo(m)}</span>
            {puedeResolver ? (
              <Button
                variant="secondary"
                size="sm"
                loading={resolver.isPending && resolviendo}
                onClick={() => {
                  onResolviendo(cliente.id)
                  resolver.mutate([m], { onSettled: () => onResolviendo(null) })
                }}
              >
                Dar por revisado
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {resolver.error ? (
        <Alert tone="danger" role="alert" title="No se pudo resolver">
          <p>{resolver.error.message}</p>
        </Alert>
      ) : null}

      <div className={styles.acciones}>
        <LinkButton variant="secondary" to={`/clientes/${cliente.id}`}>
          Abrir el cliente
        </LinkButton>
      </div>
    </li>
  )
}
