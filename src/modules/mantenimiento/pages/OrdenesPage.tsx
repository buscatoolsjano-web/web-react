import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { contar } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { permisosDe } from '../lib/permisos'
import { FiltrosOrdenes } from '../components/FiltrosOrdenes'
import { ListadoOrdenes } from '../components/ListadoOrdenes'
import { Paginador } from '../components/Paginador'
import { useOrdenes } from '../hooks/useOrdenes'
import { useFiltrosOrdenes } from '../hooks/useFiltrosOrdenes'
import {
  etiquetaDeCotizacion,
  etiquetaDeEstado,
  etiquetaDeEtapa,
  etiquetaDeServicio,
} from '../lib/estados'
import { descargarCsv, ordenesACsv } from '../lib/csv'
import { exportarOrdenes } from '../services/ordenes'
import type { OrdenDeOrdenes } from '../types'

const ORDENES = { singular: 'orden', plural: 'órdenes' }

/**
 * Las órdenes de servicio.
 *
 * Filtros, orden, página y total exacto los resuelve el servidor.
 *
 * Fase 13 · E5: PageHeader, FilterBar, tabla común, Pagination y los estados
 * vacío / error del sistema. Mismas consultas y mismos permisos.
 */
const hoy = () => new Date().toISOString().slice(0, 10)

export function OrdenesPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosOrdenes()
  const { data, isPending, isFetching, error, refetch } = useOrdenes(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  // Las etiquetas van en castellano, como en pantalla: un CSV que dice
  // «quotation» y «on_hold» obliga a traducir a mano lo que la aplicación ya
  // sabe traducir.
  const exportar = useMutation({
    mutationFn: () => exportarOrdenes(activa!.companyId, filtros),
    onSuccess: ({ filas }) =>
      descargarCsv(
        `ordenes-de-servicio-${hoy()}.csv`,
        ordenesACsv(
          filas,
          etiquetaDeEtapa,
          etiquetaDeEstado,
          etiquetaDeServicio,
          etiquetaDeCotizacion,
        ),
      ),
  })

  const ordenar = (columna: OrdenDeOrdenes) => {
    // Click en la columna activa invierte; en otra, empieza descendente — un
    // listado de documentos se lee de lo más nuevo a lo más viejo.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Órdenes de servicio" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const total = data?.total ?? 0
  const filas = data?.filas ?? []
  const nueva = permisos.crear ? (
    <LinkButton to="/mantenimiento/ordenes/nueva" variant="primary" icon={<Icon name="plus" size={16} />}>
      Nueva orden
    </LinkButton>
  ) : undefined

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Órdenes de servicio"
        subtitle={isPending ? 'Cargando…' : contar(total, ORDENES)}
        actions={
          <>
            <LinkButton to="/mantenimiento/activos" variant="ghost">
              Equipos
            </LinkButton>
            <LinkButton to="/mantenimiento/puntos" variant="ghost">
              Puntos de revisión
            </LinkButton>
            <Button
              variant="secondary"
              icon={<Icon name="download" size={16} />}
              loading={exportar.isPending}
              disabled={total === 0}
              onClick={() => exportar.mutate()}
            >
              {exportar.isPending ? 'Exportando…' : 'Exportar a CSV'}
            </Button>
            {nueva}
          </>
        }
      />

      <FiltrosOrdenes
        filtros={filtros}
        hayFiltros={hayFiltros}
        onAplicar={aplicar}
        onLimpiar={limpiar}
      />

      {exportar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo exportar">
          <p>{exportar.error.message}</p>
        </Alert>
      ) : null}

      {error ? (
        <ErrorState title="No se pudo leer el listado." description={error.message} onRetry={() => void refetch()} retrying={isFetching} />
      ) : !isPending && filas.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description="No hay órdenes que coincidan. Probá con otro estado, etapa o fecha."
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState icon="inbox" title="Todavía no hay órdenes de servicio" action={nueva} />
        )
      ) : (
        <>
          <ListadoOrdenes
            filas={filas}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            cargando={isPending}
          />
          <Paginador
            pagina={filtros.pagina}
            porPagina={filtros.porPagina}
            total={total}
            cargando={isFetching}
            onIr={(pagina) => aplicar({ pagina })}
            onTamano={(porPagina) => aplicar({ porPagina })}
            sustantivo={ORDENES}
          />
        </>
      )}
    </div>
  )
}
