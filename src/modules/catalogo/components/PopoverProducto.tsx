import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatearPrecio, presentarAtributos, valorConUnidad } from '../lib/formato'
import { columnasDe } from '../lib/familias'
import { textoDe } from '../lib/similitud'
import { ComparadorProductos } from './ComparadorProductos'
import { useSimilares } from '../hooks/useProductos'
import { ImagenProducto } from './ImagenProducto'
import type { DefinicionAtributo, ProductoListado } from '../types'
import { ANCHO_IMAGEN, ubicar } from '../lib/ubicarPopover'
import styles from './PopoverProducto.module.css'

export interface PopoverProductoProps {
  producto: ProductoListado
  /** El elemento sobre el que se abrió: de ahí sale la posición. */
  ancla: DOMRect
  moneda: string | null
  esInterno: boolean
  definiciones: readonly DefinicionAtributo[]
  priceListId: string | null
  /** Abrir un producto —el principal o un similar— en el modal del catálogo. */
  onAbrirProducto: (id: string) => void
  /** El mouse entró o salió de la ficha: el listado decide si cerrarla. */
  onEntrar: () => void
  onSalir: () => void
}

/** Cuántos similares se ven sin pedir más (B13). */
const VISIBLES = 4

/**
 * La ficha instantánea al pasar el mouse por la foto.
 *
 * Es la función del sistema anterior que más se extrañaba: saber qué es un
 * producto **sin abrirlo**, recorriendo el listado con el mouse. Y ahora,
 * además, con qué se lo puede reemplazar.
 *
 * **La ficha no pide nada.** Imagen, marca, categoría, tipo, atributos, precio
 * y stock ya vinieron en la fila del listado. Mover el mouse por cincuenta
 * filas no dispara una sola consulta, que es lo que haría inutilizable la
 * idea. Los similares sí se buscan, pero recién cuando el hover ya se abrió
 * —el listado espera 250 ms antes de montar esto— y quedan cacheados por
 * producto: volver a pasar por la misma fila no vuelve a pedir nada.
 *
 * Horizontal a propósito: la foto a la izquierda y la ficha a la derecha, como
 * el catálogo anterior. La versión vertical —foto arriba, datos abajo— tapaba
 * media pantalla para decir seis cosas.
 */
export function PopoverProducto({
  producto,
  ancla,
  moneda,
  esInterno,
  definiciones,
  priceListId,
  onAbrirProducto,
  onEntrar,
  onSalir,
}: PopoverProductoProps) {
  const caja = useRef<HTMLDivElement>(null)
  const [alto, setAlto] = useState(0)
  const [verTodos, setVerTodos] = useState(false)

  const familia = producto.categoria?.slug ?? null
  const columnas = columnasDe(familia)
  const similares = useSimilares(producto.id, priceListId, columnas.length > 0, 8)
  const lista = similares.data?.productos ?? []
  const fuentes = similares.data?.fuentes
  const mostrados = verTodos ? lista : lista.slice(0, VISIBLES)

  // Se mide en `useLayoutEffect` para que el primer pintado ya esté ubicado:
  // con `useEffect` la ficha aparece arriba a la izquierda y salta.
  useLayoutEffect(() => {
    setAlto(caja.current?.offsetHeight ?? 0)
  }, [producto.id, lista.length, verTodos])

  // El alto cambia cuando llegan los similares, y la ficha puede quedar
  // colgando fuera de la pantalla si nadie vuelve a mirar.
  useEffect(() => {
    const el = caja.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setAlto(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { izquierda, arriba, ancho } = ubicar(ancla, alto)

  /**
   * Qué atributos muestra la ficha.
   *
   * Si la familia es comparable, los SUYOS y en su orden (B4/B19). Mostrar
   * todos los del jsonb traía ruido interno: «Marca (display)» al lado de
   * «Marca», y «Longitud (original)» repitiendo el recorrido que ya está dos
   * líneas más arriba. Para las familias sin columnas definidas se cae a lo
   * que haya, que es mejor que nada.
   */
  const atributos =
    columnas.length > 0
      ? columnas
          .filter((c) => c.origen === 'atributo')
          .map((c) => ({ key: c.clave, label: c.etiqueta, valor: textoDe(producto, c) }))
          .filter((a) => a.valor !== '—')
      : presentarAtributos(producto.atributos, definiciones)
          .slice(0, 8)
          .map((a) => ({ key: a.key, label: a.label, valor: valorConUnidad(a) }))

  return (
    <div
      ref={caja}
      className={styles.popover}
      style={{ left: izquierda, top: arriba, width: ancho }}
      role="tooltip"
      onMouseEnter={onEntrar}
      onMouseLeave={onSalir}
    >
      <div className={styles.ficha}>
        <div className={styles.foto} style={{ width: ANCHO_IMAGEN }}>
          <ImagenProducto imagen={producto.imagen} alt="" tamano="full" />
        </div>

        <div className={styles.panel}>
          <code className={styles.sku}>{producto.sku}</code>
          <p className={styles.nombre}>{producto.nombre}</p>

          <dl className={styles.datos}>
            <Dato etiqueta="Marca" valor={producto.marca?.nombre} />
            <Dato etiqueta="Categoría" valor={producto.categoria?.nombre} />
            <Dato etiqueta="Tipo" valor={producto.tipo} />
            <Dato etiqueta="Serie" valor={producto.serie} />
            {/* Sin filas vacías: un producto de STEL no tiene encastre, y una
                fila «Encastre: —» ocupa lo mismo que una con dato (B4). */}
            {atributos.map((a) => (
              <Dato key={a.key} etiqueta={a.label} valor={a.valor} />
            ))}
          </dl>

          <div className={styles.comercial}>
            <span className={styles.precio}>{formatearPrecio(producto.precio, moneda)}</span>
            {/* El stock sólo existe para roles internos: lo decide RLS. */}
            {esInterno && producto.stock ? (
              <span className={styles.stock}>
                Real <strong>{producto.stock.real}</strong> · Virtual{' '}
                <strong>{producto.stock.virtual}</strong>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <Comparador
        principal={producto}
        similares={mostrados}
        fuentes={fuentes}
        familia={familia}
        cargando={similares.isPending && columnas.length > 0}
        comparable={columnas.length > 0}
        total={lista.length}
        verTodos={verTodos}
        onVerTodos={() => setVerTodos(true)}
        moneda={moneda}
        onAbrirProducto={onAbrirProducto}
      />
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  if (!valor) return null
  return (
    <div className={styles.dato}>
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  )
}

interface ComparadorProps {
  principal: ProductoListado
  similares: ProductoListado[]
  fuentes: ReadonlyMap<string, 'legacy' | 'calculated'> | undefined
  familia: string | null
  cargando: boolean
  comparable: boolean
  total: number
  verTodos: boolean
  onVerTodos: () => void
  moneda: string | null
  onAbrirProducto: (id: string) => void
}

/**
 * Qué cambia entre este producto y sus alternativas.
 *
 * Una fila por producto, el principal primero y marcado. Verde donde el valor
 * coincide, rojo donde difiere y neutro donde **alguno de los dos no tiene el
 * dato**: eso último no es un detalle, es la diferencia entre informar y
 * afirmar algo que no sabemos.
 */
function Comparador({
  principal,
  similares,
  fuentes,
  familia,
  cargando,
  comparable,
  total,
  verTodos,
  onVerTodos,
  moneda,
  onAbrirProducto,
}: ComparadorProps) {
  if (!comparable) {
    return (
      <p className={styles.sinComparar}>
        Este producto no tiene datos técnicos cargados, así que no hay con qué compararlo.
      </p>
    )
  }
  if (cargando) return <p className={styles.sinComparar}>Buscando similares…</p>
  if (similares.length === 0) {
    return <p className={styles.sinComparar}>No se encontraron productos similares.</p>
  }

  return (
    <div className={styles.comparador}>
      <h3 className={styles.tituloComparador}>Productos similares</h3>
      <ComparadorProductos
        principal={principal}
        similares={similares}
        fuentes={fuentes}
        familia={familia}
        moneda={moneda}
        onAbrirProducto={onAbrirProducto}
        variante="compacta"
      />
      {/* Más de los que entran en el hover: se ven completos en el modal, que
          tiene espacio. Meter cinco columnas acá lo volvería una pantalla. */}
      {!verTodos && total > similares.length ? (
        <button type="button" className={styles.verMas} onClick={onVerTodos}>
          Ver los {total} similares
        </button>
      ) : null}
    </div>
  )
}
