import type { ChangeEvent } from 'react'
import tabla from '@/components/tables/Tabla.module.css'
import type { ColumnaDinamica } from '../lib/columnasDinamicas'
import type { Facetas, FiltrosCatalogo, OpcionFaceta } from '../types'
import styles from './FilaFiltrosColumna.module.css'

/**
 * La fila de filtros DENTRO del encabezado de la tabla (Fase 38).
 *
 * Es lo que tiene la web vieja: debajo de cada título, el control que filtra
 * por esa columna. La diferencia con esa web —y es la decisión importante de
 * todo esto— es que acá **cada control le pega al servidor**, no a las 50
 * filas que están cargadas.
 *
 * Un filtro que sólo mira la página actual es peor que no tener filtro: con
 * 21.772 productos y 50 por página, escribir «torx» en la columna y ver tres
 * resultados da por buena una respuesta que dejó afuera 21.722 filas sin
 * decirlo. Parece que anda, y por eso no se revisa.
 *
 * Por eso cada control escribe en `filtros`, que es lo que viaja a
 * `search_products` y a `catalog_facets`. El conteo de cada opción sale de las
 * facetas, así que lo que se ofrece es lo que existe: si una opción no está en
 * la lista es porque con los filtros puestos no hay ni un producto así.
 */

export interface FilaFiltrosColumnaProps {
  filtros: FiltrosCatalogo
  facetas: Facetas | undefined
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
  /** El texto del buscador, compartido con el de arriba: es el mismo filtro. */
  texto: string
  onTexto: (valor: string) => void
  columnasDinamicas: readonly ColumnaDinamica[]
  /** Hay checkbox de comparar a la izquierda. */
  conSeleccion: boolean
  /** La columna Categoría no se dibuja cuando ya se filtró por una. */
  categoriaFija: boolean
  conCarrito: boolean
  esInterno: boolean
}

/**
 * Cuánto se deja crecer al texto de una opción.
 *
 * No es estética: el ancho MÍNIMO de un `<select>` lo fija su opción más
 * larga, y ese mínimo se le suma a la columna. Con «Medida» (235 opciones) y
 * «Largo» (176) la tabla volvía a desbordar 89 px, o sea que el filtro por
 * columna rompía justo lo que habíamos arreglado. El valor completo sigue
 * estando en el `title`.
 */
const MAXIMO_OPCION = 16

const recortar = (t: string) =>
  t.length <= MAXIMO_OPCION ? t : `${t.slice(0, MAXIMO_OPCION - 1)}…`

/** Un `<select>` de faceta: «Todos» + lo que existe, con su conteo. */
function Desplegable({
  etiqueta,
  valor,
  opciones,
  onElegir,
}: {
  etiqueta: string
  valor: string
  opciones: readonly OpcionFaceta[]
  onElegir: (valor: string) => void
}) {
  // Sin opciones no se dibuja el control: un desplegable con un solo ítem que
  // dice «Todos» ocupa lugar y no filtra nada.
  if (opciones.length === 0) return null
  return (
    <div className={styles.caja}>
    <select
      className={styles.control}
      aria-label={`Filtrar por ${etiqueta}`}
      value={valor}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onElegir(e.target.value)}
    >
      <option value="">Todos</option>
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor} title={o.etiqueta}>
          {recortar(o.etiqueta)} ({o.cantidad.toLocaleString('es-AR')})
        </option>
      ))}
    </select>
    </div>
  )
}

export function FilaFiltrosColumna({
  filtros,
  facetas,
  onCambiar,
  texto,
  onTexto,
  columnasDinamicas,
  conSeleccion,
  categoriaFija,
  conCarrito,
  esInterno,
}: FilaFiltrosColumnaProps) {
  /* Cambiar un filtro vuelve a la página 1. Sin esto se filtra estando en la
     página 7 y la tabla queda vacía, que parece «no hay resultados». */
  const poner = (cambios: Partial<FiltrosCatalogo>) => onCambiar({ ...cambios, pagina: 1 })

  return (
    <tr className={styles.fila}>
      {conSeleccion ? <td /> : null}
      <td />

      {/* REFERENCIA · el mismo `q` que el buscador de arriba, que ya busca por
          referencia, nombre y modelo. Dos cajas para el mismo filtro serían
          dos sitios donde mirar para entender por qué falta una fila. */}
      <td className={styles.celda}>
        <div className={styles.caja}>
        <input
          type="search"
          className={styles.control}
          aria-label="Filtrar por referencia o modelo"
          placeholder="Buscar…"
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
        />
        </div>
      </td>

      {/* MODELO · lo cubre la caja de al lado. */}
      <td />

      <td className={styles.celda}>
        <Desplegable
          etiqueta="marca"
          valor={filtros.marca ?? ''}
          opciones={facetas?.marcas ?? []}
          onElegir={(v) => poner({ marca: v === '' ? null : v })}
        />
      </td>

      {categoriaFija ? null : (
        <td className={styles.celda}>
          <Desplegable
            etiqueta="categoría"
            valor={filtros.categoria ?? ''}
            opciones={facetas?.categorias ?? []}
            onElegir={(v) =>
              // Igual que los chips: cambiar de categoría descarta subtipos,
              // atributos y rangos, que son los de la categoría anterior.
              poner({
                categoria: v === '' ? null : v,
                subtipos: [],
                atributos: {},
                rangos: {},
              })
            }
          />
        </td>
      )}

      <td className={styles.celda}>
        <Desplegable
          etiqueta="serie"
          valor={filtros.serie ?? ''}
          opciones={facetas?.series ?? []}
          onElegir={(v) => poner({ serie: v === '' ? null : v })}
        />
      </td>

      <td className={styles.celda}>
        <Desplegable
          etiqueta="tipo"
          valor={filtros.subtipos[0] ?? ''}
          opciones={facetas?.subtipos ?? []}
          onElegir={(v) => poner({ subtipos: v === '' ? [] : [v] })}
        />
      </td>

      {columnasDinamicas.map((c) => {
        const faceta = facetas?.atributos.find((a) => a.key === c.key)
        return (
          <td key={c.key} className={styles.celda}>
            <Desplegable
              etiqueta={c.label}
              valor={filtros.atributos[c.key]?.[0] ?? ''}
              opciones={faceta?.opciones ?? []}
              onElegir={(v) => {
                const siguientes = { ...filtros.atributos }
                if (v === '') delete siguientes[c.key]
                else siguientes[c.key] = [v]
                poner({ atributos: siguientes })
              }}
            />
          </td>
        )
      })}

      {/* Stock y precio no tienen filtro del lado del servidor, así que no se
          dibuja una caja que no haría nada. */}
      {esInterno ? (
        <>
          <td />
          <td />
        </>
      ) : (
        <td />
      )}
      <td className={tabla.num} />
      {conCarrito ? <td /> : null}
    </tr>
  )
}
