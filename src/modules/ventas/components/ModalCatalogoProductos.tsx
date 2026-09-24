import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Spinner } from '@/components/ui/Spinner'
import { ImagenProducto } from '@/modules/catalogo/components/ImagenProducto'
import { EncabezadoOrdenable as Encabezado } from '@/modules/catalogo/components/EncabezadoOrdenable'
import { PanelFacetas } from '@/modules/catalogo/components/PanelFacetas'
import { columnasDinamicas, valorDinamico } from '@/modules/catalogo/lib/columnasDinamicas'
import {
  FILTROS_INICIALES,
  type FiltrosCatalogo,
  type OrdenCatalogo,
  type ProductoListado,
} from '@/modules/catalogo/types'
import { formatearImporte } from '../lib/formato'
import { POR_PAGINA, useCatalogoParaDocumento, useFacetasParaDocumento } from '../hooks/useCatalogoParaDocumento'
import styles from './ModalCatalogoProductos.module.css'

export interface ModalCatalogoProductosProps {
  /** La tarifa del documento: de ahí sale el precio que se propone. */
  listaPrecioId: string | null
  moneda: string | null
  /** Sólo un rol interno ve stock; RLS decide qué llega. */
  esInterno: boolean
  onCerrar: () => void
  /** Se llama una vez por producto agregado, con la cantidad elegida. */
  onAgregar: (p: ProductoListado, cantidad: number) => void
}

const INICIAL: FiltrosCatalogo = { ...FILTROS_INICIALES, porPagina: POR_PAGINA }

/**
 * Elegir productos del catálogo sin salir del documento (Fase 28 · E1).
 *
 * Réplica de «Añadir productos o servicios» del sistema anterior: los filtros
 * del catálogo arriba, un buscador, y una tabla con foto, referencia, nombre,
 * categoría, marca, los dos saldos de stock, el precio y la cantidad.
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
  onCerrar,
  onAgregar,
}: ModalCatalogoProductosProps) {
  const [filtros, setFiltros] = useState<FiltrosCatalogo>(INICIAL)
  const [texto, setTexto] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [agregados, setAgregados] = useState<string[]>([])

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
  const productos = data?.productos ?? []
  const total = data?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  // Las columnas de la categoría elegida, igual que en la pantalla de
  // Catálogo: salen de las facetas y no de un mapa escrito a mano.
  const dinamicas = columnasDinamicas(filtros.categoria, facetas.data?.atributos ?? [], total)

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
    onAgregar(p, cantidadDe(p.id))
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
        <Field label="Buscar por SKU, nombre o descripción" hideLabel>
          <Input
            type="search"
            value={texto}
            placeholder="Buscar por SKU, nombre o descripción…"
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
          />
        </Field>

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
        {isPending ? (
          <p className={styles.nota}>
            <Spinner size={16} /> Buscando…
          </p>
        ) : productos.length === 0 ? (
          <p className={styles.nota}>Ningún producto coincide.</p>
        ) : (
          <table className={styles.tabla}>
            <caption className="sr-only">Productos del catálogo</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.colImagen}>
                  <span className="sr-only">Imagen</span>
                </th>
                <Encabezado campo="sku" orden={orden}>
                  SKU
                </Encabezado>
                <Encabezado campo="nombre" orden={orden}>
                  Nombre
                </Encabezado>
                <Encabezado campo="categoria" orden={orden}>
                  Categoría
                </Encabezado>
                <Encabezado campo="marca" orden={orden}>
                  Marca
                </Encabezado>
                {/* Las columnas de la categoría elegida: en «Puntas y tubos»,
                    medida, largo y encastre. Salen de las facetas, no de una
                    lista escrita a mano, y ordenan como cualquier otra. */}
                {dinamicas.map((c) => (
                  <Encabezado key={c.key} campo={`attr:${c.key}`} orden={orden}>
                    {c.label}
                    {c.unidad ? <span className={styles.secundario}> {c.unidad}</span> : null}
                  </Encabezado>
                ))}
                {esInterno ? (
                  <>
                    <Encabezado campo="stock_virtual" orden={orden} className={styles.num}>
                      <span title="Stock virtual">SV</span>
                    </Encabezado>
                    <Encabezado campo="stock_real" orden={orden} className={styles.num}>
                      <span title="Stock real">SR</span>
                    </Encabezado>
                  </>
                ) : null}
                {/* Precio NO ordena: sale de la tarifa del documento y se
                    resuelve sobre la página ya traída, así que ordenar acá
                    ordenaría 25 filas y mentiría sobre las otras 4.791. */}
                <th scope="col" className={styles.num}>
                  Precio
                </th>
                <th scope="col" className={styles.num}>
                  Cant.
                </th>
                <th scope="col">
                  <span className="sr-only">Agregar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className={agregados.includes(p.id) ? styles.filaAgregada : undefined}>
                  <td className={styles.colImagen}>
                    <ImagenProducto imagen={p.imagen} alt="" tamano="thumb" prioridad="eager" />
                  </td>
                  <td>
                    <code className={styles.sku}>{p.sku}</code>
                  </td>
                  <td className={styles.colNombre}>{p.nombre}</td>
                  <td className={styles.secundario}>{p.categoria?.nombre ?? '—'}</td>
                  <td className={styles.secundario}>{p.marca?.nombre ?? '—'}</td>
                  {dinamicas.map((c) => (
                    <td key={c.key} className={styles.nowrap}>
                      {valorDinamico(p, c)}
                    </td>
                  ))}
                  {esInterno ? (
                    <>
                      <td className={styles.num}>{p.stock ? p.stock.virtual : '—'}</td>
                      <td className={styles.num}>{p.stock ? p.stock.real : '—'}</td>
                    </>
                  ) : null}
                  <td className={styles.num}>
                    {p.precio === null ? (
                      <span className={styles.sinPrecio} title="Sin precio en la tarifa del documento">
                        —
                      </span>
                    ) : (
                      formatearImporte(p.precio, moneda)
                    )}
                  </td>
                  <td className={styles.num}>
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
                  </td>
                  <td>
                    <Button size="sm" onClick={() => agregar(p)}>
                      {agregados.includes(p.id) ? 'Sumar más' : '+ Agregar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </Dialog>
  )
}
