import { useCallback, useId, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, MetaList, Missing } from '@/components/document/DocSection'
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
import { EditorCabecera } from '../components/EditorCabecera'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { ModalEntregaParcial } from '../components/ModalEntregaParcial'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelPendientes } from '../components/PanelPendientes'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelStock } from '../components/PanelStock'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { SelectorProducto } from '../components/SelectorProducto'
import { TablaLineas } from '../components/TablaLineas'
import { TotalesDocumento } from '../components/TotalesDocumento'
import {
  useContactos,
  useDisponibilidad,
  useDocumento,
  usePendientes,
  useRelacionados,
  useTarifas,
  useVendedores,
} from '../hooks/useDocumentos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { mensajeErrorVentas, motivoBloqueo, type DocTypeVentas } from '../lib/autoridad'
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
import { formatearFecha, formatearImporte } from '../lib/formato'
import { escribeVentas } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { FalloDeGuardado, ordenarLineas } from '../services/cotizaciones'
import { crearEntregaDesdePedido, lineasParaEntregar } from '../services/entregas'
import { cambiarEstadoPedido, editabilidadPedido, guardarPedido } from '../services/pedidos'
import type { DocumentoDetalle } from '../types'
import editor from './EditorCotizacion.module.css'

type Pestana = 'lineas' | 'informacion' | 'entregas' | 'adjuntos' | 'relacionados' | 'trazabilidad'
const PESTANAS: Pestana[] = ['lineas', 'informacion', 'entregas', 'adjuntos', 'relacionados', 'trazabilidad']

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
  const pendientes = usePendientes(doc)

  const [original, setOriginal] = useState<Borrador | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [avisoContacto, setAvisoContacto] = useState(false)
  const [avisoTarifa, setAvisoTarifa] = useState(false)
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [errorRemito, setErrorRemito] = useState<string | null>(null)
  const [pestana, setPestana] = useTabDeUrl<Pestana>(PESTANAS, 'lineas')
  const idPestanas = useId()

  const esInterno = activa?.esInterno ?? false
  const escribe = escribeVentas(activa?.rol)
  const autoridad = useAutoridadNumeracion()
  const stelPedido = autoridad.stel('sales_order')
  const stelEntrega = autoridad.stel('delivery')

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
    mutationFn: ({ cantidades, fecha }: { cantidades: Map<string, number>; fecha: string }) =>
      crearEntregaDesdePedido(activa!.companyId, id!, cantidades, paraEntregar.data ?? [], fecha),
    onSuccess: (entregaId) => {
      setGenerando(false)
      setErrorRemito(null)
      void refrescar()
      void navegar(`/ventas/entregas/${entregaId}`)
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
    { key: 'informacion' as const, label: 'Información' },
    { key: 'entregas' as const, label: 'Entregas' },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'relacionados' as const, label: 'Relacionados' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  return (
    <div className={docUi.pagina}>
      <DocumentHeader
        back={{ to: '/ventas/pedidos', label: 'Pedidos' }}
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
        cliente={doc.clienteNombre}
        fecha={formatearFecha(doc.fecha)}
        titulo={borrador ? borrador.cabecera.titulo : doc.titulo}
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
          danger={acciones.peligro}
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
                        // La tarifa del pedido SUGIERE el precio de la línea
                        // nueva. Las que ya estaban no se tocan.
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
        ) : null}

        {pestana === 'informacion' ? (
          <DocSection title="Información del pedido">
            {editando ? (
              <EditorCabecera
                valores={borrador.cabecera}
                contactos={contactos.data ?? []}
                tarifas={tarifas.data ?? []}
                vendedores={vendedores.data ?? []}
                cargandoContactos={contactos.isPending && borrador.cabecera.customerId !== ''}
                avisoContacto={avisoContacto}
                avisoTarifa={avisoTarifa}
                mostrarValidez={false}
                onCambiar={cambiarCampoCabecera}
                onCambiarCliente={elegirCliente}
                onCambiarMoneda={elegirMoneda}
              />
            ) : (
              <MetaList
                items={[
                  { label: 'Cliente', value: doc.clienteNombre },
                  { label: 'Contacto', value: doc.contactoNombre ?? <Missing /> },
                  { label: 'Vendedor', value: doc.vendedor ?? <Missing /> },
                  { label: 'Fecha del pedido', value: formatearFecha(doc.fecha) },
                  { label: 'Moneda', value: doc.moneda ?? <Missing /> },
                  doc.tipoCambio !== null ? { label: 'Tipo de cambio', value: doc.tipoCambio } : null,
                  { label: 'Tarifa', value: doc.listaPrecioNombre ?? <Missing /> },
                  doc.formaPago ? { label: 'Forma de pago', value: doc.formaPago } : null,
                  { label: 'Serie', value: doc.serie ?? <Missing /> },
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
                  { label: 'Creado por', value: doc.creadoPor ?? <Missing /> },
                  { label: 'Creado', value: formatearFecha(doc.creadoEn) },
                ]}
              />
            )}
          </DocSection>
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
            <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} />
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
          onConfirmar={(cantidades, fecha) => crearRemito.mutate({ cantidades, fecha })}
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
    </div>
  )
}
