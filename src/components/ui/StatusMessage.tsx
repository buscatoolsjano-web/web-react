import styles from './StatusMessage.module.css'

export type Tono = 'ok' | 'error' | 'pending'

export interface StatusMessageProps {
  tono: Tono
  titulo: string
  detalle?: string
}

const claseDot: Record<Tono, string | undefined> = {
  ok: styles.dotOk,
  error: styles.dotError,
  pending: styles.dotPending,
}

function cx(...clases: (string | undefined | false)[]): string {
  return clases.filter(Boolean).join(' ')
}

export function StatusMessage({ tono, titulo, detalle }: StatusMessageProps) {
  return (
    <div className={cx(styles.box, styles[tono])} role="status">
      <span className={cx(styles.dot, claseDot[tono])} aria-hidden="true" />
      <div>
        <div className={styles.title}>{titulo}</div>
        {detalle && <div className={styles.detail}>{detalle}</div>}
      </div>
    </div>
  )
}
