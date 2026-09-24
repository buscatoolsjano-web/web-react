import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { CeldaCarrito } from './CeldaCarrito'
import { DisponibilidadBadge, PrecioCelda, SaldoCelda, StockCelda } from './Celdas'
import { ImagenProducto } from './ImagenProducto'
import { PopoverProducto } from './PopoverProducto'
import { atributosDestacados } from '../lib/destacados'
import { valorDinamico, type ColumnaDinamica } from '../lib/columnasDinamicas'
import type { DefinicionAtributo, ProductoListado } from '../types'
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
  /** Abrir el producto en el modal, sin salir del catálogo. */
  onAbrirProducto?: (id: string) => void
  /** El producto con el modal abierto, para marcar su fila. */
  abierto?: string | null
  /** Para la ficha al vuelo: las etiquetas de los atributos. */
  definiciones?: readonly DefinicionAtributo[]
  /** La lista de precios vigente, para que los similares traigan SU precio. */
  priceListId?: string | null
  /** Columna «Carrito» con el − [n] + de cada fila (Fase 22 · paridad, #50). */
  conCarrito?: boolean
  /** Columna de selección para comparar a mano (Fase 22 · paridad, #42). */
  seleccion?: SeleccionComparar | undefined
  /** Encabezados que ordenan (Fase 22 · paridad, #13). */
  orden?: OrdenDeColumna | undefined
  /** Columnas del atributo distintivo de la categoría (Fase 22 · paridad, #19). */
  columnasDinamicas?: readonly ColumnaDinamica[]
}

/** Elegir 2 a 4 productos para compararlos, como el checkbox del legacy. */
export interface SeleccionComparar {
  elegidos: ReadonlySet<string>
  alternar: (producto: ProductoListado) => void
  /** Ya hay 4: los no elegidos se deshabilitan, como en el legacy. */
  lleno: boolean
}

/** El estado del orden y cómo pedirle otro. */
export interface OrdenDeColumna {
  campo: string
  direccion: 'asc' | 'desc'
  ordenar: (campo: string) => void
}

/**
 * Los controles que se manejan solos. Un click acá adentro es del control:
 * el link del nombre navega, y mañana el carrito agregará al carrito.
 */
const CONTROLES = 'a, button, input, select, textarea, label, [role="button"], [role="link"]'

/**
 * Fase 21 · E1: **la fila entera abre el producto en el modal.**
 *
 * Antes navegaba a la página del producto y volver costaba re-armar la búsqueda,
 * los filtros, la página y el scroll. Ahora abre encima. Si no hay modal
 * —la ficha completa, por ejemplo— sigue navegando, que es el comportamiento
 * de antes.
 */
function filaClickeable(
  id: string,
  onAbrir: ((id: string) => void) | undefined,
  navegar: () => void,
) {
  const abrir = () => (onAbrir ? onAbrir(id) : navegar())
  return {
    tabIndex: 0,
    onClick: (e: React.MouseEvent<HTMLTableRowElement>) => {
      if (e.defaultPrevented || e.button !== 0) return
      // Ctrl, Cmd y Shift son del navegador: abrir en pestaña o seleccionar.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if ((e.target as HTMLElement).closest(CONTROLES)) return
      // Seleccionar un SKU para copiarlo termina en un click sobre la fila.
      if ((window.getSelection()?.toString() ?? '') !== '') return
      e.currentTarget.focus()
      abrir()
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      abrir()
    },
  }
}

const rutaProducto = (sku: string) => `/catalogo/${encodeURIComponent(sku)}`

/**
 * Kit es un dato del producto; se muestra con texto, no sólo color.
 *
 * **«Datos a revisar» ya no se muestra en el Catálogo** (Fase 25 · E3, pedido
 * explícito). El dato sigue en `products.needs_review` y se sigue viendo en
 * Configuración → Categorías: lo que se saca es el cartel. La razón es de
 * proporción, no de gusto: lo tienen 12.593 de 21.828 productos —casi todos
 * los de la categoría «Otros»— así que marcaba más de la mitad del catálogo y
 * un cartel que aparece siempre no informa nada.
 */
function Estados({ producto }: { producto: ProductoListado }) {
  if (!producto.esKit) return null
  return (
    <span className={tabla.estados}>
      <Badge tone="info">Kit</Badge>
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
 * En la tabla, **cualquier parte de la fila —incluido el nombre— abre el
 * producto de la misma manera** (Fase 25 · E4). El nombre sigue siendo un
 * enlace de verdad para llegar con teclado y para abrir la ficha en otra
 * pestaña, pero el click pelado hace lo mismo que el resto de la fila. No hay
 * acciones dentro de la fila que ese click pueda pisar.
 */
export function ListadoProductos({
  productos,
  esInterno,
  moneda,
  disponibilidad,
  unidades,
  cargando,
  onAbrirProducto,
  abierto = null,
  definiciones = [],
  priceListId = null,
  conCarrito = false,
  seleccion,
  orden,
  columnasDinamicas = [],
}: ListadoProductosProps) {
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  /**
   * La ficha al vuelo (§11).
   *
   * Con un retardo de 250 ms: pasar el mouse por encima de veinte filas
   * camino al buscador no puede abrir veinte fichas. No pide datos —usa los
   * de la fila— así que abrirla es gratis.
   */
  const [popover, setPopover] = useState<{ producto: ProductoListado; ancla: DOMRect } | null>(
    null,
  )
  const timer = useRef<number | null>(null)

  const cancelar = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  const abrirPopover = (producto: ProductoListado, el: HTMLElement) => {
    cancelar()
    const ancla = el.getBoundingClientRect()
    timer.current = window.setTimeout(() => setPopover({ producto, ancla }), 250)
  }

  /**
   * El cierre espera.
   *
   * Fase 22 · Etapa B: la ficha dejó de ser un cartel y pasó a tener un
   * comparador adentro, así que hay que poder llegar con el mouse. Entre la
   * miniatura y la ficha hay un hueco de 12 px, y cerrar al instante hacía
   * imposible cruzarlo. Con el retardo, entrar en la ficha cancela el cierre.
   */
  const cerrarPopover = () => {
    cancelar()
    timer.current = window.setTimeout(() => setPopover(null), 180)
  }

  const cerrarYa = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setPopover(null)
  }, [])

  /**
   * Si la lista cambia debajo del mouse, la ficha abierta ya no corresponde a
   * nada.
   *
   * El efecto de antes sólo limpiaba al desmontar, así que no hacía lo que su
   * comentario decía: buscando otra cosa, la ficha del producto anterior se
   * quedaba flotando sobre resultados con los que no tiene relación. Ahora
   * depende de los productos, y cambiar de filtro o de página la cierra.
   */
  useEffect(() => cerrarYa, [cerrarYa, productos])

  // Escape cierra sin tener que sacar el mouse de encima (B14).
  useEffect(() => {
    if (!popover) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrarYa()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [popover, cerrarYa])

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
            <li key={p.id} className={styles.tarjetaConCarrito}>
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
              {/* Fuera del <Link>: un stepper adentro de un enlace navega al
                  tocar «+», que es lo contrario de lo que se quiso hacer. */}
              {conCarrito ? (
                <div className={styles.tarjetaCarrito}>
                  <CeldaCarrito producto={p} />
                </div>
              ) : null}
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
            {seleccion ? (
              <th scope="col" className={styles.colElegir}>
                <span className="sr-only">Comparar</span>
              </th>
            ) : null}
            <th scope="col" className={styles.colImagen}>
              <span className="sr-only">Imagen</span>
            </th>
            <Encabezado campo="sku" orden={orden}>SKU</Encabezado>
            <Encabezado campo="nombre" orden={orden}>Producto</Encabezado>
            <Encabezado campo="marca" orden={orden}>Marca</Encabezado>
            <Encabezado campo="categoria" orden={orden} className={styles.soloAncho}>
              Categoría
            </Encabezado>
            <Encabezado campo="serie" orden={orden} className={styles.soloAncho}>
              Serie
            </Encabezado>
            {/* Fase 28 · E7: también ordenan. `search_products` acepta
                `attr:<clave>`, y dentro de una familia el atributo ES la
                columna por la que se busca. */}
            {columnasDinamicas.map((c) => (
              <Encabezado key={c.key} campo={`attr:${c.key}`} orden={orden} className={styles.colDinamica}>
                {c.label}
                {c.unidad ? <span className={styles.aclaracion}> {c.unidad}</span> : null}
              </Encabezado>
            ))}
            {/* Fase 25 · E2: dos columnas, una por saldo, cada una con su
                orden — como el legacy (`app.js:15518`). Juntas en una sola
                celda «12 / 10» no se podían ordenar por separado. */}
            {esInterno ? (
              <>
                <Encabezado campo="stock_real" orden={orden} className={`${tabla.num} ${styles.thNum}`}>
                  Stock real
                </Encabezado>
                <Encabezado campo="stock_virtual" orden={orden} className={`${tabla.num} ${styles.thNum}`}>
                  Stock virtual
                </Encabezado>
              </>
            ) : (
              <th scope="col">Disponibilidad</th>
            )}
            <th scope="col" className={tabla.num}>
              Precio{moneda ? <span className={styles.aclaracion}> {moneda}</span> : null}
            </th>
            {conCarrito ? (
              <th scope="col" className={styles.colCarrito}>
                Carrito
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr
              key={p.id}
              data-fila-producto={p.id}
              aria-current={p.id === abierto ? 'true' : undefined}
              className={p.id === abierto ? `${styles.fila} ${styles.abierta}` : styles.fila}
              {...filaClickeable(p.id, onAbrirProducto, () => void navigate(rutaProducto(p.sku)))}
            >
              {seleccion ? (
                <td
                  className={styles.colElegir}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <input
                    type="checkbox"
                    className={styles.elegir}
                    checked={seleccion.elegidos.has(p.id)}
                    disabled={seleccion.lleno && !seleccion.elegidos.has(p.id)}
                    onChange={() => seleccion.alternar(p)}
                    aria-label={`Comparar ${p.sku}`}
                    data-comparar={p.sku}
                  />
                </td>
              ) : null}
              <td
                className={styles.colImagen}
                // La ficha al vuelo es de la IMAGEN, no de la fila: pasar por
                // encima del listado entero no puede tapar lo que se lee.
                onMouseEnter={(e) => abrirPopover(p, e.currentTarget)}
                onMouseLeave={cerrarPopover}
              >
                <ImagenProducto imagen={p.imagen} alt="" tamano="thumb" />
              </td>
              <td className={tabla.nowrap}>
                <code className={styles.sku}>{p.sku}</code>
              </td>
              <td className={styles.colNombre}>
                {/*
                  Fase 25 · E4: el nombre abre lo MISMO que el resto de la fila.
                  Antes navegaba a la ficha y el resto de la fila abría el
                  modal, así que el mismo producto se veía de dos formas según
                  dónde se hubiera tocado.

                  Sigue siendo un `<a>` con href de verdad: ctrl-click, botón
                  del medio y «abrir en pestaña nueva» tienen que llevar a la
                  ficha, que es una URL compartible. El click pelado, no.
                */}
                <Link
                  to={rutaProducto(p.sku)}
                  className={styles.nombre}
                  onClick={(e) => {
                    if (!onAbrirProducto) return
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    onAbrirProducto(p.id)
                  }}
                >
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
              {columnasDinamicas.map((c) => {
                const v = valorDinamico(p, c)
                return (
                  <td key={c.key} className={styles.colDinamica}>
                    {v === '—' ? <span className={tabla.secundario}>—</span> : v}
                  </td>
                )
              })}
              {esInterno ? (
                <>
                  <td className={tabla.num}>
                    <SaldoCelda valor={p.stock?.real ?? null} />
                  </td>
                  <td className={tabla.num}>
                    <SaldoCelda valor={p.stock?.virtual ?? null} />
                  </td>
                </>
              ) : (
                <td className={tabla.nowrap}>
                  <DisponibilidadBadge disponible={disponibilidad?.get(p.id) ?? false} />
                </td>
              )}
              <td className={tabla.num}>
                <PrecioCelda monto={p.precio} moneda={moneda} />
              </td>
              {conCarrito ? (
                <td className={styles.colCarrito}>
                  <CeldaCarrito producto={p} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {popover && !isMobile ? (
        <PopoverProducto
          producto={popover.producto}
          ancla={popover.ancla}
          moneda={moneda}
          esInterno={esInterno}
          definiciones={definiciones}
          priceListId={priceListId}
          onAbrirProducto={(id) => {
            cerrarYa()
            if (onAbrirProducto) onAbrirProducto(id)
          }}
          onEntrar={cancelar}
          onSalir={cerrarPopover}
        />
      ) : null}
    </div>
  )
}

/**
 * Un encabezado que ordena (Fase 22 · paridad, #13).
 *
 * El legacy (`app.js:17366`) hace exactamente dos cosas: si ya se está
 * ordenando por ese campo, da vuelta la dirección; si no, ordena por ese
 * campo ascendente. **No hay tercer click que saque el orden** — lo verifiqué
 * en el código antes de escribir esto, porque era la duda razonable.
 *
 * Si la columna no se puede ordenar, sigue siendo un `th` normal: no hay un
 * botón que no hace nada.
 */
export function Encabezado({
  campo,
  orden,
  className,
  children,
}: {
  campo: string
  orden: OrdenDeColumna | undefined
  className?: string | undefined
  children: React.ReactNode
}) {
  const clase = className ? `${styles.th} ${className}` : styles.th
  if (!orden) {
    return (
      <th scope="col" className={className}>
        {children}
      </th>
    )
  }
  const activo = orden.campo === campo
  const asc = activo && orden.direccion === 'asc'
  return (
    <th scope="col" className={clase} aria-sort={activo ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={styles.ordenar} onClick={() => orden.ordenar(campo)}>
        {children}
        {/* El indicador va marcado como decorativo: la dirección ya la dice
            `aria-sort`, y leerla dos veces molesta más de lo que ayuda. */}
        <span className={activo ? styles.flecha : styles.flechaInactiva} aria-hidden="true">
          {activo ? (asc ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  )
}
