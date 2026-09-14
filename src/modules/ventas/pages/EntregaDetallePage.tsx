import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, MetaList, Missing, Totals } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAccionesDocumento } from '../components/AccionesDocumento'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { ChipEstado } from '../components/ChipEstado'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { TablaLineas } from '../components/TablaLineas'
import { mensajeErrorVentas, motivoBloqueo } from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useDocumento, useRelacionados } from '../hooks/useDocumentos'
import { confirmarEntrega, editabilidadEntrega } from '../services/entregas'
import editor from './EditorCotizacion.module.css'

/**
 * Detalle del remito.
 *
 * Un remito no se edita: se emite con lo que se entrega y después se
 * despacha. Lo único que hace esta pantalla, además de mostrarlo, es
 * confirmarlo — y esa confirmación es una función del servidor que mueve el
 * stock, libera reservas y actualiza el pedido en una sola transacción.
 */
export function EntregaDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('entrega', id)
  const relacionados = useRelacionados('entrega', id)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false
  // Despachar es de admin y employee: el mismo conjunto que `deliveries_write`.
  const escribe = escribeVentas(activa?.rol)
  // Fase 12 E2.5: despachar es el efecto productivo del remito (mueve stock).
  const autoridad = useAutoridadNumeracion()
  const stelEntrega = autoridad.stel('delivery')

  const confirmar = useMutation({
    mutationFn: () => confirmarEntrega(id!),
    onSuccess: (r) => {
      setUltimoError(null)
      setResultado(
        r.yaConfirmada
          ? 'El remito ya estaba despachado: no se repitió ningún movimiento de stock.'
          : `Despachado. ${r.movimientos} movimiento(s) de stock` +
            (r.reservasLiberadas > 0 ? `, ${r.reservasLiberadas} reserva(s) liberada(s)` : '') +
            '.',
      )
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
    },
    onError: (e: Error) => {
      setResultado(null)
      setUltimoError(mensajeErrorVentas(e))
    },
  })

  const acciones = useAccionesDocumento(doc)

  if (isPending) {
    return (
      <p className={editor.cargando} role="status">
        <Spinner size={20} /> Cargando nota de entrega…
      </p>
    )
  }

  if (error) {
    return <ErrorState title="No se pudo leer la nota de entrega." description={error.message} />
  }

  if (!doc) {
    return (
      <EmptyState
        headingLevel={1}
        icon="search"
        title="No se encontró la nota de entrega"
        description="Puede que no exista o que no tengas acceso."
        action={
          <LinkButton to="/ventas/entregas" icon={<Icon name="arrow-left" size={16} />}>
            Volver a Notas de entrega
          </LinkButton>
        }
      />
    )
  }

  const permiso = editabilidadEntrega(doc.estado, escribe)

  return (
    <div className={docUi.pagina}>
      <PageHeader
        back={{ to: '/ventas/entregas', label: 'Notas de entrega' }}
        title={doc.numero}
        status={
          <>
            <ChipEstado estado={presentarEstado('entrega', doc.estado)} />
            {doc.serie ? <Badge tone="neutral">Serie {doc.serie}</Badge> : null}
            {doc.esHistorico ? (
              <Badge tone="neutral" outline>
                Migrado del sistema anterior
              </Badge>
            ) : null}
            {confirmar.isPending ? (
              <span className={editor.guardando} role="status">
                <Spinner size={16} /> Despachando…
              </span>
            ) : null}
          </>
        }
        subtitle={[doc.clienteNombre, formatearFecha(doc.fecha), doc.titulo].filter(Boolean).join(' · ')}
        actions={
          <div className={docUi.importe}>
            <span className={docUi.importeValor}>{formatearImporte(doc.total, doc.moneda)}</span>
            <span className={docUi.importeLabel}>Total</span>
          </div>
        }
      />

      <AvisosHistoricos
        motivos={doc.motivosRevision}
        numeroFueraDeSerie={doc.numeroFueraDeSerie}
        numeroSospechado={doc.numeroSospechado}
        esHistorico={doc.esHistorico}
      />

      {esInterno && stelEntrega ? (
        <AvisoAutoridadStel detalle="Podés consultar, imprimir y exportar. Confirmar y despachar desde el ERP está bloqueado hasta completar la migración: no se mueve stock." />
      ) : null}

      {ultimoError ? (
        <Alert tone="danger" role="alert" title="No se pudo despachar">
          <p>{ultimoError}</p>
        </Alert>
      ) : null}
      {resultado ? (
        <Alert tone="success" role="status">
          <p>{resultado}</p>
        </Alert>
      ) : null}

      <ActionBar
        primary={
          permiso.confirmable ? (
            <Button
              icon={<Icon name="truck" size={16} />}
              loading={confirmar.isPending}
              disabled={stelEntrega || autoridad.cargando}
              aria-describedby={stelEntrega ? 'motivo-despachar' : undefined}
              onClick={() => confirmar.mutate()}
            >
              {confirmar.isPending ? 'Despachando…' : 'Confirmar y despachar'}
            </Button>
          ) : null
        }
        secondary={acciones.secundarias}
        danger={acciones.peligro}
        note={
          <>
            {permiso.confirmable ? (
              stelEntrega ? (
                <p id="motivo-despachar">{motivoBloqueo('delivery')}</p>
              ) : (
                <p>
                  Descuenta el stock de cada línea y libera las reservas del pedido. Se puede apretar una
                  sola vez: el servidor no repite el movimiento.
                </p>
              )
            ) : permiso.motivo ? (
              <p className={editor.candado}>
                <Icon name="alert-circle" size={16} /> {permiso.motivo}
              </p>
            ) : null}
            {acciones.motivo}
            {acciones.error ? (
              <p className={editor.error} role="alert">
                {acciones.error}
              </p>
            ) : null}
          </>
        }
      />

      <DocSection title="Datos de la entrega">
        <MetaList
          items={[
            { label: 'Cliente', value: doc.clienteNombre },
            { label: 'Contacto', value: doc.contactoNombre ?? '—' },
            { label: 'Fecha', value: formatearFecha(doc.fecha) },
            { label: 'Moneda', value: doc.moneda ?? <Missing /> },
            doc.origen
              ? {
                  label: 'Pedido de origen',
                  value: (
                    <Link to={`/ventas/pedidos/${doc.origen.id}`} className={docUi.enlace}>
                      {doc.origen.numero}
                    </Link>
                  ),
                }
              : null,
            doc.notas ? { label: 'Notas', value: doc.notas, wide: true } : null,
          ]}
        />
      </DocSection>

      <DocSection title="Líneas">
        <TablaLineas lineas={doc.lineas} moneda={doc.moneda} tipo="entrega" />
        <Totals
          rows={[
            { label: 'Subtotal', value: formatearImporte(doc.subtotal, doc.moneda) },
            { label: 'Impuestos', value: formatearImporte(doc.impuesto, doc.moneda) },
            { label: 'Total', value: formatearImporte(doc.total, doc.moneda), strong: true },
          ]}
        />
      </DocSection>

      <DocSection title="Adjuntos">
        <PanelAdjuntos tipo="entrega" documentoId={doc.id} />
      </DocSection>

      <DocSection title="Relacionados">
        <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} />
      </DocSection>

      {acciones.capas}
    </div>
  )
}
