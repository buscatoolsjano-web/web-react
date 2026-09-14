import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAccionesDocumento } from '../components/AccionesDocumento'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { CabeceraCotizacion, type CampoCabecera, type ValoresCabecera } from '../components/CabeceraCotizacion'
import { ChipEstado } from '../components/ChipEstado'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { ModalEntregaParcial } from '../components/ModalEntregaParcial'
import { PanelPendientes } from '../components/PanelPendientes'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelStock } from '../components/PanelStock'
import { SelectorProducto } from '../components/SelectorProducto'
import { TablaLineas } from '../components/TablaLineas'
import { mensajeErrorVentas, motivoBloqueo, type DocTypeVentas } from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { lineaCapitulo, lineaDeProducto, lineaLibre } from '../lib/lineaNueva'
import { tasaDe } from '../lib/tratamientos'
import {
  useDisponibilidad,
  useDocumento,
  usePendientes,
  useRelacionados,
} from '../hooks/useDocumentos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { esSensible, registrarEvento } from '../services/auditoria'
import { crearEntregaDesdePedido, lineasParaEntregar } from '../services/entregas'
import { ordenarLineas, type LineaNueva } from '../services/cotizaciones'
import {
  actualizarCabeceraPedido,
  actualizarLineaPedido,
  agregarLineaPedido,
  cambiarEstadoPedido,
  editabilidadPedido,
  eliminarLineaPedido,
  intercambiarOrdenPedido,
} from '../services/pedidos'
import type { DocumentoDetalle, LineaDocumento } from '../types'
import editor from './EditorCotizacion.module.css'

/** Campo lógico del editor → columna real de `sales_order_lines`. */
const COLUMNA_LINEA: Record<CampoLinea, string> = {
  sku_snapshot: 'sku_snapshot',
  name_snapshot: 'name_snapshot',
  description_snapshot: 'description_snapshot',
  // La única que cambia de nombre respecto de la cotización.
  quantity: 'quantity_ordered',
  unit_price: 'unit_price',
  discount_pct: 'discount_pct',
  tax_treatment: 'tax_treatment',
  tax_rate_snapshot: 'tax_rate_snapshot',
}

const COLUMNA: Record<CampoCabecera, string> = {
  customerId: 'customer_id',
  titulo: 'title',
  fecha: 'order_date',
  validaHasta: 'order_date', // el pedido no tiene validez; el campo se oculta
  moneda: 'currency_code',
  tipoCambio: 'exchange_rate',
  formaPago: 'payment_terms',
  descuentoPct: 'discount_pct',
  percepcionPct: 'perception_pct',
  notas: 'notes',
}

const TEXTO: CampoCabecera[] = ['titulo', 'formaPago', 'notas']
const NUMERO: CampoCabecera[] = ['tipoCambio', 'descuentoPct', 'percepcionPct']

const texto = (n: number | null) => (n === null ? '' : String(n))

function aValores(d: DocumentoDetalle): ValoresCabecera {
  return {
    customerId: d.clienteId ?? '',
    titulo: d.titulo ?? '',
    fecha: d.fecha.slice(0, 10),
    validaHasta: '',
    moneda: d.moneda ?? 'USD',
    tipoCambio: texto(d.tipoCambio),
    formaPago: d.formaPago ?? '',
    descuentoPct: texto(d.descuentoPct),
    percepcionPct: texto(d.percepcionPct),
    notas: d.notas ?? '',
  }
}

/**
 * Detalle y edición de un pedido.
 *
 * Igual que la cotización, con dos cosas propias: el panel de entregas —con
 * las cuatro reglas del histórico que aprobamos en Stage 2.5— y el de stock,
 * que es SÓLO INFORMATIVO: crear o editar un pedido no reserva ni descuenta
 * nada.
 */
export function PedidoDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('pedido', id)
  const relacionados = useRelacionados('pedido', id)
  const pendientes = usePendientes(doc)

  const [modoEdicion, setModoEdicion] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [generando, setGenerando] = useState(false)
  const [errorRemito, setErrorRemito] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false
  // Escribir (editar, confirmar, generar remito) es de admin y employee: el
  // mismo conjunto que `orders_write` y `deliveries_write`.
  const escribe = escribeVentas(activa?.rol)
  // Fase 12 E2.5: confirmar el pedido y generar el remito son emisiones.
  const autoridad = useAutoridadNumeracion()
  const stelPedido = autoridad.stel('sales_order')
  const stelEntrega = autoridad.stel('delivery')
  const lineas = useMemo(() => (doc ? ordenarLineas(doc.lineas) : []), [doc])
  const productIds = useMemo(
    () => lineas.flatMap((l) => (l.productId ? [l.productId] : [])),
    [lineas],
  )
  const stock = useDisponibilidad(productIds)

  // Un pedido con entregas tiene las líneas congeladas, y lo impone un trigger.
  const tieneEntregas = (relacionados.data?.entregas.length ?? 0) > 0
  const permiso = editabilidadPedido(doc?.estado ?? '', escribe, tieneEntregas)
  const editando = modoEdicion && permiso.editable

  const guardar = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      setUltimoError(null)
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
    },
    onError: (e: Error) => setUltimoError(mensajeErrorVentas(e)),
  })

  // Los pendientes se piden sólo cuando el modal está abierto: es una consulta
  // de tres pasos y no hace falta tenerla lista todo el tiempo.
  const paraEntregar = useQuery({
    queryKey: ['ventas', activa?.companyId, 'para-entregar', id],
    queryFn: () => lineasParaEntregar(activa!.companyId, id!),
    enabled: generando && !!activa && !!id,
    staleTime: 0,
  })

  const crearRemito = useMutation({
    mutationFn: ({ cantidades, fecha }: { cantidades: Map<string, number>; fecha: string }) =>
      crearEntregaDesdePedido(
        activa!.companyId,
        id!,
        cantidades,
        paraEntregar.data ?? [],
        fecha,
      ),
    onSuccess: (entregaId) => {
      setGenerando(false)
      setErrorRemito(null)
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/entregas/${entregaId}`)
    },
    onError: (e: Error) => setErrorRemito(mensajeErrorVentas(e)),
  })

  const acciones = useAccionesDocumento(doc)

  if (isPending) {
    return (
      <p className={editor.cargando} role="status">
        <Spinner size={20} /> Cargando pedido…
      </p>
    )
  }

  if (error) {
    return <ErrorState title="No se pudo leer el pedido." description={error.message} />
  }

  if (!doc) {
    return (
      <EmptyState
        headingLevel={1}
        icon="search"
        title="No se encontró el pedido"
        description="Puede que no exista o que no tengas acceso."
        action={
          <LinkButton to="/ventas/pedidos" icon={<Icon name="arrow-left" size={16} />}>
            Volver a Pedidos
          </LinkButton>
        }
      />
    )
  }

  // Los tipos cuya emisión se ofrece en esta barra y está bloqueada: un motivo.
  const tiposBloqueados: DocTypeVentas[] = [
    ...(escribe && stelPedido && doc.estado === 'draft' ? (['sales_order'] as const) : []),
    ...(escribe && stelEntrega && doc.estado === 'confirmed' ? (['delivery'] as const) : []),
  ]

  const cambiarCampo = (campo: CampoCabecera, valor: string) => {
    if (campo === 'validaHasta' || campo === 'moneda') return
    const columna = COLUMNA[campo]
    let valorFinal: string | number | null = valor
    if (NUMERO.includes(campo)) {
      const t = valor.trim()
      valorFinal = t === '' ? null : Number(t.replace(',', '.'))
      if (valorFinal !== null && !Number.isFinite(valorFinal)) return
    } else if (TEXTO.includes(campo)) {
      valorFinal = valor.trim() === '' ? null : valor
    } else if (valor === '') {
      valorFinal = null
    }

    guardar.mutate(async () => {
      await actualizarCabeceraPedido(doc.id, { [columna]: valorFinal })
      if (permiso.audita && esSensible(columna)) {
        await registrarEvento('sales_order', doc.id, 'updated_sensitive_fields', null, null, {
          [columna]: { from: null, to: valorFinal },
        })
      }
    })
  }

  const cambiarLinea = (lineaId: string, campo: CampoLinea, valor: string | number | null) => {
    const linea = lineas.find((l) => l.id === lineaId)
    const columna = COLUMNA_LINEA[campo]
    const cambios: Record<string, string | number | null> = { [columna]: valor }
    if (campo === 'tax_treatment') {
      const tasa = tasaDe(String(valor))
      if (tasa !== null) cambios['tax_rate_snapshot'] = tasa
    }
    guardar.mutate(async () => {
      await actualizarLineaPedido(lineaId, cambios)
      if (permiso.audita && esSensible(columna) && linea) {
        const antes =
          campo === 'unit_price' ? linea.precioUnitario
          : campo === 'quantity' ? linea.cantidad
          : linea.descuentoPct
        await registrarEvento('sales_order', doc.id, 'updated_sensitive_fields', null, null, {
          [columna]: { from: antes, to: valor },
        })
      }
    })
  }

  const proximoNumeroDeLinea = () =>
    lineas.reduce((max, l) => Math.max(max, l.numeroLinea ?? 0), 0) + 1

  const insertar = (nueva: LineaDocumento) => {
    if (!activa) return
    const l: LineaNueva = {
      tipoLinea: nueva.tipoLinea,
      productId: nueva.productId,
      sku: nueva.sku,
      nombre: nueva.nombre,
      descripcion: nueva.descripcion,
      marca: null,
      cantidad: nueva.cantidad,
      precioUnitario: nueva.precioUnitario ?? 0,
      precioLista: null,
      descuentoPct: nueva.descuentoPct ?? 0,
      tratamientoImpuesto: nueva.tratamientoImpuesto ?? 'vat_21',
      tasaImpuesto: nueva.tasaImpuesto ?? 0,
    }
    guardar.mutate(() =>
      agregarLineaPedido(activa.companyId, doc.id, nueva.numeroLinea ?? proximoNumeroDeLinea(), l),
    )
  }

  const moverLinea = (lineaId: string, direccion: -1 | 1) => {
    const i = lineas.findIndex((l) => l.id === lineaId)
    const a = lineas[i]
    const b = lineas[i + direccion]
    if (!a || !b || a.numeroLinea === null || b.numeroLinea === null) return
    guardar.mutate(() =>
      intercambiarOrdenPedido(
        { id: a.id, numeroLinea: a.numeroLinea! },
        { id: b.id, numeroLinea: b.numeroLinea! },
      ),
    )
  }

  const idMotivo = 'motivo-emision-pedido'

  return (
    <div className={docUi.pagina}>
      <PageHeader
        back={{ to: '/ventas/pedidos', label: 'Pedidos' }}
        title={doc.numero}
        status={
          <>
            <ChipEstado estado={presentarEstado('pedido', doc.estado)} />
            {doc.estadoSecundario ? <ChipEstado estado={presentarCumplimiento(doc.estadoSecundario)} /> : null}
            {doc.esHistorico ? (
              <Badge tone="neutral" outline>
                Migrado del sistema anterior
              </Badge>
            ) : null}
            {guardar.isPending ? (
              <span className={editor.guardando} role="status">
                <Spinner size={16} /> Guardando…
              </span>
            ) : null}
          </>
        }
        subtitle={[doc.clienteNombre, formatearFecha(doc.fecha), editando ? null : doc.titulo].filter(Boolean).join(' · ')}
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

      {esInterno && (stelPedido || stelEntrega) ? (
        <AvisoAutoridadStel detalle="Podés consultar, editar el borrador, imprimir y exportar. Confirmar el pedido, duplicarlo o generar la nota de entrega desde el ERP está bloqueado hasta completar la migración." />
      ) : null}

      {ultimoError ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar">
          <p>{ultimoError}</p>
        </Alert>
      ) : null}

      <ActionBar
        primary={
          escribe && doc.estado === 'confirmed' ? (
            <Button
              icon={<Icon name="truck" size={16} />}
              disabled={stelEntrega || autoridad.cargando}
              aria-describedby={stelEntrega ? idMotivo : undefined}
              onClick={() => {
                setErrorRemito(null)
                setGenerando(true)
              }}
            >
              Generar nota de entrega
            </Button>
          ) : escribe && doc.estado === 'draft' ? (
            <Button
              disabled={stelPedido || autoridad.cargando}
              aria-describedby={stelPedido ? idMotivo : undefined}
              onClick={() => guardar.mutate(() => cambiarEstadoPedido(doc.id, 'draft', 'confirmed'))}
            >
              Confirmar pedido
            </Button>
          ) : null
        }
        secondary={
          <>
            {permiso.editable ? (
              <Button
                variant={editando ? 'primary' : 'secondary'}
                icon={<Icon name={editando ? 'check' : 'edit'} size={16} />}
                onClick={() => setModoEdicion((v) => !v)}
              >
                {editando ? 'Terminar edición' : 'Editar'}
              </Button>
            ) : null}
            {acciones.secundarias}
          </>
        }
        // «Cancelar pedido» es la acción común del documento: escribe lo mismo
        // (commercial_status = cancelled + evento «cancelled») que el botón
        // propio que había acá, y cubre todos los estados en que aparecía.
        danger={acciones.peligro}
        note={
          <>
            {!permiso.editable && permiso.motivo ? (
              <p className={editor.candado}>
                <Icon name="alert-circle" size={16} /> {permiso.motivo}
              </p>
            ) : null}
            {permiso.editable && permiso.motivo ? <p>{permiso.motivo}</p> : null}
            {tiposBloqueados.length > 0 ? <p id={idMotivo}>{motivoBloqueo(...tiposBloqueados)}</p> : null}
            {acciones.motivo}
            {acciones.error ? (
              <p className={editor.error} role="alert">
                {acciones.error}
              </p>
            ) : null}
          </>
        }
      />

      <DocSection title="Datos del pedido">
        {editando ? (
          <CabeceraCotizacion
            valores={aValores(doc)}
            editable
            monedaEditable={false}
            onCambiar={cambiarCampo}
          />
        ) : (
          <MetaList
            items={[
              { label: 'Cliente', value: doc.clienteNombre },
              { label: 'Contacto', value: doc.contactoNombre ?? '—' },
              { label: 'Fecha', value: formatearFecha(doc.fecha) },
              { label: 'Moneda', value: doc.moneda ?? <Missing /> },
              { label: 'Tipo de cambio', value: doc.tipoCambio ?? <Missing /> },
              { label: 'Vendedor', value: doc.vendedor ?? <Missing /> },
              doc.origen
                ? {
                    label: 'Cotización de origen',
                    value: (
                      <Link to={`/ventas/cotizaciones/${doc.origen.id}`} className={docUi.enlace}>
                        {doc.origen.numero}
                      </Link>
                    ),
                  }
                : null,
              doc.notas ? { label: 'Notas', value: doc.notas, wide: true } : null,
            ]}
          />
        )}
      </DocSection>

      <DocSection
        title="Líneas"
        actions={
          editando ? (
            <>
              <Button variant="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={() => setBuscando(true)}>
                Añadir producto
              </Button>
              <Button variant="secondary" size="sm" icon={<Icon name="plus" size={16} />} onClick={() => insertar(lineaLibre(proximoNumeroDeLinea()))}>
                Nueva línea
              </Button>
              <Button variant="ghost" size="sm" onClick={() => insertar(lineaCapitulo(proximoNumeroDeLinea()))}>
                Nuevo capítulo
              </Button>
            </>
          ) : null
        }
      >
        {editando ? (
          <>
            {buscando ? (
              <div className={editor.selector}>
                <SelectorProducto
                  moneda={doc.moneda ?? 'USD'}
                  onCerrar={() => setBuscando(false)}
                  onElegir={(p, precio) => {
                    insertar(lineaDeProducto(p, precio, proximoNumeroDeLinea()))
                    setBuscando(false)
                  }}
                />
              </div>
            ) : null}
            <EditorLineas
              lineas={lineas}
              moneda={doc.moneda ?? 'USD'}
              editable
              onCambiar={cambiarLinea}
              onEliminar={(lineaId) => guardar.mutate(() => eliminarLineaPedido(lineaId))}
              onMover={moverLinea}
            />
          </>
        ) : (
          <TablaLineas lineas={lineas} moneda={doc.moneda} tipo="pedido" />
        )}

        <Totals
          rows={[
            { label: 'Subtotal', value: formatearImporte(doc.subtotal, doc.moneda) },
            { label: 'Impuestos y percepciones', value: formatearImporte(doc.impuesto, doc.moneda) },
            { label: 'Total', value: formatearImporte(doc.total, doc.moneda), strong: true },
          ]}
        />
      </DocSection>

      <DocSection title="Entregas">
        <PanelPendientes lineas={lineas} resultado={pendientes.data} cargando={pendientes.isPending} />
      </DocSection>

      {esInterno ? (
        <DocSection title="Stock">
          <PanelStock
            lineas={lineas}
            disponibilidad={stock.data}
            cargando={stock.isPending && productIds.length > 0}
            esInterno={esInterno}
          />
        </DocSection>
      ) : null}

      <DocSection title="Adjuntos">
        <PanelAdjuntos tipo="pedido" documentoId={doc.id} />
      </DocSection>

      <DocSection title="Relacionados">
        <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} />
      </DocSection>

      {generando ? (
        <ModalEntregaParcial
          lineas={paraEntregar.data ?? []}
          cargando={paraEntregar.isPending}
          guardando={crearRemito.isPending}
          error={errorRemito}
          onCerrar={() => setGenerando(false)}
          onConfirmar={(cantidades, fecha) => crearRemito.mutate({ cantidades, fecha })}
        />
      ) : null}


      {acciones.capas}
    </div>
  )
}
