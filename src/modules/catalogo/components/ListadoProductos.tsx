import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { cx } from '@/utils/cx'
import { CeldaCarrito } from './CeldaCarrito'
import { DisponibilidadBadge, PrecioCelda, SaldoCelda, StockCelda } from './Celdas'
import { rutaProducto } from '../lib/rutas'
import { ImagenProducto } from './ImagenProducto'
import { PopoverProducto } from './PopoverProducto'
import { atributosDestacados } from '../lib/destacados'
import { valorDinamico, type ColumnaDinamica } from '../lib/columnasDinamicas'
import { FilaFiltrosColumna, type FilaFiltrosColumnaProps } from './FilaFiltrosColumna'
import { filaClickeable } from '@/components/tables/filaClickeable'
import { useAnchosAjustables, type ColumnaMedible } from '@/components/tables/anchosAjustables'
import { EncabezadoOrdenable as Encabezado, type OrdenDeColumna } from './EncabezadoOrdenable'
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
  /**
   * `true` cuando hay UNA categoría filtrada, y entonces la columna Categoría
   * no se dibuja: repetiría el mismo valor en las 50 filas. Son ~130 px que
   * necesitan los atributos, que son los que distinguen una fila de otra.
   */
  categoriaFija?: boolean
  /**
   * La fila de filtros dentro del encabezado. Opcional: otras pantallas
   * reusan este listado sin filtros propios (el modal de ventas, por ejemplo).
   */
  filtroColumnas?: Pick<
    FilaFiltrosColumnaProps,
    'filtros' | 'facetas' | 'onCambiar' | 'texto' | 'onTexto'
  >
  /**
   * Columnas propias al final de la fila, para cuando este listado se usa para
   * ELEGIR y no para mirar: el modal de ventas pone ahí «Cant.» y «Agregar».
   *
   * Es un render-prop y no un `onAgregar` porque lo que cambia entre pantallas
   * no es qué pasa al tocar: es qué controles tiene la fila. Van en el mismo
   * lugar que la columna «Carrito» del Catálogo, que es la que reemplazan.
   */
  accion?: readonly ColumnaAccion[]
  /**
   * Qué va en la celda de precio. Por defecto, `PrecioCelda`.
   *
   * Lo pisa el modal de ventas: ahí el precio no es «el del catálogo» sino el
   * que va a entrar en la línea, que puede venir del histórico de ese cliente
   * y se muestra con la tarifa tachada debajo.
   */
  precioCelda?: (producto: ProductoListado) => ReactNode
  /**
   * `false` cuando el listado vive DENTRO de un documento.
   *
   * La fila deja de abrir el producto, la referencia deja de ser un enlace y
   * la ficha al vuelo no se abre. No es una preferencia de estilo: un click
   * mal dado navegaba fuera de la cotización y se perdía lo que no estaba
   * guardado. El nombre completo sigue llegando por el `title` de la fila.
   */
  navegable?: boolean
  /** Una clase extra por fila. La usa el modal para marcar lo ya agregado. */
  claseDeFila?: (producto: ProductoListado) => string | undefined
  /**
   * Fuerza la vista de TARJETAS (con foto) aunque la pantalla sea ancha. El
   * Catálogo usa la tabla en escritorio; el modal de ventas pide tarjetas para
   * elegir con la foto a la vista, más parecido a navegar el catálogo (Fase 196).
   */
  forzarTarjetas?: boolean
  /**
   * Carga las imágenes `eager` en vez de `lazy` (Fase 197).
   *
   * Para listas cortas que se ven casi enteras y viven en un contenedor con
   * scroll PROPIO —las 25 filas del modal de ventas—: ahí el `lazy` del
   * navegador no dispara de forma confiable (lo mide `ImagenProducto`) y las
   * fotos bajo el pliegue quedan en blanco hasta que alguien scrollea, que es
   * justo lo que se siente como que «no carga». El Catálogo sigue en `lazy`:
   * son cientos de filas sobre el scroll de la página.
   */
  imagenesEager?: boolean
}

/** Una columna propia al final de la fila (ver `accion`). */
export interface ColumnaAccion {
  clave: string
  encabezado: ReactNode
  celda: (producto: ProductoListado) => ReactNode
  /* `| undefined` explícito: con `exactOptionalPropertyTypes` no es lo mismo
     omitir la clave que pasarla en undefined, y quien la arma la saca de una
     clase de CSS Modules, que puede no existir. */
  className?: string | undefined
}

/** Marcar productos para comparar (2 a 4) o exportar (los que sean). */
export interface SeleccionComparar {
  elegidos: ReadonlySet<string>
  alternar: (producto: ProductoListado) => void
  /** Marca/desmarca todos los de la página visible de un saque (tilde del encabezado). */
  alternarTodos: (productos: readonly ProductoListado[]) => void
  /** Se llegó al tope de selección: los no elegidos se deshabilitan. */
  lleno: boolean
}

/** Se re-exporta para no romper a quien ya lo importaba de acá. */
export type { OrdenDeColumna } from './EncabezadoOrdenable'




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
  categoriaFija = false,
  filtroColumnas,
  accion = [],
  precioCelda,
  navegable = true,
  claseDeFila,
  forzarTarjetas = false,
  imagenesEager = false,
}: ListadoProductosProps) {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  // Tarjetas con foto: siempre en mobile; en escritorio sólo si lo piden (modal
  // de ventas). El resto del render sigue decidiendo por `isMobile`.
  const enTarjetas = isMobile || forzarTarjetas

  /*
   * ANCHOS AJUSTABLES (Fase 58 · E6). «También quiero yo poder ir modificando
   * el tamaño de las columnas, tipo ir agarrando y ampliarlo, achicarlo».
   *
   * SÓLO LAS COLUMNAS DE TEXTO. Las de ancho conocido —casillero, imagen,
   * referencia, stock, precio, carrito— lo piden en píxeles en el CSS desde la
   * Fase 39, y ahí el reparto ya es el bueno. Las de texto, en cambio, se
   * reparten el sobrante EN PARTES IGUALES, y eso es justo lo que molestaba:
   * Modelo necesita más que Serie, y cuánto más depende de los datos que haya
   * cargados en cada una, que es algo que sólo sabe quien la está mirando.
   *
   * La tabla ya está en `table-layout: fixed` desde la Fase 39, que es el
   * requisito para que un ancho declarado se cumpla en vez de ser una
   * sugerencia que el navegador ignora.
   */
  /*
   * Y CADA UNA SE MIDE POR LO QUE TIENE ADENTRO (Fase 66).
   *
   * «Torque mínimo siempre van a ser un número y Nm, entonces la columna no
   * puede ser así de grande. Lo mismo con la serie: hay tres series de tres
   * letras nada más. Si no, no se ven las otras columnas».
   *
   * Antes toda columna de texto arrancaba en 220 px fijos, mirara lo que
   * mirara: «Serie» ocupaba lo mismo que «Modelo». Ahora se le pasan los
   * valores que se están viendo y el ancho sale de medirlos de verdad, con la
   * tipografía de la tabla. El encabezado y el filtro ponen su piso: ver
   * `anchoPorContenido`.
   *
   * Las opciones del filtro también se miden, porque el `<select>` vive en el
   * encabezado y tiene que poder mostrar la suya más larga.
   */
  const facetasDeFiltro = filtroColumnas?.facetas
  const columnasAjustables = useMemo<ColumnaMedible[]>(() => {
    const textos = (f: (p: ProductoListado) => string | null | undefined) =>
      productos.map((p) => f(p) ?? '—')
    /*
     * Las opciones del desplegable, que es lo que el `<select>` del
     * encabezado tiene que poder mostrar. Se lee la ETIQUETA y no el valor:
     * es lo que se dibuja.
     *
     * Y se nombran una por una en vez de armar la clave con una plantilla:
     * la primera versión buscaba `facetas['marca']` cuando la faceta se
     * llama `marcas`, así que devolvía siempre vacío y el mínimo del filtro
     * no se aplicaba nunca. Andaba de casualidad —los títulos alcanzaban—
     * y no había forma de notarlo leyendo el código.
     */
    const etiquetas = (os: readonly { etiqueta: string }[] | undefined) =>
      ['Todos', ...(os ?? []).map((o) => o.etiqueta)]
    const delAtributo = (key: string) =>
      etiquetas(facetasDeFiltro?.atributos.find((a) => a.key === key)?.opciones)

    return [
      { key: 'sku', header: 'Referencia', tipo: 'texto', valores: textos((p) => p.sku) },
      { key: 'modelo', header: 'Modelo', tipo: 'texto', valores: textos((p) => p.modelo) },
      { key: 'marca', header: 'Marca', tipo: 'texto', valores: textos((p) => p.marca?.nombre), opcionesDeFiltro: etiquetas(facetasDeFiltro?.marcas) },
      { key: 'categoria', header: 'Categoría', tipo: 'texto', valores: textos((p) => p.categoria?.nombre), opcionesDeFiltro: etiquetas(facetasDeFiltro?.categorias) },
      { key: 'tipo', header: 'Tipo', tipo: 'texto', valores: textos((p) => p.tipo), opcionesDeFiltro: etiquetas(facetasDeFiltro?.subtipos) },
      ...columnasDinamicas.map((c) => ({
        key: claveAncho(c.key),
        // El encabezado incluye la unidad, que se dibuja al lado: «Torque
        // mín.» sin el « Nm» mediría de menos y el título quedaría cortado.
        header: c.unidad ? `${c.label} ${c.unidad}` : c.label,
        tipo: 'texto' as const,
        valores: productos.map((p) => valorDinamico(p, c)),
        opcionesDeFiltro: delAtributo(c.key),
      })),
    ]
  }, [columnasDinamicas, productos, facetasDeFiltro])

  const refTabla = useRef<HTMLTableElement | null>(null)
  const anchos = useAnchosAjustables('catalogo', columnasAjustables, refTabla)

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

  if (enTarjetas) {
    return (
      <ul className={cx(tabla.tarjetas, forzarTarjetas && styles.tarjetasGrilla)} aria-busy={cargando}>
        {productos.map((p) => {
          // Uno o dos atributos, no quince: salen de los datos del propio producto.
          const destacados = atributosDestacados(p.atributos, 2, unidades)
          // Dentro de un documento la tarjeta NO es un enlace: tocarla
          // abandonaría la cotización. Mismo contenido, sin navegación.
          const Envoltura = navegable
            ? ({ children }: { children: ReactNode }) => (
                <Link to={rutaProducto(p.sku)} className={styles.tarjeta}>
                  {children}
                </Link>
              )
            : ({ children }: { children: ReactNode }) => (
                <div className={styles.tarjeta} title={p.nombre}>
                  {children}
                </div>
              )
          return (
            <li key={p.id} className={styles.tarjetaConCarrito}>
              <Envoltura>
                <span className={styles.tarjetaImagen}>
                  <ImagenProducto
                    imagen={p.imagen}
                    alt=""
                    tamano="thumb"
                    prioridad={imagenesEager ? 'eager' : 'lazy'}
                  />
                </span>
                <span className={styles.tarjetaCuerpo}>
                  <span className={styles.tarjetaFila}>
                    <code className={styles.sku}>{p.sku}</code>
                    {/* El precio que corresponde a esta pantalla: en el modal de
                        ventas es el de la línea (histórico del cliente), no el
                        del catálogo. Igual que en la tabla (Fase 196). */}
                    {precioCelda ? precioCelda(p) : <PrecioCelda monto={p.precio} moneda={moneda} />}
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
              </Envoltura>
              {/* Fuera del <Link>: un stepper adentro de un enlace navega al
                  tocar «+», que es lo contrario de lo que se quiso hacer. */}
              {conCarrito ? (
                <div className={styles.tarjetaCarrito}>
                  <CeldaCarrito producto={p} />
                </div>
              ) : null}
              {accion.length > 0 ? (
                <div className={styles.tarjetaCarrito}>
                  {accion.map((c) => (
                    <span key={c.clave}>{c.celda(p)}</span>
                  ))}
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
      <table ref={refTabla} className={`${tabla.tabla} ${styles.tabla}`}>
        <thead>
          <tr>
            {seleccion ? (
              <th scope="col" className={styles.colElegir}>
                {/* Tilde para marcar TODOS los de esta página de un saque.
                    `indeterminate` cuando hay algunos pero no todos. */}
                <input
                  type="checkbox"
                  className={styles.elegir}
                  checked={productos.length > 0 && productos.every((p) => seleccion.elegidos.has(p.id))}
                  ref={(el) => {
                    if (el) {
                      const algunos = productos.some((p) => seleccion.elegidos.has(p.id))
                      const todos = productos.length > 0 && productos.every((p) => seleccion.elegidos.has(p.id))
                      el.indeterminate = algunos && !todos
                    }
                  }}
                  onChange={() => seleccion.alternarTodos(productos)}
                  aria-label="Seleccionar todos los de esta página"
                  data-seleccionar-todos
                />
              </th>
            ) : null}
            <th scope="col" className={styles.colImagen}>
              <span className="sr-only">Imagen</span>
            </th>
            <Encabezado campo="sku" orden={orden} className={styles.colReferencia} style={anchos?.estilo('sku')} extra={anchos?.tirador('sku', 'Referencia')}>Referencia</Encabezado>
            {/*
              El NOMBRE no es una columna (Fase 38).

              Era la más ancha de la tabla y la que menos decía: «APEX *5422
              EMBOCADURA» es la marca, el modelo y la serie concatenados, o sea
              exactamente lo que ya dicen las tres columnas de al lado. Se
              comía el ancho que necesitaban los atributos, que son los que
              distinguen una fila de otra, y obligaba a scrollear de costado
              para llegar al precio.

              El nombre completo sigue estando: en el popover de la imagen, en
              la ficha y en el modal.
            */}
            <Encabezado campo="modelo" orden={orden} style={anchos?.estilo('modelo')} extra={anchos?.tirador('modelo', 'Modelo')}>
              Modelo
            </Encabezado>
            <Encabezado campo="marca" orden={orden} style={anchos?.estilo('marca')} extra={anchos?.tirador('marca', 'Marca')}>
              Marca
            </Encabezado>
            {categoriaFija ? null : (
              <Encabezado campo="categoria" orden={orden} className={`${styles.soloAncho}`} style={anchos?.estilo('categoria')} extra={anchos?.tirador('categoria', 'Categoría')}>
                Categoría
              </Encabezado>
            )}
            {/*
              «Serie» se sacó (Fase 141). Serie y Tipo eran una jerarquía de dos
              niveles mal cargada: donde diferían, Serie era la familia («Punta»)
              y Tipo el detalle real («Torx», «Allen», «Phillips»); donde no,
              decían lo mismo. El detalle vive en Tipo y la familia se deriva de
              él, así que Serie era la columna redundante. El dato sigue en la
              base y en la ficha; sólo se saca de la grilla y de los filtros.
            */}
            <Encabezado campo="tipo" orden={orden} className={`${styles.soloAncho}`} style={anchos?.estilo('tipo')} extra={anchos?.tirador('tipo', 'Tipo')}>
              Tipo
            </Encabezado>
            {/* Fase 28 · E7: también ordenan. `search_products` acepta
                `attr:<clave>`, y dentro de una familia el atributo ES la
                columna por la que se busca. */}
            {columnasDinamicas.map((c) => (
              <Encabezado
                key={c.key}
                campo={`attr:${c.key}`}
                orden={orden}
                className={`${styles.colDinamica}`}
                style={anchos?.estilo(claveAncho(c.key))}
                extra={anchos?.tirador(claveAncho(c.key), c.label)}
              >
                {c.label}
                {c.unidad ? <span className={styles.aclaracion}> {c.unidad}</span> : null}
              </Encabezado>
            ))}
            {/* Fase 25 · E2: dos columnas, una por saldo, cada una con su
                orden — como el legacy (`app.js:15518`). Juntas en una sola
                celda «12 / 10» no se podían ordenar por separado. */}
            {esInterno ? (
              <>
                <Encabezado campo="stock_real" orden={orden} className={`${tabla.num} ${styles.thNum} ${styles.thStock}`}>
                  Stock real
                </Encabezado>
                <Encabezado campo="stock_virtual" orden={orden} className={`${tabla.num} ${styles.thNum} ${styles.thStock}`}>
                  Stock virtual
                </Encabezado>
              </>
            ) : (
              <th scope="col">Disponibilidad</th>
            )}
            <th scope="col" className={`${tabla.num} ${styles.colPrecio}`}>
              Precio{moneda ? <span className={styles.aclaracion}> {moneda}</span> : null}
            </th>
            {conCarrito ? (
              <th scope="col" className={styles.colCarrito}>
                Carrito
              </th>
            ) : null}
            {/* Las columnas propias de quien usa el listado, donde iría el
                carrito: son lo que esa pantalla hace con la fila. */}
            {accion.map((c) => (
              <th scope="col" key={c.clave} className={c.className}>
                {c.encabezado}
              </th>
            ))}
          </tr>
          {filtroColumnas ? (
            <FilaFiltrosColumna
              {...filtroColumnas}
              columnasDinamicas={columnasDinamicas}
              conSeleccion={seleccion !== undefined}
              categoriaFija={categoriaFija}
              conCarrito={conCarrito}
              esInterno={esInterno}
            />
          ) : null}
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr
              key={p.id}
              data-fila-producto={p.id}
              aria-current={p.id === abierto ? 'true' : undefined}
              title={navegable ? undefined : p.nombre}
              className={[
                navegable ? styles.fila : undefined,
                p.id === abierto ? styles.abierta : undefined,
                claseDeFila?.(p),
              ]
                .filter(Boolean)
                .join(' ')}
              {...(navegable
                ? filaClickeable(() =>
                    onAbrirProducto ? onAbrirProducto(p.id) : void navigate(rutaProducto(p.sku)),
                  )
                : {})}
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
                    aria-label={`Seleccionar ${p.sku}`}
                    data-comparar={p.sku}
                  />
                </td>
              ) : null}
              <td
                className={styles.colImagen}
                // La ficha al vuelo es de la IMAGEN, no de la fila: pasar por
                // encima del listado entero no puede tapar lo que se lee.
                //
                // Dentro de un documento no se abre: la ficha trae un
                // comparador con enlaces a otros productos, y eso es recorrer
                // el catálogo, no cargar una línea.
                {...(navegable
                  ? {
                      onMouseEnter: (e: React.MouseEvent<HTMLTableCellElement>) =>
                        abrirPopover(p, e.currentTarget),
                      onMouseLeave: cerrarPopover,
                    }
                  : {})}
              >
                <ImagenProducto
                  imagen={p.imagen}
                  alt=""
                  tamano="thumb"
                  prioridad={imagenesEager ? 'eager' : 'lazy'}
                />
              </td>
              <td className={styles.colReferencia}>
                {/*
                  La REFERENCIA es ahora el enlace, como en la web vieja.

                  Fase 25 · E4: abre lo MISMO que el resto de la fila. Antes el
                  nombre navegaba a la ficha y el resto abría el modal, así que
                  el mismo producto se veía de dos formas según dónde se
                  hubiera tocado.

                  Sigue siendo un `<a>` con href de verdad: ctrl-click, botón
                  del medio y «abrir en pestaña nueva» tienen que llevar a la
                  ficha, que es una URL compartible. El click pelado, no.
                */}
                {navegable ? (
                  <Link
                    to={rutaProducto(p.sku)}
                    className={styles.refEnlace}
                    onClick={(e) => {
                      if (!onAbrirProducto) return
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                      e.preventDefault()
                      e.stopPropagation()
                      onAbrirProducto(p.id)
                    }}
                    title={p.nombre}
                  >
                    <code className={styles.sku}>{p.sku}</code>
                  </Link>
                ) : (
                  <code className={styles.sku} title={p.nombre}>
                    {p.sku}
                  </code>
                )}
                <Estados producto={p} />
              </td>
              <td className={`${tabla.nowrap} ${styles.colModelo}`} title={p.nombre}>
                {p.modelo ?? <span className={tabla.secundario}>—</span>}
              </td>
              <td className={`${styles.colMarca}`}>{p.marca?.nombre ?? <span className={tabla.secundario}>—</span>}</td>
              {categoriaFija ? null : (
                <td className={`${styles.soloAncho} ${styles.colCategoria}`}>
                  {p.categoria?.nombre ?? <span className={tabla.secundario}>—</span>}
                </td>
              )}
              <td className={`${styles.soloAncho} ${tabla.nowrap}`}>
                {p.tipo ?? <span className={tabla.secundario}>—</span>}
              </td>
              {columnasDinamicas.map((c) => {
                const v = valorDinamico(p, c)
                return (
                  <td key={c.key} className={`${styles.colDinamica}`}>
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
                {precioCelda ? precioCelda(p) : <PrecioCelda monto={p.precio} moneda={moneda} />}
              </td>
              {conCarrito ? (
                <td className={styles.colCarrito}>
                  <CeldaCarrito producto={p} />
                </td>
              ) : null}
              {accion.map((c) => (
                <td key={c.clave} className={c.className}>
                  {c.celda(p)}
                </td>
              ))}
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
 * La clave con la que se recuerda el ancho de una columna de atributo.
 *
 * El mismo prefijo que usa el orden (`attr:torq_max`), para que no haya dos
 * nombres para la misma columna: el día que se agregue un atributo que se
 * llame igual que una columna fija —`tipo`, por ejemplo, que existe como
 * columna Y podría existir como atributo— los anchos no se pisan.
 */
function claveAncho(clave: string): string {
  return `attr:${clave}`
}
