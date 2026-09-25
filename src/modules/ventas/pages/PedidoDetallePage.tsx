import { useCallback, useId, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ActionBar } from '@/components/document/ActionBar'
import { MoreMenu } from '@/components/document/MoreMenu'
import { DocSection } from '@/components/document/DocSection'
import { DocumentHeader } from '@/components/document/DocumentHeader'
import { DocumentTabs } from '@/components/document/DocumentTabs'
import { useTabDeUrl } from '@/components/document/useTabDeUrl'
import docUi from '@/components/document/Document.module.css'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { DialogoCambiosSinGuardar } from '@/components/modals/DialogoCambiosSinGuardar'
import { useSalidaConCambios } from '@/hooks/useSalidaConCambios'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAccionesDocumento } from '../components/AccionesDocumento'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { ChipEstado } from '../components/ChipEstado'
import { InformacionDocumento } from '../components/InformacionDocumento'
import { EditorCabecera } from '../components/EditorCabecera'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { ModalEntregaParcial } from '../components/ModalEntregaParcial'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelPendientes } from '../components/PanelPendientes'
import { PanelLateralCliente } from '@/modules/clientes/components/PanelLateralCliente'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelStock } from '../components/PanelStock'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { ModalCatalogoProductos } from '../components/ModalCatalogoProductos'
import { ModalContactos } from '../components/ModalContactos'
import { TablaLineas } from '../components/TablaLineas'
import { TotalesDocumento } from '../components/TotalesDocumento'
import { VistaPreviaDocumento } from '../components/VistaPreviaDocumento'
import {
  useContactos,
  useDireccionesEntrega,
  useDisponibilidad,
  useDocumento,
  usePendientes,
  useRelacionados,
  useRevision,
  useSeries,
  useTarifas,
  useVendedores,
} from '../hooks/useDocumentos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useVolverAlListado } from '../hooks/useVolverAlListado'
import {
  mensajeErrorVentas,
  motivoBloqueo,
  TITULO_BANNER_STEL_DERIVADOS,
  type DocTypeVentas,
} from '../lib/autoridad'
import {
  agregarLinea,
  aPayloadPedido,
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
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { escribeVentas } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { FalloDeGuardado, ordenarLineas } from '../services/cotizaciones'
import { crearEntregaDesdePedido, lineasParaEntregar } from '../services/entregas'
import { cambiarEstadoPedido, editabilidadPedido, guardarPedido } from '../services/pedidos'
import type { DocumentoDetalle } from '../types'
import editor from './EditorCotizacion.module.css'

type Pestana = 'lineas' | 'entregas' | 'adjuntos' | 'relacionados' | 'trazabilidad'
/*
 * Fase 27 · E5: «Información» dejó de ser pestaña. El panel de cuatro
 * secciones está siempre a la vista, arriba de las líneas, igual que en el
 * alta.
 */
const PESTANAS: Pestana[] = ['lineas', 'entregas', 'adjuntos', 'relacionados', 'trazabilidad']

/** Campo del editor de líneas → campo del borrador. */
const CAMPO_BORRADOR: Record<CampoLinea, Parameters<typeof cambiarLineaBorrador>[2]> = {
  sku_snapshot: 'sku',
  name_snapshot: 'nombre',
  description_snapshot: 'descripcion',
  quantity: 'cantidad',
  unit_price: 'precioUnitario',
  discount_pct: 'descuentoPct',
  tax_treatment: 'tratamientoImpuesto',
  tax_rate_snapshot: 'tasaImpuesto',
}

export function PedidoDetallePage() {
  const { id } = useParams<{ id: string }>()
  // Al ir de un pedido a otro, el componente se remonta: el borrador de uno
  // nunca puede aparecer en el otro.
  return <Detalle key={id ?? ''} />
}

/**
 * Detalle y edición de un pedido (Fase 15 · E4).
 *
 * Es la misma pantalla que la cotización —shell documental, pestañas, borrador
 * en memoria y un solo «Guardar cambios»— con lo propio del pedido: las
 * entregas (con las reglas del histórico de Stage 2.5) y el stock, que es
 * **sólo informativo**: crear o editar un pedido no reserva ni descuenta nada;
 * el stock se mueve al confirmar una entrega.
 *
 * Hasta E3 cada campo se escribía al perder el foco: no había «Descartar»
 * honesto, ni control de concurrencia, ni aviso al salir. Ahora el único
 * camino de escritura del editor es `guardar_pedido`, en una transacción.
 */
function Detalle() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('pedido', id)
  const relacionados = useRelacionados('pedido', id)
  // Los motivos de revisión, clasificados por el servidor (Fase 19 · E4).
  const revision = useRevision('pedido', id)
  const pendientes = usePendientes(doc)

  const [original, setOriginal] = useState<Borrador | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  // Fase 28 · E1: el catálogo completo, para elegir desde la hoja.
  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  // Fase 28 · E14: la agenda del cliente, sin abandonar el documento.
  const [contactosAbiertos, setContactosAbiertos] = useState(false)

  /**
   * Si se ve la hoja al lado (Fase 26 · E2).
   *
   * `null` = nadie lo eligió todavía, y entonces manda la pantalla: con
   * 1280 px o más la hoja entra al lado del editor y se muestra, como en el
   * alta. Una vez que se toca el botón, gana lo que pidió la persona.
   */
  const pantallaAncha = useMediaQuery('(min-width: 1280px)')
  const [previaPedida, setPreviaPedida] = useState<boolean | null>(null)
  const verPrevia = previaPedida ?? pantallaAncha
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [avisoContacto, setAvisoContacto] = useState(false)
  const [avisoTarifa, setAvisoTarifa] = useState(false)
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  /** La ficha rápida del cliente, sin salir del documento (Fase 19 · E4). */
  const [viendoCliente, setViendoCliente] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [errorRemito, setErrorRemito] = useState<string | null>(null)
  const [pestana, setPestana] = useTabDeUrl<Pestana>(PESTANAS, 'lineas')
  const idPestanas = useId()

  const esInterno = activa?.esInterno ?? false
  const escribe = escribeVentas(activa?.rol)
  const autoridad = useAutoridadNumeracion()
  // El listado como estaba, si se llegó desde él (Fase 19 · E2).
  const volver = useVolverAlListado('pedido', 'Pedidos')
  /**
   * Fase 19 · E4: la autoridad que importa es la de LA SERIE DE ESTE pedido,
   * no la general del tipo. `PDV-ERP` numera en el ERP aunque `PDV` —la serie
   * por defecto— la siga numerando STEL, y el piloto se abría diciendo que
   * STEL numeraba «este documento». Es el mismo arreglo que se hizo en la
   * cotización; si la serie no está configurada, se cae a la general, que es
   * lo conservador.
   */
  const seriesPedido = useSeries('pedido', esInterno)
  // Las series de REMITO, para elegir en cuál sale el que se genere acá
  // (Fase 19 · E5). Abrir el diálogo no emite nada; lo que emite es confirmar.
  const seriesRemito = useSeries('entrega', esInterno && escribe)
  const autoridadDeLaSerie =
    (seriesPedido.data ?? []).find((x) => x.codigo === doc?.serie)?.autoridad ?? null
  const stelPedido =
    autoridadDeLaSerie !== null ? autoridadDeLaSerie === 'STEL' : autoridad.stel('sales_order')
  /**
   * Generar el remito (Fase 19 · E5).
   *
   * Abrir el diálogo no emite nada: lo que cierra el botón ya no es la
   * autoridad general sino que NINGUNA serie de remito se emita desde el ERP.
   * Adentro decide la serie elegida, y con la de por defecto —RT, que numera
   * STEL— el «Generar remito» queda bloqueado con su motivo.
   *
   * Ojo: esto habilita CREAR el borrador. Despachar sigue bloqueado por la
   * autoridad general, que es donde está el stock.
   */
  const stelEntrega =
    (seriesRemito.data ?? []).length > 1
      ? !(seriesRemito.data ?? []).some((x) => x.autoridad === 'ERP')
      : autoridad.stel('delivery')

  const lineas = useMemo(() => (doc ? ordenarLineas(doc.lineas) : []), [doc])
  const productIds = useMemo(() => lineas.flatMap((l) => (l.productId ? [l.productId] : [])), [lineas])
  const stock = useDisponibilidad(productIds)

  const tieneEntregas = (relacionados.data?.entregas.length ?? 0) > 0
  const permiso = editabilidadPedido(doc?.estado ?? '', escribe, tieneEntregas)
  const editando = borrador !== null
  const sucio = borrador !== null && original !== null && hayCambios(borrador, original)

  const tarifas = useTarifas(editando)
  const vendedores = useVendedores(editando)
  const contactos = useContactos(editando ? borrador.cabecera.customerId || null : null)
  // Fase 17 · E3. Igual que los contactos: sólo se piden en modo edición, que
  // es cuando hay un desplegable que llenar.
  const direcciones = useDireccionesEntrega(editando ? borrador.cabecera.customerId || null : null)

  // Salir con cambios pregunta: otro pedido, el menú, atrás del navegador o
  // cerrar la pestaña. Cambiar de pestaña interna no navega y no pregunta.
  const salida = useSalidaConCambios(sucio)

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })

  /** El ÚNICO camino de escritura del editor. */
  const guardar = useMutation({
    mutationFn: () => {
      const payload = aPayloadPedido(borrador!, original!)
      return guardarPedido(doc!.id, borrador!.esperado, payload.cabecera, payload.lineas)
    },
    onSuccess: () => {
      setUltimoError(null)
      setConflicto(false)
      setBorrador(null)
      setOriginal(null)
      setGuardado(true)
      void refrescar()
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, 'pedido', 'trazabilidad', id] })
    },
    onError: (e: Error) => {
      // El borrador NO se toca: si el guardado falla, lo escrito sigue ahí.
      if (e instanceof FalloDeGuardado && e.esConflicto) setConflicto(true)
      setUltimoError(e.message)
    },
  })

  const transicion = useMutation({
    mutationFn: ({ hasta }: { hasta: string }) => cambiarEstadoPedido(doc!.id, doc!.estado, hasta),
    onSuccess: () => {
      setUltimoError(null)
      void refrescar()
    },
    onError: (e: Error) => setUltimoError(mensajeErrorVentas(e)),
  })

  // Los pendientes se piden sólo con el modal abierto: es una consulta de tres
  // pasos y no hace falta tenerla lista todo el tiempo.
  const paraEntregar = useQuery({
    queryKey: ['ventas', activa?.companyId, 'para-entregar', id],
    queryFn: () => lineasParaEntregar(activa!.companyId, id!),
    enabled: generando && !!activa && !!id,
    staleTime: 0,
  })

  const crearRemito = useMutation({
    mutationFn: ({ cantidades, fecha, serie }: { cantidades: Map<string, number>; fecha: string; serie: string }) =>
      crearEntregaDesdePedido(id!, cantidades, fecha, null, serie),
    onSuccess: (remito) => {
      setGenerando(false)
      setErrorRemito(null)
      void refrescar()
      void navegar(`/ventas/entregas/${remito.id}`)
    },
    onError: (e: Error) => setErrorRemito(mensajeErrorVentas(e)),
  })

  // Mientras se edita, las acciones del documento no se ofrecen: duplicar o
  // cancelar con un borrador a medias es perderlo.
  const acciones = useAccionesDocumento(borrador !== null ? null : doc)

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
        <Spinner size={20} /> Cargando pedido…
      </p>
    )
  }
  if (error) return <ErrorState title="No se pudo leer el pedido." description={error.message} />
  if (!doc) {
    return (
      <EmptyState
        headingLevel={1}
        icon="search"
        title="No encontramos este pedido"
        description="Puede que lo hayan borrado, o que no tengas acceso."
      />
    )
  }

  const lineasVisibles = borrador ? comoLineasDocumento(borrador) : lineas
  const docVisible: DocumentoDetalle = borrador
    ? {
        ...doc,
        moneda: borrador.cabecera.moneda,
        // Previsualización con la fórmula del servidor para el subtotal. El
        // impuesto y el total quedan en null: dependen del descuento global y
        // de la percepción, y mostrar una cifra propia sería inventar el total.
        subtotal: lineasVisibles.reduce(
          (s, l) =>
            s + (l.tipoLinea === 'chapter' ? 0 : l.cantidad * (l.precioUnitario ?? 0) * (1 - (l.descuentoPct ?? 0) / 100)),
          0,
        ),
        impuesto: null,
        total: null,
      }
    : doc

  const cambiarCampoCabecera = (campo: CampoCabecera, valor: string) =>
    setBorrador((b) => (b ? cambiarCampo(b, campo, valor) : b))

  const elegirCliente = (customerId: string) =>
    setBorrador((b) => {
      if (!b) return b
      const r = cambiarCliente(b, customerId)
      setAvisoContacto(r.contactoLimpiado)
      return r.borrador
    })

  const elegirMoneda = (moneda: string) =>
    setBorrador((b) => {
      if (!b) return b
      const actual = tarifas.data?.find((t) => t.id === b.cabecera.listaPrecioId)
      const r = cambiarMoneda(b, moneda, actual?.moneda ?? null)
      setAvisoTarifa(r.tarifaLimpiada)
      return r.borrador
    })

  const cambiarLinea = (clave: string, campo: CampoLinea, valor: string | number | null) =>
    setBorrador((b) => {
      if (!b) return b
      let siguiente = cambiarLineaBorrador(b, clave, CAMPO_BORRADOR[campo], valor)
      if (campo === 'tax_treatment') {
        const tasa = tasaDe(String(valor))
        if (tasa !== null) siguiente = cambiarLineaBorrador(siguiente, clave, 'tasaImpuesto', tasa)
      }
      return siguiente
    })

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

  const tiposBloqueados: DocTypeVentas[] = [
    ...(stelPedido ? (['sales_order'] as const) : []),
    ...(stelEntrega ? (['delivery'] as const) : []),
  ]
  const idMotivo = 'motivo-emision-pedido'
  const hayBanner = esInterno && tiposBloqueados.length > 0
  const describePorBloqueo = hayBanner ? idMotivo : undefined

  const pestanas = [
    { key: 'lineas' as const, label: 'Líneas', count: lineasVisibles.length },
    { key: 'entregas' as const, label: 'Entregas' },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'relacionados' as const, label: 'Relacionados' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  return (
    <div className={`${docUi.pagina} ${docUi.paginaAncha}`}>
      <DocumentHeader
        back={volver}
        numero={doc.numero}
        estados={
          <>
            <ChipEstado estado={presentarEstado('pedido', doc.estado)} />
            {doc.estadoSecundario ? <ChipEstado estado={presentarCumplimiento(doc.estadoSecundario)} /> : null}
          </>
        }
        origen={
          doc.esHistorico ? (
            <Badge tone="neutral" outline className={docUi.origen}>
              Migrado del sistema anterior
            </Badge>
          ) : null
        }
        aviso={editando ? <Badge tone="info">Editando</Badge> : null}
      />

      <AvisosHistoricos documento={doc} revision={revision.data} />

      {hayBanner ? (
        <AvisoAutoridadStel
          idDetalle={idMotivo}
          // Si la serie de ESTE pedido la numera el ERP, lo que sigue en STEL
          // es el remito que saldría de él, no él.
          {...(stelPedido ? {} : { titulo: TITULO_BANNER_STEL_DERIVADOS })}
          detalle={`${motivoBloqueo(...tiposBloqueados)} Podés consultar, editar y guardar, imprimir y exportar.`}
        />
      ) : null}

      {conflicto ? (
        <Alert
          tone="warning"
          role="alert"
          title="Este pedido cambió mientras lo estabas editando"
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Recargar
            </Button>
          }
        >
          <p>
            Alguien más lo guardó, así que para no pisar su trabajo no se guardó nada.{' '}
            <strong>Lo que escribiste sigue en pantalla</strong>: anotá lo que haga falta antes de recargar.
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
          <p>El pedido y sus líneas se guardaron juntos.</p>
        </Alert>
      ) : null}

      {editando ? (
        <ActionBar
          pegajosa
          volver={volver}
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
          pegajosa
          volver={volver}
          primary={
            escribe && doc.estado === 'confirmed' ? (
              <Button
                icon={<Icon name="truck" size={16} />}
                disabled={stelEntrega || autoridad.cargando}
                aria-describedby={stelEntrega ? describePorBloqueo : undefined}
                onClick={() => {
                  setErrorRemito(null)
                  setGenerando(true)
                }}
              >
                Generar nota de entrega
              </Button>
            ) : escribe && doc.estado === 'draft' ? (
              <Button
                icon={<Icon name="check" size={16} />}
                loading={transicion.isPending}
                disabled={stelPedido || autoridad.cargando}
                aria-describedby={stelPedido ? describePorBloqueo : undefined}
                onClick={() => transicion.mutate({ hasta: 'confirmed' })}
              >
                Confirmar pedido
              </Button>
            ) : null
          }
          secondary={
            <>
              {permiso.editable ? (
                <Button variant="secondary" icon={<Icon name="edit" size={16} />} onClick={() => abrirEdicion(doc)}>
                  Editar
                </Button>
              ) : null}
              {acciones.secundarias}
            </>
          }
          more={
            acciones.hayMas ? <MoreMenu>{acciones.mas}</MoreMenu> : null
          }
          note={
            <>
              {!permiso.editable && permiso.motivo ? (
                <p className={editor.candado}>
                  <Icon name="alert-circle" size={16} /> {permiso.motivo}
                </p>
              ) : null}
              {permiso.editable && permiso.motivo ? <p>{permiso.motivo}</p> : null}
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

      <DocumentTabs id={idPestanas} items={pestanas} value={pestana} onChange={setPestana} label="Secciones del pedido">
        {pestana === 'lineas' ? (
          /* Fase 26 · E2: el editor a la izquierda y la HOJA a la derecha,
             igual que en el alta. Antes esta pantalla no tenía hoja y para ver
             cómo salía el documento había que abrir el modal de impresión —
             donde no se puede editar. */
          <div className={verPrevia && pantallaAncha ? editor.conPrevia : undefined}>
          <div className={editor.columnaEditor}>
          <DocSection title="Información del pedido">
            {editando ? (
              <EditorCabecera
                onAbrirContactos={() => setContactosAbiertos(true)}
                valores={borrador.cabecera}
                contactos={contactos.data ?? []}
                direcciones={direcciones.data ?? []}
                cargandoDirecciones={direcciones.isPending && borrador.cabecera.customerId !== ''}
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
              <InformacionDocumento agrupado doc={doc} onVerCliente={() => setViendoCliente(true)} />
            )}
          </DocSection>

          <DocSection
            title="Líneas"
            actions={
              <>
                {editando ? (
                  <>
                    <Button variant="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={() => setCatalogoAbierto(true)}>
                      Añadir producto
                    </Button>
                    <Button variant="secondary" size="sm" icon={<Icon name="plus" size={16} />} onClick={() => nueva()}>
                      Nueva línea
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => nueva({ tipoLinea: 'chapter', tasaImpuesto: 0 })}>
                      Nuevo capítulo
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Icon name="eye" size={16} />}
                  onClick={() => setPreviaPedida(!verPrevia)}
                  aria-expanded={verPrevia}
                >
                  {verPrevia ? 'Ocultar documento' : 'Ver documento'}
                </Button>
              </>
            }
          >
            {editando ? (
              <>
                <EditorLineas
                  lineas={lineasVisibles}
                  moneda={borrador.cabecera.moneda}
                  editable
                  documento="del pedido"
                  onCambiar={cambiarLinea}
                  onEliminar={(clave) => setBorrador((b) => (b ? quitarLinea(b, clave) : b))}
                  onMover={(clave, d) => setBorrador((b) => (b ? moverLinea(b, clave, d) : b))}
                />
              </>
            ) : (
              <TablaLineas lineas={lineasVisibles} moneda={doc.moneda} tipo="pedido" />
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

        {pestana === 'entregas' ? (
          <>
            <DocSection title="Entregas">
              <PanelPendientes lineas={lineasVisibles} resultado={pendientes.data} cargando={pendientes.isPending} />
            </DocSection>
            {esInterno ? (
              <DocSection title="Stock">
                <PanelStock
                  lineas={lineasVisibles}
                  disponibilidad={stock.data}
                  cargando={stock.isPending && productIds.length > 0}
                  esInterno={esInterno}
                />
              </DocSection>
            ) : null}
          </>
        ) : null}

        {pestana === 'adjuntos' ? (
          <DocSection title="Adjuntos">
            <PanelAdjuntos tipo="pedido" documentoId={doc.id} />
          </DocSection>
        ) : null}

        {pestana === 'relacionados' ? (
          <DocSection title="Relacionados">
            <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} tipoActual="pedido" />
          </DocSection>
        ) : null}

        {pestana === 'trazabilidad' ? (
          <DocSection title="Trazabilidad">
            <PanelTrazabilidad tipo="pedido" documentoId={doc.id} />
          </DocSection>
        ) : null}
      </DocumentTabs>

      {generando ? (
        <ModalEntregaParcial
          lineas={paraEntregar.data ?? []}
          cargando={paraEntregar.isPending}
          guardando={crearRemito.isPending}
          error={errorRemito}
          onCerrar={() => setGenerando(false)}
          series={seriesRemito.data ?? []}
          onConfirmar={(cantidades, fecha, serie) => crearRemito.mutate({ cantidades, fecha, serie })}
        />
      ) : null}

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
          onCerrar={() => setCatalogoAbierto(false)}
          onAgregar={(p, cantidad) =>
            nueva({
              productId: p.id,
              sku: p.sku,
              nombre: p.nombre,
              cantidad,
              // La tarifa del documento SUGIERE el precio; sin precio en
              // esa tarifa la línea entra en cero y se ve.
              precioUnitario: p.precio ?? 0,
            })
          }
        />
      ) : null}

      <DialogoCambiosSinGuardar open={salida.preguntando} onSalir={salida.salir} onQuedarse={salida.quedarse} />

      <ConfirmDialog
        open={confirmarSalida}
        tone="danger"
        title="Hay cambios sin guardar"
        description="Si descartás, se pierde lo que editaste y el pedido vuelve a como estaba."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onCancel={() => setConfirmarSalida(false)}
        onConfirm={descartar}
      />

      {acciones.capas}

      {/* Fase 19 · E4: la MISMA ficha rápida que abre el listado de Clientes
          y la cotización. Mirar con quién se está tratando no puede costar
          perder el pedido de vista. */}
      {viendoCliente && doc.clienteId ? (
        <PanelLateralCliente clienteId={doc.clienteId} onCerrar={() => setViendoCliente(false)} />
      ) : null}
    </div>
  )
}
