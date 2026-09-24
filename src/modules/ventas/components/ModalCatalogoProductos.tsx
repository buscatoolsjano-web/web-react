import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Spinner } from '@/components/ui/Spinner'
import { ImagenProducto } from '@/modules/catalogo/components/ImagenProducto'
import type { ProductoListado } from '@/modules/catalogo/types'
import { formatearImporte } from '../lib/formato'
import {
  POR_PAGINA,
  useCatalogoParaDocumento,
  useCategoriasParaDocumento,
  type FiltroCatalogoDocumento,
} from '../hooks/useCatalogoParaDocumento'
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

const FILTRO_INICIAL: FiltroCatalogoDocumento = { texto: '', categoria: '', pagina: 1 }

/**
 * Elegir productos del catálogo sin salir del documento (Fase 28 · E1).
 *
 * Réplica de «Añadir productos o servicios» del sistema anterior: botones de
 * categoría arriba, un buscador, y una tabla con foto, referencia, nombre,
 * categoría, marca, los dos saldos de stock, el precio y la cantidad.
 *
 * Lo que cambia respecto del buscador que había antes acá:
 *
 *  · **Se puede recorrer.** El anterior exigía dos letras y sólo buscaba: sin
 *    escribir no mostraba nada, así que no servía para «mostrame los
 *    balanceadores». Ahora la categoría lista.
 *  · **Se ve lo que hace falta para decidir**: la foto, el stock y el precio.
 *    Antes era una lista de nombres.
 *  · **Se agregan varios sin cerrar.** Cada «Agregar» suma una línea y la
 *    ventana queda abierta, que es como se carga un pedido de verdad.
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
  const [filtro, setFiltro] = useState<FiltroCatalogoDocumento>(FILTRO_INICIAL)
  const [texto, setTexto] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [agregados, setAgregados] = useState<string[]>([])

  // Se espera a que pare de tipear: sin esto, «balanceador» son once consultas.
  useEffect(() => {
    const t = setTimeout(() => setFiltro((f) => (f.texto === texto ? f : { ...f, texto, pagina: 1 })), 300)
    return () => clearTimeout(t)
  }, [texto])

  const categorias = useCategoriasParaDocumento()
  const { data, isPending, isFetching, error } = useCatalogoParaDocumento(filtro, listaPrecioId)
  const productos = data?.productos ?? []
  const total = data?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  // Al cambiar de página se vuelve arriba: si no, se sigue mirando el final
  // de la anterior con filas nuevas.
  const cuerpo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // `scrollTop` y no `scrollTo`: es lo que entienden todos, jsdom incluido.
    if (cuerpo.current) cuerpo.current.scrollTop = 0
  }, [filtro.pagina, filtro.categoria])

  const cantidadDe = (id: string) => {
    const n = Number((cantidades[id] ?? '1').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  const agregar = (p: ProductoListado) => {
    onAgregar(p, cantidadDe(p.id))
    // La confirmación es del producto, no un cartel global: con veinte filas
    // en pantalla hay que saber cuál se agregó.
    setAgregados((a) => [...a, p.id])
  }

  return (
    <Dialog
      open
      onClose={onCerrar}
      title="Añadir productos o servicios"
      size="lg"
      closeOnOverlay={false}
      footer={
        <Button variant="secondary" onClick={onCerrar}>
          Listo
        </Button>
      }
    >
      <div className={styles.filtros}>
        <div className={styles.categorias} role="group" aria-label="Categoría">
          <Button
            variant={filtro.categoria === '' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFiltro((f) => ({ ...f, categoria: '', pagina: 1 }))}
          >
            Todos
          </Button>
          {(categorias.data ?? []).map((c) => (
            <Button
              key={c.id}
              variant={filtro.categoria === c.id ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setFiltro((f) => ({ ...f, categoria: c.id, pagina: 1 }))}
            >
              {c.nombre}
            </Button>
          ))}
        </div>

        <Field label="Buscar por SKU, nombre o descripción" hideLabel>
          <Input
            type="search"
            value={texto}
            placeholder="Buscar por SKU, nombre o descripción…"
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
          />
        </Field>
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
                <th scope="col">SKU</th>
                <th scope="col">Nombre</th>
                <th scope="col">Categoría</th>
                <th scope="col">Marca</th>
                {esInterno ? (
                  <>
                    <th scope="col" className={styles.num} title="Stock virtual">
                      SV
                    </th>
                    <th scope="col" className={styles.num} title="Stock real">
                      SR
                    </th>
                  </>
                ) : null}
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
                    <ImagenProducto imagen={p.imagen} alt="" tamano="thumb" />
                  </td>
                  <td>
                    <code className={styles.sku}>{p.sku}</code>
                  </td>
                  <td className={styles.colNombre}>{p.nombre}</td>
                  <td className={styles.secundario}>{p.categoria?.nombre ?? '—'}</td>
                  <td className={styles.secundario}>{p.marca?.nombre ?? '—'}</td>
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
                      {agregados.includes(p.id) ? 'Agregar otra vez' : '+ Agregar'}
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
          {agregados.length > 0
            ? ` · ${agregados.length === 1 ? '1 línea agregada' : `${agregados.length} líneas agregadas`}`
            : ''}
        </span>
        {paginas > 1 ? (
          <span className={styles.paginador}>
            <Button
              variant="secondary"
              size="sm"
              disabled={filtro.pagina <= 1}
              onClick={() => setFiltro((f) => ({ ...f, pagina: f.pagina - 1 }))}
            >
              Anterior
            </Button>
            <span className={styles.nota}>
              Página {filtro.pagina} de {paginas}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={filtro.pagina >= paginas}
              onClick={() => setFiltro((f) => ({ ...f, pagina: f.pagina + 1 }))}
            >
              Siguiente
            </Button>
          </span>
        ) : null}
      </div>
    </Dialog>
  )
}
