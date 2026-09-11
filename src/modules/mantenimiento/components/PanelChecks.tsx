import { Link } from 'react-router-dom'
import { etiquetaDeResultado } from '../lib/estados'
import type { CheckDeOrden, FaseCheck, PuntoDeRevision, ResultadoCheck } from '../types'
import styles from './PanelChecks.module.css'

export interface PanelChecksProps {
  puntos: readonly PuntoDeRevision[]
  checks: readonly CheckDeOrden[]
  /** La fase de reparación sólo existe si la orden la requiere. */
  requiereReparacion: boolean
  puedeEditar: boolean
  guardando: boolean
  error: string | null
  onMarcar: (puntoId: string, fase: FaseCheck, resultado: ResultadoCheck) => void
  onBorrar: (id: string) => void
}

const RESULTADOS: ResultadoCheck[] = ['ok', 'nok', 'na']

const FASES: { valor: FaseCheck; etiqueta: string }[] = [
  { valor: 'diagnosis', etiqueta: 'Al diagnosticar' },
  { valor: 'repair', etiqueta: 'Al reparar' },
]

/**
 * Las revisiones de la orden, punto por punto.
 *
 * **No es un blob JSON.** El legacy guardaba `diagnosticoPartes: {rotor:"NOK",
 * cabezal:"NOK", …}` dentro de la ficha, así que no se podía preguntar
 * «cuántos rotores fallaron este mes» sin abrir cada orden. Acá cada marca es
 * una fila de `maintenance_order_checks` con su punto, su fase y su resultado.
 *
 * Los puntos son configurables por empresa: los ocho que vienen sembrados
 * salen de las partes que revisa el legacy, pero no están escritos en el
 * código. Si una empresa revisa otra cosa se configura, no se migra.
 *
 * Las dos fases son el mismo punto en dos momentos distintos: qué se encontró
 * al diagnosticar y cómo quedó al reparar. Volver a marcar corrige el valor —
 * es un upsert sobre `(orden, punto, fase)`— en vez de acumular filas.
 */
export function PanelChecks({
  puntos,
  checks,
  requiereReparacion,
  puedeEditar,
  guardando,
  error,
  onMarcar,
  onBorrar,
}: PanelChecksProps) {
  if (puntos.length === 0) {
    return (
      <p className={styles.nota}>
        Esta empresa no tiene puntos de revisión configurados.{' '}
        <Link to="/mantenimiento/puntos">Configurarlos</Link>.
      </p>
    )
  }

  const fases = requiereReparacion ? FASES : FASES.filter((f) => f.valor === 'diagnosis')
  const buscar = (puntoId: string, fase: FaseCheck) =>
    checks.find((c) => c.puntoId === puntoId && c.fase === fase) ?? null

  return (
    <div className={styles.panel}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.fases}>
        {fases.map((f) => {
          const marcados = puntos.filter((p) => buscar(p.id, f.valor) !== null).length
          return (
            <section key={f.valor} className={styles.fase}>
              <h3 className={styles.tituloFase}>{f.etiqueta}</h3>
              <ul className={styles.lista}>
                {puntos.map((p) => {
                  const marca = buscar(p.id, f.valor)
                  return (
                    <li key={p.id} className={styles.punto}>
                      <span className={styles.etiqueta}>{p.etiqueta}</span>
                      <span
                        className={styles.opciones}
                        role="group"
                        aria-label={`${p.etiqueta} · ${f.etiqueta}`}
                      >
                        {RESULTADOS.map((r) => {
                          const elegida = marca?.resultado === r
                          const clase = !elegida
                            ? styles.opcion
                            : r === 'ok'
                              ? styles.elegidaOk
                              : r === 'nok'
                                ? styles.elegidaNok
                                : styles.elegidaNa
                          return (
                            <button
                              key={r}
                              type="button"
                              className={clase}
                              aria-pressed={elegida}
                              disabled={!puedeEditar || guardando}
                              onClick={() => {
                                // Volver a tocar la opción ya elegida la
                                // desmarca: «no revisado» tiene que poder
                                // volver a ser el estado, y no es lo mismo
                                // que «N/A».
                                if (elegida && marca) onBorrar(marca.id)
                                else onMarcar(p.id, f.valor, r)
                              }}
                            >
                              {etiquetaDeResultado(r)}
                            </button>
                          )
                        })}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className={styles.resumen}>
                {marcados} de {puntos.length} revisados
              </p>
            </section>
          )
        })}
      </div>

      {!requiereReparacion ? (
        <p className={styles.resumen}>
          La reparación está marcada como no requerida, así que su revisión no se pide.
        </p>
      ) : null}
    </div>
  )
}
