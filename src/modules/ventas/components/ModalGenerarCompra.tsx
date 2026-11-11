import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/modals/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { BuscadorProveedor } from '@/modules/compras/components/BuscadorProveedor'
import { lineaDeProducto } from '@/modules/compras/lib/lineas'
import { pedidoVacio } from '@/modules/compras/lib/validacion'
import { crearPedido } from '@/modules/compras/services/pedidos'
import type { ProveedorBuscado } from '@/modules/compras/services/catalogo'
import { formatear, pendienteDeCompra, repartoDeCompra, sugeridoComprar } from '../lib/abastecimiento'
import { abastecimientoDeVenta, type LineaAbastecimiento } from '../services/abastecimiento'
import styles from './Abastecimiento.module.css'

/**
 * El mismo cuadro, abierto desde el menú «Más» de la venta: primero lee qué
 * se vendió, qué ya se pidió y el stock (Fase 237).
 */
export function ModalGenerarCompraDeVenta({
  tipo,
  id,
  numero,
  moneda,
  onCerrar,
}: {
  tipo: 'cotizacion' | 'pedido'
  id: string
  numero: string | null
  moneda: string | null
  onCerrar: () => void
}) {
  const { activa } = useEmpresa()
  const datos = useQuery({
    queryKey: ['ventas', activa?.companyId, 'abastecimiento', tipo, id],
    queryFn: () => abastecimientoDeVenta(tipo, id),
    enabled: !!activa,
    staleTime: 30_000,
  })
  if (datos.data) {
    return <ModalGenerarCompra tipo={tipo} numero={numero} moneda={moneda} lineas={datos.data} onCerrar={onCerrar} />
  }
  return (
    <Dialog open onClose={onCerrar} title="Pedido a proveedor" size="sm">
      {datos.error ? (
        <Alert tone="danger" role="alert">
          <p>{datos.error.message}</p>
        </Alert>
      ) : (
        <p>Leyendo qué se vendió y qué falta comprar…</p>
      )}
    </Dialog>
  )
}

/**
 * Generar un pedido a proveedor desde la venta (Fase 237).
 *
 * Cada línea muestra lo que hace falta para decidir: lo vendido, lo que ya se
 * pidió para esta venta, el stock y lo pendiente. La cantidad a comprar arranca
 * en lo sugerido (lo pendiente que el stock no cubre) pero es LIBRE: se puede
 * comprar de más para tener. Debajo de cada cantidad se dice el reparto —
 * cuánto es para esta venta y cuánto para stock— y así queda guardado.
 *
 * Crea el pedido de compra en BORRADOR, ya vinculado, y lleva a su ficha para
 * ponerle precios y confirmarlo. Un pedido por proveedor: si hay que comprarle
 * a dos, se genera dos veces (la segunda ya descuenta lo pedido en la primera).
 */
export function ModalGenerarCompra({
  tipo,
  numero,
  moneda,
  lineas,
  onCerrar,
}: {
  tipo: 'cotizacion' | 'pedido'
  numero: string | null
  moneda: string | null
  lineas: readonly LineaAbastecimiento[]
  onCerrar: () => void
}) {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const [proveedor, setProveedor] = useState<ProveedorBuscado | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(lineas.map((l) => [l.lineaId, String(sugeridoComprar(l))])),
  )

  const conProducto = lineas.filter((l) => l.productoId !== null)
  const elegidas = conProducto
    .map((l) => ({ l, comprar: Number((cantidades[l.lineaId] ?? '0').replace(',', '.')) || 0 }))
    .filter((x) => x.comprar > 0)

  const crear = useMutation({
    mutationFn: async () => {
      if (!activa || !proveedor) throw new Error('Elegí el proveedor.')
      const hoy = new Date().toISOString().slice(0, 10)
      const datos = {
        ...pedidoVacio(hoy),
        proveedorId: proveedor.id,
        moneda: proveedor.moneda || moneda || 'USD',
        formaPago: proveedor.formaPago ?? '',
        notas: numero ? `Para ${numero}` : '',
      }
      const lineasCompra = elegidas.map(({ l, comprar }, i) => ({
        ...lineaDeProducto({ id: l.productoId!, sku: l.sku ?? '', nombre: l.nombre ?? '' }, i + 1),
        cantidad: comprar,
        venta: {
          cotizacionLineaId: tipo === 'cotizacion' ? l.lineaId : null,
          pedidoLineaId: tipo === 'pedido' ? l.lineaId : null,
          cantidad: repartoDeCompra(comprar, l).paraVenta,
          documento: numero,
        },
      }))
      return crearPedido(activa.companyId, datos, lineasCompra)
    },
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, 'abastecimiento'] })
      void queryClient.invalidateQueries({ queryKey: ['compras', activa?.companyId] })
      onCerrar()
      void navegar(`/compras/pedidos/${id}`)
    },
  })

  return (
    <Dialog
      open
      onClose={onCerrar}
      size="xl"
      title={numero ? `Pedido a proveedor para ${numero}` : 'Pedido a proveedor'}
      description="Se crea en borrador, vinculado a esta venta. Después le ponés los precios y lo confirmás."
      busy={crear.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={crear.isPending}>
            Cancelar
          </Button>
          <Button
            icon={<Icon name="truck" size={16} />}
            loading={crear.isPending}
            disabled={!proveedor || elegidas.length === 0}
            onClick={() => crear.mutate()}
          >
            {elegidas.length === 0 ? 'Nada para comprar' : `Crear pedido (${elegidas.length} ${elegidas.length === 1 ? 'línea' : 'líneas'})`}
          </Button>
        </>
      }
    >
      <div className={styles.modal}>
        <BuscadorProveedor
          elegido={proveedor}
          onElegir={setProveedor}
          onLimpiar={() => setProveedor(null)}
        />

        <div className={styles.tablaScroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className={styles.num}>Vendido</th>
                <th scope="col" className={styles.num}>Ya pedido</th>
                <th scope="col" className={styles.num}>Stock</th>
                <th scope="col" className={styles.num}>Pendiente</th>
                <th scope="col" className={styles.num}>Comprar</th>
              </tr>
            </thead>
            <tbody>
              {conProducto.map((l) => {
                const comprar = Number((cantidades[l.lineaId] ?? '0').replace(',', '.')) || 0
                const { paraVenta, paraStock } = repartoDeCompra(comprar, l)
                const pendiente = pendienteDeCompra(l)
                return (
                  <tr key={l.lineaId}>
                    <td>
                      <span className={styles.sku}>{l.sku ?? '—'}</span>
                      <span className={styles.nombre}>{l.nombre ?? '—'}</span>
                    </td>
                    <td className={styles.num}>{formatear(l.vendido)}</td>
                    <td className={styles.num}>{formatear(l.pedidoParaVenta)}</td>
                    <td className={styles.num}>{formatear(l.stockDisponible)}</td>
                    <td className={`${styles.num} ${pendiente > 0 ? styles.falta : styles.cubierto}`}>
                      {formatear(pendiente)}
                    </td>
                    <td className={styles.num}>
                      <input
                        className={styles.cantidad}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={`Cantidad a comprar de ${l.sku ?? l.nombre ?? 'la línea'}`}
                        value={cantidades[l.lineaId] ?? ''}
                        onChange={(e) => setCantidades((c) => ({ ...c, [l.lineaId]: e.target.value }))}
                      />
                      {comprar > 0 ? (
                        <span className={styles.reparto}>
                          {paraVenta > 0 ? <span className={styles.chipVenta}>{formatear(paraVenta)} venta</span> : null}
                          {paraStock > 0 ? <span className={styles.chipStock}>{formatear(paraStock)} stock</span> : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className={styles.ayuda}>
          <strong>Pendiente</strong> es lo vendido que todavía no tiene compra. Lo que compres
          por encima queda marcado <span className={styles.chipStock}>para stock</span>.
        </p>

        {crear.error ? (
          <Alert tone="danger" role="alert">
            <p>{crear.error.message}</p>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  )
}
