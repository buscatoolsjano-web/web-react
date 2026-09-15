import { useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection, MetaList, Missing } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { EditorContactos } from '../components/EditorContactos'
import { EditorDirecciones } from '../components/EditorDirecciones'
import { FormularioCliente } from '../components/FormularioCliente'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelMemoria } from '../components/PanelMemoria'
import { PanelPrecios } from '../components/PanelPrecios'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelResumen } from '../components/PanelResumen'
import { explicarMotivo } from '../lib/motivos'
import { formatearCuit, formatearFecha, nombreVisible } from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import type { DatosCliente } from '../lib/validacion'
import { useCliente, useContactos, useHistorial, useRelacionados } from '../hooks/useClientes'
import {
  useActualizarCliente,
  useBajaCliente,
  useResolverRevision,
} from '../hooks/useEdicionClientes'
import type { ClienteDetalle } from '../types'
import styles from './ClienteDetallePage.module.css'

type Pestana =
  | 'informacion'
  | 'contactos'
  | 'direcciones'
  | 'memoria'
  | 'precios'
  | 'historial'
  | 'relacionados'

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
    notas: c.notas ?? '',
  }
}

/**
 * La ficha del cliente.
 *
 * El legacy tenía cinco pestañas: Información, Contactos, Memoria de
 * productos, Precios e Historial. Están las cinco, más Direcciones —que en el
 * legacy no existían estructuradas— y Relacionados.
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
 *   4. pestañas para lo que tiene contenido propio: datos comerciales,
 *      contactos, direcciones, memoria, precios, historial y relacionados.
 *
 * Los datos de contacto y comerciales se muestran como lista de definiciones
 * (no parecen campos) y un dato faltante se dice («Sin CUIT»), no se deja vacío.
 */
export function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const { data: cliente, isPending, isFetching, error, refetch } = useCliente(id)
  const contactos = useContactos(id)
  const historial = useHistorial(id)
  const relacionados = useRelacionados(id)
  const [pestana, setPestana] = useState<Pestana>('informacion')
  const [editando, setEditando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)
  const idPestanas = useId()

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

  const nombre = nombreVisible(cliente.razonSocial, cliente.nombreComercial)
  const principal = (contactos.data ?? []).find((c) => c.esPrincipal) ?? contactos.data?.[0] ?? null
  const direcciones = relacionados.data?.direcciones ?? []
  const direccionPrincipal = direcciones.find((d) => d.esPrincipal) ?? direcciones[0] ?? null

  const pestanas = [
    { key: 'informacion' as const, label: 'Datos comerciales' },
    { key: 'contactos' as const, label: 'Contactos', count: contactos.data?.length },
    { key: 'direcciones' as const, label: 'Direcciones', count: direcciones.length },
    { key: 'memoria' as const, label: 'Memoria de productos' },
    { key: 'precios' as const, label: 'Precios' },
    { key: 'historial' as const, label: 'Historial', count: historial.data?.length },
    { key: 'relacionados' as const, label: 'Relacionados' },
  ]

  const acciones = editando ? undefined : (
    <>
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
        <Alert tone="warning" title="Este cliente quedó marcado para revisión">
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
                  <Missing>Sin contactos</Missing>
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
              { label: 'CUIT', value: cliente.cuit ? <span className={styles.numero}>{formatearCuit(cliente.cuit)}</span> : <Missing>Sin CUIT</Missing> },
              {
                label: 'Dirección principal',
                wide: true,
                value: relacionados.isPending ? (
                  <Missing>Cargando…</Missing>
                ) : direccionPrincipal ? (
                  direccionPrincipal.texto || <Missing>Sin datos</Missing>
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
              <FormularioCliente
                valores={aFormulario(cliente)}
                cuitOriginal={cliente.cuit}
                referencia={cliente.referencia}
                guardando={guardar.isPending}
                errorAlGuardar={guardar.error?.message ?? null}
                etiquetaGuardar="Guardar cambios"
                onGuardar={(datos) => guardar.mutate(datos, { onSuccess: () => setEditando(false) })}
                onCancelar={() => setEditando(false)}
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
            />
          ) : null}

          {pestana === 'direcciones' ? (
            <EditorDirecciones
              clienteId={cliente.id}
              direcciones={direcciones}
              cargando={relacionados.isPending}
              puedeEditar={permisos.editarDirecciones && !cliente.dadoDeBaja}
            />
          ) : null}

          {pestana === 'memoria' ? (
            <PanelMemoria clienteId={cliente.id} puedeEditar={permisos.editarMemoria && !cliente.dadoDeBaja} />
          ) : null}

          {pestana === 'precios' ? <PanelPrecios clienteId={cliente.id} /> : null}

          {pestana === 'historial' ? (
            <PanelHistorial clienteId={cliente.id} documentos={historial.data ?? []} cargando={historial.isPending} />
          ) : null}

          {pestana === 'relacionados' ? <PanelRelacionados datos={relacionados.data} cargando={relacionados.isPending} /> : null}
        </TabPanel>
      </div>

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
