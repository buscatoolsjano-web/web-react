import { Link, useNavigate } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { DisponibilidadBadge, PrecioCelda, StockCelda } from './Celdas'
import { ImagenProducto } from './ImagenProducto'
import { atributosDestacados } from '../lib/destacados'
import type { ProductoListado } from '../types'
import styles from './ListadoProductos.module.css'

export interface ListadoProductosProps {
  productos: readonly ProductoListado[]
  /** Interno ve stock real/virtual; externo, sólo disponibilidad (RLS decide qué llega). */
  esInterno: boolean
  moneda: string | null
  disponibilidad: ReadonlyMap<string, boolean> | undefined
  /** Unidades de los atributos, para que «1» se lea «1 kg» en las tarjetas. */
  unidades: ReadonlyMap<string, string | null>
  cargando: boolean
}

const rutaProducto = (sku: string) => `/catalogo/${encodeURIComponent(sku)}`

/** Kit y «a revisar» son datos del producto; se muestran con texto, no sólo color. */
function Estados({ producto }: { producto: ProductoListado }) {
  if (!producto.esKit && !producto.necesitaRevision) return null
  return (
    <span className={tabla.estados}>
      {producto.esKit ? <Badge tone="info">Kit</Badge> : null}
      {producto.necesitaRevision ? (
        <Badge tone="warning" dot>
          Datos a revisar
        </Badge>
      ) : null}
    </span>
  )
}

/**
 * Resultados del catálogo (Fase 13 · E4).
 *
 * El catálogo es de búsqueda: prioriza leer rápido SKU, nombre, marca, precio
 * y stock. Por eso:
 *
 * - ≥ 1280 px: tabla densa con todas las columnas.
 * - 768–1279 px (con la barra lateral, ~770 px útiles a 1024): la misma tabla
 * sin Serie ni Categoría como columnas; la
 *   categoría pasa debajo del nombre, así no se pierde.
 * - < 768 px: tarjetas compactas (imagen chica a la izquierda), no cards
 *   gigantes. Toda la tarjeta es un enlace.
 *
 * En la tabla el enlace es el nombre (se llega con teclado); la fila entera
 * también abre el producto con el mouse, como antes. No hay acciones dentro de
 * la fila que ese click pueda pisar.
 */
export function ListadoProductos({ productos, esInterno, moneda, disponibilidad, unidades, cargando }: ListadoProductosProps) {
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  if (cargando && productos.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={6} columns={isMobile ? 2 : 6} label="Cargando productos…" />
      </div>
    )
  }
  if (productos.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas} aria-busy={cargando}>
        {productos.map((p) => {
          // Uno o dos atributos, no quince: salen de los datos del propio producto.
          const destacados = atributosDestacados(p.atributos, 2, unidades)
          return (
            <li key={p.id}>
              <Link to={rutaProducto(p.sku)} className={styles.tarjeta}>
                <span className={styles.tarjetaImagen}>
                  <ImagenProducto imagen={p.imagen} alt="" tamano="thumb" />
                </span>
                <span className={styles.tarjetaCuerpo}>
                  <span className={styles.tarjetaFila}>
                    <code className={styles.sku}>{p.sku}</code>
                    <PrecioCelda monto={p.precio} moneda={moneda} />
                  </span>
                  <span className={styles.tarjetaNombre}>{p.nombre}</span>
                  <span className={styles.tarjetaMeta}>
                    {p.marca?.nombre ?? 'Sin marca'}
                    {p.categoria ? ` · ${p.categoria.nombre}` : ''}
                    {p.tipo ? ` · ${p.tipo}` : ''}
                  </span>
                  {destacados.length > 0 ? (
                    <span className={styles.atributos}>
                      {destacados.map((d) => (
                        <span key={d.key} className={styles.atributo}>
                          {d.texto}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className={styles.tarjetaFila}>
                    <Estados producto={p} />
                    <span className={styles.tarjetaStock}>
                      {esInterno ? (
                        <>
                          <span className={styles.rotulo}>Stock</span>
                          <StockCelda stock={p.stock} />
                        </>
                      ) : (
                        <DisponibilidadBadge disponible={disponibilidad?.get(p.id) ?? false} />
                      )}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className={tabla.contenedor} aria-busy={cargando}>
      <table className={`${tabla.tabla} ${styles.tabla}`}>
        <thead>
          <tr>
            <th scope="col" className={styles.colImagen}>
              <span className="sr-only">Imagen</span>
            </th>
            <th scope="col">SKU</th>
            <th scope="col">Producto</th>
            <th scope="col">Marca</th>
            <th scope="col" className={styles.soloAncho}>
              Categoría
            </th>
            <th scope="col" className={styles.soloAncho}>
              Serie
            </th>
            {esInterno ? (
              <th scope="col" className={tabla.num}>
                Stock <span className={styles.aclaracion}>real / virt.</span>
              </th>
            ) : (
              <th scope="col">Disponibilidad</th>
            )}
            <th scope="col" className={tabla.num}>
              Precio{moneda ? <span className={styles.aclaracion}> {moneda}</span> : null}
            </th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id} className={styles.fila} onClick={() => void navigate(rutaProducto(p.sku))}>
              <td className={styles.colImagen}>
                <ImagenProducto imagen={p.imagen} alt="" tamano="thumb" />
              </td>
              <td className={tabla.nowrap}>
                <code className={styles.sku}>{p.sku}</code>
              </td>
              <td className={styles.colNombre}>
                <Link to={rutaProducto(p.sku)} className={styles.nombre} onClick={(e) => e.stopPropagation()}>
                  {p.nombre}
                </Link>
                <span className={styles.bajoNombre}>
                  {p.categoria ? <span className={styles.soloTablet}>{p.categoria.nombre}</span> : null}
                  <Estados producto={p} />
                </span>
              </td>
              <td className={styles.colMarca}>{p.marca?.nombre ?? <span className={tabla.secundario}>—</span>}</td>
              <td className={`${styles.soloAncho} ${styles.colCategoria}`}>
                {p.categoria?.nombre ?? <span className={tabla.secundario}>—</span>}
              </td>
              <td className={`${styles.soloAncho} ${tabla.nowrap}`}>{p.serie ?? <span className={tabla.secundario}>—</span>}</td>
              <td className={esInterno ? tabla.num : tabla.nowrap}>
                {esInterno ? <StockCelda stock={p.stock} /> : <DisponibilidadBadge disponible={disponibilidad?.get(p.id) ?? false} />}
              </td>
              <td className={tabla.num}>
                <PrecioCelda monto={p.precio} moneda={moneda} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
