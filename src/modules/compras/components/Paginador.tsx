import { rangoVisible, totalDePaginas } from '../lib/formato'
import { TAMANOS_DE_PAGINA } from '../hooks/useFiltrosProveedores'
import styles from './Paginador.module.css'

export interface PaginadorProps {
  pagina: number
  porPagina: number
  total: number
  cargando?: boolean
  onIr: (pagina: number) => void
  onTamano: (porPagina: number) => void
}

/** Paginado real: cada página es un request acotado. */
export function Paginador({
  pagina,
  porPagina,
  total,
  cargando = false,
  onIr,
  onTamano,
}: PaginadorProps) {
  const paginas = totalDePaginas(total, porPagina)

  return (
    <nav className={styles.wrap} aria-label="Paginación">
      <span className={styles.rango} aria-live="polite">
        {cargando ? 'Cargando…' : rangoVisible(pagina, porPagina, total)}
      </span>

      <label className={styles.tamano}>
        <span className={styles.tamanoLabel}>Por página</span>
        <select
          className={styles.select}
          value={porPagina}
          onChange={(e) => onTamano(Number(e.target.value))}
        >
          {TAMANOS_DE_PAGINA.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.botones}>
        <button
          type="button"
          className={styles.boton}
          onClick={() => onIr(pagina - 1)}
          disabled={pagina <= 1 || cargando}
        >
          ← Anterior
        </button>
        <span className={styles.pagina}>
          {pagina} / {paginas}
        </span>
        <button
          type="button"
          className={styles.boton}
          onClick={() => onIr(pagina + 1)}
          disabled={pagina >= paginas || cargando}
        >
          Siguiente →
        </button>
      </div>
    </nav>
  )
}
