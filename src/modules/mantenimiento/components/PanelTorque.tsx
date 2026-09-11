import { useId, useState } from 'react'
import { formatearNumero, indicadorDeCapacidad } from '../lib/formato'
import { ChipVeredicto } from './ChipEstado'
import type {
  CapacidadTorque,
  DatosMedicion,
  LimitesTorque,
  Medicion,
  OrdenDetalle,
} from '../types'
import styles from './PanelCotizacion.module.css'

export interface PanelTorqueProps {
  orden: OrdenDetalle
  mediciones: readonly Medicion[]
  capacidad: CapacidadTorque | null
  cargando: boolean
  puedeEditar: boolean
  guardando: boolean
  error: string | null
  onLimites: (l: LimitesTorque) => void
  onCrear: (d: DatosMedicion) => Promise<unknown>
  onActualizar: (id: string, d: DatosMedicion) => void
  onBorrar: (id: string) => void
  onCompletar: (fecha: string | null) => void
  onRequerido: (requerido: boolean) => void
}

const aNumero = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}


/**
 * El torque.
 *
 * Lo que define esta pantalla:
 *
 *   · **Ningún indicador se calcula acá.** Cp, Cpk, CV, promedio, desvío y
 *     veredicto salen de `capacidad_torque()`. Tener una segunda
 *     implementación en JavaScript sería la forma más rápida de que dos
 *     números que deberían ser el mismo dejen de serlo.
 *   · **Nunca se muestra NaN ni Infinity.** Con menos de dos mediciones, o con
 *     todas iguales, no hay desvío muestral y Cp/Cpk/CV no existen: se muestra
 *     «N/D».
 *   · **Cargar mediciones tiene que ser rápido.** Una fila, un campo, Enter, y
 *     la siguiente. No es una pantalla de laboratorio: es el taller.
 *   · **«No requerido» es un estado explícito**, no cero mediciones ni un nulo
 *     ambiguo, y queda auditado.
 */
export function PanelTorque({
  orden,
  mediciones,
  capacidad,
  cargando,
  puedeEditar,
  guardando,
  error,
  onLimites,
  onCrear,
  onActualizar,
  onBorrar,
  onCompletar,
  onRequerido,
}: PanelTorqueProps) {
  const id = useId()
  const [lsl, setLsl] = useState(orden.torqueLsl === null ? '' : String(orden.torqueLsl))
  const [nominal, setNominal] = useState(
    orden.torqueNominal === null ? '' : String(orden.torqueNominal),
  )
  const [usl, setUsl] = useState(orden.torqueUsl === null ? '' : String(orden.torqueUsl))
  const [nuevo, setNuevo] = useState('')
  const [errorLocal, setErrorLocal] = useState<string | null>(null)

  // Si los límites cambian desde afuera, reflejarlo. Se ajusta DURANTE el
  // render, no en un efecto.
  const claveLimites = `${orden.torqueLsl}|${orden.torqueNominal}|${orden.torqueUsl}`
  const [clavePrevia, setClavePrevia] = useState(claveLimites)
  if (clavePrevia !== claveLimites) {
    setClavePrevia(claveLimites)
    setLsl(orden.torqueLsl === null ? '' : String(orden.torqueLsl))
    setNominal(orden.torqueNominal === null ? '' : String(orden.torqueNominal))
    setUsl(orden.torqueUsl === null ? '' : String(orden.torqueUsl))
  }

  const abierta = orden.estado === 'open'
  const editable = puedeEditar && abierta
  const requerido = orden.requiereTorque
  const completado = orden.torqueEn !== null

  const guardarLimites = () => {
    const v: LimitesTorque = { lsl: aNumero(lsl), nominal: aNumero(nominal), usl: aNumero(usl) }
    // Un texto que no es número da NaN: no se manda. Que lo rechace la base
    // sería un viaje al servidor para nada, y NaN es justo lo que el CHECK
    // nuevo vino a impedir.
    if ([v.lsl, v.nominal, v.usl].some((x) => x !== null && Number.isNaN(x))) {
      setErrorLocal('Los límites tienen que ser números.')
      return
    }
    setErrorLocal(null)
    onLimites(v)
  }

  const agregar = async () => {
    const v = aNumero(nuevo)
    if (v === null || Number.isNaN(v)) {
      setErrorLocal('Escribí un número para la medición.')
      return
    }
    setErrorLocal(null)
    const siguiente = Math.max(0, ...mediciones.map((m) => m.fila)) + 1
    try {
      await onCrear({ fila: siguiente, valor: v, minimo: null, maximo: null })
      setNuevo('')
    } catch {
      /* el mensaje del servidor ya se muestra arriba */
    }
  }

  /** Fuera de la banda: se marca, no se rechaza. Un valor fuera es un dato. */
  const fuera = (m: Medicion): boolean =>
    m.valor !== null &&
    orden.torqueLsl !== null &&
    orden.torqueUsl !== null &&
    (m.valor < orden.torqueLsl || m.valor > orden.torqueUsl)

  if (!requerido) {
    return (
      <div className={styles.panel}>
        <p className={styles.aviso} role="note">
          <strong>Torque — No requerido.</strong> Esta orden no lleva calibración de torque, así
          que no se le piden mediciones y la etapa se saltea. Quedó registrado en el historial: no
          es lo mismo que una etapa pendiente ni que una sin datos.
        </p>
        {editable ? (
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={guardando}
              onClick={() => onRequerido(true)}
            >
              Marcar el torque como requerido
            </button>
          </div>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      {error || errorLocal ? (
        <p className={styles.error} role="alert">
          {error ?? errorLocal}
        </p>
      ) : null}

      {/* ── Límites ─────────────────────────────────────────────────────── */}
      <div className={styles.formulario}>
        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-lsl`}>
            LCI (límite inferior)
          </label>
          <input
            id={`${id}-lsl`}
            type="text"
            inputMode="decimal"
            className={styles.numero}
            value={lsl}
            disabled={!editable || guardando}
            onChange={(e) => setLsl(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-nom`}>
            Nominal
          </label>
          <input
            id={`${id}-nom`}
            type="text"
            inputMode="decimal"
            className={styles.numero}
            value={nominal}
            disabled={!editable || guardando}
            onChange={(e) => setNominal(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-usl`}>
            LCS (límite superior)
          </label>
          <input
            id={`${id}-usl`}
            type="text"
            inputMode="decimal"
            className={styles.numero}
            value={usl}
            disabled={!editable || guardando}
            onChange={(e) => setUsl(e.target.value)}
          />
        </div>
        {editable ? (
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={guardando}
              onClick={guardarLimites}
            >
              Guardar límites
            </button>
          </div>
        ) : null}
        <p className={`${styles.nota} ${styles.anchoCompleto}`}>
          El nominal tiene que quedar entre el LCI y el LCS: lo exige la base, no esta pantalla.
          Sin los tres límites cargados no hay Cp ni Cpk — no porque falte calcularlos, sino
          porque sin banda de especificación no existen.
        </p>
      </div>

      {/* ── Indicadores ─────────────────────────────────────────────────── */}
      <div className={styles.cabecera}>
        <div>
          <span className={styles.totalEtiqueta}>Veredicto</span>
          <ChipVeredicto veredicto={capacidad?.veredicto ?? null} />
        </div>
        <div>
          <span className={styles.totalEtiqueta}>Cpk</span>
          <span className={styles.total}>{indicadorDeCapacidad(capacidad?.cpk ?? null)}</span>
        </div>
      </div>

      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col" className={styles.derecha}>N</th>
              <th scope="col" className={styles.derecha}>Mínimo</th>
              <th scope="col" className={styles.derecha}>Máximo</th>
              <th scope="col" className={styles.derecha}>Promedio</th>
              <th scope="col" className={styles.derecha}>Desvío</th>
              <th scope="col" className={styles.derecha}>Cp</th>
              <th scope="col" className={styles.derecha}>Cpk</th>
              <th scope="col" className={styles.derecha}>CV</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.derecha}>{capacidad?.mediciones ?? 0}</td>
              <td className={styles.derecha}>
                {indicadorDeCapacidad(
                  mediciones.length === 0
                    ? null
                    : Math.min(...mediciones.flatMap((m) => (m.valor === null ? [] : [m.valor]))),
                )}
              </td>
              <td className={styles.derecha}>
                {indicadorDeCapacidad(
                  mediciones.length === 0
                    ? null
                    : Math.max(...mediciones.flatMap((m) => (m.valor === null ? [] : [m.valor]))),
                )}
              </td>
              <td className={styles.derecha}>{indicadorDeCapacidad(capacidad?.promedio ?? null)}</td>
              <td className={styles.derecha}>{indicadorDeCapacidad(capacidad?.desvio ?? null)}</td>
              <td className={styles.derecha}>{indicadorDeCapacidad(capacidad?.cp ?? null)}</td>
              <td className={styles.derecha}>{indicadorDeCapacidad(capacidad?.cpk ?? null)}</td>
              <td className={styles.derecha}>{indicadorDeCapacidad(capacidad?.cv ?? null, ' %')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className={styles.nota}>
        Los calcula el servidor y no se guardan. Cuando dicen <strong>N/D</strong> es porque no
        existen: con menos de dos mediciones no hay desvío, y con todas iguales el desvío es cero.
      </p>

      {/* ── Mediciones ──────────────────────────────────────────────────── */}
      {cargando ? (
        <p className={styles.nota}>Cargando mediciones…</p>
      ) : mediciones.length === 0 ? (
        <p className={styles.vacio}>Todavía no hay mediciones.</p>
      ) : (
        <ul className={styles.tarjetas}>
          {mediciones.map((m) => (
            <li key={m.id} className={styles.tarjeta}>
              <span className={styles.tarjetaDato}>Medición {m.fila}</span>
              {editable ? (
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.numero}
                  defaultValue={m.valor === null ? '' : String(m.valor)}
                  disabled={guardando}
                  aria-label={`Medición ${m.fila}`}
                  onBlur={(e) => {
                    const v = aNumero(e.target.value)
                    if (v !== null && Number.isNaN(v)) return
                    if (v === m.valor) return
                    onActualizar(m.id, { fila: m.fila, valor: v, minimo: m.minimo, maximo: m.maximo })
                  }}
                />
              ) : (
                <span className={styles.tarjetaTotal}>{formatearNumero(m.valor)}</span>
              )}
              {fuera(m) ? (
                <span className={styles.tarjetaDato}>
                  <strong>Fuera de los límites</strong>
                </span>
              ) : null}
              {editable ? (
                <span className={styles.tarjetaAcciones}>
                  <button
                    type="button"
                    className={styles.mini}
                    disabled={guardando}
                    onClick={() => onBorrar(m.id)}
                  >
                    Quitar
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <div className={styles.acciones}>
          <input
            type="text"
            inputMode="decimal"
            className={styles.numero}
            value={nuevo}
            disabled={guardando}
            placeholder="Valor medido"
            aria-label="Nueva medición"
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              // Enter agrega y deja el foco donde está: cargar diez mediciones
              // no debería costar diez viajes al mouse.
              if (e.key === 'Enter') {
                e.preventDefault()
                void agregar()
              }
            }}
          />
          <button
            type="button"
            className={styles.primario}
            disabled={guardando}
            onClick={() => void agregar()}
          >
            + Agregar medición
          </button>
        </div>
      ) : null}

      {/* ── Completar la etapa ──────────────────────────────────────────── */}
      {editable ? (
        <div className={styles.resolver}>
          <h3 className={styles.etiqueta}>Estado de la etapa</h3>
          {completado ? (
            <>
              <p className={styles.nota}>
                Torque completado el {orden.torqueEn}. Mientras siga así, no se puede quedar sin
                mediciones: la base lo impide.
              </p>
              <div className={styles.acciones}>
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={guardando}
                  onClick={() => onCompletar(null)}
                >
                  Reabrir el torque
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.nota}>
                Dar el torque por completado exige al menos una medición cargada. Es la regla del
                servidor: una etapa «hecha» sin ninguna medición no midió nada.
              </p>
              <div className={styles.acciones}>
                <button
                  type="button"
                  className={styles.primario}
                  disabled={guardando || mediciones.length === 0}
                  onClick={() => onCompletar(new Date().toISOString().slice(0, 10))}
                >
                  Dar el torque por completado
                </button>
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={guardando}
                  onClick={() => onRequerido(false)}
                >
                  Marcar como no requerido
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
