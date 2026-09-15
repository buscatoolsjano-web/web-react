import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { useListasPrecios } from '../hooks/useMaestros'
import { AUTORIDAD, mensajeErrorMaestro, textoVigenciaLista, type ListaPrecios } from '../lib/maestros'
import { ErrorMaestro } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

const codigo = (e: unknown) => (e instanceof ErrorMaestro ? e.codigo : 'desconocido')

/**
 * Configuración → Listas de precios: SÓLO LECTURA (AUTORIDAD.listas).
 *
 * Sin filtros: son pocas listas por empresa (Buscatools tiene 3). Buscar y
 * filtrar tiene sentido dentro de una lista, que puede tener miles de precios.
 */
export function ListasPreciosPage() {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const q = useListasPrecios()
  const lista = q.data ?? []

  const columnas: Column<ListaPrecios>[] = [
    {
      key: 'nombre',
      header: 'Lista',
      mobile: 'title',
      render: (l) => (
        <span className={styles.persona}>
          <Link to={`/configuracion/listas-precios/${l.id}`} className={cx(styles.nombre, styles.enlace)}>
            {l.nombre}
          </Link>
          {l.porDefecto && <Badge tone="brand">Predeterminada de la empresa</Badge>}
        </span>
      ),
    },
    { key: 'moneda', header: 'Moneda', width: '6rem', render: (l) => l.moneda },
    {
      key: 'items',
      header: 'Precios',
      align: 'right',
      width: '9rem',
      render: (l) => (
        <span>
          {l.items.toLocaleString('es-AR')}
          {l.itemsVigentes !== l.items && <span className={styles.email}> ({l.itemsVigentes.toLocaleString('es-AR')} vigentes)</span>}
        </span>
      ),
    },
    { key: 'cero', header: 'En 0', align: 'right', width: '5rem', render: (l) => l.preciosCero.toLocaleString('es-AR') },
    { key: 'vigencia', header: 'Vigencia', render: (l) => textoVigenciaLista(l) },
    { key: 'clientes', header: 'Clientes', align: 'right', width: '6rem', render: (l) => l.clientes.toLocaleString('es-AR') },
  ]

  return (
    <>
      <PageHeader title="Listas de precios" subtitle={`Listas de ${activa?.companyName ?? 'la empresa'}, cada una en su moneda.`} status={<Badge tone="neutral" outline>Sólo lectura</Badge>} />

      <StatusMessage tono="pending" titulo={AUTORIDAD.listas.titulo} detalle={AUTORIDAD.listas.detalle} />

      {q.isError ? (
        <StatusMessage tono="error" titulo={codigo(q.error) === 'sin_permiso' ? 'Tu rol no tiene acceso a las listas de precios.' : mensajeErrorMaestro(codigo(q.error))} />
      ) : (
        <ResponsiveTable
          columns={columnas}
          rows={lista}
          rowKey={(l) => l.id}
          isLoading={q.isPending}
          emptyMessage="Esta empresa no tiene listas de precios."
          onRowClick={(l) => void navegar(`/configuracion/listas-precios/${l.id}`)}
          renderCard={(l) => (
            <article className={styles.card}>
              <div className={styles.cardCabecera}>
                {columnas[0]!.render!(l)}
                <Badge tone="neutral">{l.moneda}</Badge>
              </div>
              <dl className={styles.cardDatos}>
                <dt>Precios</dt>
                <dd>{columnas[2]!.render!(l)}</dd>
                <dt>En 0</dt>
                <dd>{l.preciosCero.toLocaleString('es-AR')}</dd>
                <dt>Vigencia</dt>
                <dd>{textoVigenciaLista(l)}</dd>
                <dt>Clientes</dt>
                <dd>{l.clientes.toLocaleString('es-AR')}</dd>
              </dl>
            </article>
          )}
        />
      )}
    </>
  )
}
