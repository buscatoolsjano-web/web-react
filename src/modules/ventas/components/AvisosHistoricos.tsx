import { Alert } from '@/components/feedback/Alert'
import { presentarMotivo } from '../lib/estados'
import type { RevisionDeDocumento } from '../services/documentos'
import type { DocumentoDetalle } from '../types'
import styles from './AvisosHistoricos.module.css'

export interface AvisosHistoricosProps {
  documento: DocumentoDetalle
  /**
   * La clasificación del servidor. Mientras no llegó se muestran los motivos
   * históricos tal como están: es lo que se hacía antes, y no promete nada.
   */
  revision: RevisionDeDocumento | undefined
}

/** «sin moneda, sin tipo de cambio» a partir de los códigos del servidor. */
function lista(motivos: readonly string[]): string {
  return motivos.map((m) => presentarMotivo(m).toLowerCase()).join(', ')
}

/**
 * Los avisos que dejó la migración, contrastados con el documento de hoy.
 *
 * Regla de la Fase 4: **el dato histórico no se corrige visualmente**. Si un
 * documento no cierra sus totales, se muestra el total original y se avisa;
 * no se recalcula para que quede lindo. Si el número está fuera de serie, se
 * muestra el número literal y la sospecha aparte, nunca en su lugar.
 *
 * Fase 19 · E4: esa regla no autoriza a repetir como presente algo que el
 * propio dato desmiente. `review_reason` es la foto del día de la migración y
 * se conserva entera; quién decide si un motivo sigue pasando es el servidor
 * —la vista `revision_de_documentos`—, el MISMO que cuenta el inicio y los
 * informes. Acá no se clasifica nada: sólo se elige cómo contarlo.
 *
 * Lo que no se puede comprobar desde el documento **no se declara resuelto**:
 * se muestra como lo que es, algo que sigue pidiendo una mirada.
 */
export function AvisosHistoricos({ documento, revision }: AvisosHistoricosProps) {
  const historicos = revision?.historicos ?? documento.motivosRevision
  const activos = revision ? [...revision.activos, ...revision.noVerificables] : historicos
  const resueltos = revision?.resueltos ?? []
  const hayNumero = documento.numeroFueraDeSerie && documento.numeroSospechado !== null

  if (historicos.length === 0 && !documento.numeroFueraDeSerie) return null

  // Sin nada vigente el documento no tiene un problema HOY: lo que queda es
  // contar de dónde viene, y eso no es una advertencia.
  if (activos.length === 0 && !documento.numeroFueraDeSerie) {
    return (
      <p className={styles.resueltoSolo} data-testid="avisos-historicos-resueltos">
        Durante la migración se marcó para revisión por <strong>{lista(resueltos)}</strong>, pero los
        datos de hoy ya no lo dicen. Sigue en la cola de revisión hasta que alguien lo saque.
      </p>
    )
  }

  return (
    <Alert
      tone="warning"
      title={documento.esHistorico ? 'Documento histórico con observaciones' : 'Documento con observaciones'}
    >
      {activos.length > 0 ? (
        <ul>
          {activos.map((m) => (
            <li key={m}>{presentarMotivo(m)}</li>
          ))}
        </ul>
      ) : null}
      {hayNumero ? (
        <p>
          El número podría ser <strong>{documento.numeroSospechado}</strong>. Es una sospecha
          registrada durante la migración: <strong>el número original no se modificó</strong> y
          sigue siendo el que vale.
        </p>
      ) : null}
      {resueltos.length > 0 ? (
        <p className={styles.resuelto}>
          Durante la migración también se marcó <strong>{lista(resueltos)}</strong>, pero eso ya no
          pasa: los datos de hoy lo desmienten.
        </p>
      ) : null}
    </Alert>
  )
}
