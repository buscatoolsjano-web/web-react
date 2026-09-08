import { rangoVisible, totalDePaginas } from '../lib/formato'
import styles from './Paginador.module.css'

export interface PaginadorProps {
  pagina: number
  porPagina: number
  total: number
  cargando?: boolean
  onIr: (pagina: number) => void
}

/**
 * Paginado real: cada cambio de página es un request acotado al servidor.
 *
 * En el legacy el paginado era `filtered.slice(start, start + PER)` sobre
 * los 21.772 productos que ya estaban en memoria. Acá el navegador nunca
 * tiene más de `porPagina` productos.
 */
export function Paginador({ pagina, porPagina, total, cargando = false, onIr }: PaginadorProps) {
  const paginas = totalDePaginas(total, porPagina)
  const hayAnterior = pagina > 1
  const haySiguiente = pagina < paginas

  return (
    <nav className={styles.wrap} aria-label="Paginación del catálogo">
      <span className={styles.rango} aria-live="polite">
        {cargando ? 'Cargando…' : rangoVisible(pagina, porPagina, total)}
      </span>

      <div className={styles.botones}>
        <button
          type="button"
          className={styles.boton}
          onClick={() => onIr(pagina - 1)}
          disabled={!hayAnterior || cargando}
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
          disabled={!haySiguiente || cargando}
        >
          Siguiente →
        </button>
      </div>
    </nav>
  )
}
