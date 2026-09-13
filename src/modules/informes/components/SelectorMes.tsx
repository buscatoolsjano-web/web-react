import { useMesInformes } from '../hooks/useMesInformes'
import styles from './Informes.module.css'

export function SelectorMes({ etiqueta = 'Mes' }: { etiqueta?: string }) {
  const { mes, tope, cambiarMes } = useMesInformes()
  return (
    <>
      <label className={styles.control}>
        <span className={styles.controlEtiqueta}>{etiqueta}</span>
        <input type="month" className={styles.inputMes} value={mes ?? tope} max={tope} onChange={(e) => cambiarMes(e.target.value)} />
      </label>
      {mes ? (
        <button type="button" className={styles.boton} onClick={() => cambiarMes(tope)}>
          Mes en curso
        </button>
      ) : null}
    </>
  )
}
