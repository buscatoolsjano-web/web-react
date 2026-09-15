import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, MetaList, Missing } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { FormularioProveedor } from '../components/FormularioProveedor'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelCompras } from '../components/PanelCompras'
import { PanelHistorial } from '../components/PanelHistorial'
import { explicarMotivo } from '../lib/motivos'
import {
  ETIQUETA_NOMBRE_COMERCIAL,
  etiquetaDeEstado,
  formatearCuit,
  formatearFecha,
  nombreDePais,
  nombreVisible,
} from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import type { DatosProveedor } from '../lib/validacion'
import {
  useComprasDelProveedor,
  useHistorialDeProveedor,
  useProveedor,
} from '../hooks/useProveedores'
import {
  useActualizarProveedor,
  useBajaProveedor,
  useResolverRevisionProveedor,
} from '../hooks/useEdicionProveedores'
import type { ProveedorDetalle } from '../types'
import styles from './ProveedorDetallePage.module.css'

type Pestana = 'informacion' | 'compras' | 'adjuntos' | 'historial'

const ID_PESTANAS = 'ficha-proveedor'
const VOLVER = { to: '/compras/proveedores', label: 'Proveedores' }

function aFormulario(p: ProveedorDetalle): DatosProveedor {
  return {
    razonSocial: p.razonSocial,
    nombreComercial: p.nombreComercial ?? '',
    cuit: p.cuit ?? '',
    email: p.email ?? '',
    telefono: p.telefono ?? '',
    direccion: p.direccion ?? '',
    pais: p.pais ?? '',
    actividad: p.actividad ?? '',
    agente: p.agente ?? '',
    formaPago: p.formaPago ?? '',
    monedaPorDefecto: p.monedaPorDefecto ?? '',
    notas: p.notas ?? '',
  }
}

/**
 * La ficha del proveedor.
 *
 * Cuatro secciones. «Compras relacionadas» está vacía a propósito: el
 * circuito existe en la base desde la entrega 1 pero no tiene pantalla, así
 * que no hay ni un documento. Se dice eso, no se inventan datos ni se muestra
 * un «próximamente».
 *
 * Fase 13 · E6 (deuda de E3): PageHeader, ActionBar, pestañas comunes,
 * MetaList y la baja en un ConfirmDialog (antes, confirmación en línea). Las
 * mismas mutaciones y los mismos permisos.
 */
export function ProveedorDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const { data: proveedor, isPending, error } = useProveedor(id)
  const compras = useComprasDelProveedor(id)
  const historial = useHistorialDeProveedor(id)
  const [pestana, setPestana] = useState<Pestana>('informacion')
  const [editando, setEditando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)

  const guardar = useActualizarProveedor(id ?? '')
  const baja = useBajaProveedor(id ?? '')
  const revision = useResolverRevisionProveedor(id ?? '')

  if (isPending) {
    return (
      <div className={doc.pagina}>
        <SkeletonRows rows={6} columns={3} label="Cargando proveedor…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Proveedor" back={VOLVER} />
        <ErrorState title="No se pudo leer el proveedor." description={error.message} />
      </div>
    )
  }

  if (!proveedor) {
    return (
      <div className={doc.pagina}>
        <EmptyState
          icon="search"
          title="No se encontró el proveedor"
          description="Puede que no exista o que no tengas acceso: Compras es de administradores y empleados."
          action={
            <LinkButton to="/compras/proveedores" variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
              Volver al listado
            </LinkButton>
          }
        />
      </div>
    )
  }

  const falta = (texto: string) => <Missing>{texto}</Missing>
  const cantidadHistorial = historial.data?.length ?? 0
  const pestanas: TabItem<Pestana>[] = [
    { key: 'informacion', label: 'Información' },
    { key: 'compras', label: 'Compras relacionadas' },
    { key: 'adjuntos', label: 'Adjuntos' },
    { key: 'historial', label: 'Historial', count: cantidadHistorial > 0 ? cantidadHistorial : undefined },
  ]

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={VOLVER}
        title={nombreVisible(proveedor.razonSocial)}
        subtitle={proveedor.referencia ?? 'sin referencia'}
        status={
          proveedor.dadoDeBaja || proveedor.esHistorico ? (
            <>
              {proveedor.dadoDeBaja ? (
                <Badge tone="danger" outline>
                  Dado de baja
                </Badge>
              ) : null}
              {proveedor.esHistorico ? <Badge tone="neutral">Migrado del sistema anterior</Badge> : null}
            </>
          ) : undefined
        }
      />

      {!editando && (permisos.editarProveedor || permisos.darDeBaja) ? (
        <ActionBar
          label="Acciones del proveedor"
          secondary={
            <>
              {permisos.editarProveedor && !proveedor.dadoDeBaja ? (
                <Button variant="secondary" icon={<Icon name="edit" size={16} />} onClick={() => setEditando(true)}>
                  Editar
                </Button>
              ) : null}
              {permisos.darDeBaja && proveedor.dadoDeBaja ? (
                <Button variant="secondary" icon={<Icon name="refresh" size={16} />} loading={baja.reactivar.isPending} onClick={() => baja.reactivar.mutate()}>
                  {baja.reactivar.isPending ? 'Reactivando…' : 'Reactivar'}
                </Button>
              ) : null}
            </>
          }
          danger={
            permisos.darDeBaja && !proveedor.dadoDeBaja ? (
              <Button variant="danger" onClick={() => setConfirmandoBaja(true)}>
                Dar de baja
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {proveedor.dadoDeBaja ? (
        <Alert tone="warning" title="Este proveedor está dado de baja">
          <p>
            <strong>No se ofrece</strong> al armar un pedido de compra nuevo. Sus documentos anteriores lo siguen nombrando igual y su ficha sigue accesible.
          </p>
        </Alert>
      ) : null}

      {baja.dar.error || baja.reactivar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo cambiar el estado del proveedor">
          <p>{baja.dar.error?.message ?? baja.reactivar.error?.message}</p>
        </Alert>
      ) : null}

      {proveedor.necesitaRevision ? (
        <Alert
          tone="warning"
          title="Este proveedor quedó marcado para revisión"
          action={
            permisos.resolverRevision ? (
              <Button variant="secondary" size="sm" loading={revision.isPending} onClick={() => revision.mutate()}>
                {revision.isPending ? 'Guardando…' : 'Dar por revisado'}
              </Button>
            ) : undefined
          }
        >
          <ul className={styles.motivos}>
            {proveedor.motivosRevision.map((m) => (
              <li key={m}>{explicarMotivo(m)}</li>
            ))}
          </ul>
          {revision.error ? (
            <p className={styles.error} role="alert">
              {revision.error.message}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div>
        <Tabs id={ID_PESTANAS} label="Secciones de la ficha" items={pestanas} value={pestana} onChange={setPestana} />
        <TabPanel tabsId={ID_PESTANAS} tabKey={pestana} className={styles.panelPestana}>
          {pestana === 'informacion' && editando ? (
            <FormularioProveedor
              valores={aFormulario(proveedor)}
              cuitOriginal={proveedor.cuit}
              referencia={proveedor.referencia}
              guardando={guardar.isPending}
              errorAlGuardar={guardar.error?.message ?? null}
              etiquetaGuardar="Guardar cambios"
              onGuardar={(datos) => guardar.mutate(datos, { onSuccess: () => setEditando(false) })}
              onCancelar={() => setEditando(false)}
            />
          ) : null}

          {pestana === 'informacion' && !editando ? (
            <DocSection title="Datos del proveedor">
              <MetaList
                items={[
                  { label: 'Razón social', value: proveedor.razonSocial },
                  { label: ETIQUETA_NOMBRE_COMERCIAL, value: proveedor.nombreComercial ?? falta('sin dato') },
                  { label: 'Referencia', value: proveedor.referencia ?? falta('sin referencia') },
                  { label: 'CUIT', value: proveedor.cuit ? formatearCuit(proveedor.cuit) : falta('sin CUIT') },
                  { label: 'Teléfono', value: proveedor.telefono ?? falta('sin teléfono') },
                  {
                    label: 'Email',
                    value: proveedor.email ? (
                      <a className={`${styles.enlace} ${styles.enlaceTactil}`} href={`mailto:${proveedor.email}`}>
                        {proveedor.email}
                      </a>
                    ) : (
                      falta('sin email')
                    ),
                  },
                  { label: 'País', value: proveedor.pais ? nombreDePais(proveedor.pais) : falta('sin país') },
                  { label: 'Forma de pago', value: proveedor.formaPago ?? falta('no definida') },
                  { label: 'Moneda por defecto', value: proveedor.monedaPorDefecto ?? falta('no definida') },
                  { label: 'Actividad', value: proveedor.actividad ?? falta('sin actividad') },
                  { label: 'Agente', value: proveedor.agente ?? falta('sin agente') },
                  { label: 'Estado', value: etiquetaDeEstado(proveedor.estado, proveedor.dadoDeBaja) },
                  { label: 'Alta', value: formatearFecha(proveedor.creadoEn) },
                  { label: 'Dirección', value: proveedor.direccion ?? falta('sin dirección'), wide: true },
                  proveedor.notas ? { label: 'Notas', value: <span className={styles.notas}>{proveedor.notas}</span>, wide: true } : null,
                ]}
              />
            </DocSection>
          ) : null}

          {pestana === 'compras' ? <PanelCompras proveedorId={proveedor.id} datos={compras.data} cargando={compras.isPending} /> : null}

          {pestana === 'adjuntos' ? <PanelAdjuntos proveedorId={proveedor.id} puedeEditar={permisos.editarAdjuntos && !proveedor.dadoDeBaja} /> : null}

          {pestana === 'historial' ? (
            <PanelHistorial eventos={historial.data ?? []} cargando={historial.isPending} esHistorico={proveedor.esHistorico} />
          ) : null}
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmandoBaja}
        tone="danger"
        title={`¿Dar de baja ${nombreVisible(proveedor.razonSocial)}?`}
        description="No se va a ofrecer al armar pedidos de compra nuevos. Sus documentos anteriores lo siguen nombrando y se puede reactivar."
        confirmLabel={baja.dar.isPending ? 'Dando de baja…' : 'Confirmar baja'}
        cancelLabel="Cancelar"
        busy={baja.dar.isPending}
        onCancel={() => setConfirmandoBaja(false)}
        onConfirm={() => baja.dar.mutate(undefined, { onSuccess: () => setConfirmandoBaja(false) })}
      />
    </div>
  )
}
