import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useCarrito } from '@/modules/catalogo/hooks/useCarrito'
import { formatearImporte } from '@/modules/ventas/lib/formato'
import { resolverPorSku } from '../services/porSku'
import type { ProductoNombrado } from '../services/asistente'
import styles from './TarjetasProductos.module.css'

export interface TarjetasProductosProps {
  productos: readonly ProductoNombrado[]
}

/**
 * Los productos que el asistente nombró, como tarjetas con sus acciones
 * (Fase 40).
 *
 * EL PROBLEMA QUE RESUELVE. El asistente contestaba «SP.PH2 — SPEEDRILL: USD
 * 1,81; stock 400» y ahí se terminaba: para hacer algo con ese producto había
 * que copiar el SKU, cerrar el panel, ir al catálogo y buscarlo. La respuesta
 * era correcta y no servía para nada.
 *
 * Ahora cada producto es una tarjeta con «Ver» y «Agregar». Los datos vienen
 * ESTRUCTURADOS en la respuesta, no sacados de la prosa: el texto del modelo
 * sigue siendo texto y la tarjeta no depende de que haya escrito el guión en
 * el lugar correcto.
 *
 * LAS DOS ACCIONES NO CUESTAN LO MISMO. «Ver» es un link a `/catalogo/:sku` y
 * no necesita nada más. «Agregar» escribe en el carrito, que guarda el id real
 * del producto, así que los SKU se resuelven en una sola consulta al aparecer
 * las tarjetas. Mientras no estén resueltos el botón se ve deshabilitado: es
 * preferible a que el primer clic no haga nada.
 */
export function TarjetasProductos({ productos }: TarjetasProductosProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const skus = productos.map((p) => p.sku)

  const resueltos = useQuery({
    queryKey: ['asistente', 'productos-por-sku', companyId, skus],
    queryFn: () => resolverPorSku(companyId!, skus),
    enabled: companyId !== null && skus.length > 0,
    staleTime: 5 * 60_000,
  })

  const carrito = useCarrito()

  if (productos.length === 0) return null

  return (
    <ul className={styles.lista} aria-label="Productos de la respuesta">
      {productos.map((p) => {
        const real = resueltos.data?.get(p.sku) ?? null
        const enCarrito = real ? carrito.cantidadDe(real.id) : 0
        return (
          <li key={p.sku} className={styles.tarjeta}>
            <div className={styles.datos}>
              <code className={styles.sku}>{p.sku}</code>
              <span className={styles.nombre}>{p.nombre}</span>
              <span className={styles.cifras}>
                {p.precio !== null ? (
                  <span className={styles.precio}>{formatearImporte(p.precio, p.moneda)}</span>
                ) : (
                  <span className={styles.sinPrecio}>Sin precio</span>
                )}
                {/*
                  El saldo se dice con palabras y no sólo con un número suelto:
                  «0» al lado de un precio se lee como un precio de cero.
                */}
                {p.disponible !== null ? (
                  <span className={p.disponible > 0 ? styles.conStock : styles.sinStock}>
                    {p.disponible > 0 ? `${p.disponible} disponibles` : 'sin stock'}
                  </span>
                ) : null}
              </span>
            </div>

            <div className={styles.acciones}>
              <Link to={`/catalogo/${encodeURIComponent(p.sku)}`} className={styles.ver}>
                <Icon name="eye" size={16} />
                Ver
              </Link>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="cart" size={16} />}
                /* Sin el id no se puede agregar: el carrito guarda identidad,
                   no SKU. Pasa mientras resuelve, y también si el SKU que
                   nombró el modelo ya no existe en el catálogo. */
                disabled={real === null}
                onClick={() => real && carrito.producto(real).sumar()}
                aria-label={`Agregar ${p.sku} a la cotización`}
              >
                {enCarrito > 0 ? `Agregar (${enCarrito})` : 'Agregar'}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
