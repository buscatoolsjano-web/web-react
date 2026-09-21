import { useEffect, useRef, useState } from 'react'
import { formatearPrecio } from '../lib/formato'
import { presentarAtributos, valorConUnidad } from '../lib/formato'
import { ImagenProducto } from './ImagenProducto'
import type { DefinicionAtributo, ProductoListado } from '../types'
import styles from './PopoverProducto.module.css'

export interface PopoverProductoProps {
  producto: ProductoListado
  /** El elemento sobre el que se abrió: de ahí sale la posición. */
  ancla: DOMRect
  moneda: string | null
  esInterno: boolean
  definiciones: readonly DefinicionAtributo[]
}

const ANCHO = 280
const MARGEN = 12

/**
 * La ficha instantánea al pasar el mouse por la foto.
 *
 * Es la función del sistema anterior que más se extrañaba: saber qué es un
 * producto **sin abrirlo**, recorriendo el listado con el mouse.
 *
 * **No pide nada.** Todo lo que muestra —imagen, marca, categoría, tipo,
 * atributos, precio y stock— ya vino en la fila del listado. Mover el mouse
 * por cincuenta filas no dispara una sola consulta, que es lo que haría
 * inutilizable la idea.
 *
 * Se ubica sola: a la derecha del cursor si entra, a la izquierda si no, y
 * pegada al borde de arriba o de abajo antes que salirse de la pantalla.
 */
export function PopoverProducto({
  producto,
  ancla,
  moneda,
  esInterno,
  definiciones,
}: PopoverProductoProps) {
  const caja = useRef<HTMLDivElement>(null)
  const [alto, setAlto] = useState(0)

  useEffect(() => {
    setAlto(caja.current?.offsetHeight ?? 0)
  }, [producto.id])

  const hayLugarDerecha = ancla.right + MARGEN + ANCHO < window.innerWidth
  const izquierda = hayLugarDerecha ? ancla.right + MARGEN : ancla.left - ANCHO - MARGEN
  const arribaIdeal = ancla.top + ancla.height / 2 - alto / 2
  const arriba = Math.max(MARGEN, Math.min(arribaIdeal, window.innerHeight - alto - MARGEN))

  const atributos = presentarAtributos(producto.atributos, definiciones).slice(0, 6)

  return (
    <div
      ref={caja}
      className={styles.popover}
      style={{ left: Math.max(MARGEN, izquierda), top: arriba, width: ANCHO }}
      role="tooltip"
    >
      <div className={styles.foto}>
        <ImagenProducto imagen={producto.imagen} alt="" tamano="full" />
      </div>
      <div className={styles.cuerpo}>
        <code className={styles.sku}>{producto.sku}</code>
        <p className={styles.nombre}>{producto.nombre}</p>

        <dl className={styles.datos}>
          <Fila etiqueta="Marca" valor={producto.marca?.nombre} />
          <Fila etiqueta="Categoría" valor={producto.categoria?.nombre} />
          <Fila etiqueta="Tipo" valor={producto.tipo} />
          {atributos.map((a) => (
            <Fila key={a.key} etiqueta={a.label} valor={valorConUnidad(a)} />
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
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  if (!valor) return null
  return (
    <div className={styles.fila}>
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  )
}
