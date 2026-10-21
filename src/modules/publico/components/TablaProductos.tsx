import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import type { ColumnaAtributo } from '../lib/columnas'
import { valorDeAtributo } from '../lib/columnas'
import type { FacetasPublicas, ProductoPublicoResumen } from '../services/catalogoPublico'
import { urlDeFoto } from '../services/catalogoPublico'
import { rutaProductoPublico } from '../lib/rutas'
import type { CarritoEnUso } from '../hooks/useCarritoPublico'
import styles from './TablaProductos.module.css'

/**
 * El catálogo público, en tabla (Fase 87 · E2c).
 *
 * ── POR QUÉ UNA TABLA Y NO LA GRILLA DE TARJETAS ────────────────────────────
 *
 * «Que lo repliques: una fila donde está cada columna con su título. Imagen,
 * referencia, modelo, así con todo. Como está cuando iniciás sesión.»
 *
 * Y tiene razón para este catálogo. Una grilla de fotos sirve cuando el
 * producto se elige por cómo se ve; acá se elige por el encastre, la medida y
 * el largo, que son números. Ocho mil embocaduras se diferencian en tres
 * columnas, no en la foto —de hecho muchas fotos son la misma página de
 * catálogo escaneada—. En tabla se comparan de un vistazo y se filtran por lo
 * que importa.
 *
 * ── LO QUE NO SE REPLICA, Y NO ES UN OLVIDO ─────────────────────────────────
 *
 * Stock real, stock virtual y precio. No están ocultos: no vienen en la
 * respuesta, y ésa es la mitad de por qué el catálogo se puede publicar.
 * Las columnas que quedan son exactamente las otras, en el mismo orden.
 */
interface Opcion {
  valor: string
  etiqueta: string
}

/**
 * Un desplegable de la fila de filtros.
 *
 * Vive FUERA del componente de la tabla a propósito: definido adentro, React
 * lo trataría como un componente nuevo en cada pintado y volvería a montar el
 * `select` —perdiendo el foco mientras alguien lo está usando—. Lo marca el
 * linter, y tiene razón.
 *
 * Con una sola opción no se dibuja: todo lo que se ve ya la cumple, así que
 * es una decisión que no existe.
 */
function Selector({
  clave,
  opciones,
  valor,
  onCambiar,
}: {
  clave: string
  opciones: readonly Opcion[]
  valor: string
  onCambiar: (clave: string, valor: string) => void
}) {
  if (opciones.length < 2) return <span aria-hidden="true" />
  return (
    <select
      className={styles.filtro}
      value={valor}
      aria-label={`Filtrar por ${clave.replace(/^a\./, '')}`}
      onChange={(e) => onCambiar(clave, e.target.value)}
    >
      <option value="">Todos</option>
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta}
        </option>
      ))}
    </select>
  )
}

export interface TablaProductosProps {
  productos: readonly ProductoPublicoResumen[]
  columnas: readonly ColumnaAtributo[]
  facetas: FacetasPublicas | undefined
  /** Lo que está filtrado ahora. La clave es la del filtro, no la del dato. */
  filtros: Record<string, string>
  onFiltrar: (clave: string, valor: string) => void
  carrito: CarritoEnUso
  /** `false` cuando hay una categoría fija: la columna diría siempre lo mismo. */
  mostrarCategoria: boolean
}

export function TablaProductos({
  productos,
  columnas,
  facetas,
  filtros,
  onFiltrar,
  carrito,
  mostrarCategoria,
}: TablaProductosProps) {
  const sel = (clave: string, opciones: readonly Opcion[]) => (
    <Selector
      clave={clave}
      opciones={opciones}
      valor={filtros[clave] ?? ''}
      onCambiar={onFiltrar}
    />
  )

  // La cantidad va en la etiqueta y no es adorno: «TECNA (285)» al lado de
  // «GEDORE (2)» dice por dónde empezar, y garantiza que ninguna opción
  // devuelva cero —salen de contar lo que hay dentro de lo ya filtrado—.
  const conCuenta = (os: readonly { nombre: string; cuantos: number; slug?: string }[]): Opcion[] =>
    os.map((o) => ({
      valor: o.slug ?? o.nombre,
      etiqueta: `${o.nombre} (${o.cuantos.toLocaleString('es-AR')})`,
    }))

  return (
    <div className={tabla.contenedor}>
      <table className={`${tabla.tabla} ${styles.tabla}`}>
        <thead>
          <tr>
            <th scope="col" className={styles.colImagen}>
              <span className="sr-only">Imagen</span>
            </th>
            <th scope="col" className={styles.colReferencia}>
              Referencia
            </th>
            <th scope="col">Modelo</th>
            <th scope="col">Marca</th>
            {mostrarCategoria ? <th scope="col">Categoría</th> : null}
            <th scope="col" className={styles.soloAncho}>Serie</th>
            <th scope="col" className={styles.soloAncho}>Tipo</th>
            {columnas.map((c) => (
              <th key={c.key} scope="col" className={styles.colAtributo}>
                {c.label}
                {c.unidad ? <span className={styles.unidad}> {c.unidad}</span> : null}
              </th>
            ))}
            <th scope="col" className={styles.colCarrito}>
              Consulta
            </th>
          </tr>

          {/*
            La fila de filtros, debajo de los títulos y no arriba de la tabla.
            Es donde está en el ERP y donde la busca el ojo: el filtro de una
            columna vive en su columna, y así no hay que leer el rótulo del
            desplegable para saber qué filtra.
          */}
          <tr className={styles.filaFiltros}>
            <td />
            <td>
              <input
                className={styles.filtro}
                type="search"
                value={filtros['q'] ?? ''}
                placeholder="Buscar…"
                aria-label="Buscar por referencia o nombre"
                onChange={(e) => onFiltrar('q', e.target.value)}
              />
            </td>
            {/* La caja de Modelo, pedida aparte de la de Referencia: busca
                sólo por el código de modelo, que no está en la búsqueda
                general. */}
            <td>
              <input
                className={styles.filtro}
                type="search"
                value={filtros['modelo'] ?? ''}
                placeholder="Modelo…"
                aria-label="Buscar por modelo"
                onChange={(e) => onFiltrar('modelo', e.target.value)}
              />
            </td>
            <td>
              {sel('marca', conCuenta(facetas?.marcas ?? []))}
            </td>
            {mostrarCategoria ? (
              <td>
                {sel('categoria', conCuenta(facetas?.categorias ?? []))}
              </td>
            ) : null}
            <td className={styles.soloAncho}>
              {sel('serie', conCuenta(facetas?.series ?? []))}
            </td>
            <td className={styles.soloAncho}>
              {sel('tipo', conCuenta(facetas?.tipos ?? []))}
            </td>
            {columnas.map((c) => (
              <td key={c.key}>
                {sel(`a.${c.key}`, c.opciones.map((o) => ({ valor: o.valor, etiqueta: `${o.valor} (${o.cuantos.toLocaleString('es-AR')})` })))}
              </td>
            ))}
            <td />
          </tr>
        </thead>

        <tbody>
          {productos.map((p) => {
            const foto = urlDeFoto(p)
            const enLista = carrito.cantidadDe(p.sku)
            const item = {
              sku: p.sku,
              slug: p.slug,
              categoriaSlug: p.categoriaSlug,
              nombre: p.nombre,
              imagen: foto,
            }
            return (
              <tr key={p.slug}>
                <td className={styles.colImagen}>
                  <Link to={rutaProductoPublico(p.categoriaSlug, p.slug)} className={styles.foto}>
                    {foto ? (
                      <img src={foto} alt="" loading="lazy" decoding="async" width={44} height={44} />
                    ) : (
                      <span className={styles.sinFoto} aria-hidden="true">
                        <Icon name="image" size={16} />
                      </span>
                    )}
                  </Link>
                </td>

                {/* La referencia es el enlace de la fila: es lo primero que se
                    lee y lo que se copia para pedir. */}
                <td className={styles.colReferencia}>
                  <Link to={rutaProductoPublico(p.categoriaSlug, p.slug)} className={styles.sku}>
                    {p.sku}
                  </Link>
                </td>

                <td>{p.modelo ?? '—'}</td>
                <td>{p.marca ?? '—'}</td>
                {mostrarCategoria ? <td>{p.categoria ?? '—'}</td> : null}
                <td className={styles.soloAncho}>{p.serie ?? '—'}</td>
                <td className={styles.soloAncho}>{p.tipo ?? '—'}</td>

                {columnas.map((c) => (
                  <td key={c.key} className={styles.colAtributo}>
                    {valorDeAtributo(p.atributos, c)}
                  </td>
                ))}

                {/* El «− n +» de siempre, pero lo que arma es una consulta y
                    no un pedido: no hay precio publicado. */}
                <td className={styles.colCarrito}>
                  <div className={styles.cantidad}>
                    <button
                      type="button"
                      onClick={() => carrito.sacar(p.sku)}
                      disabled={enLista === 0}
                      aria-label={`Quitar uno de ${p.sku}`}
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={enLista}
                      aria-label={`Cantidad de ${p.sku}`}
                      onChange={(e) => carrito.poner(item, Number(e.target.value))}
                    />
                    <button
                      type="button"
                      onClick={() => carrito.agregar(item)}
                      aria-label={`Agregar uno de ${p.sku}`}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
