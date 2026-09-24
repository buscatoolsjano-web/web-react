import { useCallback, useId, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, Totals } from '@/components/document/DocSection'
import { DocumentHeader } from '@/components/document/DocumentHeader'
import { DocumentTabs } from '@/components/document/DocumentTabs'
import { useTabDeUrl } from '@/components/document/useTabDeUrl'
import docUi from '@/components/document/Document.module.css'
import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { DialogoCambiosSinGuardar } from '@/components/modals/DialogoCambiosSinGuardar'
import { useSalidaConCambios } from '@/hooks/useSalidaConCambios'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAccionesDocumento } from '../components/AccionesDocumento'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { ChipEstado } from '../components/ChipEstado'
import { InformacionDocumento } from '../components/InformacionDocumento'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelLateralCliente } from '@/modules/clientes/components/PanelLateralCliente'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { PanelAvanceRemito } from '../components/PanelAvanceRemito'
import { VistaPreviaDocumento } from '../components/VistaPreviaDocumento'
import { TablaLineas } from '../components/TablaLineas'
import {
  useAvanceDeRemito,
  useContactos,
  useDocumento,
  useRelacionados,
  useRevision,
} from '../hooks/useDocumentos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useVolverAlListado } from '../hooks/useVolverAlListado'
import { mensajeErrorVentas, motivoBloqueo } from '../lib/autoridad'
import {
  aPayloadRemito,
  agregarLineaRemito,
  cambiarCampoRemito,
  cambiarLineaRemito,
  crearBorradorRemito,
  faltaParaGuardarRemito,
  hayCambiosRemito,
  quitarLineaRemito,
  topeDeLinea,
  type BorradorRemito,
  type CampoRemito,
} from '../lib/borradorRemito'
import { presentarEstado } from '../lib/estados'
import { formatearCantidad, formatearFecha, formatearImporte } from '../lib/formato'
import { escribeVentas } from '../lib/permisos'
import { FalloDeGuardado } from '../services/cotizaciones'
import { confirmarEntrega, editabilidadEntrega, guardarRemito, lineasParaEntregar } from '../services/entregas'
import lineasUi from '../components/EditorLineas.module.css'
import editor from './EditorCotizacion.module.css'

/*
 * Fase 27 · E5: «Información» dejó de ser pestaña. Los datos del remito
 * están siempre a la vista, arriba de las líneas, igual que en el alta.
 */
type Pestana = 'lineas' | 'adjuntos' | 'relacionados' | 'trazabilidad'
const PESTANAS: Pestana[] = ['lineas', 'adjuntos', 'relacionados', 'trazabilidad']

export function EntregaDetallePage() {
  const { id } = useParams<{ id: string }>()
  // Al ir de un remito a otro el componente se remonta: el borrador de uno no
  // puede aparecer en el otro.
  return <Detalle key={id ?? ''} />
}

/**
 * Detalle del remito (Fase 15 · E5).
 *
 * El mismo shell documental que la cotización y el pedido, con lo propio del
 * remito:
 *
 * · en **borrador** se edita —fecha, transporte, texto y cantidades— por
 *   borrador local y un solo «Guardar cambios», que es `guardar_remito`;
 * · **despachar** es lo único que mueve stock, y lo hace el servidor en una
 *   transacción idempotente: apretar dos veces no descuenta dos veces;
 * · despachado ya no se edita, no se cancela y no se borra. No es una regla de
 *   la pantalla: la impone la base, porque borrar el movimiento no devuelve
 *   las unidades.
 */
function Detalle() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('entrega', id)
  const relacionados = useRelacionados('entrega', id)
  // Los motivos de revisión, clasificados por el servidor (Fase 19 · E4).
  const revision = useRevision('entrega', id)
  // El avance del pedido visto desde este remito (Fase 19 · E5).
  const avance = useAvanceDeRemito(id, doc?.origen?.tipo === 'pedido' ? doc.origen.id : null)

  const [borrador, setBorrador] = useState<BorradorRemito | null>(null)
  const [original, setOriginal] = useState<BorradorRemito | null>(null)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  /** La ficha rápida del cliente, sin salir del documento (Fase 19 · E4). */
  const [viendoCliente, setViendoCliente] = useState(false)
  const [aAgregar, setAAgregar] = useState('')

  /**
   * Si se ve la hoja al lado (Fase 26 · E2).
   *
   * `null` = nadie lo eligió todavía, y entonces manda la pantalla: con
   * 1280 px o más la hoja entra al lado del editor y se muestra, como en el
   * alta de una cotización. Una vez que se toca el botón, gana lo que pidió
   * la persona.
   *
   * Va acá arriba y no al lado de `lineasParaHoja`: abajo de los `return`
   * tempranos serían hooks condicionales.
   */
  const pantallaAncha = useMediaQuery('(min-width: 1280px)')
  const [previaPedida, setPreviaPedida] = useState<boolean | null>(null)
  const verPrevia = previaPedida ?? pantallaAncha
  const [pestana, setPestana] = useTabDeUrl<Pestana>(PESTANAS, 'lineas')
  const idPestanas = useId()

  const esInterno = activa?.esInterno ?? false
  const escribe = escribeVentas(activa?.rol)
  const autoridad = useAutoridadNumeracion()
  // El listado como estaba, si se llegó desde él (Fase 19 · E2).
  const volver = useVolverAlListado('entrega', 'Notas de entrega')
  const stelEntrega = autoridad.stel('delivery')

  const editando = borrador !== null
  const sucio = borrador !== null && original !== null && hayCambiosRemito(borrador, original)
  const salida = useSalidaConCambios(sucio)
  const contactos = useContactos(editando ? (doc?.clienteId ?? null) : null)

  // Lo pendiente del pedido, para no ofrecer más de lo que queda. Es la misma
  // cuenta que hace la base al guardar; acá sólo evita el ida y vuelta.
  const pendientes = useQuery({
    queryKey: ['ventas', activa?.companyId, 'para-entregar', doc?.origen?.id],
    queryFn: () => lineasParaEntregar(activa!.companyId, doc!.origen!.id),
    enabled: !!activa && !!doc?.origen && esInterno,
    staleTime: 0,
  })

  /**
   * Por línea del pedido: lo pedido, lo entregado por OTROS remitos y lo que
   * toma éste. `lineasParaEntregar` suma todas las entregas no canceladas,
   * incluida ésta, así que hay que descontarla para no competir con uno mismo.
   */
  const porLineaDePedido = useMemo(() => {
    const enEste = new Map<string, number>()
    for (const l of doc?.lineas ?? []) {
      if (l.ordenLineaId) enEste.set(l.ordenLineaId, (enEste.get(l.ordenLineaId) ?? 0) + l.cantidad)
    }
    const m = new Map<string, { pedida: number; otros: number; pendiente: number; enEsteRemito: number }>()
    for (const p of pendientes.data ?? []) {
      const propio = enEste.get(p.orderLineId) ?? 0
      m.set(p.orderLineId, {
        pedida: p.pedida,
        otros: p.entregada - propio,
        pendiente: Math.max(0, p.pedida - (p.entregada - propio) - propio),
        enEsteRemito: propio,
      })
    }
    return m
  }, [pendientes.data, doc?.lineas])

  const topes = useMemo(() => {
    const m = new Map<string, { pendiente: number; enEsteRemito: number }>()
    for (const [k, v] of porLineaDePedido) m.set(k, { pendiente: v.pendiente, enEsteRemito: v.enEsteRemito })
    return m
  }, [porLineaDePedido])

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })

  /** El ÚNICO camino de escritura del editor. */
  const guardar = useMutation({
    mutationFn: () => {
      const payload = aPayloadRemito(borrador!, original!)
      return guardarRemito(doc!.id, borrador!.esperado, payload.cabecera, payload.lineas)
    },
    onSuccess: (r) => {
      setUltimoError(null)
      setConflicto(false)
      setBorrador(null)
      setOriginal(null)
      setResultado(`Cambios guardados. ${r.lineasTocadas} línea(s) tocada(s).`)
      void refrescar()
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, 'entrega', 'trazabilidad', id] })
    },
    onError: (e: Error) => {
      // El borrador NO se toca: si el guardado falla, lo escrito sigue ahí.
      if (e instanceof FalloDeGuardado && e.esConflicto) setConflicto(true)
      setResultado(null)
      setUltimoError(mensajeErrorVentas(e))
    },
  })

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
      void refrescar()
    },
    onError: (e: Error) => {
      setResultado(null)
      setUltimoError(mensajeErrorVentas(e))
    },
  })

  const acciones = useAccionesDocumento(editando ? null : doc)

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
        <Spinner size={20} /> Cargando nota de entrega…
      </p>
    )
  }
  if (error) return <ErrorState title="No se pudo leer la nota de entrega." description={error.message} />
  if (!doc) {
    return (
      <EmptyState
        headingLevel={1}
        icon="search"
        title="No se encontró la nota de entrega"
        description="Puede que no exista o que no tengas acceso."
      />
    )
  }

  const permiso = editabilidadEntrega(doc.estado, escribe, doc.esHistorico)

  const abrirEdicion = () => {
    const b = crearBorradorRemito(doc, doc.lineas, {
      transporte: doc.transporte ?? null,
      seguimiento: doc.seguimiento ?? null,
    })
    setOriginal(b)
    setBorrador(b)
    setUltimoError(null)
    setConflicto(false)
    setResultado(null)
  }

  const cambiarCabecera = (campo: CampoRemito, valor: string) =>
    setBorrador((b) => (b ? cambiarCampoRemito(b, campo, valor) : b))

  const falta = borrador ? faltaParaGuardarRemito(borrador) : []

  // Las líneas del pedido que todavía se pueden sumar a este remito.
  const agregables = [...porLineaDePedido.entries()]
    .filter(([ol, v]) => v.pendiente > 0 && !borrador?.lineas.some((l) => l.orderLineId === ol))
    .map(([ol, v]) => {
      const dato = (pendientes.data ?? []).find((p) => p.orderLineId === ol)
      return { orderLineId: ol, sku: dato?.sku ?? null, nombre: dato?.nombre ?? null, pendiente: v.pendiente }
    })

  const lineasVisibles = borrador
    ? borrador.lineas.map((l, i) => ({
        id: l.clave,
        numeroLinea: i + 1,
        tipoLinea: 'item' as const,
        productId: null,
        sku: l.sku,
        nombre: l.nombre,
        descripcion: l.descripcion || null,
        cantidad: Number(l.cantidad.replace(',', '.')) || 0,
        precioUnitario: null,
        descuentoPct: null,
        tratamientoImpuesto: null,
        tasaImpuesto: null,
        ordenLineaId: l.orderLineId,
      }))
    : doc.lineas

  /**
   * Las líneas como van en la hoja.
   *
   * El borrador del remito no lleva precio —el editor lo aclara: el precio
   * viene del pedido y no se edita acá—, así que pasárselo tal cual dejaría
   * la hoja sin importes mientras se edita. Se recupera el precio de la
   * línea guardada que corresponde a la misma línea de pedido. Una línea
   * recién agregada desde el pedido todavía no tiene guardada, y va sin
   * importe: la hoja muestra un guión, que es la verdad.
   */
  const lineasParaHoja = borrador
    ? lineasVisibles.map((l) => {
        const guardada = l.ordenLineaId === null
          ? undefined
          : doc.lineas.find((o) => o.ordenLineaId === l.ordenLineaId)
        return guardada
          ? {
              ...l,
              precioUnitario: guardada.precioUnitario,
              descuentoPct: guardada.descuentoPct,
              tratamientoImpuesto: guardada.tratamientoImpuesto,
              tasaImpuesto: guardada.tasaImpuesto,
            }
          : l
      })
    : lineasVisibles

  const pestanas = [
    { key: 'lineas' as const, label: 'Líneas', count: lineasVisibles.length },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'relacionados' as const, label: 'Relacionados' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  return (
    <div className={docUi.pagina}>
      <DocumentHeader
        back={volver}
        numero={doc.numero}
        estados={
          <>
            <ChipEstado estado={presentarEstado('entrega', doc.estado)} />
            {doc.serie ? <Badge tone="neutral">Serie {doc.serie}</Badge> : null}
          </>
        }
        origen={
          doc.esHistorico ? (
            <Badge tone="neutral" outline className={docUi.origen}>
              Migrado del sistema anterior
            </Badge>
          ) : null
        }
        aviso={
          editando ? (
            <Badge tone="info">Editando</Badge>
          ) : confirmar.isPending ? (
            <span className={editor.guardando} role="status">
              <Spinner size={16} /> Despachando…
            </span>
          ) : null
        }
        cliente={doc.clienteNombre}
        fecha={formatearFecha(doc.fecha)}
        titulo={borrador ? borrador.cabecera.titulo : doc.titulo}
        total={formatearImporte(doc.total, doc.moneda)}
      />

      <AvisosHistoricos documento={doc} revision={revision.data} />

      {esInterno && stelEntrega ? (
        <AvisoAutoridadStel
          idDetalle="motivo-despachar"
          detalle="Podés consultar, editar el borrador, imprimir y exportar. Confirmar y despachar desde el ERP está bloqueado hasta completar la migración: no se mueve stock."
        />
      ) : null}

      {conflicto ? (
        <Alert
          tone="warning"
          role="alert"
          title="Este remito cambió mientras lo estabas editando"
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

      {resultado && !editando ? (
        <Alert tone="success" role="status">
          <p>{resultado}</p>
        </Alert>
      ) : null}

      {editando ? (
        <ActionBar
          primary={
            <Button
              icon={<Icon name="check" size={16} />}
              loading={guardar.isPending}
              disabled={!sucio || falta.length > 0 || guardar.isPending}
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
            <>
              {falta.length > 0 ? <p>{falta.join(' ')}</p> : null}
              <p>
                {sucio
                  ? 'Hay cambios sin guardar. No se escribe nada hasta que aprietes «Guardar cambios».'
                  : 'Sin cambios todavía. Editar un remito en borrador no mueve stock.'}
              </p>
            </>
          }
        />
      ) : (
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
          secondary={
            <>
              {permiso.editable ? (
                <Button variant="secondary" icon={<Icon name="edit" size={16} />} onClick={abrirEdicion}>
                  Editar
                </Button>
              ) : null}
              {acciones.secundarias}
            </>
          }
          danger={acciones.peligro}
          note={
            <>
              {permiso.confirmable ? (
                stelEntrega ? (
                  // El motivo lo explica el banner de arriba, que ya lleva el
                  // id al que apunta el botón: repetirlo sería contarlo dos
                  // veces y duplicar el id.
                  esInterno ? null : (
                    <p id="motivo-despachar">{motivoBloqueo('delivery')}</p>
                  )
                ) : (
                  <p>
                    Descuenta el stock de cada línea y libera las reservas del pedido. Se puede apretar una
                    sola vez: el servidor no repite el movimiento.
                  </p>
                )
              ) : null}
              {permiso.motivo ? (
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

      <DocumentTabs id={idPestanas} items={pestanas} value={pestana} onChange={setPestana} label="Secciones del remito">
        {pestana === 'lineas' ? (
          /* Fase 26 · E2: el editor a la izquierda y la HOJA a la derecha,
             igual que en el alta de una cotización. La hoja del remito es de
             sólo lectura: ver la nota de `lineasParaHoja`. */
          <div className={verPrevia && pantallaAncha ? editor.conPrevia : undefined}>
          <div className={editor.columnaEditor}>
          <DocSection title="Datos de la entrega">
            {editando ? (
              <div className={editor.formulario}>
                <Field label="Fecha del remito">
                  <Input
                    type="date"
                    value={borrador.cabecera.fecha}
                    onChange={(e) => cambiarCabecera('fecha', e.target.value)}
                  />
                </Field>
                <Field label="Contacto" optional>
                  <Select
                    value={borrador.cabecera.contactoId}
                    disabled={contactos.isPending}
                    onChange={(e) => cambiarCabecera('contactoId', e.target.value)}
                  >
                    <option value="">Sin contacto</option>
                    {(contactos.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rol ? `${c.nombre} · ${c.rol}` : c.nombre}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Título" optional>
                  <Input value={borrador.cabecera.titulo} onChange={(e) => cambiarCabecera('titulo', e.target.value)} />
                </Field>
                <Field label="Transporte" optional>
                  <Input
                    value={borrador.cabecera.transporte}
                    onChange={(e) => cambiarCabecera('transporte', e.target.value)}
                  />
                </Field>
                <Field label="Seguimiento" optional help="El número que da el transporte, si lo hay.">
                  <Input
                    value={borrador.cabecera.seguimiento}
                    onChange={(e) => cambiarCabecera('seguimiento', e.target.value)}
                  />
                </Field>
                <Field label="Observaciones" optional>
                  <Textarea
                    rows={3}
                    value={borrador.cabecera.notas}
                    onChange={(e) => cambiarCabecera('notas', e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <InformacionDocumento doc={doc} onVerCliente={() => setViendoCliente(true)} />
            )}
          </DocSection>

          <DocSection
            title="Líneas"
            actions={
              <>
              {editando && agregables.length > 0 ? (
                <>
                  <Select
                    aria-label="Línea del pedido para agregar"
                    value={aAgregar}
                    onChange={(e) => setAAgregar(e.target.value)}
                  >
                    <option value="">Agregar una línea pendiente…</option>
                    {agregables.map((a) => (
                      <option key={a.orderLineId} value={a.orderLineId}>
                        {[a.sku, a.nombre].filter(Boolean).join(' · ')} — pendiente {formatearCantidad(a.pendiente)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="plus" size={16} />}
                    disabled={aAgregar === ''}
                    onClick={() => {
                      const a = agregables.find((x) => x.orderLineId === aAgregar)
                      if (!a) return
                      setBorrador((b) =>
                        b ? agregarLineaRemito(b, { orderLineId: a.orderLineId, sku: a.sku, nombre: a.nombre, cantidad: a.pendiente }) : b,
                      )
                      setAAgregar('')
                    }}
                  >
                    Agregar
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
              <div className={lineasUi.scroll}>
                <table className={lineasUi.tabla}>
                  <caption className="sr-only">Líneas del remito, en edición</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={lineasUi.num}>#</th>
                      <th scope="col">Referencia</th>
                      <th scope="col">Producto</th>
                      <th scope="col">Descripción</th>
                      <th scope="col">Cantidad</th>
                      <th scope="col">Pedida</th>
                      <th scope="col">Pendiente después</th>
                      <th scope="col"><span className="sr-only">Quitar</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {borrador.lineas.map((l, i) => {
                      const info = l.orderLineId ? porLineaDePedido.get(l.orderLineId) : undefined
                      const tope = topeDeLinea(l, topes)
                      const cantidad = Number(l.cantidad.replace(',', '.')) || 0
                      return (
                        <tr key={l.clave}>
                          <td className={lineasUi.num}>{i + 1}</td>
                          <td>{l.sku ?? '—'}</td>
                          <td>{l.nombre ?? '—'}</td>
                          <td>
                            <input
                              className={lineasUi.texto}
                              value={l.descripcion}
                              aria-label={`Descripción de ${l.sku ?? 'la línea'}`}
                              placeholder="Texto del remito"
                              onChange={(e) =>
                                setBorrador((b) => (b ? cambiarLineaRemito(b, l.clave, 'descripcion', e.target.value) : b))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className={lineasUi.numero}
                              min="0"
                              step="any"
                              {...(tope !== null ? { max: tope } : {})}
                              value={l.cantidad}
                              aria-label={`Cantidad de ${l.sku ?? 'la línea'}`}
                              onChange={(e) =>
                                setBorrador((b) => (b ? cambiarLineaRemito(b, l.clave, 'cantidad', e.target.value) : b))
                              }
                            />
                          </td>
                          <td>{info ? formatearCantidad(info.pedida) : '—'}</td>
                          <td>{info ? formatearCantidad(Math.max(0, info.pedida - info.otros - cantidad)) : '—'}</td>
                          <td>
                            <IconButton
                              aria-label={`Quitar ${l.sku ?? 'la línea'}`}
                              icon="trash"
                              onClick={() => setBorrador((b) => (b ? quitarLineaRemito(b, l.clave) : b))}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <TablaLineas lineas={doc.lineas} moneda={doc.moneda} tipo="entrega" />
            )}

            {editando ? (
              <p className={editor.nota}>
                El precio, el descuento y el impuesto vienen del pedido y no se editan acá: un remito dice
                qué se entrega, no a qué precio se vendió.
              </p>
            ) : (
              <Totals
                rows={[
                  { label: 'Subtotal', value: formatearImporte(doc.subtotal, doc.moneda) },
                  { label: 'Impuestos', value: formatearImporte(doc.impuesto, doc.moneda) },
                  { label: 'Total', value: formatearImporte(doc.total, doc.moneda), strong: true },
                ]}
              />
            )}
          </DocSection>

        {/* Fase 19 · E5: los cuatro números contra el pedido, sin salir del
            remito. Sólo con pedido de origen: uno suelto no tiene contra qué
            compararse. */}
        {!editando && doc.origen?.tipo === 'pedido' ? (
          <DocSection title="Avance del pedido">
            <PanelAvanceRemito
              avance={avance.data}
              cargando={avance.isPending}
              despachado={doc.estado === 'shipped' || doc.estado === 'delivered'}
            />
          </DocSection>
        ) : null}
          </div>

          {verPrevia ? (
            <div className={editor.columnaPrevia}>
              <VistaPreviaDocumento
                doc={doc}
                lineas={lineasParaHoja}
                ajustarAlAncho={pantallaAncha}
                aclaracion={
                  editando
                    ? 'La hoja muestra las cantidades que estás editando. El precio y el impuesto vienen del pedido y no se editan acá.'
                    : null
                }
              />
            </div>
          ) : null}
          </div>
        ) : null}

        {pestana === 'adjuntos' ? (
          <DocSection title="Adjuntos">
            <PanelAdjuntos tipo="entrega" documentoId={doc.id} />
          </DocSection>
        ) : null}

        {pestana === 'relacionados' ? (
          <DocSection title="Relacionados">
            <PanelRelacionados relacionados={relacionados.data} cargando={relacionados.isPending} idActual={doc.id} tipoActual="entrega" />
          </DocSection>
        ) : null}

        {pestana === 'trazabilidad' ? (
          <DocSection title="Trazabilidad">
            <PanelTrazabilidad tipo="entrega" documentoId={doc.id} />
          </DocSection>
        ) : null}
      </DocumentTabs>

      <DialogoCambiosSinGuardar open={salida.preguntando} onSalir={salida.salir} onQuedarse={salida.quedarse} />

      <ConfirmDialog
        open={confirmarSalida}
        tone="danger"
        title="Hay cambios sin guardar"
        description="Si descartás, se pierde lo que editaste y el remito vuelve a como estaba."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onCancel={() => setConfirmarSalida(false)}
        onConfirm={descartar}
      />

      {acciones.capas}

      {/* Fase 19 · E4: la MISMA ficha rápida que abre el listado de Clientes
          y la cotización. Mirar con quién se está tratando no puede costar
          perder el remito de vista. */}
      {viendoCliente && doc.clienteId ? (
        <PanelLateralCliente clienteId={doc.clienteId} onCerrar={() => setViendoCliente(false)} />
      ) : null}
    </div>
  )
}
