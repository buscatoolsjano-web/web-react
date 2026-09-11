import { useState } from 'react'
import { etiquetaDeCotizacion, etiquetaDeEtapa, etiquetaDeVeredicto } from '../lib/estados'
import { formatearFecha } from '../lib/formato'
import type { CapacidadTorque, OrdenDetalle, PrecheckCierre } from '../types'
import styles from './PanelCotizacion.module.css'

export interface PanelCierreProps {
  orden: OrdenDetalle
  precheck: PrecheckCierre | null
  capacidad: CapacidadTorque | null
  cargando: boolean
  puedeEditar: boolean
  guardando: boolean
  error: string | null
  onEntrega: (fecha: string | null) => void
  onCerrar: () => void
}

type Marca = 'ok' | 'falta' | 'nr'

const SIMBOLO: Record<Marca, string> = { ok: '✓', falta: '○', nr: '—' }

/**
 * El cierre de la orden.
 *
 * Lo que define esta pantalla:
 *
 *   · **Las doce condiciones no están acá.** Viven en
 *     `app.bloqueos_de_cierre_mant()` y esta pantalla las *pregunta* con
 *     `precheck_cierre_mantenimiento()`. Tener una copia en JavaScript sería
 *     garantizar que algún día digan cosas distintas.
 *   · **El precheck es una comodidad, no la autorización.** El botón vuelve a
 *     pasar por `cerrar_orden_mantenimiento()`, que evalúa la misma lista
 *     dentro de la transacción.
 *   · **Si algo bloquea, se dice cuál.** No un «no se pudo cerrar» genérico:
 *     la lista completa, de una vez, para no descubrirlas de a una.
 */
export function PanelCierre({
  orden,
  precheck,
  capacidad,
  cargando,
  puedeEditar,
  guardando,
  error,
  onEntrega,
  onCerrar,
}: PanelCierreProps) {
  const [confirmando, setConfirmando] = useState(false)
  const [entrega, setEntrega] = useState(orden.fechaEntrega ?? '')

  if (cargando) return <p className={styles.nota}>Revisando qué falta para cerrar…</p>

  if (orden.estado === 'cancelled') {
    return (
      <p className={styles.aviso} role="note">
        <strong>Orden cancelada.</strong> Cancelar no es cerrar: la herramienta entró y se
        devolvió sin trabajo terminado. Una orden cancelada no se cierra ni se reabre.
        {orden.notasCierre ? ` Motivo: ${orden.notasCierre}` : ''}
      </p>
    )
  }

  if (orden.estado === 'closed') {
    return (
      <div className={styles.panel}>
        <p className={styles.nota}>
          <strong>Orden cerrada el {formatearFecha(orden.cerradaEn)}.</strong> Todo lo de esta
          orden quedó congelado: diagnóstico, cotización y sus líneas, reparación, torque,
          mediciones, revisiones y repuestos. No se edita ni se reabre.
        </p>
      </div>
    )
  }

  if (!precheck) return <p className={styles.nota}>Sin datos de cierre.</p>

  const fila = (etiqueta: string, marca: Marca, detalle: string) => (
    <li key={etiqueta} className={styles.punto}>
      <span className={styles.etiqueta}>
        {SIMBOLO[marca]} {etiqueta}
      </span>
      <span className={styles.tarjetaDato}>{detalle}</span>
    </li>
  )

  const marcaTorque: Marca = !precheck.requiereTorque
    ? 'nr'
    : precheck.torqueHecho
      ? 'ok'
      : 'falta'
  const detalleTorque = !precheck.requiereTorque
    ? 'No requerido'
    : precheck.torqueHecho
      ? `${precheck.mediciones} ${precheck.mediciones === 1 ? 'medición' : 'mediciones'}` +
        (capacidad?.veredicto ? ` · ${etiquetaDeVeredicto(capacidad.veredicto)}` : '')
      : 'Pendiente'

  return (
    <div className={styles.panel}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <ul className={styles.tarjetas}>
        {fila('Etapa', precheck.etapa === 'closing' ? 'ok' : 'falta', etiquetaDeEtapa(precheck.etapa))}
        {fila('Diagnóstico', precheck.diagnosticada ? 'ok' : 'falta',
          precheck.diagnosticada ? formatearFecha(orden.diagnosticadaEn) : 'Pendiente')}
        {fila('Cotización', precheck.cotizacion === 'pending' ? 'falta' : 'ok',
          `${etiquetaDeCotizacion(precheck.cotizacion)} · ${precheck.lineas} ${precheck.lineas === 1 ? 'línea' : 'líneas'}`)}
        {fila('Reparación',
          !precheck.requiereReparacion ? 'nr' : precheck.reparada ? 'ok' : 'falta',
          !precheck.requiereReparacion ? 'No requerida'
            : precheck.reparada ? formatearFecha(orden.reparadaEn) : 'Pendiente')}
        {fila('Torque', marcaTorque, detalleTorque)}
        {fila('Repuestos', precheck.repuestosPendientes === 0 ? 'ok' : 'falta',
          `${precheck.repuestosConsumidos} consumidos · ${precheck.repuestosPendientes} sin consumir`)}
        {fila('Entrega', precheck.entregada ? 'ok' : 'falta',
          precheck.entregada ? formatearFecha(precheck.entregada) : 'Falta la fecha')}
      </ul>

      {precheck.enEspera ? (
        <p className={styles.aviso} role="note">
          La orden está <strong>en espera</strong>. No impide cerrarla —la espera no es una de las
          condiciones de cierre— pero conviene reanudarla antes, para que el historial no quede
          diciendo que se cerró una orden pausada.
        </p>
      ) : null}

      {!precheck.entregada && puedeEditar ? (
        <div className={styles.formulario}>
          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor="fecha-entrega">
              Fecha de entrega
            </label>
            <input
              id="fecha-entrega"
              type="date"
              className={styles.control}
              value={entrega}
              disabled={guardando}
              onChange={(e) => setEntrega(e.target.value)}
            />
          </div>
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={guardando || entrega === ''}
              onClick={() => onEntrega(entrega)}
            >
              Guardar la entrega
            </button>
          </div>
          <p className={`${styles.nota} ${styles.anchoCompleto}`}>
            Cerrar es entregar: sin fecha de entrega la orden no cierra, y no puede ser anterior
            al ingreso.
          </p>
        </div>
      ) : null}

      {precheck.bloqueos.length > 0 ? (
        <div className={styles.aviso} role="note">
          <strong>
            Falta{precheck.bloqueos.length === 1 ? '' : 'n'} {precheck.bloqueos.length}{' '}
            {precheck.bloqueos.length === 1 ? 'cosa' : 'cosas'} para poder cerrar:
          </strong>
          <ul className={styles.tarjetas}>
            {precheck.bloqueos.map((b) => (
              <li key={b} className={styles.tarjetaDato}>
                · {b}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.nota}>
          <strong>Lista para cerrar.</strong> Lo comprueba el servidor, y lo vuelve a comprobar al
          apretar el botón.
        </p>
      )}

      {puedeEditar ? (
        <div className={styles.resolver}>
          <p className={styles.nota}>
            Cerrar es <strong>definitivo</strong>: la orden queda congelada entera y en esta
            versión no hay reapertura.
          </p>
          <div className={styles.acciones}>
            {confirmando ? (
              <>
                <button
                  type="button"
                  className={styles.primario}
                  disabled={guardando}
                  onClick={() => {
                    onCerrar()
                    setConfirmando(false)
                  }}
                >
                  {guardando ? 'Cerrando…' : 'Sí, cerrar la orden'}
                </button>
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={guardando}
                  onClick={() => setConfirmando(false)}
                >
                  Volver
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.primario}
                disabled={guardando || !precheck.puedeCerrar}
                onClick={() => setConfirmando(true)}
              >
                Cerrar orden
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
