import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { Badge } from '@/components/ui/Badge'
import { useFacturasVenta } from '../hooks/useFacturasVenta'
import { formatearFecha, formatearImporte } from '../lib/formato'
import type { FacturaListada } from '../services/facturas'

const ESTADO: Record<string, { texto: string; tono: 'neutral' | 'info' | 'success' | 'danger' }> = {
  draft: { texto: 'Borrador', tono: 'neutral' },
  issued: { texto: 'Emitida', tono: 'info' },
  paid: { texto: 'Cobrada', tono: 'success' },
  cancelled: { texto: 'Anulada', tono: 'danger' },
}

const COLUMNAS: Column<FacturaListada>[] = [
  { key: 'numero', header: 'Número', mobile: 'title', width: '150px' },
  { key: 'fecha', header: 'Fecha', width: '110px', render: (f) => formatearFecha(f.fecha) },
  { key: 'cliente', header: 'Cliente' },
  {
    key: 'pedido',
    header: 'Pedido',
    width: '130px',
    hideBelow: 'lg',
    render: (f) => f.pedidoNumero ?? '—',
  },
  {
    key: 'externo',
    header: 'Nº en Tango',
    width: '130px',
    hideBelow: 'xl',
    // Mientras la API no esté enchufada esto va vacío en todas. Se muestra
    // igual: es la columna que dice de un vistazo qué se replicó y qué no.
    render: (f) => f.numeroExterno ?? 'Sin replicar',
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    width: '140px',
    render: (f) => formatearImporte(f.total, f.moneda),
  },
  {
    key: 'estado',
    header: 'Estado',
    width: '120px',
    render: (f) => {
      const e = ESTADO[f.estado] ?? { texto: f.estado, tono: 'neutral' as const }
      return <Badge tone={e.tono}>{e.texto}</Badge>
    },
  },
]

/**
 * Las facturas de venta (Fase 29 · E7).
 *
 * Todavía no se crean desde acá: nacen del pedido, con «Generar» en el
 * circuito de la venta. Esta pantalla es dónde viven después.
 */
export function FacturasVentaPage() {
  const facturas = useFacturasVenta()
  const navegar = useNavigate()

  if (facturas.error) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Facturas" />
        <ErrorState
          title="No se pudieron leer las facturas."
          description={facturas.error.message}
          onRetry={() => void facturas.refetch()}
          retrying={facturas.isFetching}
        />
      </div>
    )
  }

  const filas = facturas.data ?? []

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Facturas"
        subtitle={
          facturas.isPending
            ? undefined
            : `${filas.length} ${filas.length === 1 ? 'factura' : 'facturas'}`
        }
      />

      {!facturas.isPending && filas.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="Todavía no hay facturas"
          description="Las facturas se generan desde el pedido, en el circuito de la venta. El número fiscal lo sigue dando AFIP a través de Tango."
        />
      ) : (
        <ResponsiveTable
          columns={COLUMNAS}
          rows={filas}
          rowKey={(f) => f.id}
          isLoading={facturas.isPending}
          // `void`: en React Router 7 `navigate()` devuelve una promesa, y
          // pasarla tal cual a un handler que espera void es lo que marca
          // `no-misused-promises` —un error de navegación se perdería sin que
          // nadie lo vea—.
          onRowClick={(f) => void navegar(`/ventas/facturas/${f.id}`)}
        />
      )}
    </div>
  )
}
