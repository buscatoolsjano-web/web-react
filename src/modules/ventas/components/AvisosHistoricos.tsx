import { Alert } from '@/components/feedback/Alert'
import { presentarMotivo } from '../lib/estados'
import { revisarMotivos } from '../lib/revision'
import type { DocumentoDetalle } from '../types'
import styles from './AvisosHistoricos.module.css'

export interface AvisosHistoricosProps {
  /** El documento entero: los avisos se contrastan con sus propios datos. */
  documento: DocumentoDetalle
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
 * propio dato desmiente. `review_reason` es la foto del día de la migración,
 * y 138 avisos ya no eran ciertos —moneda que ahora está, productos que se
 * resolvieron, totales que cierran, pedidos que sí tienen su cotización—. Lo
 * que ya no pasa se cuenta aparte, y **como pasado**; el documento sigue
 * marcado para revisar hasta que alguien lo saque de la cola.
 */
export function AvisosHistoricos({ documento }: AvisosHistoricosProps) {
  const { vigentes, resueltos } = revisarMotivos(documento)
  const hayNumero = documento.numeroFueraDeSerie && documento.numeroSospechado !== null
  if (vigentes.length === 0 && resueltos.length === 0 && !documento.numeroFueraDeSerie) return null

  // Sin nada vigente el documento no tiene observaciones HOY: lo que queda es
  // contar de dónde viene, y eso no es una advertencia.
  const soloHistoria = vigentes.length === 0 && !documento.numeroFueraDeSerie

  if (soloHistoria) {
    return (
      <p className={styles.resueltoSolo} data-testid="avisos-historicos-resueltos">
        La migración marcó este documento para revisar por{' '}
        <strong>{resueltos.map(presentarMotivo).join(', ').toLowerCase()}</strong>, pero los datos de
        hoy ya no lo dicen. Sigue en la cola de revisión hasta que alguien lo saque.
      </p>
    )
  }

  return (
    <Alert
      tone="warning"
      title={documento.esHistorico ? 'Documento histórico con observaciones' : 'Documento con observaciones'}
    >
      {vigentes.length > 0 ? (
        <ul>
          {vigentes.map((m) => (
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
          La migración también marcó{' '}
          <strong>{resueltos.map(presentarMotivo).join(', ').toLowerCase()}</strong>, pero eso ya no
          pasa: los datos de hoy lo desmienten.
        </p>
      ) : null}
    </Alert>
  )
}
