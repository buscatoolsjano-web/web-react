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
import { descargarCsv, pedidosACsv } from '../lib/csv'
import { etiquetaDeEstadoPedido, etiquetaDeRecepcion } from '../lib/estados'
import { exportarPedidos } from '../services/pedidos'
import { FiltrosPedidos } from '../components/FiltrosPedidos'
import { ListadoPedidos } from '../components/ListadoPedidos'
import { Paginador } from '../components/Paginador'
import { usePedidos } from '../hooks/usePedidos'
import { useFiltrosPedidos } from '../hooks/useFiltrosPedidos'
import type { OrdenPedidos } from '../types'

const PEDIDOS = { singular: 'pedido', plural: 'pedidos' }

/**
 * El listado de pedidos de compra.
 *
 * Todo del lado del servidor: filtros, orden, página y el total exacto.
 *
 * No hay una fila de «total general»: en este listado conviven pedidos en
 * USD, ARS y EUR, y sumarlos daría el mismo número sin sentido que daba el
 * panel del legacy. Cada importe lleva su moneda al lado.
 */
export function PedidosPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosPedidos()
  const { data, isPending, isFetching, error, refetch } = usePedidos(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  /**
   * Exportar.
   *
   * Se lleva **lo que muestran los filtros**, no la página en pantalla ni la
   * tabla entera: las páginas las pide el servidor.
   */
  const exportar = useMutation({
    mutationFn: () => exportarPedidos(activa!.companyId, filtros),
    onSuccess: ({ filas }) =>
      descargarCsv(
        `pedidos-compra-${new Date().toISOString().slice(0, 10)}.csv`,
        pedidosACsv(filas, etiquetaDeEstadoPedido, etiquetaDeRecepcion),
      ),
  })

  const ordenar = (columna: OrdenPedidos) => {
    // Click en la columna activa invierte; en otra, empieza descendente — un
    // listado de documentos se lee del más nuevo al más viejo.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

  if (!permisos.verProveedores) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Pedidos de compra" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Compras. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const total = data?.total ?? 0
  const filas = data?.filas ?? []
  const nuevo = permisos.crearProveedor ? (
    <LinkButton to="/compras/pedidos/nuevo" variant="primary" icon={<Icon name="plus" size={16} />}>
      Nuevo pedido
    </LinkButton>
  ) : undefined

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Pedidos de compra"
        subtitle={isPending ? 'Cargando…' : contar(total, PEDIDOS)}
        actions={
          <>
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

      {exportar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo exportar">
          <p>{exportar.error.message}</p>
        </Alert>
      ) : null}

      <FiltrosPedidos filtros={filtros} hayFiltros={hayFiltros} onAplicar={aplicar} onLimpiar={limpiar} />

      {error ? (
        <ErrorState title="No se pudo leer el listado." description="Revisá la conexión y volvé a intentar." onRetry={() => void refetch()} retrying={isFetching} />
      ) : !isPending && filas.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description="No hay pedidos de compra que coincidan. Probá con otro proveedor, estado o fecha."
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState icon="inbox" title="Todavía no hay pedidos de compra" action={nuevo} />
        )
      ) : (
        <>
          <ListadoPedidos filas={filas} orden={filtros.orden} direccion={filtros.direccion} onOrdenar={ordenar} cargando={isPending} />
          <Paginador
            pagina={filtros.pagina}
            porPagina={filtros.porPagina}
            total={total}
            cargando={isFetching}
            onIr={(pagina) => aplicar({ pagina })}
            onTamano={(porPagina) => aplicar({ porPagina })}
            sustantivo={PEDIDOS}
          />
        </>
      )}
    </div>
  )
}
