import { Alert } from '@/components/feedback/Alert'
import { presentarMotivo } from '../lib/estados'

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
    <Alert tone="warning" title={esHistorico ? 'Documento histórico con observaciones' : 'Documento con observaciones'}>
      {motivos.length > 0 ? (
        <ul>
          {motivos.map((m) => (
            <li key={m}>{presentarMotivo(m)}</li>
          ))}
        </ul>
      ) : null}
      {numeroFueraDeSerie && numeroSospechado ? (
        <p>
          El número podría ser <strong>{numeroSospechado}</strong>. Es una sospecha registrada
          durante la migración: <strong>el número original no se modificó</strong> y sigue siendo el
          que vale.
        </p>
      ) : null}
    </Alert>
  )
}
