import styles from './Informes.module.css'

interface Props {
  pagina: number
  porPagina: number
  total: number
  onCambiar: (pagina: number) => void
  cargando?: boolean
}

/** «1–50 de 379» con Anterior / Siguiente. La página es 0-based. */
export function Paginador({ pagina, porPagina, total, onCambiar, cargando = false }: Props) {
  if (total === 0) return null
  const desde = pagina * porPagina + 1
  const hasta = Math.min(total, (pagina + 1) * porPagina)
  return (
    <div className={styles.paginador}>
      <button type="button" className={styles.boton} disabled={pagina === 0 || cargando} onClick={() => onCambiar(pagina - 1)}>
        Anterior
      </button>
      <span className={styles.nota} aria-live="polite">{desde}–{hasta} de {total}</span>
      <button type="button" className={styles.boton} disabled={hasta >= total || cargando} onClick={() => onCambiar(pagina + 1)}>
        Siguiente
      </button>
    </div>
  )
}
