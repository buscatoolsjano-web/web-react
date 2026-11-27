import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/feedback/Alert'
import { Dialog } from '@/components/modals/Dialog'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatearPrecio } from '@/modules/catalogo/lib/formato'
import {
  guardarLimites,
  panelDistribuidores,
  suspenderDistribuidor,
  type FilaPanelDistribuidor,
} from '@/modules/catalogo/services/compartido'
import styles from './PanelDistribuidores.module.css'

/**
 * El panel de distribuidores (2026-11-27) — Fase 5.
 *
 * Una fila por distribuidor: cuánto usa el sistema, qué le pidió a esta
 * empresa, y los controles —límites, suspender el acceso, configurar su
 * catálogo—. Sólo administradores generales; la base lo vuelve a exigir.
 */
export function PanelDistribuidores({
  ownerId,
  moneda,
  onConfigurar,
}: {
  ownerId: string
  moneda: string | null
  onConfigurar: (companyId: string) => void
}) {
  const clave = ['config', ownerId, 'panel-distribuidores'] as const
  const panel = useQuery({ queryKey: clave, queryFn: () => panelDistribuidores(ownerId) })
  const [limites, setLimites] = useState<FilaPanelDistribuidor | null>(null)
  const [suspendiendo, setSuspendiendo] = useState<FilaPanelDistribuidor | null>(null)
  const qc = useQueryClient()
  const refrescar = () => qc.invalidateQueries({ queryKey: clave })

  const suspender = useMutation({
    mutationFn: (f: FilaPanelDistribuidor) => suspenderDistribuidor(f.id, f.usuariosActivos > 0),
    onSuccess: () => {
      setSuspendiendo(null)
      void refrescar()
    },
  })

  if (panel.isPending) return <SkeletonRows rows={3} columns={6} label="Cargando distribuidores…" />
  if (panel.error) return <Alert tone="danger" title="No se pudo cargar el panel">{panel.error.message}</Alert>
  const filas = panel.data ?? []
  if (filas.length === 0) return null

  return (
    <section className={styles.panel} aria-label="Panel de distribuidores">
      <div className={styles.tablaScroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th>Distribuidor</th>
              <th>Usuarios</th>
              <th>Cotizaciones del mes</th>
              <th>Aceptadas</th>
              <th>Pedidos</th>
              <th>Monto pedido</th>
              <th>Última actividad</th>
              <th>Catálogo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const suspendido = f.usuariosActivos === 0 && f.usuariosSuspendidos > 0
              return (
                <tr key={f.id}>
                  <td>
                    <strong>{f.nombre}</strong>
                    <span className={styles.chico}>
                      {f.moneda}
                      {suspendido ? ' · acceso suspendido' : ''}
                    </span>
                  </td>
                  <td>
                    {f.usuariosActivos}
                    {f.limiteUsuarios ? <span className={styles.chico}> de {f.limiteUsuarios}</span> : null}
                  </td>
                  <td>
                    {f.cotizacionesMes}
                    {f.limiteCotizacionesMes ? <span className={styles.chico}> de {f.limiteCotizacionesMes}</span> : null}
                    <span className={styles.chico}>{f.cotizaciones} en total</span>
                  </td>
                  <td>{f.aceptadas}</td>
                  <td>
                    {f.pedidos}
                    {f.pedidosPendientes > 0 ? (
                      <span className={styles.aviso}>{f.pedidosPendientes} a confirmar</span>
                    ) : null}
                  </td>
                  <td>{f.montoPedidos > 0 ? formatearPrecio(f.montoPedidos, moneda) : '—'}</td>
                  <td>{f.ultimaActividad ? new Date(f.ultimaActividad).toLocaleDateString('es-AR') : '—'}</td>
                  <td>
                    {f.compartido
                      ? f.compartido.activo
                        ? `Compartido · −${f.compartido.descuento} %`
                        : 'Pausado'
                      : 'Sin compartir'}
                  </td>
                  <td className={styles.acciones}>
                    <Button size="sm" variant="secondary" onClick={() => onConfigurar(f.id)}>
                      Catálogo
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setLimites(f)}>
                      Límites
                    </Button>
                    {f.usuariosActivos + f.usuariosSuspendidos > 0 ? (
                      <Button size="sm" variant={suspendido ? 'secondary' : 'ghost'} onClick={() => setSuspendiendo(f)}>
                        {suspendido ? 'Reactivar' : 'Suspender'}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {limites ? <DialogoLimites fila={limites} onCerrar={() => setLimites(null)} onGuardado={() => void refrescar()} /> : null}

      <ConfirmDialog
        open={suspendiendo !== null}
        tone={suspendiendo && suspendiendo.usuariosActivos > 0 ? 'danger' : 'default'}
        title={
          suspendiendo && suspendiendo.usuariosActivos > 0
            ? `¿Suspender el acceso de ${suspendiendo.nombre}?`
            : `¿Reactivar el acceso de ${suspendiendo?.nombre ?? ''}?`
        }
        description={
          suspendiendo && suspendiendo.usuariosActivos > 0
            ? 'Sus usuarios dejan de poder entrar ya mismo. Sus datos quedan guardados y se reactiva cuando quieras.'
            : 'Sus usuarios vuelven a entrar con su cuenta de siempre.'
        }
        confirmLabel={suspendiendo && suspendiendo.usuariosActivos > 0 ? 'Suspender' : 'Reactivar'}
        busy={suspender.isPending}
        onConfirm={() => suspendiendo && suspender.mutate(suspendiendo)}
        onCancel={() => setSuspendiendo(null)}
      >
        {suspender.error ? <p role="alert">{suspender.error.message}</p> : null}
      </ConfirmDialog>
    </section>
  )
}

function DialogoLimites({
  fila,
  onCerrar,
  onGuardado,
}: {
  fila: FilaPanelDistribuidor
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [usuarios, setUsuarios] = useState(fila.limiteUsuarios?.toString() ?? '')
  const [cotizaciones, setCotizaciones] = useState(fila.limiteCotizacionesMes?.toString() ?? '')
  const leer = (t: string) => (t.trim() === '' ? null : Number(t))
  const guardar = useMutation({
    mutationFn: () => {
      const u = leer(usuarios)
      const c = leer(cotizaciones)
      if ((u !== null && !Number.isInteger(u)) || (c !== null && !Number.isInteger(c))) {
        throw new Error('Usá números enteros (o dejalo vacío para no limitar).')
      }
      return guardarLimites(fila.id, u, c)
    },
    onSuccess: () => {
      onGuardado()
      onCerrar()
    },
  })
  return (
    <Dialog
      open
      onClose={onCerrar}
      busy={guardar.isPending}
      title={`Límites de ${fila.nombre}`}
      description="Vacío = sin límite. La base los hace cumplir: al llegar al tope no puede sumar usuarios ni crear cotizaciones."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button loading={guardar.isPending} onClick={() => guardar.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.limites}>
        <Field label="Usuarios activos (máximo)" help={`Hoy tiene ${fila.usuariosActivos}.`}>
          <Input inputMode="numeric" value={usuarios} onChange={(e) => setUsuarios(e.target.value)} placeholder="Sin límite" />
        </Field>
        <Field label="Cotizaciones por mes (máximo)" help={`Este mes lleva ${fila.cotizacionesMes}.`}>
          <Input inputMode="numeric" value={cotizaciones} onChange={(e) => setCotizaciones(e.target.value)} placeholder="Sin límite" />
        </Field>
        {guardar.error ? (
          <Alert tone="danger" title="No se guardó">
            {guardar.error.message}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  )
}
