import { filtrarAtributosDeCategoria } from '../services/facetas'
import type {
  CategoriaResumen,
  DefinicionAtributo,
  FiltrosCatalogo,
  MarcaResumen,
} from '../types'
import styles from './CatalogoFiltros.module.css'

export interface CatalogoFiltrosProps {
  filtros: FiltrosCatalogo
  marcas: readonly MarcaResumen[]
  categorias: readonly CategoriaResumen[]
  definiciones: readonly DefinicionAtributo[]
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
  onLimpiar: () => void
}

/**
 * Filtros del catálogo.
 *
 * Los filtros dinámicos por atributo se arman con lo que dice
 * product_attribute_definitions, no con un objeto hardcodeado en el código
 * como el CATEGORY_FILTERS del legacy (app.js:15087).
 */
export function CatalogoFiltros({
  filtros,
  marcas,
  categorias,
  definiciones,
  onCambiar,
  onLimpiar,
}: CatalogoFiltrosProps) {
  const dinamicos = filtrarAtributosDeCategoria(definiciones, filtros.categoria)

  return (
    <div className={styles.panel}>
      <div className={styles.grupo}>
        <label className={styles.campo}>
          <span className={styles.etiqueta}>Categoría</span>
          <select
            className={styles.select}
            value={filtros.categoria ?? ''}
            onChange={(e) =>
              // Al cambiar de categoría se descartan los filtros de atributo:
              // los de la categoría anterior no tienen por qué aplicar acá.
              onCambiar({ categoria: e.target.value || null, atributos: {} })
            }
          >
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.campo}>
          <span className={styles.etiqueta}>Marca</span>
          <select
            className={styles.select}
            value={filtros.marca ?? ''}
            onChange={(e) => onCambiar({ marca: e.target.value || null })}
          >
            <option value="">Todas</option>
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.campo}>
          <span className={styles.etiqueta}>Serie</span>
          <input
            className={styles.input}
            type="text"
            value={filtros.serie ?? ''}
            placeholder="Todas"
            onChange={(e) => onCambiar({ serie: e.target.value || null })}
          />
        </label>
      </div>

      {dinamicos.length > 0 && (
        <>
          <p className={styles.subtitulo}>Características</p>
          <div className={styles.grupo}>
            {dinamicos.map((d) => (
              <label key={d.key} className={styles.campo}>
                <span className={styles.etiqueta}>
                  {d.label}
                  {d.unidad && <span className={styles.unidad}> ({d.unidad})</span>}
                </span>
                <input
                  className={styles.input}
                  type={d.tipo === 'number' ? 'number' : 'text'}
                  value={filtros.atributos[d.key] ?? ''}
                  placeholder="Cualquiera"
                  onChange={(e) =>
                    onCambiar({
                      atributos: { ...filtros.atributos, [d.key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </>
      )}

      <button type="button" className={styles.limpiar} onClick={onLimpiar}>
        Limpiar filtros
      </button>
    </div>
  )
}
