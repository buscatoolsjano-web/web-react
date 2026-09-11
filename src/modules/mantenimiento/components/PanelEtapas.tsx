import { useState } from 'react'
import {
  ETAPAS,
  etapaSiguiente,
  etapasAnteriores,
  etapasRequeridas,
  etiquetaDeEtapa,
  situacionDeEtapa,
} from '../lib/estados'
import { ChipSituacion } from './ChipEstado'
import type { EtapaOrden, OrdenDetalle } from '../types'
import styles from './PanelEtapas.module.css'

export interface PanelEtapasProps {
  orden: OrdenDetalle
  puedeEditar: boolean
  moviendo: boolean
  guardando: boolean
  error: string | null
  onMover: (etapa: EtapaOrden) => void
  onRequisitos: (cambios: { requiereReparacion?: boolean; requiereTorque?: boolean }) => void
  onEspera: (enEspera: boolean) => void
}

/**
 * El circuito de la orden.
 *
 * Tres reglas, y las tres las impone el servidor:
 *
 *   1. **Adelante se avanza de a una etapa**, salteando sólo las marcadas como
 *      no requeridas. El botón ofrece exactamente la que
 *      `app.validar_etapa_mantenimiento()` va a aceptar; si igual se colara un
 *      salto, el servidor lo rechaza.
 *   2. **Atrás se puede volver a cualquier etapa anterior**, y queda auditado
 *      como `stage_reverted`. Una vuelta atrás es un hecho del taller, no un
 *      error que haya que esconder.
 *   3. **La espera es ortogonal**: pausa el trabajo sin moverlo de etapa.
 *
 * Las etapas salteables se muestran con las tres situaciones distinguidas:
 * pendiente, completada y no requerida. «No requerida» no es «pendiente», y
 * confundirlas era justo lo que había que evitar.
 */
export function PanelEtapas({
  orden,
  puedeEditar,
  moviendo,
  guardando,
  error,
  onMover,
  onRequisitos,
  onEspera,
}: PanelEtapasProps) {
  const [volverA, setVolverA] = useState('')

  const secuencia = etapasRequeridas(orden.requiereReparacion, orden.requiereTorque)
  const siguiente = etapaSiguiente(
    orden.etapa,
    orden.requiereReparacion,
    orden.requiereTorque,
  )
  const anteriores = etapasAnteriores(
    orden.etapa,
    orden.requiereReparacion,
    orden.requiereTorque,
  )
  const indiceActual = secuencia.indexOf(orden.etapa)

  const situacionReparacion = situacionDeEtapa(orden.requiereReparacion, orden.reparadaEn)
  const situacionTorque = situacionDeEtapa(orden.requiereTorque, orden.torqueEn)

  const abierta = orden.estado === 'open'

  return (
    <div className={styles.panel}>
      <ol className={styles.pasos}>
        {ETAPAS.map((e) => {
          const requerida = secuencia.includes(e.valor)
          const posicion = secuencia.indexOf(e.valor)
          const clase = !requerida
            ? styles.pasoSalteado
            : e.valor === orden.etapa
              ? styles.pasoActual
              : styles.paso
          return (
            <li key={e.valor} className={clase}>
              <span className={styles.orden}>
                {requerida ? `${posicion + 1}.` : '—'}
              </span>
              {e.etiqueta}
              {!requerida ? <span className={styles.orden}>no requerida</span> : null}
              {requerida && posicion < indiceActual ? (
                <span className={styles.orden}>hecha</span>
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className={styles.requisitos}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={orden.requiereReparacion}
            disabled={!puedeEditar || !abierta || guardando}
            onChange={(ev) => onRequisitos({ requiereReparacion: ev.target.checked })}
          />
          Requiere reparación <ChipSituacion situacion={situacionReparacion} />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={orden.requiereTorque}
            disabled={!puedeEditar || !abierta || guardando}
            onChange={(ev) => onRequisitos({ requiereTorque: ev.target.checked })}
          />
          Requiere torque <ChipSituacion situacion={situacionTorque} />
        </label>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {!abierta ? (
        <p className={styles.nota}>
          La orden está {orden.estado === 'closed' ? 'cerrada' : 'cancelada'}: no cambia de etapa.
        </p>
      ) : !puedeEditar ? (
        <p className={styles.nota}>
          Tu rol no puede mover esta orden. Mantenimiento es de administradores y empleados.
        </p>
      ) : (
        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.primario}
            disabled={siguiente === null || moviendo}
            onClick={() => siguiente && onMover(siguiente)}
          >
            {siguiente === null
              ? 'Última etapa'
              : `Avanzar a ${etiquetaDeEtapa(siguiente)}`}
          </button>

          {anteriores.length > 0 ? (
            <>
              <select
                className={styles.select}
                value={volverA}
                onChange={(ev) => setVolverA(ev.target.value)}
                aria-label="Volver a una etapa anterior"
              >
                <option value="">Volver a…</option>
                {anteriores.map((e) => (
                  <option key={e} value={e}>
                    {etiquetaDeEtapa(e)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.secundario}
                disabled={volverA === '' || moviendo}
                onClick={() => {
                  if (volverA !== '') onMover(volverA as EtapaOrden)
                  setVolverA('')
                }}
              >
                Volver atrás
              </button>
            </>
          ) : null}

          <button
            type="button"
            className={styles.secundario}
            disabled={guardando}
            onClick={() => onEspera(!orden.enEspera)}
          >
            {orden.enEspera ? 'Reanudar' : 'Poner en espera'}
          </button>
        </div>
      )}

      {orden.enEspera ? (
        <p className={styles.nota}>
          En espera desde {orden.enEsperaDesde?.slice(0, 10) ?? '—'}. La etapa no cambió: la
          espera es un estado aparte.
        </p>
      ) : null}

      {siguiente === null && abierta ? (
        <p className={styles.nota}>
          Está en la última etapa. El cierre de la orden es de la entrega 3 y todavía no está
          habilitado acá.
        </p>
      ) : null}
    </div>
  )
}
