import { columnasDe, type ColumnaComparable } from '../lib/familias'
import { compararValor, textoDe } from '../lib/similitud'
import { ImagenProducto } from './ImagenProducto'
import { formatearPrecio } from '../lib/formato'
import type { ProductoListado } from '../types'
import styles from './ComparadorProductos.module.css'

export interface ComparadorProductosProps {
  principal: ProductoListado
  similares: readonly ProductoListado[]
  /** De dónde salió cada similar, por id. `legacy` = equivalencia curada. */
  fuentes?: ReadonlyMap<string, 'legacy' | 'calculated'> | undefined
  familia: string | null
  moneda: string | null
  onAbrirProducto: (id: string) => void
  /**
   * `compacta` para el hover —3 similares, cabecera baja—; `completa` para el
   * modal, que tiene espacio. Un solo componente: tener dos era la forma
   * segura de que dijeran cosas distintas del mismo par de productos.
   */
  variante: 'compacta' | 'completa'
  /**
   * Las filas, cuando no las decide la familia del principal.
   *
   * Lo usa el comparador manual (#42): ahí los productos los eligió la
   * persona y pueden ser de familias distintas, así que las columnas salen de
   * `columnasDeVarias`. Sin esto habría que duplicar el comparador, y dos
   * comparadores son dos respuestas para la misma pregunta.
   */
  columnas?: readonly ColumnaComparable[] | undefined
  /** Sin tope: el manual muestra los que el usuario eligió, ni uno menos. */
  sinTope?: boolean
}

/** Cuántos similares entran sin que el hover se vuelva una pantalla. */
const MAXIMO = { compacta: 3, completa: 8 } as const

/**
 * Qué cambia entre este producto y sus alternativas (Fase 22 · Etapa B).
 *
 * **Atributos en filas, productos en columnas**, como el catálogo anterior. La
 * orientación no es estética: uno compara leyendo una fila —«¿qué largo tiene
 * cada uno?»— y con los productos en filas esa pregunta obliga a saltar de
 * columna en columna.
 *
 * La primera columna es el producto que uno está mirando y es la línea base;
 * no se pinta contra sí misma. Las demás se comparan contra ella: verde si el
 * valor normalizado coincide, rojo si difiere, neutro si **alguno de los dos**
 * no tiene el dato.
 *
 * El color no va solo. Cada celda lleva su símbolo —`=`, `≠`, `?`— y un texto
 * para lector de pantalla, así que quien no distingue rojo de verde no pierde
 * información: pierde el atajo visual.
 */
export function ComparadorProductos({
  principal,
  similares,
  fuentes,
  familia,
  moneda,
  onAbrirProducto,
  variante,
  columnas,
  sinTope = false,
}: ComparadorProductosProps) {
  const filas = columnas ?? columnasDe(familia)
  if (filas.length === 0) return null

  const mostrados = sinTope ? similares : similares.slice(0, MAXIMO[variante])
  // Los PRODUCTOS que van en columna; `columnas` (la prop) son las FILAS.
  const enColumna = [principal, ...mostrados]

  return (
    <div className={styles.scroll} data-variante={variante}>
      <table className={styles.tabla}>
        <caption className={styles.sr}>
          Comparación técnica de {principal.sku} contra {mostrados.length} alternativas.
        </caption>
        <thead>
          <tr>
            {/* La esquina: la columna de atributos no tiene cabecera propia. */}
            <td className={styles.esquina} />
            {enColumna.map((p, i) => (
              <th key={p.id} scope="col" className={i === 0 ? styles.cabPrincipal : styles.cabSimilar}>
                <Cabecera
                  producto={p}
                  esPrincipal={i === 0}
                  fuente={fuentes?.get(p.id)}
                  moneda={moneda}
                  onAbrir={() => onAbrirProducto(p.id)}
                  variante={variante}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((col) => (
            <tr key={col.clave}>
              <th scope="row" className={styles.etiqueta}>
                {col.etiqueta}
              </th>
              {enColumna.map((p, i) => {
                const veredicto = i === 0 ? null : compararValor(principal, p, col)
                return (
                  <td
                    key={p.id}
                    className={i === 0 ? styles.celdaPrincipal : styles.celda}
                    data-veredicto={veredicto ?? undefined}
                  >
                    <span className={styles.contenido}>
                      <span className={styles.valor}>{textoDe(p, col)}</span>
                      {veredicto ? <Marca veredicto={veredicto} etiqueta={col.etiqueta} /> : null}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * La marca de coincidencia.
 *
 * Símbolo para quien mira y texto para quien escucha. El fondo de color es el
 * atajo, no el dato: si fuera lo único, la tabla sería ilegible para una de
 * cada doce personas.
 */
function Marca({ veredicto, etiqueta }: { veredicto: 'igual' | 'distinto' | 'sin-dato'; etiqueta: string }) {
  const simbolo = veredicto === 'igual' ? '=' : veredicto === 'distinto' ? '≠' : '?'
  const dicho =
    veredicto === 'igual'
      ? `mismo ${etiqueta.toLowerCase()}`
      : veredicto === 'distinto'
        ? `${etiqueta.toLowerCase()} distinto`
        : `${etiqueta.toLowerCase()} sin datos para comparar`
  return (
    <span className={styles.marca} aria-hidden="true" data-veredicto={veredicto}>
      {simbolo}
      <span className={styles.sr} aria-hidden="false">
        {dicho}
      </span>
    </span>
  )
}

interface CabeceraProps {
  producto: ProductoListado
  esPrincipal: boolean
  fuente: 'legacy' | 'calculated' | undefined
  moneda: string | null
  onAbrir: () => void
  variante: 'compacta' | 'completa'
}

/**
 * La cabecera de cada columna: miniatura, marca, modelo y precio.
 *
 * Baja a propósito. Una cabecera alta empuja los atributos fuera de la
 * pantalla, y los atributos son el motivo por el que uno abrió esto.
 */
function Cabecera({ producto, esPrincipal, fuente, moneda, onAbrir, variante }: CabeceraProps) {
  return (
    <div className={styles.cabecera}>
      {esPrincipal ? <span className={styles.estasViendo}>Estás viendo</span> : null}
      {fuente === 'legacy' && !esPrincipal ? (
        /* Curada no es idéntica: se avisa de dónde sale, y las diferencias se
           siguen viendo en rojo abajo. */
        <span className={styles.curada} title="Equivalencia cargada a mano en el catálogo anterior">
          Equivalente
        </span>
      ) : null}

      {variante === 'completa' ? (
        <span className={styles.mini}>
          <ImagenProducto imagen={producto.imagen} alt="" tamano="thumb" />
        </span>
      ) : null}

      <button type="button" className={styles.abrir} onClick={onAbrir}>
        <span className={styles.marcaProducto}>{producto.marca?.nombre ?? '—'}</span>
        <span className={styles.sku}>{producto.sku}</span>
      </button>
      <span className={styles.precio}>{formatearPrecio(producto.precio, moneda)}</span>
    </div>
  )
}
