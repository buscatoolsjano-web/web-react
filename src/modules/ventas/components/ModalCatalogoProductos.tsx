import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { ModalNuevoProducto } from '@/modules/catalogo/components/ModalNuevoProducto'
import type { ProductoCreado } from '@/modules/catalogo/services/altaProducto'
import { ListadoProductos } from '@/modules/catalogo/components/ListadoProductos'
import { PanelFacetas } from '@/modules/catalogo/components/PanelFacetas'
import { useDisponibilidad } from '@/modules/catalogo/hooks/useProductos'
import { columnasDinamicas } from '@/modules/catalogo/lib/columnasDinamicas'
import {
  type FiltrosCatalogo,
  type OrdenCatalogo,
  type ProductoListado,
} from '@/modules/catalogo/types'
import type { UltimoPrecio } from '@/modules/clientes/types'
import { formatearImporte } from '../lib/formato'
import { mismoPrecio, precioParaLineaNueva } from '../lib/ultimoPrecio'
import {
  FILTROS_MODAL,
  POR_PAGINA,
  useCatalogoParaDocumento,
  useFacetasParaDocumento,
} from '../hooks/useCatalogoParaDocumento'
import styles from './ModalCatalogoProductos.module.css'

export interface ModalCatalogoProductosProps {
  /** La tarifa del documento: de ahí sale el precio que se propone. */
  listaPrecioId: string | null
  moneda: string | null
  /** Sólo un rol interno ve stock; RLS decide qué llega. */
  esInterno: boolean
  /**
   * El último precio de este cliente por producto (Fase 40).
   *
   * Lo pide la página, una vez, y lo comparte con el editor de líneas: el
   * histórico es por cliente, no por página del catálogo, así que recorrer el
   * catálogo no cuesta ninguna consulta.
   */
  historicos?: Map<string, UltimoPrecio> | undefined
  onCerrar: () => void
  /**
   * Se llama una vez por producto agregado, con la cantidad elegida y con el
   * PRECIO QUE CORRESPONDE.
   *
   * El precio es un tercer argumento y no `p.precio` porque ya no sale de un
   * solo lado: si este cliente ya compró este producto, manda el precio que se
   * le cobró; si no, la tarifa del documento. La decisión se toma acá, una vez,
   * en vez de repetirla en las cuatro pantallas que agregan líneas.
   */
  onAgregar: (p: ProductoListado, cantidad: number, precio: PrecioPropuesto) => void
}

/** El precio con el que entra la línea, y de dónde salió. */
export interface PrecioPropuesto {
  precio: number
  /** `true`: vino del histórico del cliente, no de la tarifa. */
  deHistorico: boolean
}

/** Una sola instancia: un `new Map()` por render rompería las memos. */
const SIN_HISTORICO: Map<string, UltimoPrecio> = new Map()

/* Los filtros de arranque viven en el hook, junto a la precarga: si cada uno
   armara los suyos, un campo distinto bastaría para que la clave no coincidiera
   y la precarga dejara de servir sin que nadie lo note. */

/**
 * Elegir productos del catálogo sin salir del documento (Fase 28 · E1).
 *
 * Réplica de «Añadir productos o servicios» del sistema anterior: los filtros
 * del catálogo arriba, un buscador, y la tabla del catálogo con una columna de
 * cantidad y un botón de agregar al final.
 *
 * **La tabla es LA DEL CATÁLOGO, no una parecida** (Fase 42). Hasta ahora este
 * modal tenía su propio `<thead>` escrito a mano, y pasó lo que pasa siempre:
 * se separaron. El catálogo mostraba Modelo, Serie y Tipo; acá no estaban. Acá
 * había una columna Nombre que el catálogo sacó en la Fase 38. Los dos saldos
 * de stock estaban en orden inverso, así que el número que se leía bajo «SV»
 * en una pantalla era el de «Stock real» en la otra —el peor de los errores
 * posibles, porque no se ve—. Ahora las dos pantallas renderizan
 * `ListadoProductos` y las columnas no pueden volver a divergir.
 *
 * Lo propio de acá entra por los tres huecos que ese listado deja: la celda de
 * precio (que puede ser el histórico de este cliente y no el de la tarifa),
 * las columnas «Cant.» y «Agregar», y la marca de lo ya agregado. Y se pide
 * `navegable={false}`: tocar una fila no puede abandonar la cotización.
 *
 * Los filtros son los MISMOS de la pantalla de Catálogo —`PanelFacetas` sobre
 * `catalog_facets`—, así que al elegir una categoría aparecen sus atributos
 * (encastre, medida, largo…) con los valores que existen de verdad y su
 * conteo. No hay una segunda definición de qué se puede filtrar.
 *
 * Lo que cambia respecto del buscador que había antes acá:
 *
 *  · **Se puede recorrer.** El anterior exigía dos letras y sólo buscaba: sin
 *    escribir no mostraba nada, así que no servía para «mostrame los
 *    balanceadores de 1 a 2 kg».
 *  · **Se ve lo que hace falta para decidir**: la foto, el stock y el precio.
 *  · **Se agregan varios sin cerrar.** Cada «Agregar» suma la cantidad elegida
 *    y la ventana queda abierta, que es como se carga un pedido de verdad.
 *
 * El precio sale de la tarifa del documento. Un producto sin precio en esa
 * tarifa se agrega igual, en cero y diciéndolo: es lo que ya hacía el carrito
 * del Catálogo, y esconderlo llevaría a cotizar gratis sin enterarse.
 */
export function ModalCatalogoProductos({
  listaPrecioId,
  moneda,
  esInterno,
  historicos = SIN_HISTORICO,
  onCerrar,
  onAgregar,
}: ModalCatalogoProductosProps) {
  const [filtros, setFiltros] = useState<FiltrosCatalogo>(FILTROS_MODAL)
  const [texto, setTexto] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [agregados, setAgregados] = useState<string[]>([])
  /** El alta de producto, encima de este modal (Fase 40). */
  const [creando, setCreando] = useState(false)
  const [reciente, setReciente] = useState<ProductoCreado | null>(null)

  // Se espera a que pare de tipear: sin esto, «balanceador» son once consultas.
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.q === texto ? f : { ...f, q: texto, pagina: 1 })), 300)
    return () => clearTimeout(t)
  }, [texto])

  // Cualquier cambio de filtro vuelve a la página 1: filtrar desde la página 9
  // dejaría la lista vacía sin explicación.
  const cambiarFiltros = (cambios: Partial<FiltrosCatalogo>) =>
    setFiltros((f) => ({ ...f, ...cambios, ...(cambios.pagina === undefined ? { pagina: 1 } : {}) }))

  const facetas = useFacetasParaDocumento(filtros)
  const { data, isPending, isFetching, error } = useCatalogoParaDocumento(filtros, listaPrecioId)
  const productos = useMemo(() => data?.productos ?? [], [data])
  const total = data?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  // Las columnas de la categoría elegida, igual que en la pantalla de
  // Catálogo: salen de las facetas y no de un mapa escrito a mano.
  const dinamicas = columnasDinamicas(filtros.categoria, facetas.data?.atributos ?? [], total)

  // Las unidades, para que un «1» suelto se lea «1 kg» en las tarjetas del
  // teléfono. Salen de las mismas facetas, que ya vienen con label y unidad.
  const unidades = useMemo(
    () => new Map((facetas.data?.atributos ?? []).map((a) => [a.key, a.unidad] as const)),
    [facetas.data],
  )

  // Un rol externo no ve saldos sino «Disponibilidad», igual que en el
  // Catálogo. El hook ya se desactiva solo para los internos, así que esto no
  // cuesta una consulta cuando no corresponde.
  const idsPagina = useMemo(() => productos.map((p) => p.id), [productos])
  const { data: disponibilidad } = useDisponibilidad(idsPagina)

  /**
   * Un click en el encabezado ordena por esa columna; otro, al revés. No hay
   * tercer click que saque el orden, igual que el sistema anterior.
   */
  const orden = {
    campo: filtros.orden.endsWith('_desc') ? filtros.orden.slice(0, -5) : filtros.orden,
    direccion: filtros.orden.endsWith('_desc') ? ('desc' as const) : ('asc' as const),
    ordenar: (campo: string) =>
      cambiarFiltros({ orden: (filtros.orden === campo ? `${campo}_desc` : campo) as OrdenCatalogo }),
  }

  // Al cambiar de página se vuelve arriba: si no, se sigue mirando el final
  // de la anterior con filas nuevas.
  const cuerpo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // `scrollTop` y no `scrollTo`: es lo que entienden todos, jsdom incluido.
    if (cuerpo.current) cuerpo.current.scrollTop = 0
  }, [filtros])

  const cantidadDe = (id: string) => {
    const n = Number((cantidades[id] ?? '1').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  const agregar = (p: ProductoListado) => {
    onAgregar(p, cantidadDe(p.id), precioParaLineaNueva(historicos.get(p.id), p.precio))
    // La confirmación es del producto, no un cartel global: con veinte filas
    // en pantalla hay que saber cuál se agregó.
    setAgregados((a) => (a.includes(p.id) ? a : [...a, p.id]))
  }

  return (
    <Dialog
      open
      onClose={onCerrar}
      title="Añadir productos o servicios"
      size="xl"
      closeOnOverlay={false}
      footer={
        <Button variant="secondary" onClick={onCerrar}>
          Listo
        </Button>
      }
    >
      <div className={styles.filtros}>
        {/* El alta va PEGADA al buscador y no en el pie, porque el momento en
            que hace falta es exactamente éste: buscaste, no está, y hasta ahora
            había que abandonar la cotización, ir al Catálogo, crearlo y volver
            a empezar. */}
        <div className={styles.barraBuscar}>
          <Field label="Buscar por SKU, nombre o descripción" hideLabel className={styles.campoBuscar}>
            <Input
              type="search"
              value={texto}
              placeholder="Buscar por SKU, nombre o descripción…"
              onChange={(e) => setTexto(e.target.value)}
              autoFocus
            />
          </Field>
          <Button variant="secondary" icon={<Icon name="plus" size={16} />} onClick={() => setCreando(true)}>
            Nuevo producto
          </Button>
        </div>

        {/* El cartel no dice sólo «listo»: dice qué hacer ahora. El producto
            recién creado no tiene precio en la tarifa del documento —no puede
            tenerlo, acaba de nacer— y entra en cero si nadie lo mira. */}
        {reciente ? (
          <Alert tone="success" title={`${reciente.sku} creado y agregado al buscador`}>
            <p>
              Ponele la cantidad y tocá «Agregar». Revisá el precio: un producto nuevo
              todavía no está en la tarifa de este documento.
            </p>
          </Alert>
        ) : null}

        {/* Los filtros del catálogo, tal cual: categorías, subcategorías,
            marca y los atributos de la categoría elegida. */}
        <PanelFacetas
          filtros={filtros}
          facetas={facetas.data}
          cargando={facetas.isPending}
          onCambiar={cambiarFiltros}
        />
      </div>

      {error ? (
        <Alert tone="danger" role="alert" title="No se pudo leer el catálogo">
          <p>{error.message}</p>
        </Alert>
      ) : null}

      <div className={styles.cuerpo} ref={cuerpo}>
        {!isPending && productos.length === 0 ? (
          <p className={styles.nota}>Ningún producto coincide.</p>
        ) : (
          <ListadoProductos
            productos={productos}
            esInterno={esInterno}
            moneda={moneda}
            disponibilidad={disponibilidad}
            unidades={unidades}
            cargando={isPending}
            columnasDinamicas={dinamicas}
            categoriaFija={filtros.categoria !== null}
            orden={orden}
            /* Tocar una fila no abre nada: dentro de un documento, navegar al
               producto deja la cotización a medio cargar. */
            navegable={false}
            claseDeFila={(p) => (agregados.includes(p.id) ? styles.filaAgregada : undefined)}
            precioCelda={(p) => <CeldaPrecio producto={p} moneda={moneda} historico={historicos.get(p.id)} />}
            accion={[
              {
                clave: 'cantidad',
                encabezado: 'Cant.',
                className: styles.num,
                celda: (p) => (
                  <Input
                    className={styles.cantidad}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    aria-label={`Cantidad de ${p.sku}`}
                    value={cantidades[p.id] ?? '1'}
                    onChange={(e) => setCantidades((c) => ({ ...c, [p.id]: e.target.value }))}
                  />
                ),
              },
              {
                clave: 'agregar',
                encabezado: <span className="sr-only">Agregar</span>,
                celda: (p) => (
                  <Button size="sm" onClick={() => agregar(p)}>
                    {agregados.includes(p.id) ? 'Sumar más' : '+ Agregar'}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </div>

      <div className={styles.pie}>
        <span className={styles.nota}>
          {isFetching && !isPending ? <Spinner size={16} /> : null}
          {total === 1 ? '1 producto' : `${total.toLocaleString('es-AR')} productos`}
          {/* Se cuentan PRODUCTOS, no líneas: elegir tres veces el mismo suma
              cantidad en una sola línea, así que «3 líneas» sería mentira. */}
          {agregados.length > 0
            ? ` · ${agregados.length === 1 ? '1 producto agregado' : `${agregados.length} productos agregados`}`
            : ''}
        </span>
        {paginas > 1 ? (
          <span className={styles.paginador}>
            <Button
              variant="secondary"
              size="sm"
              disabled={filtros.pagina <= 1}
              onClick={() => cambiarFiltros({ pagina: filtros.pagina - 1 })}
            >
              Anterior
            </Button>
            <span className={styles.nota}>
              Página {filtros.pagina} de {paginas}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={filtros.pagina >= paginas}
              onClick={() => cambiarFiltros({ pagina: filtros.pagina + 1 })}
            >
              Siguiente
            </Button>
          </span>
        ) : null}
      </div>

      {/*
       * El alta, encima de este modal.
       *
       * Al crearlo NO se agrega solo al documento: se deja listo en la lista,
       * buscado por su SKU, para que se elija la cantidad y se mire el precio
       * como con cualquier otro. Agregarlo de una escondería justo lo que hay
       * que revisar —que nació sin precio en esta tarifa—.
       *
       * El texto se escribe en los dos lados a la vez: en `texto`, para que el
       * buscador muestre lo que está filtrando, y en `filtros`, para saltear
       * los 300 ms del debounce. Esperarlos acá sería medio segundo de lista
       * vieja justo después de crear algo.
       */}
      {creando ? (
        <ModalNuevoProducto
          onCerrar={() => setCreando(false)}
          onCreado={(p) => {
            setCreando(false)
            setReciente(p)
            setTexto(p.sku)
            setFiltros((f) => ({ ...FILTROS_MODAL, q: p.sku, pagina: 1, porPagina: f.porPagina }))
          }}
        />
      ) : null}
    </Dialog>
  )
}

/**
 * El precio con el que va a entrar la línea.
 *
 * Si este cliente ya compró este producto, se muestra ESE precio, que es el
 * que va a entrar. Mostrar el de la tarifa y después cargar otro sería la peor
 * de las dos opciones. El de la tarifa queda abajo, tachado, para que se vea
 * la diferencia antes de agregar.
 */
function CeldaPrecio({
  producto,
  moneda,
  historico,
}: {
  producto: ProductoListado
  moneda: string | null
  historico: UltimoPrecio | undefined
}) {
  if (historico && historico.ultimoPrecio !== null) {
    return (
      <>
        <span
          className={styles.precioHistorico}
          title={`Último precio de este cliente · ${historico.ultimoTipo === 'pedido' ? 'pedido' : 'cotización'} ${historico.ultimoDocumento ?? ''}`}
        >
          {formatearImporte(historico.ultimoPrecio, moneda)}
        </span>
        {producto.precio !== null && !mismoPrecio(producto.precio, historico.ultimoPrecio) ? (
          <span className={styles.precioTarifa}>tarifa {formatearImporte(producto.precio, moneda)}</span>
        ) : null}
      </>
    )
  }
  return producto.precio === null ? (
    <span className={styles.sinPrecio} title="Sin precio en la tarifa del documento">
      —
    </span>
  ) : (
    <>{formatearImporte(producto.precio, moneda)}</>
  )
}
