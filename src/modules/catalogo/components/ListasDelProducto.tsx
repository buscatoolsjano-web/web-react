import { useQuery } from '@tanstack/react-query'
import { Alert } from '@/components/feedback/Alert'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { avisosDePrecio, variacionDeLista } from '../lib/avisosDePrecio'
import { formatearPrecio } from '../lib/formato'
import styles from './ListasDelProducto.module.css'

const fechaCorta = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * El costo y la venta de las listas del proveedor, al lado del precio.
 *
 * «Tener el costo de compra y el precio de venta» y «aviso cuando el precio
 * de venta quedó por debajo de la última lista». Sólo para la gente de la
 * empresa: el costo nunca se le muestra a un cliente (y la RLS de las listas
 * tampoco se lo devolvería).
 */
export function ListasDelProducto({
  productId,
  precio,
  moneda,
}: {
  productId: string
  precio: number | null
  moneda: string | null
}) {
  const companyId = useEmpresa().activa?.companyId ?? null
  const q = useQuery({
    queryKey: ['catalogo', companyId, 'listas-del-producto', productId],
    // El servicio se carga al usarse: así el cliente de Supabase no entra en
    // los tests de las pantallas que muestran la ficha.
    queryFn: async () => (await import('../services/listasDelProducto')).listasDelProducto(companyId!, productId),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
  const listas = q.data ?? []
  if (q.isLoading || listas.length === 0) return null
  const avisos = avisosDePrecio(precio, moneda, listas)

  return (
    <div className={styles.caja}>
      <span className={styles.titulo}>Según las listas del proveedor</span>
      <table className={styles.tabla}>
        <thead>
          <tr>
            <th scope="col">Lista</th>
            <th scope="col" className={styles.num}>Costo</th>
            <th scope="col" className={styles.num}>Venta</th>
            <th scope="col" className={styles.num}>Cambio</th>
          </tr>
        </thead>
        <tbody>
          {listas.map((l) => {
            const v = variacionDeLista(l)
            return (
              <tr key={`${l.fuente}-${l.fecha}`}>
                <td>
                  {l.fuente}
                  <span className={styles.fecha}>{fechaCorta(l.fecha)}</span>
                </td>
                <td className={styles.num}>{l.costo === null ? '—' : formatearPrecio(l.costo, l.monedaCosto)}</td>
                <td className={styles.num}>
                  {l.venta !== null
                    ? formatearPrecio(l.venta, l.monedaVenta)
                    : l.ancla !== null
                      ? formatearPrecio(l.ancla, l.moneda)
                      : '—'}
                </td>
                <td className={styles.num}>
                  {v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {avisos.map((a) => (
        <Alert key={a.texto} tone={a.gravedad === 'peligro' ? 'danger' : a.gravedad === 'atencion' ? 'warning' : 'info'}>
          <p>{a.texto}</p>
        </Alert>
      ))}
    </div>
  )
}
