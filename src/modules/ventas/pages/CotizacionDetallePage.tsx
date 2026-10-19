import { Suspense, lazy, useCallback, useId, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
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
import { CadenaDocumento } from '../components/CadenaDocumento'
import { EditorCabecera } from '../components/EditorCabecera'
import { EditorMasInformacion } from '../components/EditorMasInformacion'
import { useUltimoPrecio } from '../hooks/useUltimoPrecio'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { InformacionDocumento } from '../components/InformacionDocumento'
import { PanelLateralCliente } from '@/modules/clientes/components/PanelLateralCliente'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { ModalCatalogoProductos } from '../components/ModalCatalogoProductos'
import { usePrecargarCatalogoDeDocumento } from '../hooks/useCatalogoParaDocumento'
import { ModalContactos } from '../components/ModalContactos'
import { TablaLineas } from '../components/TablaLineas'
import { TotalesDocumento } from '../components/TotalesDocumento'
import { VistaPreviaDocumento } from '../components/VistaPreviaDocumento'
import { puedeUsarEmails } from '@/modules/emails/lib/permisos'
import { ControlesDeHoja } from '../components/ControlesDeHoja'
/*
 * El modal de enviar por mail, perezoso (Fase 84).
 *
 * Adentro va el composer entero —destinatarios, borradores de Gmail, envío—,
 * que es mucho código para una pantalla donde la mayoría de las veces nadie
 * lo abre. Y de paso el test de esta página no levanta el cliente de Supabase
 * al cargar el módulo, que es lo que rompe la suite aislada.
 */
const ModalEnviarPorMail = lazy(() =>
  import('../components/ModalEnviarPorMail').then((m) => ({ default: m.ModalEnviarPorMail })),
)
import { useOpcionesDeHoja } from '../hooks/useOpcionesDeHoja'
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
  faltaParaGuardar,
} from '../lib/borrador'
import {
  mensajeErrorVentas,
  motivoBloqueo,
  motivoSerieStel,
  TITULO_BANNER_STEL_DERIVADOS,
  type DocTypeVentas,
} from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useVolverAlListado } from '../hooks/useVolverAlListado'
import {
  useContactos,
  useDocumento,
  useCadenaDocumento,
  useRelacionados,
  useRevision,
  useSeries,
  useTarifas,
  useFormasDePago,
  useAgregarFormaDePago,
  useVendedores,
} from '../hooks/useDocumentos'
import {
  FalloDeGuardado,
  cambiarEstado,
  editabilidad,
  guardarCotizacion,
  ordenarLineas,
} from '../services/cotizaciones'
import { guardarContactosDocumento } from '../services/contactosDocumento'
import { guardarVendedoresDocumento } from '../services/vendedoresDocumento'
import {
  convertirCotizacionEnPedido,
  convertirCotizacionEnPedidoEnSerie,
} from '../services/pedidos'
import type { DocumentoDetalle } from '../types'
import editor from './EditorCotizacion.module.css'

/** Las pestañas del documento. Líneas primero: es lo que se mira siempre. */
/*
 * Fase 27 · E5: «Información» dejó de ser pestaña. El panel de cuatro
 * secciones está siempre a la vista, arriba de las líneas, igual que en el
 * alta: una pestaña para lo mismo era un click para ver lo que ya estaba.
 */
const PESTANAS = ['lineas', 'masinfo', 'adjuntos', 'relacionados', 'trazabilidad'] as const
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
  const cadena = useCadenaDocumento('cotizacion', id)
  // Los motivos de revisión, clasificados por el servidor (Fase 19 · E4).
  const revision = useRevision('cotizacion', id)

  // `original` es el snapshot con el que se entró; `borrador` es lo que se
  // está editando. Los dos en `null` significa modo lectura.
  const [original, setOriginal] = useState<Borrador | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)

  /**
   * Si se ve la hoja al lado (Fase 26 · E2).
   *
   * `null` = nadie lo eligió todavía, y entonces manda la pantalla: con 1280 px
   * o más la hoja entra al lado del editor y se muestra, como en el alta. Una
   * vez que se toca el botón, gana lo que pidió la persona.
   */
  const pantallaAncha = useMediaQuery('(min-width: 1280px)')
  const [previaPedida, setPreviaPedida] = useState<boolean | null>(null)
  const verPrevia = previaPedida ?? pantallaAncha
  // Fase 28 · E1: el catálogo completo, para elegir desde la hoja.
  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  // Fase 28 · E14: la agenda del cliente, sin abandonar el documento.
  const [contactosAbiertos, setContactosAbiertos] = useState(false)
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
  const [enviandoPorMail, setEnviandoPorMail] = useState(false)
  const [serieDestino, setSerieDestino] = useState('')
  const serieDestinoVisible = serieDestino || seriePedidoPorDefecto?.codigo || ''
  const serieDestinoElegida =
    (seriesPedido.data ?? []).find((x) => x.codigo === serieDestinoVisible) ?? null
  const permiso = editabilidad(doc?.estado ?? '', escribe)
  const editando = borrador !== null
  const sucio = borrador !== null && original !== null && hayCambios(borrador, original)
  /**
   * Lo que falta para poder guardar (Fase 29 · E17).
   *
   * El título es obligatorio también al editar, no sólo al crear: es el
   * renglón que sale impreso debajo del tipo de documento, y hasta ahora se
   * podía abrir un documento existente, borrárselo y guardarlo.
   */
  // El catálogo, pedido antes de que lo abran (Fase 29 · E18).
  // Sólo en edición: mirando un documento cerrado no se agrega nada.
  usePrecargarCatalogoDeDocumento(borrador?.cabecera.listaPrecioId ?? null, editando)

  const faltaGuardar = borrador ? faltaParaGuardar(borrador) : []

  // Un solo texto de autoridad por pantalla: el del banner. Los botones
  // bloqueados lo referencian en vez de repetirlo debajo de la barra.
  const idMotivo = 'motivo-autoridad-cotizacion'
  const hayBanner = esInterno && (stelCotizacion || stelPedido)
  const describePorBloqueo = hayBanner ? idMotivo : undefined

  // Las opciones de los desplegables se piden sólo al entrar en edición.
  const tarifas = useTarifas(editando)
  const formasDePago = useFormasDePago(editando)
  const agregarFormaDePago = useAgregarFormaDePago()
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
      const r = await guardarCotizacion(
        doc!.id,
        borrador!.esperado,
        payload.cabecera,
        payload.lineas,
      )
      /*
       * Los contactos van DESPUÉS y por su propia RPC (Fase 40).
       *
       * El principal es una columna del documento y viaja en la cabecera como
       * siempre; los secundarios viven en su tabla. Se mandan los dos juntos
       * para que la base mantenga la invariante —el principal nunca figura
       * además como secundario— sin que la pantalla tenga que acordarse.
       *
       * Va después del guardado y no antes: si el documento no se pudo
       * guardar, no tiene sentido haberle cambiado el equipo.
       */
      await guardarContactosDocumento(
        'cotizacion',
        doc!.id,
        borrador!.cabecera.contactoId === '' ? null : borrador!.cabecera.contactoId,
        borrador!.cabecera.contactosExtra,
      )
      await guardarVendedoresDocumento(
        'cotizacion',
        doc!.id,
        borrador!.cabecera.vendedorId === '' ? null : borrador!.cabecera.vendedorId,
        borrador!.cabecera.vendedoresExtra,
      )
      return r
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
  /* El formato de la hoja. Vive en la barra de acciones, como en el alta:
     arriba de la hoja era un renglón que le sacaba alto al documento
     (Fase 81). Quedó solo: la foto del producto dejó de ser una opción y el
     renglón impreso la lleva siempre (Fase 83). */
  const { opciones: opcionesDeHoja, controles: controlesDeHoja } = useOpcionesDeHoja()

  const acciones = useAccionesDocumento(editando ? null : doc, {})

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

  /*
   * El último precio de este cliente, una sola consulta para la pantalla
   * entera: la comparten el editor de líneas y el modal del catálogo.
   *
   * VA ACÁ ARRIBA, antes de los `return` de carga y error, porque es un hook:
   * abajo quedaba después de tres salidas tempranas y React cambiaba el orden
   * de los hooks entre renders. Por eso `doc?.` en vez de `doc.`: todavía
   * puede no haber documento, y el hook sabe no consultar sin cliente.
   */
  const { historicos } = useUltimoPrecio(
    borrador?.cabecera.customerId || doc?.clienteId || null,
    borrador?.cabecera.moneda || doc?.moneda || null,
  )

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

  /**
   * El equipo de contactos: principal y secundarios cambian JUNTOS (Fase 40).
   *
   * Hacer principal a alguien que ya estaba en la lista mueve dos cosas a la
   * vez; mandarlas por separado dejaría al documento, entre una y otra, con
   * dos principales o con ninguno.
   */
  const cambiarContactos = (principal: string, secundarios: string[]) => {
    setBorrador((b) =>
      b
        ? { ...b, cabecera: { ...b.cabecera, contactoId: principal, contactosExtra: secundarios } }
        : b,
    )
  }

  /** Lo mismo para los vendedores (Fase 40): principal y acompañantes, juntos. */
  const cambiarVendedores = (principal: string, acompanan: string[]) =>
    setBorrador((b) =>
      b
        ? { ...b, cabecera: { ...b.cabecera, vendedorId: principal, vendedoresExtra: acompanan } }
        : b,
    )

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
    ...(escribe && stelCotizacion && (doc.estado === 'draft' || doc.estado === 'sent')
      ? (['quote'] as const)
      : []),
    ...(escribe && stelPedido && doc.estado !== 'rejected' && !yaTienePedido
      ? (['sales_order'] as const)
      : []),
  ]
  // Y los que STEL numera, se ofrezcan o no en la barra: es lo que cuenta el
  // banner cuando no hay ninguna acción bloqueada a la vista (sólo lectura, o
  // un estado sin acciones). Antes caía a «cotizaciones» por defecto, que con
  // una serie ERP era falso.
  const tiposConAutoridadStel: DocTypeVentas[] = [
    ...(stelCotizacion ? (['quote'] as const) : []),
    ...(stelPedido ? (['sales_order'] as const) : []),
  ]

  const botonGenerarPedido =
    escribe && doc.estado !== 'rejected' ? (
      <Button
        variant="primary"
        icon={
          yaTienePedido ? <Icon name="check" size={16} /> : <Icon name="arrow-right" size={16} />
        }
        loading={convertir.isPending}
        disabled={yaTienePedido || stelPedido || autoridad.cargando}
        onClick={() => (hayQueElegirSerie ? setEligiendoSerie(true) : convertir.mutate(null))}
        title={yaTienePedido ? 'Esta cotización ya tiene un pedido' : undefined}
        aria-describedby={stelPedido && !yaTienePedido ? describePorBloqueo : undefined}
      >
        {convertir.isPending ? 'Generando…' : yaTienePedido ? 'Ya tiene pedido' : 'Generar pedido'}
      </Button>
    ) : null

  /**
   * «Enviar por mail», adentro de «Más» (Fase 84).
   *
   * Estaba suelto en la barra y la barra pasaba de ancho: con siete botones y
   * el circuito al costado se iba a un segundo renglón. «Más» es donde va lo
   * que no se hace todos los días, y mandar el documento es de ésas: se hace
   * una vez, cuando está listo.
   *
   * Sólo para quien tiene Emails —admin y empleados—: al resto el botón le
   * abriría un cartel de «sin cuenta de correo».
   */
  const enviarPorMail = puedeUsarEmails(activa?.rol) ? (
    <Button
      variant="secondary"
      icon={<Icon name="mail" size={16} />}
      onClick={() => setEnviandoPorMail(true)}
    >
      Enviar por mail
    </Button>
  ) : null

  /**
   * El circuito de la venta, en la barra de acciones (Fase 29 · E16).
   *
   * La Fase 83 lo probó arriba, en la fila del número, y se volvió: la barra
   * es el lugar —es lo que se puede hacer con el documento, y el circuito es
   * justamente por dónde va—. Lo que sí se fue de la barra es un botón, así
   * que ahora entra en la misma fila.
   *
   * Se arma una vez y se pasa a las DOS barras —la de edición y la de
   * lectura—: es el mismo dato en los dos estados, y tenerlo en una sola
   * variable evita que una quede vieja cuando se toque la otra.
   *
   * «Generar» llama al MISMO handler que el botón de la barra, con el mismo
   * motivo de bloqueo: dos botones para lo mismo que se comportan distinto
   * sería peor que uno solo.
   */
  const circuito = cadena.data ? (
    <CadenaDocumento
      cadena={cadena.data}
      actual="cotizacion"
      generar={{
        pedido: {
          onGenerar: () => (hayQueElegirSerie ? setEligiendoSerie(true) : convertir.mutate(null)),
          cargando: convertir.isPending,
          ...(!escribe
            ? { motivo: 'Tu rol no genera pedidos' }
            : stelPedido
              ? { motivo: 'La numeración de pedidos la lleva el sistema anterior' }
              : {}),
        },
      }}
    />
  ) : null

  const nueva = (over: Partial<Parameters<typeof agregarLinea>[1]> = {}) =>
    setBorrador((b) =>
      b
        ? agregarLinea(b, {
            tipoLinea: 'item',
            productId: null,
            sku: null,
            nombre: null,
            descripcion: null,
            cantidad: 1,
            precioUnitario: 0,
            descuentoPct: 0,
            tratamientoImpuesto: 'vat_21',
            tasaImpuesto: 21,
            ...over,
          })
        : b,
    )

  const pestanas = [
    { key: 'lineas' as const, label: 'Líneas', count: lineasVisibles.length },
    { key: 'masinfo' as const, label: 'Más información' },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'relacionados' as const, label: 'Relacionados' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  return (
    <div className={`${docUi.pagina} ${docUi.paginaAncha} ${docUi.arrancaEnLaBarra}`}>
      {enviandoPorMail && doc ? (
        <Suspense fallback={null}>
          <ModalEnviarPorMail
            doc={docVisible}
            /* La MISMA hoja que se está mirando: las líneas visibles y las
               opciones de la barra. Si en pantalla está sin precios, el PDF
               que recibe el cliente también. */
            lineas={lineasVisibles}
            opciones={opcionesDeHoja}
            onCerrar={() => setEnviandoPorMail(false)}
          />
        </Suspense>
      ) : null}

      {/*
        Acá vivía el encabezado del documento: el «volver», el número, los
        chips de estado y de dónde vino. Se fue entero en la Fase 84.

        «Eso quiero que lo saques, así se sube todo mucho más. El número de
        cotización va a ir en la serie, y pendiente vas a agregar un campo
        más, como en el sistema anterior, que dice Estado.»

        Y es donde van: la referencia y el estado son ahora dos filas de la
        ficha, que es donde el sistema anterior los tiene. La vuelta al
        listado ya estaba repetida en la barra de acciones, que además es la
        que acompaña el scroll. El h1 pasa a la barra, invisible, igual que en
        el alta desde la Fase 28 · E12: la página no se queda sin encabezado
        para quien navega saltando por títulos.
      */}

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
          pegajosa
          volver={volver}
          titulo={doc.numero}
          pasos={circuito}
          primary={
            <Button
              icon={<Icon name="check" size={16} />}
              loading={guardar.isPending}
              disabled={!sucio || faltaGuardar.length > 0 || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          }
          secondary={
            <>
              {/* También mientras se edita: la hoja de al lado es la que se
                  está editando, y poder cambiarle el formato es parte de
                  mirarla (Fase 81). */}
              <ControlesDeHoja {...controlesDeHoja} />
              {/*
                Mostrar u ocultar la hoja (Fase 26 · E2, mudado acá en la 84).
                Vivía en la cabecera de «Líneas», que queda abajo del documento y
                fuera de la vista: «no veo el botón para cerrar la vista previa».
                Acá está donde se lo busca —al lado del formato de la hoja, que
                es la otra cosa que se le hace— y en el mismo lugar que en el
                alta. Cerrada, el panel de datos ocupa el ancho entero.
              */}
              <Button
                variant="secondary"
                icon={<Icon name="eye" size={16} />}
                onClick={() => setPreviaPedida(!verPrevia)}
                aria-expanded={verPrevia}
              >
                {verPrevia ? 'Ocultar vista previa' : 'Vista previa'}
              </Button>
              <Button
                variant="secondary"
                disabled={guardar.isPending}
                onClick={() => (sucio ? setConfirmarSalida(true) : descartar())}
              >
                Descartar
              </Button>
            </>
          }
          note={
            <>
              {faltaGuardar.length > 0 ? <p>{faltaGuardar.join(' ')}</p> : null}
              <p>
                {sucio
                  ? 'Hay cambios sin guardar. No se escribe nada hasta que aprietes «Guardar cambios».'
                  : 'Sin cambios todavía. Lo que edites no se escribe hasta que lo guardes.'}
              </p>
            </>
          }
        />
      ) : (
        <ActionBar
          pegajosa
          volver={volver}
          titulo={doc.numero}
          pasos={circuito}
          /*
            Acá vivía «Marcar como enviada», que se sacó en la Fase 43.
            Guardar una cotización YA la deja Pendiente —lo hace un trigger, no
            la pantalla— así que el estado `draft` no existe más y el botón no
            tenía nada que marcar. La acción principal es generar el pedido.
          */
          primary={botonGenerarPedido}
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
              {/*
                Acá vivía «Marcar aceptada», que se sacó en la Fase 83.

                «Eso sería casi lo mismo que generar pedido, sacalo.» Y es
                más que parecido: el estado lo DERIVA la base. El trigger
                `cotizacion_sigue_a_su_pedido` pone `accepted` en cuanto la
                cotización tiene un pedido y la devuelve a `sent` si ese
                pedido se borra. Marcarla a mano escribía una aceptación que
                ningún pedido respaldaba, y que el primer movimiento de
                pedidos corregía sin avisar.

                «Marcar rechazada» se queda, en «Más»: eso sí es una decisión
                de una persona y no hay nada de dónde derivarla.
              */}
              {/* El formato de la hoja, acá y no arriba de la hoja (Fase 81):
                  es la misma barra donde está todo lo que se puede hacer con
                  el documento, y el renglón que ocupaba arriba era alto que le
                  sacaba al documento. */}
              <ControlesDeHoja {...controlesDeHoja} />
              {/* El mismo interruptor de la hoja que en la otra barra. */}
              <Button
                variant="secondary"
                icon={<Icon name="eye" size={16} />}
                onClick={() => setPreviaPedida(!verPrevia)}
                aria-expanded={verPrevia}
              >
                {verPrevia ? 'Ocultar vista previa' : 'Vista previa'}
              </Button>
              {acciones.secundarias}
            </>
          }
          more={
            escribe && doc.estado === 'sent' ? (
              <MoreMenu>
                <Button
                  variant="secondary"
                  onClick={() => transicion.mutate({ hasta: 'rejected' })}
                >
                  Marcar rechazada
                </Button>
                {enviarPorMail}
                {acciones.mas}
              </MoreMenu>
            ) : acciones.hayMas || enviarPorMail ? (
              <MoreMenu>
                {enviarPorMail}
                {acciones.mas}
              </MoreMenu>
            ) : null
          }
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
          /* Fase 26 · E2: el editor a la izquierda y la HOJA a la derecha,
             igual que en el alta. Antes esta pantalla no tenía hoja y para ver
             cómo salía el documento había que abrir el modal de impresión —
             donde no se puede editar. */
          <div className={verPrevia && pantallaAncha ? editor.conPrevia : undefined}>
            <div className={editor.columnaEditor}>
              <DocSection title="Información de la cotización">
                {editando ? (
                  <EditorCabecera
                    valores={borrador.cabecera}
                    tarifas={tarifas.data ?? []}
                    formasDePago={formasDePago.data ?? []}
                    cargandoFormasDePago={formasDePago.isPending}
                    onAgregarFormaDePago={agregarFormaDePago}
                    vendedores={vendedores.data ?? []}
                    avisoTarifa={avisoTarifa}
                    onCambiar={cambiarCampoCabecera}
                    onCambiarVendedores={cambiarVendedores}
                    onCambiarCliente={elegirCliente}
                  />
                ) : (
                  <InformacionDocumento doc={doc} onVerCliente={() => setViendoCliente(true)} />
                )}
              </DocSection>

              <DocSection
                title="Líneas"
                actions={
                  <>
                    {editando ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Icon name="search" size={16} />}
                          onClick={() => setCatalogoAbierto(true)}
                        >
                          Añadir producto
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Icon name="plus" size={16} />}
                          onClick={() => nueva()}
                        >
                          Nueva línea
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => nueva({ tipoLinea: 'chapter', tasaImpuesto: 0 })}
                        >
                          Nuevo capítulo
                        </Button>
                      </>
                    ) : null}
                  </>
                }
              >
                {editando ? (
                  <>
                    <EditorLineas
                      lineas={lineasVisibles}
                      moneda={borrador.cabecera.moneda}
                      editable
                      historicos={historicos}
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
            </div>

            {verPrevia ? (
              <div className={editor.columnaPrevia}>
                <VistaPreviaDocumento
                  opciones={opcionesDeHoja}
                  doc={docVisible}
                  lineas={lineasVisibles}
                  ajustarAlAncho={pantallaAncha}
                  aclaracion={
                    editando
                      ? 'Mientras editás, el total es una previsualización: el definitivo lo calcula el servidor al guardar.'
                      : null
                  }
                  /* La hoja edita EL MISMO borrador que el panel de la izquierda,
                   y sólo cuando el documento se puede editar: si no, es el
                   documento y no un editor. */
                  edicion={
                    editando
                      ? {
                          // El título también desde la hoja (Fase 29 · E17):
                          // es obligatorio y es donde se ve el hueco.
                          onTitulo: (valor) =>
                            setBorrador((b) => (b ? cambiarCampo(b, 'titulo', valor) : b)),
                          onTextoCapitulo: (id, texto) => cambiarLinea(id, 'name_snapshot', texto),
                          onCantidad: (id, valor) => cambiarLinea(id, 'quantity', valor),
                          onPrecio: (id, valor) => cambiarLinea(id, 'unit_price', valor),
                          onDescuento: (id, valor) => cambiarLinea(id, 'discount_pct', valor),
                          onEliminar: (id) => setBorrador((b) => (b ? quitarLinea(b, id) : b)),
                          onAgregar: () => setCatalogoAbierto(true),
                        }
                      : null
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
          «Más información», la otra mitad de la cabecera (Fase 84).

          La tarjeta de arriba muestra lo que identifica al documento y es
          igual mirándolo que editándolo; el resto —contactos, moneda, tipo de
          cambio, domicilio, observaciones— vive acá, y acá también se edita.
          Es la forma del sistema anterior, y resuelve lo que se pidió: que
          «Editar» no agregue un montón de filas nuevas arriba.

          Se edita con el MISMO borrador y se guarda con el mismo botón de la
          barra: esto no es un formulario aparte.
        */}
        {pestana === 'masinfo' ? (
          <DocSection title="Más información">
            {editando ? (
              <EditorMasInformacion
                valores={borrador.cabecera}

                onCambiar={cambiarCampoCabecera}

                onAbrirContactos={() => setContactosAbiertos(true)}

                contactos={contactos.data ?? []}

                cargandoContactos={contactos.isPending && borrador.cabecera.customerId !== ''}

                avisoContacto={avisoContacto}

                onCambiarContactos={cambiarContactos}

                onCambiarMoneda={elegirMoneda}
              />
            ) : (
              <InformacionDocumento
                parte="mas"
                doc={doc}
                onVerCliente={() => setViendoCliente(true)}
              />
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
            <PanelRelacionados
              relacionados={relacionados.data}
              cargando={relacionados.isPending}
              idActual={doc.id}
              tipoActual="cotizacion"
            />
          </DocSection>
        ) : null}

        {pestana === 'trazabilidad' ? (
          <DocSection title="Trazabilidad">
            <PanelTrazabilidad tipo="cotizacion" documentoId={doc.id} />
          </DocSection>
        ) : null}
      </DocumentTabs>

      {/* Fase 28 · E1: el catálogo entero, con sus categorías, para elegir
          sin salir del documento. Agrega con el MISMO `nueva()` que el
          buscador de la izquierda: una sola forma de sumar una línea. */}
      {contactosAbiertos && borrador?.cabecera.customerId ? (
        <ModalContactos
          clienteId={borrador.cabecera.customerId}
          clienteNombre={doc.clienteNombre || 'el cliente'}
          onCerrar={() => setContactosAbiertos(false)}
        />
      ) : null}

      {catalogoAbierto ? (
        <ModalCatalogoProductos
          listaPrecioId={borrador?.cabecera.listaPrecioId || doc.listaPrecioId}
          moneda={borrador?.cabecera.moneda || doc.moneda}
          esInterno={activa?.esInterno ?? false}
          historicos={historicos}
          onCerrar={() => setCatalogoAbierto(false)}
          onAgregar={(p, cantidad, precio) =>
            nueva({
              productId: p.id,
              sku: p.sku,
              nombre: p.nombre,
              cantidad,
              // El precio lo decide el modal: si este cliente ya compró este
              // producto, el que se le cobró; si no, la tarifa del documento.
              // Sin ninguno de los dos, la línea entra en cero y se ve.
              precioUnitario: precio.precio,
            })
          }
        />
      ) : null}

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
