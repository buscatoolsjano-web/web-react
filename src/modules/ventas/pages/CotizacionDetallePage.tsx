import { useId, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ActionBar } from '@/components/document/ActionBar'
import { DocumentHeader } from '@/components/document/DocumentHeader'
import { DocumentTabs } from '@/components/document/DocumentTabs'
import { useTabDeUrl } from '@/components/document/useTabDeUrl'
import { MoreMenu } from '@/components/document/MoreMenu'
import { DocSection } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAccionesDocumento } from '../components/AccionesDocumento'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { CabeceraCotizacion, type CampoCabecera, type ValoresCabecera } from '../components/CabeceraCotizacion'
import { ChipEstado } from '../components/ChipEstado'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { InformacionDocumento } from '../components/InformacionDocumento'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { SelectorProducto } from '../components/SelectorProducto'
import { TablaLineas } from '../components/TablaLineas'
import { TotalesDocumento } from '../components/TotalesDocumento'
import { mensajeErrorVentas, motivoBloqueo, type DocTypeVentas } from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { lineaCapitulo, lineaDeProducto, lineaLibre } from '../lib/lineaNueva'
import { presentarOrigen } from '../lib/origen'
import { tasaDe } from '../lib/tratamientos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useDocumento, useRelacionados } from '../hooks/useDocumentos'
import { esSensible, registrarEvento } from '../services/auditoria'
import {
  actualizarCabecera,
  actualizarLinea,
  agregarLinea,
  cambiarEstado,
  editabilidad,
  eliminarLinea,
  intercambiarOrden,
  ordenarLineas,
  type LineaNueva,
} from '../services/cotizaciones'
import { convertirCotizacionEnPedido } from '../services/pedidos'
import type { DocumentoDetalle, LineaDocumento } from '../types'
import editor from './EditorCotizacion.module.css'

/** Los campos de la cabecera que se guardan, y con qué columna. */
const COLUMNA: Record<CampoCabecera, string> = {
  customerId: 'customer_id',
  titulo: 'title',
  fecha: 'quote_date',
  validaHasta: 'valid_until',
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
    validaHasta: d.validaHasta?.slice(0, 10) ?? '',
    moneda: d.moneda ?? '',
    tipoCambio: texto(d.tipoCambio),
    formaPago: d.formaPago ?? '',
    descuentoPct: texto(d.descuentoPct),
    percepcionPct: texto(d.percepcionPct),
    notas: d.notas ?? '',
  }
}

/** Las pestañas del documento. Líneas primero: es lo que se mira siempre. */
const PESTANAS = ['lineas', 'informacion', 'adjuntos', 'relacionados', 'trazabilidad'] as const
type Pestana = (typeof PESTANAS)[number]

/**
 * Detalle y edición de una cotización.
 *
 * Fase 15 E1 · la pantalla pasa a tener la forma común de los tres
 * documentos: identidad arriba, acciones a la vista debajo, y el contenido
 * repartido en pestañas con Líneas como la primera. Lo que antes era un scroll
 * de seis secciones apiladas ahora abre mostrando lo único que se mira siempre.
 *
 * Lo que NO cambió, a propósito: cada cambio se sigue guardando solo, en
 * cuanto el control pierde el foco y sólo si el valor cambió. No hay Guardar
 * ni Descartar porque **todavía no hay transacción que descartar** — eso es la
 * E2. Mientras tanto la pantalla lo dice en vez de prometerlo.
 *
 * Los totales que se ven vuelven siempre del servidor: los calcula un trigger,
 * no el navegador.
 */
export function CotizacionDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('cotizacion', id)
  const relacionados = useRelacionados('cotizacion', id)

  const [modoEdicion, setModoEdicion] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [pestana, setPestana] = useTabDeUrl<Pestana>(PESTANAS, 'lineas')
  const idPestanas = useId()

  const esInterno = activa?.esInterno ?? false
  // Escribir (editar, cambiar estado, generar pedido) es de admin y employee:
  // el mismo conjunto que `quotes_write` y `orders_write`.
  const escribe = escribeVentas(activa?.rol)
  // Fase 12 E2.5: enviar/aceptar la cotización y generar el pedido son
  // emisiones. Con STEL como autoridad las bloquea la base; acá se anticipa.
  const autoridad = useAutoridadNumeracion()
  const stelCotizacion = autoridad.stel('quote')
  const stelPedido = autoridad.stel('sales_order')
  const permiso = editabilidad(doc?.estado ?? '', escribe)
  const editando = modoEdicion && permiso.editable

  // Un solo texto de autoridad por pantalla: el del banner. Los botones
  // bloqueados lo referencian en vez de repetirlo debajo de la barra.
  const idMotivo = 'motivo-autoridad-cotizacion'
  const hayBanner = esInterno && (stelCotizacion || stelPedido)
  const describePorBloqueo = hayBanner ? idMotivo : undefined

  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, 'cotizacion'] })

  const guardar = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      setUltimoError(null)
      void refrescar()
    },
    onError: (e: Error) => setUltimoError(mensajeErrorVentas(e)),
  })

  /**
   * Cotización → pedido.
   *
   * El botón se deshabilita si ya hay un pedido, pero lo que IMPIDE el
   * duplicado es un índice único sobre `(company_id, quote_id)`: dos pestañas
   * apretando a la vez sólo crean uno, y la segunda recibe el error.
   */
  const convertir = useMutation({
    mutationFn: () => convertirCotizacionEnPedido(activa!.companyId, id!),
    onSuccess: (pedidoId) => {
      setUltimoError(null)
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/pedidos/${pedidoId}`)
    },
    onError: (e: Error) => setUltimoError(mensajeErrorVentas(e)),
  })

  const lineas = useMemo(() => (doc ? ordenarLineas(doc.lineas) : []), [doc])
  // La cotización ya tiene pedido si el panel de relacionados encontró uno.
  const yaTienePedido = (relacionados.data?.pedidos.length ?? 0) > 0

  // Un solo mensaje de autoridad por pantalla: el del banner. Duplicar lo
  // referencia en vez de repetirlo.
  const acciones = useAccionesDocumento(doc, { idMotivoAutoridad: describePorBloqueo })

  if (isPending) {
    return (
      <p className={editor.cargando} role="status">
        <Spinner size={20} /> Cargando cotización…
      </p>
    )
  }

  if (error) {
    return <ErrorState title="No se pudo leer la cotización." description={error.message} />
  }

  if (!doc) {
    return (
      <EmptyState
        headingLevel={1}
        icon="search"
        title="No se encontró la cotización"
        description="Puede que no exista o que no tengas acceso."
        action={
          <LinkButton to="/ventas/cotizaciones" icon={<Icon name="arrow-left" size={16} />}>
            Volver a Cotizaciones
          </LinkButton>
        }
      />
    )
  }

  const valores = aValores(doc)

  const cambiarCampo = (campo: CampoCabecera, valor: string) => {
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
      await actualizarCabecera(doc.id, { [columna]: valorFinal })
      // Un cambio de precio o de descuento en un documento YA ENVIADO es un
      // hecho comercial, no un guardado técnico: queda registrado.
      if (doc.estado === 'sent' && esSensible(columna)) {
        await registrarEvento('sales_quote', doc.id, 'updated_sensitive_fields', null, null, {
          [columna]: { from: null, to: valorFinal },
        })
      }
    })
  }

  const cambiarLinea = (lineaId: string, campo: CampoLinea, valor: string | number | null) => {
    const linea = lineas.find((l) => l.id === lineaId)
    const cambios: Record<string, string | number | null> = { [campo]: valor }
    if (campo === 'tax_treatment') {
      const tasa = tasaDe(String(valor))
      if (tasa !== null) cambios['tax_rate_snapshot'] = tasa
    }
    guardar.mutate(async () => {
      await actualizarLinea(lineaId, cambios)
      if (doc.estado === 'sent' && esSensible(campo) && linea) {
        const antes =
          campo === 'unit_price' ? linea.precioUnitario
          : campo === 'quantity' ? linea.cantidad
          : linea.descuentoPct
        await registrarEvento('sales_quote', doc.id, 'updated_sensitive_fields', null, null, {
          [campo]: { from: antes, to: valor },
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
      agregarLinea(activa.companyId, doc.id, nueva.numeroLinea ?? proximoNumeroDeLinea(), l),
    )
  }

  const moverLinea = (lineaId: string, direccion: -1 | 1) => {
    const i = lineas.findIndex((l) => l.id === lineaId)
    const j = i + direccion
    const a = lineas[i]
    const b = lineas[j]
    if (!a || !b || a.numeroLinea === null || b.numeroLinea === null) return
    guardar.mutate(() =>
      intercambiarOrden(
        { id: a.id, numeroLinea: a.numeroLinea! },
        { id: b.id, numeroLinea: b.numeroLinea! },
      ),
    )
  }

  // Los tipos cuya emisión se ofrece en esta barra y está bloqueada: un motivo.
  const tiposBloqueados: DocTypeVentas[] = [
    ...(escribe && stelCotizacion && (doc.estado === 'draft' || doc.estado === 'sent') ? (['quote'] as const) : []),
    ...(escribe && stelPedido && doc.estado !== 'rejected' && !yaTienePedido ? (['sales_order'] as const) : []),
  ]

  const transicion = (hasta: string) =>
    guardar.mutate(() => cambiarEstado(doc.id, doc.estado, hasta))

  const origen = presentarOrigen({
    externalSource: doc.externalSource,
    esHistorico: doc.esHistorico,
    serie: doc.serie,
  })

  // Un borrador todavía no se envió: su paso siguiente es enviarlo. Ya
  // enviada o aceptada, el paso siguiente es el pedido.
  const esBorrador = doc.estado === 'draft'

  const botonGenerarPedido = escribe && doc.estado !== 'rejected' ? (
    <Button
      variant={esBorrador ? 'secondary' : 'primary'}
      icon={yaTienePedido ? <Icon name="check" size={16} /> : <Icon name="arrow-right" size={16} />}
      loading={convertir.isPending}
      disabled={yaTienePedido || stelPedido || autoridad.cargando}
      onClick={() => convertir.mutate()}
      title={yaTienePedido ? 'Esta cotización ya tiene un pedido' : undefined}
      aria-describedby={stelPedido && !yaTienePedido ? describePorBloqueo : undefined}
    >
      {convertir.isPending ? 'Generando…' : yaTienePedido ? 'Ya tiene pedido' : 'Generar pedido'}
    </Button>
  ) : null

  const botonMarcarEnviada = escribe && esBorrador ? (
    <Button
      icon={<Icon name="arrow-right" size={16} />}
      disabled={stelCotizacion || autoridad.cargando}
      aria-describedby={stelCotizacion ? describePorBloqueo : undefined}
      onClick={() => transicion('sent')}
    >
      Marcar como enviada
    </Button>
  ) : null

  const pestanas = [
    { key: 'lineas' as const, label: 'Líneas', count: lineas.length },
    { key: 'informacion' as const, label: 'Información' },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'relacionados' as const, label: 'Relacionados' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  return (
    <div className={docUi.pagina}>
      <DocumentHeader
        back={{ to: '/ventas/cotizaciones', label: 'Cotizaciones' }}
        numero={doc.numero}
        estados={<ChipEstado estado={presentarEstado('cotizacion', doc.estado)} />}
        origen={origen.map((o) => (
          <Badge key={o.texto} tone="neutral" outline className={docUi.origen}>
            {o.texto}
          </Badge>
        ))}
        aviso={
          guardar.isPending ? (
            <span className={editor.guardando} role="status">
              <Spinner size={16} /> Guardando…
            </span>
          ) : null
        }
        cliente={doc.clienteNombre}
        fecha={formatearFecha(doc.fecha)}
        titulo={doc.titulo}
        total={formatearImporte(doc.total, doc.moneda)}
      />

      <AvisosHistoricos
        motivos={doc.motivosRevision}
        numeroFueraDeSerie={doc.numeroFueraDeSerie}
        numeroSospechado={doc.numeroSospechado}
        esHistorico={doc.esHistorico}
      />

      {hayBanner ? (
        <AvisoAutoridadStel
          idDetalle={idMotivo}
          detalle={`${motivoBloqueo(...(tiposBloqueados.length > 0 ? tiposBloqueados : (['quote'] as const)))} Podés consultar, editar el borrador, imprimir y exportar.`}
        />
      ) : null}

      {ultimoError ? (
        <Alert tone="danger" role="alert" title="No se pudo completar la acción">
          <p>{ultimoError}</p>
        </Alert>
      ) : null}

      <ActionBar
        primary={esBorrador ? botonMarcarEnviada : botonGenerarPedido}
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
            {/* En borrador «Generar pedido» baja a secundaria, pero sigue
                existiendo con las mismas condiciones que antes. */}
            {esBorrador ? botonGenerarPedido : null}
            {escribe && doc.estado === 'sent' ? (
              <Button
                variant="secondary"
                disabled={stelCotizacion || autoridad.cargando}
                aria-describedby={stelCotizacion ? describePorBloqueo : undefined}
                onClick={() => transicion('accepted')}
              >
                Marcar aceptada
              </Button>
            ) : null}
            {acciones.secundarias}
          </>
        }
        more={
          escribe && doc.estado === 'sent' ? (
            <MoreMenu>
              <Button variant="secondary" onClick={() => transicion('rejected')}>
                Marcar rechazada
              </Button>
            </MoreMenu>
          ) : null
        }
        danger={acciones.peligro}
        note={
          <>
            {editando ? (
              <p>
                Los cambios se guardan solos al salir de cada campo. Todavía no hay «Guardar» ni
                «Descartar»: lo que escribís, queda escrito.
              </p>
            ) : null}
            {!permiso.editable && permiso.motivo ? (
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

      <DocumentTabs
        id={idPestanas}
        items={pestanas}
        value={pestana}
        onChange={setPestana}
        label="Secciones de la cotización"
      >
        {pestana === 'lineas' ? (
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
                      moneda={doc.moneda ?? ''}
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
                  moneda={doc.moneda ?? ''}
                  editable
                  onCambiar={cambiarLinea}
                  onEliminar={(lineaId) => guardar.mutate(() => eliminarLinea(lineaId))}
                  onMover={moverLinea}
                />
              </>
            ) : (
              <TablaLineas lineas={lineas} moneda={doc.moneda} tipo="cotizacion" />
            )}

            <TotalesDocumento
              doc={doc}
              lineas={lineas}
              nota={
                editando
                  ? 'Los totales los calcula el servidor a partir de las líneas, el descuento global y la percepción. El navegador no los inventa.'
                  : undefined
              }
            />
          </DocSection>
        ) : null}

        {pestana === 'informacion' ? (
          <DocSection title="Información de la cotización">
            {editando ? (
              <CabeceraCotizacion valores={valores} editable monedaEditable={false} onCambiar={cambiarCampo} />
            ) : (
              <InformacionDocumento doc={doc} />
            )}
          </DocSection>
        ) : null}

        {pestana === 'adjuntos' ? (
          <DocSection title="Adjuntos">
            <PanelAdjuntos tipo="cotizacion" documentoId={doc.id} />
          </DocSection>
        ) : null}

        {pestana === 'relacionados' ? (
          <DocSection title="Documentos relacionados">
            <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} />
          </DocSection>
        ) : null}

        {pestana === 'trazabilidad' ? (
          <DocSection title="Trazabilidad">
            <PanelTrazabilidad tipo="cotizacion" documentoId={doc.id} />
          </DocSection>
        ) : null}
      </DocumentTabs>

      {acciones.capas}
    </div>
  )
}
