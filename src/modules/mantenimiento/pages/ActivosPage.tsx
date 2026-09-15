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
import { FiltrosActivos } from '../components/FiltrosActivos'
import { ListadoActivos } from '../components/ListadoActivos'
import { Paginador } from '../components/Paginador'
import { useActivos } from '../hooks/useActivos'
import { useFiltrosActivos } from '../hooks/useFiltrosActivos'
import { descargarCsv, equiposACsv } from '../lib/csv'
import { exportarActivos } from '../services/activos'
import type { OrdenActivos } from '../types'

const EQUIPOS = { singular: 'equipo', plural: 'equipos' }

/**
 * El parque de equipos.
 *
 * Filtros, orden, página y total exacto los resuelve el servidor: nunca se
 * traen todas las filas al navegador.
 *
 * A quien no sea admin ni employee este listado le vuelve vacío: las ocho
 * tablas de Mantenimiento usan `app.current_maintenance_company_ids()`. Se
 * avisa antes de mostrarle una pantalla en blanco, pero lo que lo impide es
 * RLS, no este `if`.
 */
const hoy = () => new Date().toISOString().slice(0, 10)

export function ActivosPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosActivos()
  const { data, isPending, isFetching, error, refetch } = useActivos(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  // Exporta **lo que muestran los filtros**, no la página visible ni la tabla
  // entera: es lo que alguien espera cuando filtró antes de apretar el botón.
  const exportar = useMutation({
    mutationFn: () => exportarActivos(activa!.companyId, filtros),
    onSuccess: ({ filas }) => descargarCsv(`equipos-${hoy()}.csv`, equiposACsv(filas)),
  })

  const ordenar = (columna: OrdenActivos) => {
    // Click en la columna activa invierte; en otra, empieza ascendente — un
    // parque de equipos se lee por referencia, no por fecha.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'asc' },
    )
  }

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Equipos" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const total = data?.total ?? 0
  const filas = data?.filas ?? []
  const nuevo = permisos.crear ? (
    <LinkButton to="/mantenimiento/activos/nuevo" variant="primary" icon={<Icon name="plus" size={16} />}>
      Nuevo equipo
    </LinkButton>
  ) : undefined

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Equipos"
        subtitle={isPending ? 'Cargando…' : contar(total, EQUIPOS)}
        actions={
          <>
            <LinkButton to="/mantenimiento/ordenes" variant="ghost">
              Órdenes de servicio
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
            {nuevo}
          </>
        }
      />

      <FiltrosActivos
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
            description="No hay equipos que coincidan. Probá con otra serie, referencia o tipo."
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState icon="inbox" title="Todavía no hay equipos cargados" action={nuevo} />
        )
      ) : (
        <>
          <ListadoActivos
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
            sustantivo={EQUIPOS}
          />
        </>
      )}
    </div>
  )
}
