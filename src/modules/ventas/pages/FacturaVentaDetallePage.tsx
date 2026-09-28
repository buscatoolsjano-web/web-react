import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection } from '@/components/document/DocSection'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useFacturaVenta } from '../hooks/useFacturasVenta'
import { formatearCantidad, formatearFecha, formatearImporte } from '../lib/formato'
import type { LineaFactura } from '../services/facturas'

const ESTADO: Record<string, { texto: string; tono: 'neutral' | 'info' | 'success' | 'danger' }> = {
  draft: { texto: 'Borrador', tono: 'neutral' },
  issued: { texto: 'Emitida', tono: 'info' },
  paid: { texto: 'Cobrada', tono: 'success' },
  cancelled: { texto: 'Anulada', tono: 'danger' },
}

function columnas(moneda: string): Column<LineaFactura>[] {
  return [
    { key: 'sku', header: 'Ref.', width: '130px' },
    { key: 'nombre', header: 'Producto', mobile: 'title' },
    {
      key: 'cantidad',
      header: 'Uds.',
      align: 'right',
      width: '90px',
      render: (l) => formatearCantidad(l.cantidad),
    },
    {
      key: 'precio',
      header: 'Precio',
      align: 'right',
      width: '130px',
      render: (l) => formatearImporte(l.precioUnitario, moneda),
    },
    {
      key: 'descuento',
      header: '% Dto.',
      align: 'right',
      width: '90px',
      hideBelow: 'lg',
      render: (l) => (l.descuentoPct > 0 ? `${l.descuentoPct} %` : '—'),
    },
    {
      key: 'subtotal',
      header: 'Subtotal',
      align: 'right',
      width: '140px',
      render: (l) =>
        formatearImporte(l.cantidad * l.precioUnitario * (1 - l.descuentoPct / 100), moneda),
    },
  ]
}

/**
 * Una factura de venta (Fase 29 · E7).
 *
 * De sólo lectura por ahora, y a propósito: la factura se emite desde el
 * pedido y el número fiscal lo pone AFIP por Tango. Editarla acá daría la
 * impresión de que este documento manda, y no manda.
 */
export function FacturaVentaDetallePage() {
  const { id } = useParams<{ id: string }>()
  const factura = useFacturaVenta(id)

  if (factura.isPending) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Factura" />
        <SkeletonRows rows={6} columns={3} label="Cargando la factura…" />
      </div>
    )
  }

  if (factura.error) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Factura" />
        <ErrorState
          title="No se pudo leer la factura."
          description={factura.error.message}
          onRetry={() => void factura.refetch()}
          retrying={factura.isFetching}
        />
      </div>
    )
  }

  const f = factura.data
  if (!f) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Factura" />
        <EmptyState
          icon="inbox"
          title="Esa factura no existe"
          description="Puede que la hayan anulado, o que el enlace esté viejo."
        />
      </div>
    )
  }

  const estado = ESTADO[f.estado] ?? { texto: f.estado, tono: 'neutral' as const }

  return (
    <div className={doc.listado}>
      <PageHeader
        title={f.numero}
        subtitle={`${f.cliente} · ${formatearFecha(f.fecha)}`}
        actions={<Badge tone={estado.tono}>{estado.texto}</Badge>}
      />

      <ActionBar volver={{ to: '/ventas/facturas', label: 'Facturas' }} titulo={f.numero} />

      {/* Mientras no esté la API, toda factura vive sólo en el ERP. Decirlo
          acá evita que alguien la mande creyendo que es el comprobante. */}
      {f.numeroExterno === null ? (
        <Alert tone="info" role="status" title="Todavía no está en Tango">
          <p>
            Esta factura existe sólo en el ERP y su número es interno. El comprobante fiscal lo
            emite AFIP a través de Tango Factura.
          </p>
        </Alert>
      ) : null}

      <DocSection title="Datos de la factura">
        <dl className={doc.datos}>
          <div>
            <dt>Cliente</dt>
            <dd>{f.cliente}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{formatearFecha(f.fecha)}</dd>
          </div>
          <div>
            <dt>Pedido de origen</dt>
            <dd>
              {f.pedidoId && f.pedidoNumero ? (
                <Link to={`/ventas/pedidos/${f.pedidoId}`} className={doc.enlace}>
                  {f.pedidoNumero}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Nº en Tango</dt>
            <dd>{f.numeroExterno ?? 'Sin replicar'}</dd>
          </div>
        </dl>
      </DocSection>

      <DocSection title="Líneas">
        <ResponsiveTable
          columns={columnas(f.moneda)}
          rows={f.lineas}
          rowKey={(l) => l.id}
          emptyMessage="La factura no tiene líneas."
        />
        <dl className={doc.totales}>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatearImporte(f.subtotal, f.moneda)}</dd>
          </div>
          <div>
            <dt>Impuestos</dt>
            <dd>{formatearImporte(f.impuestos, f.moneda)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatearImporte(f.total, f.moneda)}</dd>
          </div>
        </dl>
      </DocSection>
    </div>
  )
}
