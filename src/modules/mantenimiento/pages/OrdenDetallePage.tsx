import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, MetaList, Missing } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Field } from '@/components/forms/Field'
import { Textarea } from '@/components/forms/controls'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { permisosDe } from '../lib/permisos'
import { formatearFecha, formatearFechaHora } from '../lib/formato'
import { etiquetaDeServicio } from '../lib/estados'
import { PanelEtapas } from '../components/PanelEtapas'
import { PanelChecks } from '../components/PanelChecks'
import { PanelCotizacion } from '../components/PanelCotizacion'
import { PanelRepuestos } from '../components/PanelRepuestos'
import { PanelTorque } from '../components/PanelTorque'
import { PanelCierre } from '../components/PanelCierre'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { ChipCotizacion, ChipEspera, ChipEstadoOrden, ChipEtapa } from '../components/ChipEstado'
import {
  useAccionesOrden,
  useChecks,
  useChecksDeOrden,
  useHistorialDeOrden,
  useOrden,
} from '../hooks/useOrdenes'
import { usePuntos } from '../hooks/useCheckPoints'
import { useAccionesCotizacion, useLineasDeCotizacion } from '../hooks/useCotizacion'
import { useAccionesRepuestos, useDepositos, useRepuestosDeOrden } from '../hooks/useRepuestos'
import { useAccionesTorque, useCapacidad, useMediciones } from '../hooks/useTorque'
import { useAccionesCierre, usePrecheckCierre } from '../hooks/useCierre'
import { CLASES_ORDEN } from '../services/adjuntos'
import styles from './Pagina.module.css'

const ID_PESTANAS = 'orden-servicio'

type Pestana =
  | 'trabajo'
  | 'cotizacion'
  | 'repuestos'
  | 'torque'
  | 'cierre'
  | 'ingreso'
  | 'archivos'
  | 'historial'

/**
 * La ficha de una orden de servicio.
 *
 * Ocho pestañas, y cada una es un momento del trabajo: el circuito de etapas,
 * el presupuesto, los repuestos, el torque, el cierre, los datos de ingreso,
 * los archivos y el historial.
 *
 * La del cierre es la única que consulta al servidor de más, así que su
 * precheck se pide sólo cuando está abierta: preguntar «¿se puede cerrar?» en
 * cada visita a una orden que recién entró al taller sería una consulta por
 * nada.
 *
 * Fase 13 · E5: PageHeader con equipo, cliente y técnico; pestañas comunes
 * (teclado ← → Inicio Fin); la cancelación pide el motivo en un
 * ConfirmDialog. Las mismas mutaciones, con los mismos argumentos.
 */
export function OrdenDetallePage() {
  const { id = '' } = useParams()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  const [pestana, setPestana] = useState<Pestana>('trabajo')
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')

  const { data: orden, isPending, error } = useOrden(id)
  const historial = useHistorialDeOrden(id)
  const checks = useChecksDeOrden(id)
  const puntos = usePuntos(true)
  const acciones = useAccionesOrden(id)
  const edicionChecks = useChecks(id)
  const lineas = useLineasDeCotizacion(id)
  const cotizacion = useAccionesCotizacion(id)
  const repuestos = useRepuestosDeOrden(id)
  const depositos = useDepositos()
  const edicionRepuestos = useAccionesRepuestos(id)
  const mediciones = useMediciones(id)
  const capacidad = useCapacidad(id)
  const torque = useAccionesTorque(id)
  const cierre = useAccionesCierre(id)
  // El precheck se pide sólo al abrir la pestaña de cierre: es una consulta
  // que mira seis tablas y no hace falta en las otras cinco pestañas.
  const precheck = usePrecheckCierre(id, pestana === 'cierre')

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Orden de servicio" back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }} />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className={doc.pagina}>
        <SkeletonRows rows={6} columns={3} label="Cargando orden…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Orden de servicio" back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }} />
        <ErrorState title="No se pudo leer la orden." description={error.message} />
      </div>
    )
  }

  if (!orden) {
    return (
      <div className={doc.pagina}>
        <EmptyState
          icon="search"
          title="Orden no encontrada"
          description="Esta orden no existe o no es de la empresa activa."
          action={
            <LinkButton to="/mantenimiento/ordenes" variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
              Volver a órdenes
            </LinkButton>
          }
        />
      </div>
    )
  }

  const abierta = orden.estado === 'open'
  const puedeEditar = permisos.editar && abierta

  const dato = (etiqueta: string, valor: string | null, falta = 'sin dato') => ({
    label: etiqueta,
    value: valor ?? <Missing>{falta}</Missing>,
  })

  const pestanas: TabItem<Pestana>[] = [
    { key: 'trabajo', label: 'Trabajo' },
    { key: 'cotizacion', label: 'Cotización', count: lineas.data?.length ?? 0 },
    { key: 'repuestos', label: 'Repuestos', count: repuestos.data?.length ?? 0 },
    // Sin torque requerido no hay conteo: «0» diría que faltan mediciones.
    orden.requiereTorque
      ? { key: 'torque', label: 'Torque', count: mediciones.data?.length ?? 0 }
      : { key: 'torque', label: 'Torque (no requerido)' },
    { key: 'cierre', label: 'Cierre' },
    { key: 'ingreso', label: 'Ingreso' },
    { key: 'archivos', label: 'Archivos' },
    { key: 'historial', label: 'Historial' },
  ]

  const cerrarCancelacion = () => {
    if (acciones.cancelar.isPending) return
    setCancelando(false)
  }

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }}
        title={orden.numero}
        subtitle={
          <>
            Equipo{' '}
            <Link to={`/mantenimiento/activos/${orden.activoId}`} className={`${doc.enlace} ${styles.enlaceTactil}`}>
              {orden.activoReferencia}
            </Link>
            {orden.activoSerie ? ` · serie ${orden.activoSerie}` : ' · sin serie'}
            {' · '}
            <Link to={`/clientes/${orden.clienteId}`} className={`${doc.enlace} ${styles.enlaceTactil}`}>
              {orden.cliente}
            </Link>
            {' · '}
            {orden.tecnico ? `Técnico: ${orden.tecnico}` : 'sin técnico asignado'}
          </>
        }
        status={
          <>
            <ChipEstadoOrden estado={orden.estado} />
            <ChipEtapa estado={orden.etapa} />
            <ChipEspera enEspera={orden.enEspera} />
            <ChipCotizacion estado={orden.estadoCotizacion} />
          </>
        }
      />

      {puedeEditar ? (
        <ActionBar
          label="Acciones de la orden"
          danger={
            <Button variant="danger" icon={<Icon name="x" size={16} />} onClick={() => setCancelando(true)}>
              Cancelar orden
            </Button>
          }
        />
      ) : null}

      <div>
        <Tabs id={ID_PESTANAS} label="Secciones de la orden" items={pestanas} value={pestana} onChange={setPestana} />
        <TabPanel tabsId={ID_PESTANAS} tabKey={pestana} className={styles.panelPestana}>
      {pestana === 'trabajo' ? (
        <>
          <DocSection title="Etapa">
            <PanelEtapas
              orden={orden}
              puedeEditar={permisos.editar}
              moviendo={acciones.mover.isPending}
              guardando={
                acciones.guardar.isPending || acciones.espera.isPending ||
                cierre.diagnostico.isPending || cierre.reparacion.isPending
              }
              error={
                acciones.mover.error?.message ??
                acciones.guardar.error?.message ??
                acciones.espera.error?.message ??
                cierre.diagnostico.error?.message ??
                cierre.reparacion.error?.message ??
                null
              }
              onMover={(etapa) => acciones.mover.mutate(etapa)}
              onRequisitos={(cambios) => acciones.guardar.mutate(cambios)}
              onEspera={(enEspera) => acciones.espera.mutate(enEspera)}
              onDiagnostico={(d) => cierre.diagnostico.mutate(d)}
              onReparacion={(d) => cierre.reparacion.mutate(d)}
            />
          </DocSection>

          <DocSection title="Puntos de revisión">
            {puntos.isPending || checks.isPending ? (
              <SkeletonRows rows={4} columns={3} label="Cargando revisiones…" />
            ) : (
              <PanelChecks
                puntos={puntos.data ?? []}
                checks={checks.data ?? []}
                requiereReparacion={orden.requiereReparacion}
                puedeEditar={puedeEditar}
                guardando={edicionChecks.marcar.isPending || edicionChecks.borrar.isPending}
                error={
                  edicionChecks.marcar.error?.message ??
                  edicionChecks.borrar.error?.message ??
                  puntos.error?.message ??
                  checks.error?.message ??
                  null
                }
                onMarcar={(puntoId, fase, resultado) =>
                  edicionChecks.marcar.mutate({ puntoId, fase, resultado })
                }
                onBorrar={(checkId) => edicionChecks.borrar.mutate(checkId)}
              />
            )}
          </DocSection>
        </>
      ) : null}

      {pestana === 'cotizacion' ? (
        <PanelCotizacion
          orden={orden}
          lineas={lineas.data ?? []}
          cargando={lineas.isPending}
          puedeEditar={permisos.editar}
          guardando={
            cotizacion.crear.isPending ||
            cotizacion.actualizar.isPending ||
            cotizacion.borrar.isPending ||
            cotizacion.mover.isPending ||
            cotizacion.moneda.isPending ||
            cotizacion.aprobar.isPending ||
            cotizacion.rechazar.isPending
          }
          error={
            lineas.error?.message ??
            cotizacion.crear.error?.message ??
            cotizacion.actualizar.error?.message ??
            cotizacion.borrar.error?.message ??
            cotizacion.mover.error?.message ??
            cotizacion.moneda.error?.message ??
            cotizacion.aprobar.error?.message ??
            cotizacion.rechazar.error?.message ??
            null
          }
          onCrear={(d) => cotizacion.crear.mutateAsync(d)}
          onActualizar={(idLinea, d) => cotizacion.actualizar.mutateAsync({ id: idLinea, datos: d })}
          onBorrar={(idLinea) => cotizacion.borrar.mutate(idLinea)}
          onMover={(a, b) => cotizacion.mover.mutate({ a, b })}
          onMoneda={(m) => cotizacion.moneda.mutate(m)}
          onAprobar={(porQuien) => cotizacion.aprobar.mutate(porQuien)}
          onRechazar={(motivoTexto) => cotizacion.rechazar.mutate(motivoTexto)}
        />
      ) : null}

      {pestana === 'repuestos' ? (
        <PanelRepuestos
          repuestos={repuestos.data ?? []}
          depositos={depositos.data ?? []}
          cargando={repuestos.isPending || depositos.isPending}
          puedeEditar={puedeEditar}
          guardando={
            edicionRepuestos.agregar.isPending ||
            edicionRepuestos.actualizar.isPending ||
            edicionRepuestos.borrar.isPending
          }
          consumiendo={edicionRepuestos.consumir.isPending}
          error={
            repuestos.error?.message ??
            depositos.error?.message ??
            edicionRepuestos.agregar.error?.message ??
            edicionRepuestos.actualizar.error?.message ??
            edicionRepuestos.borrar.error?.message ??
            edicionRepuestos.consumir.error?.message ??
            null
          }
          onAgregar={(d) => edicionRepuestos.agregar.mutateAsync(d)}
          onBorrar={(idRep) => edicionRepuestos.borrar.mutate(idRep)}
          onConsumir={() => edicionRepuestos.consumir.mutate()}
        />
      ) : null}

      {pestana === 'torque' ? (
        <PanelTorque
          orden={orden}
          mediciones={mediciones.data ?? []}
          capacidad={capacidad.data ?? null}
          cargando={mediciones.isPending}
          puedeEditar={permisos.editar}
          guardando={
            torque.crear.isPending || torque.actualizar.isPending || torque.borrar.isPending ||
            torque.limites.isPending || torque.completar.isPending || acciones.guardar.isPending
          }
          error={
            mediciones.error?.message ?? capacidad.error?.message ??
            torque.crear.error?.message ?? torque.actualizar.error?.message ??
            torque.borrar.error?.message ?? torque.limites.error?.message ??
            torque.completar.error?.message ?? acciones.guardar.error?.message ?? null
          }
          onLimites={(l) => torque.limites.mutate(l)}
          onCrear={(d) => torque.crear.mutateAsync(d)}
          onActualizar={(idMed, d) => torque.actualizar.mutate({ id: idMed, datos: d })}
          onBorrar={(idMed) => torque.borrar.mutate(idMed)}
          onCompletar={(fecha) => torque.completar.mutate(fecha)}
          onRequerido={(req) => acciones.guardar.mutate({ requiereTorque: req })}
        />
      ) : null}

      {pestana === 'cierre' ? (
        <PanelCierre
          orden={orden}
          precheck={precheck.data ?? null}
          capacidad={capacidad.data ?? null}
          cargando={precheck.isPending && orden.estado === 'open'}
          puedeEditar={puedeEditar}
          guardando={cierre.entrega.isPending || cierre.cerrar.isPending}
          error={
            precheck.error?.message ?? cierre.entrega.error?.message ??
            cierre.cerrar.error?.message ?? null
          }
          onEntrega={(fecha) => cierre.entrega.mutate(fecha)}
          onCerrar={() => cierre.cerrar.mutate()}
        />
      ) : null}

      {pestana === 'ingreso' ? (
        <>
          <DocSection title="Datos de ingreso">
            <MetaList
              items={[
                dato('Cliente de la orden', orden.cliente),
                dato('Fecha de ingreso', formatearFecha(orden.fechaIngreso)),
                dato('Tipo de servicio', etiquetaDeServicio(orden.tipoServicio)),
                dato('Motivo de ingreso', orden.motivoIngreso),
                dato('Técnico asignado', orden.tecnico, 'sin asignar'),
                dato('Recibida por', orden.recibidaPor),
                dato('Serie del documento', orden.serie),
                dato('Diagnosticada', formatearFechaHora(orden.diagnosticadaEn)),
                dato('Creada', formatearFechaHora(orden.creadoEn)),
                dato('Creada por', orden.autor),
              ]}
            />
          </DocSection>

          <DocSection title="Cliente congelado">
            <p className={styles.datoValor}>
              <Link to={`/clientes/${orden.clienteId}`} className={`${doc.enlace} ${styles.enlaceTactil}`}>
                {orden.cliente}
              </Link>
            </p>
            <p className={styles.nota}>
              Es el cliente que tenía el equipo al ingresar. Si después el equipo cambia de dueño,
              esta orden no cambia: lo impide un trigger, no esta pantalla.
            </p>
          </DocSection>

          {orden.condicionVisual ? (
            <DocSection title="Condición visual al recibir">
              <p className={styles.notas}>{orden.condicionVisual}</p>
            </DocSection>
          ) : null}

          {orden.notasDiagnostico ? (
            <DocSection title="Notas de diagnóstico">
              <p className={styles.notas}>{orden.notasDiagnostico}</p>
            </DocSection>
          ) : null}
        </>
      ) : null}

      {pestana === 'archivos' ? (
        <PanelAdjuntos
          entidad="maintenance_order"
          entidadId={id}
          clases={CLASES_ORDEN}
          puedeEditar={permisos.editar}
        />
      ) : null}

      {pestana === 'historial' ? (
        <PanelHistorial eventos={historial.data ?? []} cargando={historial.isPending} />
      ) : null}
        </TabPanel>
      </div>

      <ConfirmDialog
        open={cancelando}
        tone="danger"
        title={`¿Cancelar la orden ${orden.numero}?`}
        description="Cancelar es la salida sin requisitos y no vuelve atrás. Se registra quién la canceló, cuándo y con qué motivo."
        confirmLabel={acciones.cancelar.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
        cancelLabel="No cancelar"
        busy={acciones.cancelar.isPending}
        onCancel={cerrarCancelacion}
        onConfirm={() => acciones.cancelar.mutate(motivo, { onSuccess: () => setCancelando(false) })}
      >
        <Field label="Motivo de la cancelación" id="motivo-cancelacion">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
        </Field>
        {acciones.cancelar.error ? (
          <Alert tone="danger" role="alert" title="No se pudo cancelar">
            <p>{acciones.cancelar.error.message}</p>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
