import { useEffect, useId, useRef, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { LinkButton } from '@/components/ui/LinkButton'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useMovimientos, useProductoPorId, useSimilares } from '../hooks/useProductos'
import { hojaDeCatalogo } from '../lib/hojaCatalogo'
import { formatearPrecio } from '../lib/formato'
import { HistorialStock } from './HistorialStock'
import { HojaCatalogo } from './HojaCatalogo'
import { ImagenProducto } from './ImagenProducto'
import { ListaAtributos } from './ListaAtributos'
import { ComparadorProductos } from './ComparadorProductos'
import { RelacionadosProducto } from './RelacionadosProducto'
import { EsqueletoProducto } from './EsqueletoProducto'
import type {
  DefinicionAtributo,
  MovimientoDeStock,
  ProductoDetalle,
  ProductoListado,
} from '../types'
import styles from './ModalProducto.module.css'

export interface ModalProductoProps {
  productoId: string
  priceListId: string | null
  listaResuelta: boolean
  moneda: string | null
  definiciones: readonly DefinicionAtributo[]
  onCerrar: () => void
  /** Saltar a un relacionado sin cerrar: lo maneja la URL de la página. */
  onAbrirOtro: (id: string) => void
}

/**
 * El producto, **encima del catálogo**.
 *
 * Es la diferencia de uso más grande de esta fase: antes abrir un producto
 * era navegar a `/catalogo/:sku`, y volver significaba re-armar la búsqueda,
 * los filtros, la página y el scroll. Ahora el catálogo queda atrás, intacto,
 * y cerrar es cerrar.
 *
 * Lo que se carga y cuándo:
 *
 *   · **al abrir**: el producto (1 consulta) y sus relacionados (1 más);
 *   · **al desplegar el historial**: los movimientos (1);
 *   · **nunca**: nada de esto desde el listado. Cincuenta filas en pantalla
 *     no son cincuenta historiales.
 *
 * El orden de las secciones es el del taller: quién es, cuánto vale y cuánto
 * hay, cómo es, cuánto pesa, qué otras medidas existen, qué le pasó al stock
 * y en qué página del catálogo está.
 */
export function ModalProducto({
  productoId,
  priceListId,
  listaResuelta,
  moneda,
  definiciones,
  onCerrar,
  onAbrirOtro,
}: ModalProductoProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  const cuerpo = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  const { activa } = useEmpresa()
  const esInterno = activa?.esInterno ?? false
  const { data, isPending, error } = useProductoPorId(productoId, priceListId, listaResuelta)
  // Fase 22 · Etapa B: la MISMA fuente que el hover del listado. Tener dos
  // algoritmos era la forma segura de que el modal y la ficha dijeran cosas
  // distintas del mismo par de productos.
  const relacionados = useSimilares(productoId, priceListId, true, 8)

  /**
   * El historial se pide cuando se abre la sección, no cuando se abre el
   * producto. Arranca cerrado, y **saltar a un relacionado lo vuelve a
   * cerrar**: el historial que estaba abierto era el del producto anterior.
   *
   * El reseteo se hace comparando con el producto previo DURANTE el render y
   * no en un efecto: un  dentro de un efecto provoca un segundo
   * render en cascada y el historial del producto viejo llega a pintarse.
   */
  const [verHistorial, setVerHistorial] = useState(false)
  const [productoPrevio, setProductoPrevio] = useState(productoId)
  if (productoPrevio !== productoId) {
    setProductoPrevio(productoId)
    setVerHistorial(false)
  }
  const movimientos = useMovimientos(data?.id ?? null, verHistorial)

  // El scroll sí va en un efecto: toca el DOM, no el estado.
  useEffect(() => {
    cuerpo.current?.scrollTo({ top: 0 })
  }, [productoId])

  return (
    <div className={styles.fondo}>
      <div
        ref={caja}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        data-modal-producto
      >
        <header className={styles.barra}>
          <code className={styles.sku} id={idTitulo}>
            {data?.sku ?? 'Producto'}
          </code>
          <div className={styles.accionesBarra}>
            {data ? (
              <LinkButton to={`/catalogo/${encodeURIComponent(data.sku)}`} variant="ghost" size="sm">
                Abrir ficha
              </LinkButton>
            ) : null}
            <IconButton icon="x" aria-label="Cerrar el producto" onClick={onCerrar} />
          </div>
        </header>

        <div className={styles.cuerpo} ref={cuerpo}>
          {error ? (
            <Alert tone="danger" role="alert" title="No se pudo leer el producto">
              <p>{error.message}</p>
            </Alert>
          ) : isPending ? (
            <EsqueletoProducto />
          ) : data === null ? (
            <Alert tone="warning" title="Producto no encontrado">
              <p>No existe, o no está entre los productos que podés ver.</p>
            </Alert>
          ) : (
            <Contenido
              producto={data}
              moneda={moneda}
              esInterno={esInterno}
              definiciones={definiciones}
              relacionados={relacionados.data?.productos ?? []}
              fuentes={relacionados.data?.fuentes}
              cargandoRelacionados={relacionados.isPending}
              movimientos={movimientos.data}
              cargandoMovimientos={movimientos.isFetching}
              verHistorial={verHistorial}
              onVerHistorial={() => setVerHistorial(true)}
              onAbrirOtro={onAbrirOtro}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface ContenidoProps {
  producto: ProductoDetalle
  moneda: string | null
  esInterno: boolean
  definiciones: readonly DefinicionAtributo[]
  relacionados: ProductoListado[]
  /** De dónde salió cada relacionado: curado del legacy o calculado. */
  fuentes: ReadonlyMap<string, 'legacy' | 'calculated'> | undefined
  cargandoRelacionados: boolean
  movimientos: { movimientos: MovimientoDeStock[]; total: number } | undefined
  cargandoMovimientos: boolean
  verHistorial: boolean
  onVerHistorial: () => void
  onAbrirOtro: (id: string) => void
}

function Contenido({
  producto,
  moneda,
  esInterno,
  definiciones,
  relacionados,
  fuentes,
  cargandoRelacionados,
  movimientos,
  cargandoMovimientos,
  verHistorial,
  onVerHistorial,
  onAbrirOtro,
}: ContenidoProps) {
  const hoja = hojaDeCatalogo(producto.atributos, producto.imagenes)
  const fisicos = [
    producto.ncm ? { etiqueta: 'NCM', valor: producto.ncm } : null,
    producto.pesoG !== null ? { etiqueta: 'Peso', valor: `${producto.pesoG} g` } : null,
    producto.volumenCm3 !== null
      ? { etiqueta: 'Volumen', valor: `${producto.volumenCm3} cm³` }
      : null,
    producto.origen ? { etiqueta: 'Origen', valor: producto.origen } : null,
  ].filter((x): x is { etiqueta: string; valor: string } => x !== null)

  return (
    <>
      {/* ── 1 · identidad ─────────────────────────────────────────────── */}
      <section className={styles.identidad}>
        <div className={styles.foto}>
          <ImagenProducto imagen={producto.imagen} alt={producto.nombre} tamano="full" />
        </div>
        <div className={styles.datos}>
          <h2 className={styles.nombre}>{producto.nombre}</h2>
          {producto.descripcion ? (
            <p className={styles.descripcion}>{producto.descripcion}</p>
          ) : null}
          {/* Fase 22 · B: se puede llegar acá por un link viejo o desde un
              documento histórico. El producto se muestra —los documentos que
              lo nombran tienen que poder abrirlo— pero se dice que no está en
              el catálogo, en vez de hacer como si nada. */}
          {!producto.enCatalogo ? (
            <p className={styles.fueraDelCatalogo}>
              Este producto no aparece en el catálogo: su marca está desactivada en Configuración.
            </p>
          ) : null}

          {producto.esKit || producto.necesitaRevision ? (
            <p className={styles.estados}>
              {producto.esKit ? <Badge tone="info">Kit</Badge> : null}
              {producto.necesitaRevision ? (
                <Badge tone="warning" dot>
                  Datos a revisar
                </Badge>
              ) : null}
            </p>
          ) : null}

          <dl className={styles.ficha}>
            <Dato etiqueta="Marca" valor={producto.marca?.nombre} />
            <Dato etiqueta="Categoría" valor={producto.categoria?.nombre} />
            <Dato etiqueta="Tipo" valor={producto.tipo} />
            <Dato etiqueta="Serie" valor={producto.serie} />
            <Dato etiqueta="Modelo" valor={producto.modelo} />
          </dl>

          {/* ── 2 · comercial ──────────────────────────────────────────── */}
          <div className={styles.comercial}>
            <div className={styles.precio}>
              <span className={styles.rotulo}>Precio</span>
              <strong className={styles.precioValor}>
                {formatearPrecio(producto.precio, moneda)}
              </strong>
            </div>
            {/* El stock sólo llega para roles internos: lo decide RLS, no la
                pantalla. Si no vino, no se muestra ni se inventa un cero. */}
            {esInterno && producto.stock ? (
              <>
                <div className={styles.stockDato}>
                  <span className={styles.rotulo}>Stock real</span>
                  <strong className={producto.stock.real < 0 ? styles.negativo : undefined}>
                    {producto.stock.real}
                  </strong>
                </div>
                <div className={styles.stockDato}>
                  <span className={styles.rotulo}>Stock virtual</span>
                  <strong className={producto.stock.virtual < 0 ? styles.negativo : undefined}>
                    {producto.stock.virtual}
                  </strong>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── 3 · características ─────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="mp-atributos">
        <h3 className={styles.tituloSeccion} id="mp-atributos">
          Características
        </h3>
        <ListaAtributos atributos={producto.atributos} definiciones={definiciones} />
      </section>

      {/* ── 4 · físicos y aduana: sólo si hay algo ──────────────────────── */}
      {fisicos.length > 0 ? (
        <section className={styles.seccion} aria-labelledby="mp-fisicos">
          <h3 className={styles.tituloSeccion} id="mp-fisicos">
            Datos físicos y aduana
          </h3>
          <dl className={styles.ficha}>
            {fisicos.map((f) => (
              <Dato key={f.etiqueta} etiqueta={f.etiqueta} valor={f.valor} />
            ))}
          </dl>
        </section>
      ) : null}

      {/* ── 5 · relacionados ────────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="mp-relacionados">
        <h3 className={styles.tituloSeccion} id="mp-relacionados">
          Productos similares
        </h3>
        {/* El MISMO comparador que el hover, en variante completa: acá hay
            espacio para más columnas y para la miniatura de cada uno. Un
            solo componente, así el modal y la ficha no pueden decir cosas
            distintas del mismo par de productos. */}
        {relacionados.length > 0 ? (
          <ComparadorProductos
            principal={producto}
            similares={relacionados}
            fuentes={fuentes}
            familia={producto.categoria?.slug ?? null}
            moneda={moneda}
            onAbrirProducto={onAbrirOtro}
            variante="completa"
          />
        ) : null}
        <RelacionadosProducto
          productos={relacionados}
          cargando={cargandoRelacionados}
          moneda={moneda}
          onAbrir={onAbrirOtro}
        />
      </section>

      {/* ── 6 · historial ───────────────────────────────────────────────── */}
      {esInterno ? (
        <section className={styles.seccion} aria-labelledby="mp-historial">
          <h3 className={styles.tituloSeccion} id="mp-historial">
            Historial de stock
          </h3>
          <HistorialStock
            movimientos={movimientos?.movimientos ?? []}
            total={movimientos?.total ?? 0}
            stockActual={producto.stock}
            abierto={verHistorial}
            cargando={cargandoMovimientos}
            onAbrir={onVerHistorial}
          />
        </section>
      ) : null}

      {/* ── 7 · hoja del catálogo ───────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="mp-hoja">
        <h3 className={styles.tituloSeccion} id="mp-hoja">
          Hoja del catálogo
        </h3>
        <HojaCatalogo hoja={hoja} marca={producto.marca?.nombre ?? null} />
      </section>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  // Un dato que no está no ocupa una fila con una raya: se omite.
  if (!valor) return null
  return (
    <div className={styles.dato}>
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  )
}
