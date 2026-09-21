import { useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection, MetaList, Missing } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { DialogoCambiosSinGuardar } from '@/components/modals/DialogoCambiosSinGuardar'
import { useSalidaConCambios } from '@/hooks/useSalidaConCambios'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAperturaDeAlta } from '@/modules/ventas/hooks/useAperturaDeAlta'
import { useAutoridadNumeracion } from '@/modules/ventas/hooks/useAutoridadNumeracion'
import { motivoBloqueo, type DocTypeVentas } from '@/modules/ventas/lib/autoridad'
import { escribeVentas } from '@/modules/ventas/lib/permisos'
import { EditorContactos } from '../components/EditorContactos'
import { EditorDirecciones } from '../components/EditorDirecciones'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelProductos } from '../components/PanelProductos'
import { PanelTrazabilidad } from '../components/PanelTrazabilidad'
import { FormularioCliente } from '../components/FormularioCliente'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelMemoria } from '../components/PanelMemoria'
import { PanelPrecios } from '../components/PanelPrecios'
import { PanelResumen } from '../components/PanelResumen'
import { explicarMotivo } from '../lib/motivos'
import { formatearCuit, formatearFecha, nombreVisible } from '../lib/formato'
import { useAuth } from '@/features/auth/useAuth'
import { permisosDe } from '../lib/permisos'
import type { DatosCliente } from '../lib/validacion'
import {
  useCandidatosDeOc,
  useCliente,
  useContactos,
  useDirecciones,
  useHistorial,
  useOpcionesComerciales,
} from '../hooks/useClientes'
import { useCliente360 } from '../hooks/useCliente360'
import {
  useActualizarCliente,
  useBajaCliente,
  useResolverRevision,
} from '../hooks/useEdicionClientes'
import { FalloDeCliente } from '../services/edicion'
import type { ClienteDetalle } from '../types'
import styles from './ClienteDetallePage.module.css'

type Pestana =
  | 'informacion'
  | 'contactos'
  | 'direcciones'
  | 'productos'
  | 'memoria'
  | 'precios'
  | 'historial'
  | 'adjuntos'
  | 'trazabilidad'

/** El id del motivo, para que los botones deshabilitados lo nombren. */
const MOTIVO_STEL = 'cliente-motivo-stel'

function aFormulario(c: ClienteDetalle): DatosCliente {
  return {
    razonSocial: c.razonSocial,
    nombreComercial: c.nombreComercial ?? '',
    cuit: c.cuit ?? '',
    emails: [...c.emails],
    dominios: [...c.dominios],
    rubro: c.rubro ?? '',
    telefono: c.telefono ?? '',
    tipo: c.tipo,
    condicionDePago: c.condicionDePago ?? '',
    monedaPorDefecto: c.monedaPorDefecto ?? '',
    vendedorId: c.vendedorId ?? '',
    tarifaId: c.tarifaId ?? '',
    notas: c.notas ?? '',
  }
}

/**
 * La ficha del cliente.
 *
 * El legacy tenía cinco pestañas: Información, Contactos, Memoria de
 * productos, Precios e Historial. Están las cinco, más Direcciones —que en el
 * legacy no existían estructuradas—, Productos, Adjuntos y Trazabilidad.
 *
 * **Precios** no es la pestaña del legacy: aquélla leía un caché en
 * `localStorage` que se escribía al guardar cada cotización y no guardaba la
 * moneda. Ésta deriva todo de las líneas de cotizaciones y pedidos, del lado
 * del servidor y separado por moneda.
 *
 * Fase 13 · E4 — jerarquía, mismos datos:
 *
 *   1. identidad (encabezado: nombre, referencia, estado, acciones);
 *   2. contacto (contacto principal, emails, teléfono, CUIT, dirección);
 *   3. actividad (el resumen que calcula el servidor);
 *   4. pestañas para lo que tiene contenido propio.
 *
 * Fase 17 · E4: cada pestaña pide sus datos **cuando se abre**. Antes, abrir
 * la ficha disparaba todo —incluidos los 258 documentos del cliente más
 * grande— se mirara lo que se mirara. Lo único que sale al abrir es lo que se
 * ve al abrir: la ficha, los contactos, las direcciones y el resumen.
 *
 * Los datos de contacto y comerciales se muestran como lista de definiciones
 * (no parecen campos) y un dato faltante se dice («Sin CUIT»), no se deja vacío.
 */
export function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const { user } = useAuth()
  const { data: cliente, isPending, isFetching, error, refetch } = useCliente(id)
  // La agenda del cliente —contactos y direcciones— la administra también el
  // vendedor que lo tiene asignado (Fase 17 · E3), así que el permiso depende
  // del cliente y no sólo del rol. Mientras el cliente no cargó, no se decide
  // por él: se pasa null y el vendedor no ve los botones hasta que llegue.
  const permisos = permisosDe(activa, cliente ?? null, user?.id ?? null)
  const contactos = useContactos(id)
  const direccionesConsulta = useDirecciones(id)
  // La misma consulta que usa el panel «Actividad»: React Query la comparte por
  // clave, así que pedirla acá para el contador de la pestaña no agrega un
  // viaje. Lo que evitaría traer 258 documentos sólo para contarlos.
  const resumen = useCliente360(id ?? null)
  /**
   * Quién puede emitir, y qué está bloqueado.
   *
   * La misma regla que ya aplican el listado de Ventas y la ficha rápida. Acá
   * faltaba: «Nueva cotización» y «Nuevo pedido» eran dos links sueltos, y con
   * STEL numerando se podía armar la cotización entera —cliente, líneas,
   * precios— para encontrarse con que «Crear cotización» estaba deshabilitado.
   * Un botón que lleva a una pantalla que la base va a rechazar no es una
   * acción, es una trampa; y era la MISMA acción que la ficha rápida, a dos
   * clicks de distancia, sí deshabilitaba y explicaba.
   */
  const autoridadVentas = useAutoridadNumeracion()
  /**
   * Fase 19 · E3: la trampa era el botón que llevaba a una pantalla que la
   * base iba a rechazar. Con el selector de serie ya no es el caso para la
   * cotización: abrir el alta no emite, y ahí la serie elegida decide.
   */
  const apertura = useAperturaDeAlta('cotizacion', escribeVentas(activa?.rol))
  const [pestana, setPestana] = useState<Pestana>('informacion')
  // Fase 17 · E4: el historial tiene su propia paginación, del lado del
  // servidor. Vive acá porque el panel es de presentación.
  const [paginaHistorial, setPaginaHistorial] = useState(1)
  const [porPaginaHistorial, setPorPaginaHistorial] = useState(25)
  const [editando, setEditando] = useState(false)
  // Lo informa el formulario: acá sólo se usa para el aviso al salir y para
  // preguntar antes de descartar.
  const [sucio, setSucio] = useState(false)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)
  const idPestanas = useId()
  // Salir con cambios pregunta: otro cliente, el menú, atrás del navegador o
  // cerrar la pestaña. Cambiar de pestaña interna NO navega y no pregunta.
  const salida = useSalidaConCambios(editando && sucio)
  const opciones = useOpcionesComerciales(editando && permisos.editarContactos)

  // Las consultas de cada pestaña salen cuando la pestaña se abre. Abrir la
  // ficha de un cliente con 258 documentos ya no los trae para no mostrarlos.
  const historial = useHistorial(id, {
    pagina: paginaHistorial,
    porPagina: porPaginaHistorial,
    tipo: null,
    habilitado: pestana === 'historial',
  })
  const oc = useCandidatosDeOc(id, pestana === 'historial')

  const guardar = useActualizarCliente(id ?? '')
  const baja = useBajaCliente(id ?? '')
  const revision = useResolverRevision(id ?? '')

  const volver = { to: '/clientes', label: 'Clientes' }

  if (isPending) {
    return (
      <div className={styles.cargando}>
        <Spinner label="Cargando cliente…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Cliente" back={volver} />
        <ErrorState title="No se pudo leer el cliente." description={error.message} onRetry={() => void refetch()} retrying={isFetching} />
      </div>
    )
  }

  if (!cliente) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Cliente" back={volver} />
        <EmptyState
          icon="users"
          title="No se encontró el cliente"
          description="Puede que no exista o que no tengas acceso."
          action={<LinkButton to="/clientes">Volver al listado</LinkButton>}
        />
      </div>
    )
  }

  const cerrarEdicion = () => {
    setEditando(false)
    setSucio(false)
    setConfirmandoDescarte(false)
  }

  const nombre = nombreVisible(cliente.razonSocial, cliente.nombreComercial)
  // El contacto que la ficha muestra arriba. Fase 17 · E3: entre los ACTIVOS,
  // porque desde esta entrega hay contactos dados de baja y mostrar a uno de
  // ellos como la cara del cliente sería decirle a alguien que le escriba a
  // quien ya no atiende.
  const activos = (contactos.data ?? []).filter((c) => c.activo)
  const principal = activos.find((c) => c.esPrincipal) ?? activos[0] ?? null
  const direcciones = direccionesConsulta.data ?? []
  /**
   * La dirección que la ficha muestra arriba: la **principal de entrega**, y
   * sólo ésa. No se cae en «la primera que haya»: mostrar un domicilio
   * cualquiera como si fuera el del cliente es peor que no mostrar ninguno, y
   * desde E3 además puede estar dado de baja.
   */
  const direccionPrincipal =
    direcciones.find((d) => d.activo && d.esPrincipal && (d.tipo === 'shipping' || d.tipo === 'both')) ??
    direcciones.find((d) => d.activo && d.esPrincipal) ??
    null

  // El contador del historial sale del RESUMEN, que ya está cargado: pedir los
  // documentos sólo para poder decir cuántos son sería volver al problema.
  const documentos = resumen.data
    ? resumen.data.totales.cotizaciones +
      resumen.data.totales.pedidos +
      resumen.data.totales.entregas
    : undefined

  const pestanas = [
    { key: 'informacion' as const, label: 'Datos comerciales' },
    { key: 'contactos' as const, label: 'Contactos', count: contactos.data?.length },
    { key: 'direcciones' as const, label: 'Direcciones', count: direcciones.length },
    { key: 'productos' as const, label: 'Productos' },
    { key: 'memoria' as const, label: 'Cómo los llama' },
    { key: 'precios' as const, label: 'Precios' },
    { key: 'historial' as const, label: 'Historial', count: documentos },
    { key: 'adjuntos' as const, label: 'Adjuntos' },
    { key: 'trazabilidad' as const, label: 'Trazabilidad' },
  ]

  /**
   * Un documento nuevo **desde el cliente** (Fase 17 · E4).
   *
   * Lo único que se pasa es el cliente, en la URL. Los defaults comerciales
   * —vendedor, tarifa, forma de pago, moneda— los aplica Ventas con el
   * mecanismo de E2, y el contacto y el domicilio con el de E3. Copiarlos
   * desde acá sería tener dos lugares donde vive la misma regla, y el día que
   * cambie uno, el otro miente.
   *
   * Lo que sí se promete es que se va a poder crear. Hasta la Fase 19 · E2 no:
   * el comentario que estaba acá decía que la pantalla de Ventas «lo dice y
   * bloquea», y era verdad —pero recién al final, después de elegir cliente,
   * cargar líneas y precios—. Quien decide es la base; quién la consulta
   * ANTES, acá, es este bloque.
   */
  const puedeVender = escribeVentas(activa?.rol)
  // Mientras no se sabe, las acciones se muestran deshabilitadas y SIN motivo:
  // no se inventa un bloqueo que todavía no se leyó.
  const bloqueados: DocTypeVentas[] = []
  // Fase 19 · E3: la cotización ya no se cierra por la autoridad general.
  // Abrir el alta no emite nada, y adentro decide la serie elegida: con la de
  // por defecto, «Crear» sigue bloqueado y esa pantalla lo explica.
  if (!apertura.abierta) bloqueados.push('quote')
  if (autoridadVentas.stel('sales_order')) bloqueados.push('sales_order')
  const hayMotivo = puedeVender && !cliente.dadoDeBaja && bloqueados.length > 0
  const cerrado = (docType: DocTypeVentas) =>
    docType === 'quote' ? !apertura.abierta || apertura.cargando : autoridadVentas.stel(docType)
  const emitir = (docType: DocTypeVentas, etiqueta: string, ruta: string) =>
    cerrado(docType) || autoridadVentas.cargando ? (
      <Button
        variant="secondary"
        disabled
        {...(hayMotivo && cerrado(docType) ? { 'aria-describedby': MOTIVO_STEL } : {})}
      >
        {etiqueta}
      </Button>
    ) : (
      <LinkButton variant="secondary" to={ruta}>
        {etiqueta}
      </LinkButton>
    )

  const acciones = editando ? undefined : (
    <>
      {!cliente.dadoDeBaja && puedeVender ? (
        <>
          {emitir('quote', 'Nueva cotización', `/ventas/cotizaciones/nueva?cliente=${cliente.id}`)}
          {emitir('sales_order', 'Nuevo pedido', `/ventas/pedidos/nuevo?cliente=${cliente.id}`)}
        </>
      ) : null}
      {permisos.darDeBaja && cliente.dadoDeBaja ? (
        <Button variant="secondary" loading={baja.reactivar.isPending} onClick={() => baja.reactivar.mutate()}>
          {baja.reactivar.isPending ? 'Reactivando…' : 'Reactivar'}
        </Button>
      ) : null}
      {permisos.darDeBaja && !cliente.dadoDeBaja ? (
        <Button variant="ghost" className={styles.peligro} onClick={() => setConfirmandoBaja(true)}>
          Dar de baja
        </Button>
      ) : null}
      {permisos.editarCliente && !cliente.dadoDeBaja ? (
        <Button
          variant="primary"
          icon={<Icon name="edit" size={16} />}
          onClick={() => {
            // Los datos se editan en su pestaña: se abre ahí para que el
            // formulario quede a la vista.
            setPestana('informacion')
            setEditando(true)
          }}
        >
          Editar
        </Button>
      ) : null}
    </>
  )

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={volver}
        title={nombre}
        subtitle={
          <>
            {cliente.nombreComercial ? `${cliente.razonSocial} · ` : ''}
            {cliente.referencia ?? 'Sin referencia'}
          </>
        }
        status={
          cliente.dadoDeBaja || cliente.esHistorico || cliente.necesitaRevision ? (
            <>
              {cliente.dadoDeBaja ? (
                <Badge tone="danger" outline>
                  Dado de baja
                </Badge>
              ) : null}
              {cliente.necesitaRevision ? (
                <Badge tone="warning" dot>
                  Para revisar
                </Badge>
              ) : null}
              {cliente.esHistorico ? (
                <Badge tone="neutral">
                  Migrado del sistema anterior
                  {cliente.origenLegacy === 'erp_contactos' ? ' (agenda de contactos)' : ''}
                </Badge>
              ) : null}
            </>
          ) : undefined
        }
        actions={acciones}
      />

      {hayMotivo ? (
        <p id={MOTIVO_STEL} className={doc.motivo}>
          {motivoBloqueo(...bloqueados)}
        </p>
      ) : null}

      {cliente.dadoDeBaja ? (
        <Alert tone="neutral" title="Cliente dado de baja">
          <p>
            <strong>No se ofrece</strong> al armar un documento nuevo. Sus documentos anteriores lo siguen nombrando igual y su
            historial sigue accesible.
          </p>
        </Alert>
      ) : null}

      {baja.dar.error || baja.reactivar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo cambiar el estado">
          <p>{baja.dar.error?.message ?? baja.reactivar.error?.message}</p>
        </Alert>
      ) : null}

      {cliente.necesitaRevision ? (
        <Alert
          tone="warning"
          title="Este cliente quedó marcado para revisión"
          action={
            <LinkButton variant="secondary" to="/clientes/revisar">
              Ver todos los marcados
            </LinkButton>
          }
        >
          <ul className={styles.motivos}>
            {cliente.motivosRevision.map((m) => (
              <li key={m}>
                <span>{explicarMotivo(m)}</span>
                {permisos.resolverRevision ? (
                  <Button variant="secondary" size="sm" loading={revision.isPending} onClick={() => revision.mutate([m])}>
                    Dar por revisado
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {revision.error ? (
            <p className={styles.error} role="alert">
              {revision.error.message}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div className={styles.resumen}>
        <DocSection title="Contacto">
          <MetaList
            items={[
              {
                label: 'Contacto principal',
                value: contactos.isPending ? (
                  <Missing>Cargando…</Missing>
                ) : principal ? (
                  <>
                    {principal.nombre}
                    {principal.cargo ? <span className={styles.secundario}> · {principal.cargo}</span> : null}
                  </>
                ) : (
                  // No se elige uno cualquiera entre los que haya: si nadie
                  // marcó el principal, lo honesto es decirlo.
                  <Missing>Sin contacto principal</Missing>
                ),
              },
              {
                label: cliente.emails.length > 1 ? 'Emails' : 'Email',
                value:
                  cliente.emails.length === 0 ? (
                    <Missing>Sin emails</Missing>
                  ) : (
                    <ul className={styles.listaSimple}>
                      {cliente.emails.map((e) => (
                        <li key={e}>
                          <a className={`${doc.enlace} ${styles.enlaceTactil}`} href={`mailto:${e}`}>
                            {e}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ),
              },
              { label: 'Teléfono', value: cliente.telefono ?? <Missing>Sin teléfono</Missing> },
              {
                label: 'Vendedor',
                value: cliente.vendedor ?? <Missing>Sin vendedor asignado</Missing>,
              },
              { label: 'CUIT', value: cliente.cuit ? <span className={styles.numero}>{formatearCuit(cliente.cuit)}</span> : <Missing>Sin CUIT</Missing> },
              {
                label: 'Dirección principal',
                wide: true,
                value: direccionesConsulta.isPending ? (
                  <Missing>Cargando…</Missing>
                ) : direccionPrincipal ? (
                  direccionPrincipal.texto || <Missing>Sin datos</Missing>
                ) : direcciones.length > 0 ? (
                  <Missing>Ninguna marcada como principal</Missing>
                ) : (
                  <Missing>Sin direcciones</Missing>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Actividad">
          <PanelResumen clienteId={cliente.id} />
        </DocSection>
      </div>

      <div>
        <Tabs id={idPestanas} label="Secciones de la ficha" items={pestanas} value={pestana} onChange={setPestana} />

        <TabPanel tabsId={idPestanas} tabKey={pestana}>
          {pestana === 'informacion' && editando ? (
            <DocSection title="Editar datos del cliente">
              {guardar.error instanceof FalloDeCliente && guardar.error.esConflicto ? (
                <Alert
                  tone="warning"
                  role="alert"
                  title="Este cliente cambió mientras lo editabas"
                  action={
                    <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                      Recargar
                    </Button>
                  }
                >
                  <p>
                    Alguien más lo guardó, así que para no pisar su trabajo no se guardó nada.{' '}
                    <strong>Lo que escribiste sigue en pantalla</strong>: anotá lo que haga falta
                    antes de recargar.
                  </p>
                </Alert>
              ) : null}

              <FormularioCliente
                valores={aFormulario(cliente)}
                cuitOriginal={cliente.cuit}
                referencia={cliente.referencia}
                guardando={guardar.isPending}
                errorAlGuardar={
                  guardar.error instanceof FalloDeCliente && guardar.error.esConflicto
                    ? null
                    : (guardar.error?.message ?? null)
                }
                etiquetaGuardar="Guardar cambios"
                vendedores={opciones.vendedores}
                tarifas={opciones.tarifas}
                puedeAsignar={permisos.editarContactos}
                onCambioSucio={setSucio}
                onGuardar={(datos) =>
                  guardar.mutate(
                    { esperado: cliente.actualizadoEn, datos },
                    { onSuccess: () => cerrarEdicion() },
                  )
                }
                onCancelar={() => (sucio ? setConfirmandoDescarte(true) : cerrarEdicion())}
              />
            </DocSection>
          ) : null}

          {pestana === 'informacion' && !editando ? (
            <DocSection title="Datos comerciales">
              <MetaList
                items={[
                  { label: 'Razón social', value: cliente.razonSocial },
                  { label: 'Nombre comercial', value: cliente.nombreComercial ?? <Missing>Sin nombre comercial</Missing> },
                  { label: 'Referencia', value: cliente.referencia ?? <Missing>Sin referencia</Missing> },
                  { label: 'Rubro', value: cliente.rubro ?? <Missing>Sin rubro</Missing> },
                  { label: 'Tipo', value: cliente.tipo === 'business' ? 'Empresa' : 'Persona' },
                  { label: 'Estado', value: cliente.estado === 'active' ? 'Activo' : 'Inactivo' },
                  { label: 'Condición de pago', value: cliente.condicionDePago ?? <Missing>No definida</Missing> },
                  { label: 'Moneda por defecto', value: cliente.monedaPorDefecto ?? <Missing>No definida</Missing> },
                  { label: 'Vendedor asignado', value: cliente.vendedor ?? <Missing>No asignado</Missing> },
                  // Fase 17 · E2: la tarifa del cliente ya se ve y se edita, y
                  // desde ahora sugiere la del documento nuevo. Los documentos
                  // ya emitidos conservan la suya.
                  {
                    label: 'Tarifa por defecto',
                    value: cliente.tarifaNombre ?? <Missing>Sin tarifa</Missing>,
                  },
                  { label: 'Alta', value: formatearFecha(cliente.creadoEn) },
                  cliente.nombreLegacy && cliente.nombreLegacy !== cliente.razonSocial
                    ? { label: 'Nombre en el sistema anterior', value: cliente.nombreLegacy }
                    : null,
                  {
                    label: 'Dominios',
                    wide: true,
                    value:
                      cliente.dominios.length === 0 ? (
                        <Missing>Sin dominios</Missing>
                      ) : (
                        <ul className={styles.listaEnLinea}>
                          {cliente.dominios.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      ),
                  },
                  { label: 'Notas', wide: true, value: cliente.notas ?? <Missing>Sin notas</Missing> },
                ]}
              />
            </DocSection>
          ) : null}

          {pestana === 'contactos' ? (
            <EditorContactos
              clienteId={cliente.id}
              contactos={contactos.data ?? []}
              cargando={contactos.isPending}
              puedeEditar={permisos.editarContactos && !cliente.dadoDeBaja}
              onRecargar={() => void contactos.refetch()}
            />
          ) : null}

          {pestana === 'direcciones' ? (
            <EditorDirecciones
              clienteId={cliente.id}
              direcciones={direcciones}
              cargando={direccionesConsulta.isPending}
              puedeEditar={permisos.editarDirecciones && !cliente.dadoDeBaja}
              onRecargar={() => void direccionesConsulta.refetch()}
            />
          ) : null}

          {pestana === 'productos' ? <PanelProductos clienteId={cliente.id} /> : null}

          {pestana === 'memoria' ? (
            <PanelMemoria clienteId={cliente.id} puedeEditar={permisos.editarMemoria && !cliente.dadoDeBaja} />
          ) : null}

          {pestana === 'precios' ? <PanelPrecios clienteId={cliente.id} /> : null}

          {pestana === 'historial' ? (
            <PanelHistorial
              clienteId={cliente.id}
              documentos={historial.data?.filas ?? []}
              total={historial.data?.total ?? 0}
              pagina={paginaHistorial}
              porPagina={porPaginaHistorial}
              cargando={historial.isPending}
              recargando={historial.isFetching}
              candidatosDeOc={oc.data ?? []}
              onPagina={setPaginaHistorial}
              onTamano={(n: number) => {
                setPorPaginaHistorial(n)
                setPaginaHistorial(1)
              }}
            />
          ) : null}

          {pestana === 'adjuntos' ? (
            <PanelAdjuntos
              clienteId={cliente.id}
              // Un cliente dado de baja se lee, pero no se le sube ni se le
              // borra nada. Es la misma regla que aplica la policy.
              puedeEditar={permisos.editarContactos && !cliente.dadoDeBaja}
            />
          ) : null}

          {pestana === 'trazabilidad' ? <PanelTrazabilidad clienteId={cliente.id} /> : null}
        </TabPanel>
      </div>

      <DialogoCambiosSinGuardar
        open={salida.preguntando}
        onSalir={salida.salir}
        onQuedarse={salida.quedarse}
      />

      <ConfirmDialog
        open={confirmandoDescarte}
        tone="danger"
        title="Hay cambios sin guardar"
        description="Si descartás, se pierde lo que editaste y el cliente vuelve a como estaba."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onCancel={() => setConfirmandoDescarte(false)}
        onConfirm={cerrarEdicion}
      />

      <ConfirmDialog
        open={confirmandoBaja}
        tone="danger"
        title={`¿Dar de baja a ${nombre}?`}
        description="No se borra: deja de ofrecerse al armar documentos nuevos. Sus documentos y su historial siguen accesibles, y se puede reactivar."
        confirmLabel="Dar de baja"
        cancelLabel="Volver"
        busy={baja.dar.isPending}
        onConfirm={() =>
          baja.dar.mutate(undefined, {
            onSuccess: () => setConfirmandoBaja(false),
            onError: () => setConfirmandoBaja(false),
          })
        }
        onCancel={() => setConfirmandoBaja(false)}
      />
    </div>
  )
}
