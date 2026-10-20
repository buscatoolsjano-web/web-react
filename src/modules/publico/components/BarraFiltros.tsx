import type { FacetasPublicas, OpcionFaceta } from '../services/catalogoPublico'
import styles from './BarraFiltros.module.css'

/**
 * Los filtros del catálogo público (Fase 87 · E2b).
 *
 * ── POR QUÉ DESPLEGABLES Y NO LA TABLA DEL ERP ──────────────────────────────
 *
 * El catálogo interno filtra con una fila de selectores debajo de cada
 * encabezado de columna, y ahí está bien: quien lo usa sabe qué columna es
 * cuál y entra a filtrar. Acá llega alguien de un buscador que nunca vio esta
 * pantalla, y en un teléfono una tabla de quince columnas no existe.
 *
 * Tres desplegables arriba de la grilla dicen lo mismo —marca, serie, tipo—,
 * entran en cualquier ancho y se entienden sin aprender nada.
 *
 * ── LAS OPCIONES LLEVAN SU CANTIDAD ─────────────────────────────────────────
 *
 * «TECNA (285)» en vez de «TECNA». Es el dato que convierte una lista de
 * nombres en una decisión: quien busca un balanceador y ve que TECNA tiene
 * 285 y otra marca tiene 3, ya sabe por dónde empezar. Y de paso garantiza
 * que ninguna opción devuelva cero resultados, porque salen de contar lo que
 * hay dentro de lo ya filtrado.
 */
export interface BarraFiltrosProps {
  facetas: FacetasPublicas | undefined
  marca: string
  serie: string
  tipo: string
  onCambiar: (clave: 'marca' | 'serie' | 'tipo', valor: string) => void
  onLimpiar: () => void
}

/** Un desplegable con su rótulo. Se esconde si no hay nada que elegir. */
function Filtro({
  etiqueta,
  valor,
  opciones,
  porValor,
  onCambiar,
}: {
  etiqueta: string
  valor: string
  opciones: OpcionFaceta[]
  /** Qué se manda a la URL: el slug de la marca, el nombre de las otras. */
  porValor: (o: OpcionFaceta) => string
  onCambiar: (valor: string) => void
}) {
  // Con una sola opción el filtro no filtra nada: todo lo que se ve ya la
  // cumple. Mostrarlo es ofrecer una decisión que no existe.
  if (opciones.length < 2) return null
  return (
    <label className={styles.filtro}>
      <span className={styles.etiqueta}>{etiqueta}</span>
      <select value={valor} onChange={(e) => onCambiar(e.target.value)}>
        <option value="">Todas</option>
        {opciones.map((o) => (
          <option key={porValor(o)} value={porValor(o)}>
            {o.nombre} ({o.cuantos.toLocaleString('es-AR')})
          </option>
        ))}
      </select>
    </label>
  )
}

export function BarraFiltros({
  facetas,
  marca,
  serie,
  tipo,
  onCambiar,
  onLimpiar,
}: BarraFiltrosProps) {
  const hayAlguno = marca !== '' || serie !== '' || tipo !== ''
  if (!facetas) return null

  return (
    <div className={styles.barra}>
      <Filtro
        etiqueta="Marca"
        valor={marca}
        opciones={facetas.marcas}
        porValor={(o) => o.slug ?? o.nombre}
        onCambiar={(v) => onCambiar('marca', v)}
      />
      <Filtro
        etiqueta="Serie"
        valor={serie}
        opciones={facetas.series}
        porValor={(o) => o.nombre}
        onCambiar={(v) => onCambiar('serie', v)}
      />
      <Filtro
        etiqueta="Tipo"
        valor={tipo}
        opciones={facetas.tipos}
        porValor={(o) => o.nombre}
        onCambiar={(v) => onCambiar('tipo', v)}
      />
      {/* Sólo cuando hay algo que limpiar: un botón permanentemente inútil
          enseña a ignorar esa esquina de la pantalla. */}
      {hayAlguno ? (
        <button type="button" className={styles.limpiar} onClick={onLimpiar}>
          Limpiar filtros
        </button>
      ) : null}
    </div>
  )
}
