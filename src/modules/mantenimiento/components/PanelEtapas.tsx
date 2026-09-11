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
  onDiagnostico: (d: { notas?: string | null; completadoEn?: string | null }) => void
  onReparacion: (d: { notas?: string | null; completadaEn?: string | null }) => void
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
  onDiagnostico,
  onReparacion,
}: PanelEtapasProps) {
  const [volverA, setVolverA] = useState('')
  const [confirmandoVuelta, setConfirmandoVuelta] = useState(false)
  const [notasDiag, setNotasDiag] = useState(orden.notasDiagnostico ?? '')
  const [notasRep, setNotasRep] = useState(orden.notasReparacion ?? '')

  // Si las notas cambian desde afuera se reflejan. Se ajusta DURANTE el render
  // y no en un efecto: llamar a setState dentro de un efecto provoca un render
  // en cascada.
  const claveNotas = `${orden.notasDiagnostico}|${orden.notasReparacion}`
  const [clavePrevia, setClavePrevia] = useState(claveNotas)
  if (clavePrevia !== claveNotas) {
    setClavePrevia(claveNotas)
    setNotasDiag(orden.notasDiagnostico ?? '')
    setNotasRep(orden.notasReparacion ?? '')
  }

  const HOY = new Date().toISOString().slice(0, 10)

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
              {/* Completada, pendiente o no requerida. El símbolo nunca va
                  solo: cada uno lleva su palabra al lado, porque un tilde y un
                  guion son indistinguibles para quien no conoce la convención. */}
              <span className={styles.orden} aria-hidden="true">
                {!requerida ? '—' : posicion < indiceActual ? '✓' : '○'}
              </span>
              {e.etiqueta}
              {!requerida ? (
                <span className={styles.orden}>no requerida</span>
              ) : posicion < indiceActual ? (
                <span className={styles.orden}>completada</span>
              ) : e.valor === orden.etapa ? (
                <span className={styles.orden}>en curso</span>
              ) : (
                <span className={styles.orden}>pendiente</span>
              )}
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
              {confirmandoVuelta ? (
                <>
                  <button
                    type="button"
                    className={styles.secundario}
                    disabled={moviendo}
                    onClick={() => {
                      if (volverA !== '') onMover(volverA as EtapaOrden)
                      setVolverA('')
                      setConfirmandoVuelta(false)
                    }}
                  >
                    Sí, volver a {volverA === '' ? '' : etiquetaDeEtapa(volverA)}
                  </button>
                  <button
                    type="button"
                    className={styles.secundario}
                    disabled={moviendo}
                    onClick={() => setConfirmandoVuelta(false)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={volverA === '' || moviendo}
                  onClick={() => setConfirmandoVuelta(true)}
                >
                  Volver atrás
                </button>
              )}
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

      {abierta && puedeEditar && orden.etapa === 'diagnosis' ? (
        <div className={styles.panel}>
          <label className={styles.nota} htmlFor="notas-diagnostico">
            Notas de diagnóstico
          </label>
          <textarea
            id="notas-diagnostico"
            className={styles.select}
            rows={3}
            value={notasDiag}
            disabled={guardando}
            onChange={(ev) => setNotasDiag(ev.target.value)}
          />
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={guardando}
              onClick={() => onDiagnostico({ notas: notasDiag })}
            >
              Guardar notas
            </button>
            {orden.diagnosticadaEn === null ? (
              <button
                type="button"
                className={styles.primario}
                disabled={guardando}
                onClick={() => onDiagnostico({ notas: notasDiag, completadoEn: HOY })}
              >
                Dar el diagnóstico por completado
              </button>
            ) : (
              <span className={styles.nota}>
                Diagnóstico completado el {orden.diagnosticadaEn}.
              </span>
            )}
          </div>
        </div>
      ) : null}

      {abierta && puedeEditar && orden.etapa === 'repair' && orden.requiereReparacion ? (
        <div className={styles.panel}>
          <label className={styles.nota} htmlFor="notas-reparacion">
            Notas de reparación
          </label>
          <textarea
            id="notas-reparacion"
            className={styles.select}
            rows={3}
            value={notasRep}
            disabled={guardando}
            onChange={(ev) => setNotasRep(ev.target.value)}
          />
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={guardando}
              onClick={() => onReparacion({ notas: notasRep })}
            >
              Guardar notas
            </button>
            {orden.reparadaEn === null ? (
              <button
                type="button"
                className={styles.primario}
                disabled={guardando}
                onClick={() => onReparacion({ notas: notasRep, completadaEn: HOY })}
              >
                Dar la reparación por completada
              </button>
            ) : (
              <span className={styles.nota}>Reparación completada el {orden.reparadaEn}.</span>
            )}
          </div>
          <p className={styles.nota}>
            Dar la reparación por completada <strong>no consume ningún repuesto</strong>: lo que se
            usó y lo que se descuenta del depósito son dos cosas distintas, y el consumo se
            confirma en su propia pestaña.
          </p>
        </div>
      ) : null}

      {orden.enEspera ? (
        <p className={styles.nota}>
          En espera desde {orden.enEsperaDesde?.slice(0, 10) ?? '—'}. La etapa no cambió: la
          espera es un estado aparte.
        </p>
      ) : null}

      {siguiente === null && abierta ? (
        <p className={styles.nota}>
          Está en la última etapa. La orden se cierra desde la pestaña «Cierre», que dice
          qué falta antes de dejar cerrarla.
        </p>
      ) : null}
    </div>
  )
}
