import { presentarMotivo } from '../lib/estados'
import styles from './AvisosHistoricos.module.css'

export interface AvisosHistoricosProps {
  motivos: readonly string[]
  numeroFueraDeSerie: boolean
  numeroSospechado?: string | null
  esHistorico: boolean
}

/**
 * Los avisos que dejó la migración, tal como están.
 *
 * Regla de la Fase 4: **el dato histórico no se corrige visualmente**. Si un
 * documento no cierra sus totales, se muestra el total original y se avisa;
 * no se recalcula para que quede lindo. Si el número está fuera de serie, se
 * muestra el número literal y la sospecha aparte, nunca en su lugar.
 */
export function AvisosHistoricos({
  motivos,
  numeroFueraDeSerie,
  numeroSospechado,
  esHistorico,
}: AvisosHistoricosProps) {
  if (motivos.length === 0 && !numeroFueraDeSerie) return null

  return (
    <div className={styles.caja} role="note">
      <p className={styles.titulo}>
        {esHistorico ? 'Documento histórico con observaciones' : 'Documento con observaciones'}
      </p>
      <ul className={styles.lista}>
        {motivos.map((m) => (
          <li key={m}>{presentarMotivo(m)}</li>
        ))}
      </ul>
      {numeroFueraDeSerie && numeroSospechado ? (
        <p className={styles.sospecha}>
          El número podría ser <strong>{numeroSospechado}</strong>. Es una sospecha registrada
          durante la migración: <strong>el número original no se modificó</strong> y sigue siendo el
          que vale.
        </p>
      ) : null}
    </div>
  )
}
