import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { formatearFecha, formatearFechaHora } from '../lib/formato'
import { etiquetaDeServicio } from '../lib/estados'
import { PanelEtapas } from '../components/PanelEtapas'
import { PanelChecks } from '../components/PanelChecks'
import { PanelCotizacion } from '../components/PanelCotizacion'
import { PanelRepuestos } from '../components/PanelRepuestos'
import { PanelHistorial } from '../components/PanelHistorial'
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
import styles from './Pagina.module.css'

type Pestana = 'trabajo' | 'cotizacion' | 'repuestos' | 'ingreso' | 'historial'

/**
 * La ficha de una orden de servicio.
 *
 * Lo que NO está acá, a propósito, porque es de la entrega 3: el presupuesto
 * con sus líneas, el consumo real de repuestos con su movimiento de stock, la
 * medición de torque y el cierre final. Poner botones que todavía no hacen lo
 * que dicen sería peor que no tenerlos.
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

  if (!permisos.ver) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Orden de servicio</h1>
        <p className={styles.error} role="note">
          Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  if (isPending) return <p className={styles.nota}>Cargando orden…</p>

  if (error) {
    return (
      <div className={styles.page}>
        <p className={styles.error} role="alert">
          No se pudo leer la orden: {error.message}
        </p>
      </div>
    )
  }

  if (!orden) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>Esta orden no existe o no es de la empresa activa.</p>
        <Link to="/mantenimiento/ordenes" className={styles.volver}>
          ← Volver a órdenes
        </Link>
      </div>
    )
  }

  const abierta = orden.estado === 'open'
  const puedeEditar = permisos.editar && abierta

  const dato = (etiqueta: string, valor: string | null, falta = 'sin dato') => (
    <div className={styles.dato} key={etiqueta}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={valor ? styles.datoValor : styles.falta}>{valor ?? falta}</dd>
    </div>
  )

  return (
    <div className={styles.page}>
      <Link to="/mantenimiento/ordenes" className={styles.volver}>
        ← Órdenes
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{orden.numero}</h1>
          <p className={styles.subtitulo}>
            <Link to={`/mantenimiento/activos/${orden.activoId}`} className={styles.enlace}>
              {orden.activoReferencia}
            </Link>
            {orden.activoSerie ? ` · serie ${orden.activoSerie}` : ' · sin serie'}
          </p>
          <div className={styles.chips}>
            <ChipEstadoOrden estado={orden.estado} />
            <ChipEtapa estado={orden.etapa} />
            <ChipEspera enEspera={orden.enEspera} />
            <ChipCotizacion estado={orden.estadoCotizacion} />
          </div>
        </div>

        {puedeEditar ? (
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.peligro}
              onClick={() => setCancelando((v) => !v)}
            >
              {cancelando ? 'No cancelar' : 'Cancelar orden'}
            </button>
          </div>
        ) : null}
      </header>

      {cancelando ? (
        <div className={styles.bloque}>
          <label className={styles.datoEtiqueta} htmlFor="motivo-cancelacion">
            Motivo de la cancelación
          </label>
          <textarea
            id="motivo-cancelacion"
            className={styles.areaDato}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.peligro}
              disabled={acciones.cancelar.isPending}
              onClick={() =>
                acciones.cancelar.mutate(motivo, { onSuccess: () => setCancelando(false) })
              }
            >
              {acciones.cancelar.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
          </div>
          <p className={styles.nota}>
            Cancelar es la salida sin requisitos y no vuelve atrás. Se registra quién la canceló,
            cuándo y con qué motivo.
          </p>
          {acciones.cancelar.error ? (
            <p className={styles.error} role="alert">
              {acciones.cancelar.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <nav className={styles.pestanas}>
        {(
          [
            ['trabajo', 'Trabajo'],
            ['cotizacion', `Cotización (${lineas.data?.length ?? 0})`],
            ['repuestos', `Repuestos (${repuestos.data?.length ?? 0})`],
            ['ingreso', 'Ingreso'],
            ['historial', 'Historial'],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            className={pestana === clave ? styles.pestanaActiva : styles.pestana}
            aria-current={pestana === clave ? 'page' : undefined}
            onClick={() => setPestana(clave)}
          >
            {etiqueta}
          </button>
        ))}
      </nav>

      {pestana === 'trabajo' ? (
        <>
          <div className={styles.bloque}>
            <h2 className={styles.subtitulo}>Etapa</h2>
            <PanelEtapas
              orden={orden}
              puedeEditar={permisos.editar}
              moviendo={acciones.mover.isPending}
              guardando={acciones.guardar.isPending || acciones.espera.isPending}
              error={
                acciones.mover.error?.message ??
                acciones.guardar.error?.message ??
                acciones.espera.error?.message ??
                null
              }
              onMover={(etapa) => acciones.mover.mutate(etapa)}
              onRequisitos={(cambios) => acciones.guardar.mutate(cambios)}
              onEspera={(enEspera) => acciones.espera.mutate(enEspera)}
            />
          </div>

          <div className={styles.bloque}>
            <h2 className={styles.subtitulo}>Puntos de revisión</h2>
            {puntos.isPending || checks.isPending ? (
              <p className={styles.nota}>Cargando revisiones…</p>
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
          </div>

          <div className={styles.bloque}>
            <h2 className={styles.subtitulo}>Todavía no está en esta entrega</h2>
            <p className={styles.nota}>
              La medición de torque y el cierre final de la orden son de la entrega siguiente. El
              esquema ya los soporta; la pantalla todavía no los ofrece. La cotización y los
              repuestos están en sus pestañas.
            </p>
          </div>
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
          onCrear={(d) => cotizacion.crear.mutate(d)}
          onActualizar={(idLinea, d) => cotizacion.actualizar.mutate({ id: idLinea, datos: d })}
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
          onAgregar={(d) => edicionRepuestos.agregar.mutate(d)}
          onBorrar={(idRep) => edicionRepuestos.borrar.mutate(idRep)}
          onConsumir={() => edicionRepuestos.consumir.mutate()}
        />
      ) : null}

      {pestana === 'ingreso' ? (
        <>
          <dl className={styles.datos}>
            {dato('Cliente de la orden', orden.cliente)}
            {dato('Fecha de ingreso', formatearFecha(orden.fechaIngreso))}
            {dato('Tipo de servicio', etiquetaDeServicio(orden.tipoServicio))}
            {dato('Motivo de ingreso', orden.motivoIngreso)}
            {dato('Técnico asignado', orden.tecnico, 'sin asignar')}
            {dato('Recibida por', orden.recibidaPor)}
            {dato('Serie del documento', orden.serie)}
            {dato('Diagnosticada', formatearFechaHora(orden.diagnosticadaEn))}
            {dato('Creada', formatearFechaHora(orden.creadoEn))}
            {dato('Creada por', orden.autor)}
          </dl>

          <div className={styles.bloque}>
            <h2 className={styles.subtitulo}>Cliente congelado</h2>
            <p className={styles.datoValor}>
              <Link to={`/clientes/${orden.clienteId}`} className={styles.enlace}>
                {orden.cliente}
              </Link>
            </p>
            <p className={styles.nota}>
              Es el cliente que tenía el equipo al ingresar. Si después el equipo cambia de dueño,
              esta orden no cambia: lo impide un trigger, no esta pantalla.
            </p>
          </div>

          {orden.condicionVisual ? (
            <div className={styles.bloque}>
              <h2 className={styles.subtitulo}>Condición visual al recibir</h2>
              <p className={styles.notas}>{orden.condicionVisual}</p>
            </div>
          ) : null}

          {orden.notasDiagnostico ? (
            <div className={styles.bloque}>
              <h2 className={styles.subtitulo}>Notas de diagnóstico</h2>
              <p className={styles.notas}>{orden.notasDiagnostico}</p>
            </div>
          ) : null}
        </>
      ) : null}

      {pestana === 'historial' ? (
        <PanelHistorial eventos={historial.data ?? []} cargando={historial.isPending} />
      ) : null}
    </div>
  )
}
