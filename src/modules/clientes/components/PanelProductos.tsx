import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import tabla from '@/components/tables/Tabla.module.css'
import { useDebounce } from '@/hooks/useDebounce'
import { useProductosDelCliente } from '../hooks/useClientes'
import { Paginador } from './Paginador'
import { formatearFecha, formatearImporte } from '../lib/formato'
import styles from './PanelProductos.module.css'

export interface PanelProductosProps {
  clienteId: string
}

const PRODUCTO = { singular: 'producto', plural: 'productos' }

const RUTA = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
} as const

/** Una cantidad: entera si lo es, con decimales si los tiene. */
function cantidad(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n)
}

/**
 * Qué compra este cliente (Fase 17 · E4).
 *
 * La pregunta que responde es «¿qué le vendemos a este cliente?», y la
 * respuesta tiene una trampa que esta tabla no esconde: **cotizado no es
 * comprado**. Una cotización es una pregunta que el cliente hizo; un pedido es
 * una compra. Por eso van en columnas separadas y en ningún lado se suman.
 *
 * Tampoco se mezclan monedas: un producto cotizado en USD y en ARS aparece dos
 * veces, una por moneda. Sumar 100 USD y 100 ARS da 200 de nada.
 *
 * Y no se dice que un producto sea «habitual» o «preferido»: con un pedido no
 * alcanza para afirmarlo, y con veinte tampoco hace falta decirlo —el número
 * está a la vista—.
 */
export function PanelProductos({ clienteId }: PanelProductosProps) {
  const [texto, setTexto] = useState('')
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(25)
  const busqueda = useDebounce(texto, 300)

  const consulta = useProductosDelCliente(clienteId, {
    texto: busqueda,
    pagina,
    porPagina,
    habilitado: true,
  })

  const cambiarBusqueda = (v: string) => {
    setTexto(v)
    // Filtrar y quedarse en la página 7 deja la tabla vacía sin explicar por
    // qué: cada búsqueda empieza por el principio.
    setPagina(1)
  }

  const filas = consulta.data?.filas ?? []
  const total = consulta.data?.total ?? 0

  return (
    <div className={styles.wrap}>
      <div className={styles.filtros}>
        <Field label="Buscar producto" id="buscar-producto-cliente" optional>
          <Input
            type="search"
            value={texto}
            placeholder="SKU o nombre…"
            onChange={(e) => cambiarBusqueda(e.target.value)}
          />
        </Field>
      </div>

      {consulta.error ? (
        <Alert tone="danger" role="alert" title="No se pudieron leer los productos">
          <p>{consulta.error.message}</p>
        </Alert>
      ) : null}

      {consulta.isPending ? (
        <SkeletonRows rows={5} columns={5} label="Cargando productos…" />
      ) : filas.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          icon="package"
          title={busqueda.trim() === '' ? 'Sin productos' : 'Ningún producto coincide'}
          description={
            busqueda.trim() === ''
              ? 'Cuando este cliente tenga cotizaciones o pedidos con productos del catálogo, acá se ve qué lleva y cuánto.'
              : 'Probá con otro SKU o parte del nombre.'
          }
        />
      ) : (
        <>
          <div className={tabla.contenedor}>
            <table className={tabla.tabla}>
              <caption className="sr-only">
                Productos que este cliente cotizó o pidió, por moneda
              </caption>
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Moneda</th>
                  <th scope="col" className={tabla.num}>
                    Pedido
                  </th>
                  <th scope="col" className={tabla.num}>
                    Cotizado
                  </th>
                  <th scope="col">Última vez</th>
                  <th scope="col" className={tabla.num}>
                    Última cant.
                  </th>
                  <th scope="col" className={tabla.num}>
                    Último precio
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => (
                  <tr key={`${p.productId ?? p.sku}-${p.moneda ?? ''}`}>
                    <td className={tabla.nowrap}>{p.sku ?? '—'}</td>
                    <td className={tabla.texto}>{p.nombre ?? '—'}</td>
                    <td className={tabla.nowrap}>{p.moneda ?? '—'}</td>
                    <td className={tabla.num}>
                      {p.pedidos === 0 ? (
                        <span className={styles.nada}>—</span>
                      ) : (
                        <>
                          {cantidad(p.cantidadPedida)}
                          <span className={styles.docs}>
                            {' '}
                            en {p.pedidos} {p.pedidos === 1 ? 'pedido' : 'pedidos'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={tabla.num}>
                      {p.cotizaciones === 0 ? (
                        <span className={styles.nada}>—</span>
                      ) : (
                        <>
                          {cantidad(p.cantidadCotizada)}
                          <span className={styles.docs}>
                            {' '}
                            en {p.cotizaciones}{' '}
                            {p.cotizaciones === 1 ? 'cotización' : 'cotizaciones'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={tabla.nowrap}>
                      <span className={styles.ultima}>
                        {formatearFecha(p.ultimaFecha)}
                        {p.ultimoDocumentoId ? (
                          <Link
                            className={tabla.enlace}
                            to={`${RUTA[p.ultimoTipo]}/${p.ultimoDocumentoId}`}
                          >
                            {p.ultimoNumero ?? 'Ver'}
                          </Link>
                        ) : null}
                        <Badge tone="neutral">
                          {p.ultimoTipo === 'pedido' ? 'Pedido' : 'Cotización'}
                        </Badge>
                      </span>
                    </td>
                    <td className={tabla.num}>{cantidad(p.ultimaCantidad)}</td>
                    <td className={tabla.num}>{formatearImporte(p.ultimoPrecio, p.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Paginador
            pagina={pagina}
            porPagina={porPagina}
            total={total}
            cargando={consulta.isFetching}
            sustantivo={PRODUCTO}
            onIr={setPagina}
            onTamano={(n) => {
              setPorPagina(n)
              setPagina(1)
            }}
          />
        </>
      )}
    </div>
  )
}
