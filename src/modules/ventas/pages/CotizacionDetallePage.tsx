import { useCallback, useId, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { DialogoCambiosSinGuardar } from '@/components/modals/DialogoCambiosSinGuardar'
import { useSalidaConCambios } from '@/hooks/useSalidaConCambios'
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
import { ChipEstado } from '../components/ChipEstado'
import { EditorCabecera } from '../components/EditorCabecera'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { InformacionDocumento } from '../components/InformacionDocumento'
import { PanelLateralCliente } from '@/modules/clientes/components/PanelLateralCliente'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { SelectorProducto } from '../components/SelectorProducto'
import { TablaLineas } from '../components/TablaLineas'
import { TotalesDocumento } from '../components/TotalesDocumento'
import {
  agregarLinea,
  aPayload,
  cambiarCampo,
  cambiarCliente,
  cambiarLinea as cambiarLineaBorrador,
  cambiarMoneda,
  comoLineasDocumento,
  crearBorrador,
  hayCambios,
  moverLinea,
  quitarLinea,
  type Borrador,
  type CampoCabecera,
} from '../lib/borrador'
import {
  mensajeErrorVentas,
  motivoBloqueo,
  motivoSerieStel,
  TITULO_BANNER_STEL_DERIVADOS,
  type DocTypeVentas,
} from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { presentarOrigen } from '../lib/origen'
import { tasaDe } from '../lib/tratamientos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useVolverAlListado } from '../hooks/useVolverAlListado'
import {
  useContactos,
  useDocumento,
  useRelacionados,
  useRevision,
  useSeries,
  useTarifas,
  useVendedores,
} from '../hooks/useDocumentos'
import {
  FalloDeGuardado,
  cambiarEstado,
  editabilidad,
  guardarCotizacion,
  ordenarLineas,
} from '../services/cotizaciones'
import { convertirCotizacionEnPedido, convertirCotizacionEnPedidoEnSerie } from '../services/pedidos'
import type { DocumentoDetalle } from '../types'
import editor from './EditorCotizacion.module.css'

/** Las pestañas del documento. Líneas primero: es lo que se mira siempre. */
const PESTANAS = ['lineas', 'informacion', 'adjuntos', 'relacionados', 'trazabilidad'] as const
type Pestana = (typeof PESTANAS)[number]

/** El campo del editor de líneas → el campo del borrador. */
const CAMPO_BORRADOR = {
  sku_snapshot: 'sku',
  name_snapshot: 'nombre',
  description_snapshot: 'descripcion',
  quantity: 'cantidad',
  unit_price: 'precioUnitario',
  discount_pct: 'descuentoPct',
  tax_treatment: 'tratamientoImpuesto',
  tax_rate_snapshot: 'tasaImpuesto',
} as const

/**
 * Detalle y edición de una cotización.
 *
 * Fase 15 · E2 · **la edición ya no escribe al vuelo**. Al entrar en Editar se
 * toma un snapshot; todo lo que se toca vive en un borrador en memoria, y
 * recién «Guardar cambios» lo manda —cabecera, líneas y auditoría— en UNA
 * transacción. «Descartar» no hace ni un pedido de escritura: suelta el
 * borrador y vuelve lo del servidor.
 *
 * Eso es lo que hace honesto el «Descartar» que la E1 no podía ofrecer, y lo
 * que permite registrar el valor ANTERIOR de cada cambio: antes se perdía
 * porque el valor viejo ya estaba pisado cuando se quería auditar.
 *
 * Los totales que se ven vuelven siempre del servidor. Mientras se edita se
 * muestra una previsualización con la misma fórmula, y al guardar manda el
 * servidor.
 */
export function CotizacionDetallePage() {
  const { id } = useParams<{ id: string }>()
  // El borrador pertenece a ESTE documento. Si la ruta cambia a otra
  // cotización —el menú, el botón atrás, un enlace— React reusaría el mismo
  // componente y el borrador viejo quedaría encima del documento nuevo: la
  // pantalla mostraría los datos de A sobre B y «Guardar» apuntaría al
  // equivocado. Con la `key` el detalle se remonta y no queda nada colgando.
  return <Detalle key={id ?? ''} />
}

function Detalle() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('cotizacion', id)
  const relacionados = useRelacionados('cotizacion', id)
  // Los motivos de revisión, clasificados por el servidor (Fase 19 · E4).
  const revision = useRevision('cotizacion', id)

  // `original` es el snapshot con el que se entró; `borrador` es lo que se
  // está editando. Los dos en `null` significa modo lectura.
  const [original, setOriginal] = useState<Borrador | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [avisoContacto, setAvisoContacto] = useState(false)
  const [avisoTarifa, setAvisoTarifa] = useState(false)
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [pestana, setPestana] = useTabDeUrl<Pestana>(PESTANAS, 'lineas')
  const idPestanas = useId()

  const esInterno = activa?.esInterno ?? false
  // Escribir (editar, cambiar estado, generar pedido) es de admin y employee:
  // el mismo conjunto que `quotes_write` y `orders_write`.
  const escribe = escribeVentas(activa?.rol)
  // Fase 12 E2.5: enviar/aceptar la cotización y generar el pedido son
  // emisiones. Con STEL como autoridad las bloquea la base; acá se anticipa.
  const autoridad = useAutoridadNumeracion()
  // El listado como estaba, si se llegó desde él (Fase 19 · E2).
  const volver = useVolverAlListado('cotizacion', 'Cotizaciones')
  /**
   * La ficha rápida del cliente, sin salir de la cotización (Fase 19 · E3).
   *
   * Es el MISMO componente que abre el listado de Clientes, no una copia: la
   * ficha ya se había dejado suelta en la Fase 19 · E1 justamente para esto.
   */
  const [viendoCliente, setViendoCliente] = useState(false)
  /**
   * Fase 19 · E3: la autoridad que importa acá es la de LA SERIE DE ESTE
   * documento, no la general del tipo.
   *
   * `COT-ERP` numera en el ERP aunque `COTI` —la serie por defecto— la siga
   * numerando STEL: el piloto se abría con el banner de STEL y las acciones
   * bloqueadas sin que le correspondiera. El alta ya elegía por serie; el
   * detalle seguía mirando lo general.
   *
   * Si la serie del documento no está en la configuración no se inventa nada:
   * se cae a la autoridad general, que es el comportamiento conservador.
   */
  const seriesCotizacion = useSeries('cotizacion', esInterno)
  const autoridadDeLaSerie =
    (seriesCotizacion.data ?? []).find((s) => s.codigo === doc?.serie)?.autoridad ?? null
  const stelCotizacion =
    autoridadDeLaSerie !== null ? autoridadDeLaSerie === 'STEL' : autoridad.stel('quote')
  /**
   * Las series de PEDIDO (Fase 19 · E4).
   *
   * Si la empresa tiene más de una, generar el pedido pasa a preguntar en cuál
   * se emite: abrir esa pregunta no emite nada, así que lo que cierra el botón
   * ya no es la autoridad general sino que NINGUNA serie de pedido se emita
   * desde el ERP. Con una sola serie, todo queda como estaba.
   */
  const seriesPedido = useSeries('pedido', esInterno && escribe)
  const hayQueElegirSerie = (seriesPedido.data ?? []).length > 1
  const seriePedidoPorDefecto = (seriesPedido.data ?? []).find((x) => x.esPorDefecto) ?? null
  const stelPedido = hayQueElegirSerie
    ? !(seriesPedido.data ?? []).some((x) => x.autoridad === 'ERP')
    : autoridad.stel('sales_order')
  // Cuál se elige. Arranca SIEMPRE en la de por defecto: a `PDV-ERP` se llega
  // eligiéndola, nunca sola.
  const [eligiendoSerie, setEligiendoSerie] = useState(false)
  const [serieDestino, setSerieDestino] = useState('')
  const serieDestinoVisible = serieDestino || seriePedidoPorDefecto?.codigo || ''
  const serieDestinoElegida =
    (seriesPedido.data ?? []).find((x) => x.codigo === serieDestinoVisible) ?? null
  const permiso = editabilidad(doc?.estado ?? '', escribe)
  const editando = borrador !== null
  const sucio = borrador !== null && original !== null && hayCambios(borrador, original)

  // Un solo texto de autoridad por pantalla: el del banner. Los botones
  // bloqueados lo referencian en vez de repetirlo debajo de la barra.
  const idMotivo = 'motivo-autoridad-cotizacion'
  const hayBanner = esInterno && (stelCotizacion || stelPedido)
  const describePorBloqueo = hayBanner ? idMotivo : undefined

  // Las opciones de los desplegables se piden sólo al entrar en edición.
  const tarifas = useTarifas(editando)
  const vendedores = useVendedores(editando)
  const contactos = useContactos(editando ? borrador.cabecera.customerId || null : null)


  // Salir con cambios sin guardar pregunta: otra cotización, el menú, el
  // breadcrumb, atrás/adelante del navegador y también cerrar la pestaña.
  // Cambiar de pestaña interna no navega, así que no pregunta nada.
  const salida = useSalidaConCambios(sucio)

  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, 'cotizacion'] })

  const transicion = useMutation({
    mutationFn: ({ hasta }: { hasta: string }) => cambiarEstado(doc!.id, doc!.estado, hasta),
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
    // Fase 15 · E4: una sola transacción del servidor. El pedido hereda el
    // snapshot aprobado —precios, descuentos, impuestos, tarifa y vendedor— y
    // la cotización no se toca.
    // Con serie elegida va por la puerta nueva; sin ella, por la de siempre.
    mutationFn: (serie: string | null) =>
      serie === null
        ? convertirCotizacionEnPedido(id!, doc?.actualizadoEn ?? null)
        : convertirCotizacionEnPedidoEnSerie(id!, doc?.actualizadoEn ?? null, serie),
    onSuccess: (pedido) => {
      setUltimoError(null)
      setEligiendoSerie(false)
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/pedidos/${pedido.id}`)
    },
    onError: (e: Error) => setUltimoError(mensajeErrorVentas(e)),
  })

  /** El ÚNICO camino de escritura del editor. */
  const guardar = useMutation({
    mutationFn: async () => {
      const payload = aPayload(borrador!, original!)
      return guardarCotizacion(doc!.id, borrador!.esperado, payload.cabecera, payload.lineas)
    },
    onSuccess: () => {
      setUltimoError(null)
      setConflicto(false)
      setBorrador(null)
      setOriginal(null)
      setGuardado(true)
      void refrescar()
      void queryClient.invalidateQueries({
        queryKey: ['ventas', activa?.companyId, 'cotizacion', 'trazabilidad', id],
      })
    },
    onError: (e: Error) => {
      // El borrador NO se toca: si el guardado falla, lo escrito sigue ahí.
      if (e instanceof FalloDeGuardado && e.esConflicto) setConflicto(true)
      setUltimoError(e.message)
    },
  })

  const lineas = useMemo(() => (doc ? ordenarLineas(doc.lineas) : []), [doc])
  // La cotización ya tiene pedido si el panel de relacionados encontró uno.
  const yaTienePedido = (relacionados.data?.pedidos.length ?? 0) > 0

  // Mientras se edita, las acciones del documento no se ofrecen: duplicar o
  // cancelar con un borrador a medias es perder el borrador.
  const acciones = useAccionesDocumento(editando ? null : doc, {
    idMotivoAutoridad: describePorBloqueo,
  })

  const abrirEdicion = useCallback((d: DocumentoDetalle) => {
    const b = crearBorrador(d, ordenarLineas(d.lineas))
    setOriginal(b)
    setBorrador(b)
    setUltimoError(null)
    setConflicto(false)
    setAvisoContacto(false)
    setAvisoTarifa(false)
    setGuardado(false)
  }, [])

  const descartar = useCallback(() => {
    // Ni un pedido de escritura: se suelta el borrador y vuelve lo del servidor.
    setBorrador(null)
    setOriginal(null)
    setUltimoError(null)
    setConflicto(false)
    setConfirmarSalida(false)
  }, [])

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

  // Lo que se dibuja: el borrador mientras se edita, el servidor si no.
  const lineasVisibles = borrador ? comoLineasDocumento(borrador) : lineas
  const docVisible: DocumentoDetalle = borrador
    ? {
        ...doc,
        moneda: borrador.cabecera.moneda,
        // PREVISUALIZACIÓN con la misma fórmula que el servidor. El impuesto y
        // el total se dejan en null a propósito: dependen del descuento global
        // y de la percepción, y mostrar una cifra propia sería inventar un
        // total que la base no dijo.
        subtotal: lineasVisibles.reduce(
          (s, l) =>
            s +
            (l.tipoLinea === 'chapter'
              ? 0
              : l.cantidad * (l.precioUnitario ?? 0) * (1 - (l.descuentoPct ?? 0) / 100)),
          0,
        ),
        impuesto: null,
        total: null,
      }
    : doc

  const cambiarCampoCabecera = (campo: CampoCabecera, valor: string) => {
    setBorrador((b) => (b ? cambiarCampo(b, campo, valor) : b))
  }

  const elegirCliente = (customerId: string) => {
    setBorrador((b) => {
      if (!b) return b
      const r = cambiarCliente(b, customerId)
      setAvisoContacto(r.contactoLimpiado)
      return r.borrador
    })
  }

  const elegirMoneda = (moneda: string) => {
    setBorrador((b) => {
      if (!b) return b
      const actual = tarifas.data?.find((t) => t.id === b.cabecera.listaPrecioId)
      const r = cambiarMoneda(b, moneda, actual?.moneda ?? null)
      setAvisoTarifa(r.tarifaLimpiada)
      return r.borrador
    })
  }

  const cambiarLinea = (clave: string, campo: CampoLinea, valor: string | number | null) => {
    setBorrador((b) => {
      if (!b) return b
      let siguiente = cambiarLineaBorrador(b, clave, CAMPO_BORRADOR[campo], valor)
      // Cambiar el tratamiento arrastra su alícuota, salvo «otra», que la
      // escribe quien cotiza.
      if (campo === 'tax_treatment') {
        const tasa = tasaDe(String(valor))
        if (tasa !== null) siguiente = cambiarLineaBorrador(siguiente, clave, 'tasaImpuesto', tasa)
      }
      return siguiente
    })
  }

  // Los tipos cuya emisión se ofrece en esta barra y está bloqueada: un motivo.
  const tiposBloqueados: DocTypeVentas[] = [
    ...(escribe && stelCotizacion && (doc.estado === 'draft' || doc.estado === 'sent') ? (['quote'] as const) : []),
    ...(escribe && stelPedido && doc.estado !== 'rejected' && !yaTienePedido ? (['sales_order'] as const) : []),
  ]
  // Y los que STEL numera, se ofrezcan o no en la barra: es lo que cuenta el
  // banner cuando no hay ninguna acción bloqueada a la vista (sólo lectura, o
  // un estado sin acciones). Antes caía a «cotizaciones» por defecto, que con
  // una serie ERP era falso.
  const tiposConAutoridadStel: DocTypeVentas[] = [
    ...(stelCotizacion ? (['quote'] as const) : []),
    ...(stelPedido ? (['sales_order'] as const) : []),
  ]

  const origen = presentarOrigen({
    externalSource: doc.externalSource,
    esHistorico: doc.esHistorico,
    serie: doc.serie,
  })

  const esBorrador = doc.estado === 'draft'

  const botonGenerarPedido = escribe && doc.estado !== 'rejected' ? (
    <Button
      variant={esBorrador ? 'secondary' : 'primary'}
      icon={yaTienePedido ? <Icon name="check" size={16} /> : <Icon name="arrow-right" size={16} />}
      loading={convertir.isPending}
      disabled={yaTienePedido || stelPedido || autoridad.cargando}
      onClick={() => (hayQueElegirSerie ? setEligiendoSerie(true) : convertir.mutate(null))}
      title={yaTienePedido ? 'Esta cotización ya tiene un pedido' : undefined}
      aria-describedby={stelPedido && !yaTienePedido ? describePorBloqueo : undefined}
    >
      {convertir.isPending ? 'Generando…' : yaTienePedido ? 'Ya tiene pedido' : 'Generar pedido'}
    </Button>
  ) : null

  const nueva = (over: Partial<Parameters<typeof agregarLinea>[1]> = {}) =>
    setBorrador((b) =>
      b
        ? agregarLinea(b, {
            tipoLinea: 'item', productId: null, sku: null, nombre: null, descripcion: null,
            cantidad: 1, precioUnitario: 0, descuentoPct: 0,
            tratamientoImpuesto: 'vat_21', tasaImpuesto: 21, ...over,
          })
        : b,
    )

  const pestanas = [
    { key: 'lineas' as const, label: 'Líneas', count: lineasVisibles.length },
    { key: 'informacion' as const, label: 'Información' },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'relacionados' as const, label: 'Relacionados' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  return (
    <div className={docUi.pagina}>
      <DocumentHeader
        back={volver}
        numero={doc.numero}
        estados={<ChipEstado estado={presentarEstado('cotizacion', doc.estado)} />}
        origen={origen.map((o) => (
          <Badge key={o.texto} tone="neutral" outline className={docUi.origen}>
            {o.texto}
          </Badge>
        ))}
        aviso={editando ? <Badge tone="info">Editando</Badge> : null}
        cliente={doc.clienteNombre}
        fecha={formatearFecha(doc.fecha)}
        titulo={borrador ? borrador.cabecera.titulo : doc.titulo}
        total={formatearImporte(doc.total, doc.moneda)}
      />

      <AvisosHistoricos documento={doc} revision={revision.data} />

      {hayBanner ? (
        <AvisoAutoridadStel
          idDetalle={idMotivo}
          // Si la serie de ESTA cotización la numera el ERP, lo que sigue en
          // STEL es el pedido que saldría de ella, no ella.
          {...(stelCotizacion ? {} : { titulo: TITULO_BANNER_STEL_DERIVADOS })}
          detalle={`${motivoBloqueo(...(tiposBloqueados.length > 0 ? tiposBloqueados : tiposConAutoridadStel))} Podés consultar, editar y guardar, imprimir y exportar.`}
        />
      ) : null}

      {conflicto ? (
        <Alert
          tone="warning"
          role="alert"
          title="Este documento cambió mientras lo estabas editando"
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Recargar
            </Button>
          }
        >
          <p>
            Alguien más lo guardó, así que para no pisar su trabajo no se guardó nada.{' '}
            <strong>Lo que escribiste sigue en pantalla</strong>: anotá lo que haga falta antes de
            recargar.
          </p>
        </Alert>
      ) : null}

      {ultimoError && !conflicto ? (
        <Alert tone="danger" role="alert" title="No se pudo completar la acción">
          <p>{ultimoError}</p>
        </Alert>
      ) : null}

      {guardado && !editando ? (
        <Alert tone="success" role="status" title="Cambios guardados">
          <p>La cotización y sus líneas se guardaron juntas.</p>
        </Alert>
      ) : null}

      {editando ? (
        // En edición la barra tiene DOS acciones y nada más. Generar pedido,
        // cambiar de estado, duplicar o cancelar no se ofrecen: hacerlas con un
        // borrador a medias es perderlo.
        <ActionBar
          primary={
            <Button
              icon={<Icon name="check" size={16} />}
              loading={guardar.isPending}
              disabled={!sucio || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          }
          secondary={
            <Button
              variant="secondary"
              disabled={guardar.isPending}
              onClick={() => (sucio ? setConfirmarSalida(true) : descartar())}
            >
              Descartar
            </Button>
          }
          note={
            <p>
              {sucio
                ? 'Hay cambios sin guardar. No se escribe nada hasta que aprietes «Guardar cambios».'
                : 'Sin cambios todavía. Lo que edites no se escribe hasta que lo guardes.'}
            </p>
          }
        />
      ) : (
        <ActionBar
          primary={
            esBorrador ? (
              escribe ? (
                <Button
                  icon={<Icon name="arrow-right" size={16} />}
                  disabled={stelCotizacion || autoridad.cargando}
                  aria-describedby={stelCotizacion ? describePorBloqueo : undefined}
                  onClick={() => transicion.mutate({ hasta: 'sent' })}
                >
                  Marcar como enviada
                </Button>
              ) : null
            ) : (
              botonGenerarPedido
            )
          }
          secondary={
            <>
              {permiso.editable ? (
                <Button
                  variant="secondary"
                  icon={<Icon name="edit" size={16} />}
                  onClick={() => abrirEdicion(doc)}
                >
                  Editar
                </Button>
              ) : null}
              {esBorrador ? botonGenerarPedido : null}
              {escribe && doc.estado === 'sent' ? (
                <Button
                  variant="secondary"
                  disabled={stelCotizacion || autoridad.cargando}
                  aria-describedby={stelCotizacion ? describePorBloqueo : undefined}
                  onClick={() => transicion.mutate({ hasta: 'accepted' })}
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
                <Button variant="secondary" onClick={() => transicion.mutate({ hasta: 'rejected' })}>
                  Marcar rechazada
                </Button>
              </MoreMenu>
            ) : null
          }
          danger={acciones.peligro}
          note={
            <>
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
      )}

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
                  <Button variant="secondary" size="sm" icon={<Icon name="plus" size={16} />} onClick={() => nueva()}>
                    Nueva línea
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => nueva({ tipoLinea: 'chapter', nombre: 'Capítulo', tasaImpuesto: 0 })}>
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
                      moneda={borrador.cabecera.moneda}
                      listaPrecioId={borrador.cabecera.listaPrecioId || null}
                      onCerrar={() => setBuscando(false)}
                      onElegir={(p, precio) => {
                        // La tarifa del documento SUGIERE el precio de la
                        // línea nueva. Las que ya estaban no se tocan, ni
                        // siquiera si después cambia la tarifa.
                        nueva({ productId: p.id, sku: p.sku, nombre: p.nombre, precioUnitario: precio ?? 0 })
                        setBuscando(false)
                      }}
                    />
                  </div>
                ) : null}
                <EditorLineas
                  lineas={lineasVisibles}
                  moneda={borrador.cabecera.moneda}
                  editable
                  onCambiar={cambiarLinea}
                  onEliminar={(clave) => setBorrador((b) => (b ? quitarLinea(b, clave) : b))}
                  onMover={(clave, d) => setBorrador((b) => (b ? moverLinea(b, clave, d) : b))}
                />
              </>
            ) : (
              <TablaLineas lineas={lineasVisibles} moneda={doc.moneda} tipo="cotizacion" />
            )}

            <TotalesDocumento
              doc={docVisible}
              lineas={lineasVisibles}
              nota={
                editando
                  ? 'Previsualización. Los totales definitivos los calcula el servidor al guardar, a partir de las líneas, el descuento global y la percepción.'
                  : undefined
              }
            />
          </DocSection>
        ) : null}

        {pestana === 'informacion' ? (
          <DocSection title="Información de la cotización">
            {editando ? (
              <EditorCabecera
                valores={borrador.cabecera}
                contactos={contactos.data ?? []}
                tarifas={tarifas.data ?? []}
                vendedores={vendedores.data ?? []}
                cargandoContactos={contactos.isPending && borrador.cabecera.customerId !== ''}
                avisoContacto={avisoContacto}
                avisoTarifa={avisoTarifa}
                onCambiar={cambiarCampoCabecera}
                onCambiarCliente={elegirCliente}
                onCambiarMoneda={elegirMoneda}
              />
            ) : (
              <InformacionDocumento doc={doc} onVerCliente={() => setViendoCliente(true)} />
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
            <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} tipoActual="cotizacion" />
          </DocSection>
        ) : null}

        {pestana === 'trazabilidad' ? (
          <DocSection title="Trazabilidad">
            <PanelTrazabilidad tipo="cotizacion" documentoId={doc.id} />
          </DocSection>
        ) : null}
      </DocumentTabs>

      <DialogoCambiosSinGuardar
        open={salida.preguntando}
        onSalir={salida.salir}
        onQuedarse={salida.quedarse}
      />

      <ConfirmDialog
        open={confirmarSalida}
        tone="danger"
        title="Hay cambios sin guardar"
        description="Si descartás, se pierde lo que editaste y el documento vuelve a como estaba."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onCancel={() => setConfirmarSalida(false)}
        onConfirm={descartar}
      />

      {acciones.capas}

      {/* Fase 19 · E4: en qué serie sale el pedido. Preguntar no emite nada;
          lo que emite es confirmar, y con una serie de STEL no se puede. */}
      <ConfirmDialog
        open={eligiendoSerie}
        title="¿En qué serie se emite el pedido?"
        description="El pedido hereda el snapshot aprobado de la cotización. Lo único que se elige acá es la numeración."
        confirmLabel="Generar pedido"
        cancelLabel="Cancelar"
        busy={convertir.isPending}
        confirmDisabled={serieDestinoElegida?.autoridad === 'STEL'}
        onConfirm={() => convertir.mutate(serieDestinoVisible)}
        onCancel={() => setEligiendoSerie(false)}
      >
        <Field
          label="Serie del pedido"
          help="Una serie que numera STEL no se puede emitir desde el ERP."
        >
          <Select value={serieDestinoVisible} onChange={(e) => setSerieDestino(e.target.value)}>
            {(seriesPedido.data ?? []).map((x) => (
              <option key={x.codigo} value={x.codigo}>
                {x.codigo} — {x.autoridad === 'ERP' ? 'se emite desde el ERP' : 'la numera STEL'}
              </option>
            ))}
          </Select>
        </Field>
        {serieDestinoElegida?.autoridad === 'STEL' ? (
          <p>{motivoSerieStel(serieDestinoElegida.codigo)}</p>
        ) : null}
      </ConfirmDialog>

      {viendoCliente && doc.clienteId ? (
        <PanelLateralCliente clienteId={doc.clienteId} onCerrar={() => setViendoCliente(false)} />
      ) : null}
    </div>
  )
}
