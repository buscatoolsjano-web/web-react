import { lazy, Suspense, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input } from '@/components/forms/controls'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import { permisosDe } from '../lib/permisos'
import { etiquetaDeTipoLinea } from '../lib/estados'
import { formatearFecha, formatearImporte, formatearNumero } from '../lib/formato'
import { aHojaDeLote, asuntoDeLote, cuerpoDeLote } from '../lib/hojaPresupuesto'
import { ChipCotizacion, ChipLote } from '../components/ChipEstado'
import {
  agregarAlLote,
  aprobarLote,
  obtenerLote,
  ordenesElegibles,
  pedidoDelLote,
  quitarDelLote,
  rechazarLote,
} from '../services/lotes'
import styles from './Pagina.module.css'

// El composer y el PDF pesan: se bajan recién al tocar «Enviar por mail».
const ModalEnviarPresupuesto = lazy(() =>
  import('../components/ModalEnviarPresupuesto').then((m) => ({ default: m.ModalEnviarPresupuesto })),
)

/**
 * Un lote de cotización: sus órdenes, el presupuesto junto (un capítulo por
 * equipo), y las acciones del lote entero —mandarlo, aprobarlo o rechazarlo,
 * y generar el pedido de venta—. Mientras está abierto se le agregan o sacan
 * órdenes del mismo cliente.
 */
export function LoteDetallePage() {
  const { id = '' } = useParams()
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const qc = useQueryClient()
  const clave = ['mantenimiento', companyId, 'lote', id]

  const lote = useQuery({
    queryKey: clave,
    queryFn: () => obtenerLote(companyId!, id),
    enabled: companyId !== null && permisos.ver,
    staleTime: 0,
  })
  const l = lote.data ?? null
  const abierto = l?.estado === 'open'

  const [agregando, setAgregando] = useState(false)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [resolviendo, setResolviendo] = useState<'aprobar' | 'rechazar' | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  const elegibles = useQuery({
    queryKey: ['mantenimiento', companyId, 'lotes-elegibles', l?.clienteId],
    queryFn: () => ordenesElegibles(companyId!, l!.clienteId),
    enabled: companyId !== null && !!l && agregando,
    staleTime: 0,
  })

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId] })

  const agregar = useMutation({
    mutationFn: () => agregarAlLote(id, [...elegidas]),
    onSuccess: () => {
      setAgregando(false)
      setElegidas(new Set())
      refrescar()
    },
  })
  const quitar = useMutation({ mutationFn: (ordenId: string) => quitarDelLote(id, ordenId), onSuccess: refrescar })
  const resolver = useMutation({
    mutationFn: () => (resolviendo === 'aprobar' ? aprobarLote(id, texto) : rechazarLote(id, texto)),
    onSuccess: () => {
      setResolviendo(null)
      setTexto('')
      refrescar()
    },
  })
  const pedido = useMutation({ mutationFn: () => pedidoDelLote(id), onSuccess: refrescar })

  const volver = { to: '/mantenimiento/lotes', label: 'Lotes' }

  if (lote.isPending) {
    return (
      <div className={doc.pagina}>
        <SkeletonRows rows={6} columns={3} label="Cargando el lote…" />
      </div>
    )
  }
  if (lote.error) {
    return (
      <div className={doc.pagina}>
        <PageHeader back={volver} title="Lote" />
        <ErrorState title="No se pudo leer el lote." description={lote.error.message} onRetry={() => void lote.refetch()} />
      </div>
    )
  }
  if (!l) {
    return (
      <div className={doc.pagina}>
        <PageHeader back={volver} title="Lote" />
        <EmptyState icon="search" title="No existe ese lote" description="O es de otra empresa." />
      </div>
    )
  }

  const sinLineas = l.ordenes.filter((o) => o.lineas.length === 0)
  const monedas = new Set(l.ordenes.map((o) => o.moneda))
  const error =
    agregar.error?.message ?? quitar.error?.message ?? resolver.error?.message ?? pedido.error?.message ?? null

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={volver}
        title={`Lote ${l.numero}`}
        subtitle={`${l.cliente} · ${l.equipos} ${l.equipos === 1 ? 'equipo' : 'equipos'} · ${formatearImporte(l.total, l.moneda)}`}
        actions={
          permisos.editar && l.ordenes.length > 0 ? (
            <Button variant="secondary" icon={<Icon name="mail" size={16} />} onClick={() => setEnviando(true)}>
              Enviar por mail
            </Button>
          ) : undefined
        }
      />

      <div className={styles.accionesFila}>
        <ChipLote estado={l.estado} />
        {l.aprobadoEn ? (
          <span className={styles.nota}>
            Aprobado el {formatearFecha(l.aprobadoEn)}
            {l.aprobadoPor ? ` por ${l.aprobadoPor}` : ''}.
          </span>
        ) : null}
      </div>

      {error ? (
        <Alert tone="danger" role="alert" title="No se pudo hacer el cambio">
          <p>{error}</p>
        </Alert>
      ) : null}

      <DocSection title="Órdenes del lote">
        {l.ordenes.length === 0 ? (
          <p className={styles.nota}>El lote no tiene órdenes. Agregale las del cliente.</p>
        ) : (
          <div className={tabla.contenedor}>
            <table className={tabla.tabla}>
              <thead>
                <tr>
                  <th scope="col">Orden</th>
                  <th scope="col">Equipo</th>
                  <th scope="col">Cotización</th>
                  <th scope="col" className={tabla.num}>
                    Total
                  </th>
                  {abierto && permisos.editar ? <th scope="col">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {l.ordenes.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/mantenimiento/ordenes/${o.id}`}>{o.numero}</Link>
                    </td>
                    <td>{[o.activoReferencia, o.modelo, o.serie ? `serie ${o.serie}` : null].filter(Boolean).join(' · ')}</td>
                    <td>
                      <ChipCotizacion estado={o.estadoCotizacion} />
                      {o.lineas.length === 0 ? <span className={styles.nota}> sin líneas</span> : null}
                    </td>
                    <td className={`${tabla.num} ${styles.mono}`}>{formatearImporte(o.total, o.moneda)}</td>
                    {abierto && permisos.editar ? (
                      <td>
                        <IconButton
                          icon="x"
                          size="sm"
                          variant="ghost"
                          aria-label={`Sacar ${o.numero} del lote`}
                          disabled={quitar.isPending}
                          onClick={() => quitar.mutate(o.id)}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abierto && permisos.editar ? (
          agregando ? (
            <div className={styles.acciones}>
              {elegibles.isPending ? (
                <SkeletonRows rows={2} columns={2} label="Buscando órdenes del cliente…" />
              ) : (elegibles.data ?? []).length === 0 ? (
                <p className={styles.nota}>No hay más órdenes de este cliente con la cotización pendiente.</p>
              ) : (
                <ul className={styles.listaChecks}>
                  {(elegibles.data ?? []).map((o) => (
                    <li key={o.id}>
                      <Checkbox
                        label={`${o.numero} · ${[o.activoReferencia, o.modelo].filter(Boolean).join(' · ')} — ${o.lineas === 0 ? 'sin cotizar' : formatearImporte(o.total, o.moneda)}`}
                        checked={elegidas.has(o.id)}
                        onChange={(e) =>
                          setElegidas((s) => {
                            const n = new Set(s)
                            if (e.target.checked) n.add(o.id)
                            else n.delete(o.id)
                            return n
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
              <Button disabled={elegidas.size === 0} loading={agregar.isPending} onClick={() => agregar.mutate()}>
                Agregar {elegidas.size > 0 ? elegidas.size : ''}
              </Button>
              <Button variant="secondary" onClick={() => setAgregando(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <div className={styles.acciones}>
              <Button variant="secondary" icon={<Icon name="plus" size={16} />} onClick={() => setAgregando(true)}>
                Agregar órdenes
              </Button>
            </div>
          )
        ) : null}
      </DocSection>

      <DocSection title="Presupuesto">
        {l.ordenes.length === 0 ? (
          <p className={styles.nota}>Sin órdenes no hay presupuesto.</p>
        ) : (
          <div className={tabla.contenedor}>
            <table className={tabla.tabla}>
              <thead>
                <tr>
                  <th scope="col">Detalle</th>
                  <th scope="col" className={tabla.num}>
                    Cant.
                  </th>
                  <th scope="col" className={tabla.num}>
                    Precio
                  </th>
                  <th scope="col" className={tabla.num}>
                    Total
                  </th>
                </tr>
              </thead>
              {l.ordenes.map((o) => (
                <tbody key={o.id}>
                  <tr>
                    <th scope="rowgroup" colSpan={3}>
                      {[o.numero, o.modelo, o.serie ? `serie ${o.serie}` : null].filter(Boolean).join(' · ')}
                    </th>
                    <td className={`${tabla.num} ${styles.mono}`}>
                      <strong>{formatearImporte(o.total, o.moneda)}</strong>
                    </td>
                  </tr>
                  {o.lineas.map((x) => (
                    <tr key={x.id}>
                      <td>
                        {x.descripcion ?? etiquetaDeTipoLinea(x.tipo)}
                        {x.sku ? <span className={styles.nota}> · {x.sku}</span> : null}
                      </td>
                      <td className={tabla.num}>{formatearNumero(x.cantidad)}</td>
                      <td className={`${tabla.num} ${styles.mono}`}>{formatearImporte(x.precioUnitario, o.moneda)}</td>
                      <td className={`${tabla.num} ${styles.mono}`}>{formatearImporte(x.total, o.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <p className={styles.nota}>
          Total del lote: <strong>{formatearImporte(l.total, l.moneda)}</strong> (sin IVA). Las líneas se cargan en
          cada orden, en su pestaña «Cotización».
        </p>
      </DocSection>

      {permisos.editar ? (
        <DocSection title="Resolver">
          {abierto ? (
            <>
              {sinLineas.length > 0 ? (
                <Alert tone="warning" role="status">
                  <p>
                    {sinLineas.map((o) => o.numero).join(', ')} {sinLineas.length === 1 ? 'no tiene' : 'no tienen'} líneas:
                    el lote no se puede aprobar hasta cotizarlas o sacarlas.
                  </p>
                </Alert>
              ) : null}
              {monedas.size > 1 ? (
                <Alert tone="warning" role="status">
                  <p>Las órdenes del lote están en monedas distintas: para aprobarlo tienen que estar en la misma.</p>
                </Alert>
              ) : null}
              <div className={styles.acciones}>
                <Button
                  disabled={l.ordenes.length === 0 || sinLineas.length > 0 || monedas.size > 1}
                  onClick={() => setResolviendo('aprobar')}
                >
                  Aprobar el lote
                </Button>
                <Button variant="danger" disabled={l.ordenes.length === 0} onClick={() => setResolviendo('rechazar')}>
                  Rechazar el lote
                </Button>
              </div>
            </>
          ) : l.estado === 'approved' ? (
            l.pedidoVenta ? (
              <p className={styles.nota}>
                Pedido de venta:{' '}
                <Link to={`/ventas/pedidos/${l.pedidoVenta.id}`}>
                  <strong>{l.pedidoVenta.numero}</strong>
                </Link>
                . Se factura desde Ventas.
              </p>
            ) : (
              <div className={styles.acciones}>
                <Button loading={pedido.isPending} onClick={() => pedido.mutate()}>
                  Generar pedido de venta
                </Button>
                <span className={styles.nota}>
                  Un solo pedido en borrador, con un capítulo por equipo y sus líneas (IVA 21 %).
                </span>
              </div>
            )
          ) : (
            <p className={styles.nota}>El lote fue rechazado: sus cotizaciones quedaron rechazadas.</p>
          )}
        </DocSection>
      ) : null}

      <ConfirmDialog
        open={resolviendo !== null}
        title={resolviendo === 'aprobar' ? `Aprobar el lote ${l.numero}` : `Rechazar el lote ${l.numero}`}
        description={
          resolviendo === 'aprobar'
            ? `Se aprueban las ${l.ordenes.length} cotizaciones por ${formatearImporte(l.total, l.moneda)}. Es definitivo.`
            : `Se rechazan las ${l.ordenes.length} cotizaciones. Es definitivo.`
        }
        confirmLabel={resolviendo === 'aprobar' ? 'Aprobar' : 'Rechazar'}
        tone={resolviendo === 'rechazar' ? 'danger' : 'default'}
        busy={resolver.isPending}
        onCancel={() => {
          setResolviendo(null)
          setTexto('')
        }}
        onConfirm={() => resolver.mutate()}
      >
        <Field label={resolviendo === 'aprobar' ? 'Quién lo aprobó, del lado del cliente' : 'Motivo del rechazo'}>
          <Input value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      </ConfirmDialog>

      {enviando ? (
        <Suspense fallback={null}>
          <ModalEnviarPresupuesto
            hoja={aHojaDeLote(l)}
            numero={l.numero}
            clienteId={l.clienteId}
            asunto={asuntoDeLote(l)}
            texto={cuerpoDeLote(l)}
            tipo="lote_mantenimiento"
            documentoId={l.id}
            claveHistorial={clave}
            onCerrar={() => setEnviando(false)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
