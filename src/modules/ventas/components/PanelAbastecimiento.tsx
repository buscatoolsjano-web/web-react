import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { estadoDeLinea, fechaCorta, formatear, pendienteDeCompra } from '../lib/abastecimiento'
import { abastecimientoDeVenta } from '../services/abastecimiento'
import { ModalGenerarCompra } from './ModalGenerarCompra'
import styles from './Abastecimiento.module.css'

const ESTADO_COMPRA: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
}
const RECEPCION: Record<string, string> = {
  pending: 'sin recibir',
  partially_received: 'recibido en parte',
  received: 'recibido',
}

/**
 * Las compras de una venta (Fase 237): la parte de Compras en la trazabilidad
 * del circuito.
 *
 * Por línea: lo vendido, los pedidos a proveedor que la cubren —con su estado,
 * cuánto es para esta venta y cuándo llega—, y lo que sigue pendiente. Arriba,
 * el botón para generar el pedido a proveedor de lo que falta.
 */
export function PanelAbastecimiento({
  tipo,
  documentoId,
  numero,
  moneda,
  puedeComprar,
}: {
  tipo: 'cotizacion' | 'pedido'
  documentoId: string
  numero: string | null
  moneda: string | null
  puedeComprar: boolean
}) {
  const { activa } = useEmpresa()
  const [generando, setGenerando] = useState(false)
  const datos = useQuery({
    queryKey: ['ventas', activa?.companyId, 'abastecimiento', tipo, documentoId],
    queryFn: () => abastecimientoDeVenta(tipo, documentoId),
    enabled: !!activa,
    staleTime: 30_000,
  })

  if (datos.isPending) return <SkeletonRows rows={2} label="Leyendo las compras de esta venta…" />
  if (datos.error) {
    return (
      <Alert tone="danger" role="alert">
        <p>{datos.error.message}</p>
      </Alert>
    )
  }

  const lineas = datos.data
  const conPendiente = lineas.filter((l) => l.productoId !== null && pendienteDeCompra(l) > 0).length

  return (
    <div className={styles.panel}>
      <div className={styles.cabecera}>
        <p className={styles.resumen}>
          {lineas.length === 0
            ? 'Esta venta no tiene líneas de producto.'
            : conPendiente === 0
              ? 'Todas las líneas tienen su compra o stock.'
              : `${conPendiente} ${conPendiente === 1 ? 'línea tiene' : 'líneas tienen'} cantidad pendiente de comprar.`}
        </p>
        {puedeComprar && lineas.length > 0 ? (
          <Button icon={<Icon name="truck" size={16} />} onClick={() => setGenerando(true)}>
            Generar pedido a proveedor
          </Button>
        ) : null}
      </div>

      {lineas.length > 0 ? (
        <ul className={styles.lineas}>
          {lineas.map((l) => {
            const estado = estadoDeLinea(l)
            return (
              <li key={l.lineaId} className={styles.linea}>
                <div className={styles.lineaCabecera}>
                  <span className={styles.sku}>{l.sku ?? '—'}</span>
                  <span className={styles.nombre}>{l.nombre ?? '—'}</span>
                  <span className={`${styles.estado} ${styles[`tono_${estado.tono}`]}`}>{estado.texto}</span>
                </div>
                <p className={styles.cifras}>
                  Vendido {formatear(l.vendido)} · pedido para esta venta {formatear(l.pedidoParaVenta)} · stock{' '}
                  {formatear(l.stockDisponible)}
                </p>
                {l.compras.length > 0 ? (
                  <ul className={styles.compras}>
                    {l.compras.map((c) => (
                      <li key={`${c.pedidoId}-${c.cantidad}`}>
                        <Link to={`/compras/pedidos/${c.pedidoId}`} className={styles.enlace}>
                          {c.numero}
                        </Link>{' '}
                        <span className={styles.chipEstado}>{ESTADO_COMPRA[c.estado] ?? c.estado}</span>{' '}
                        {formatear(c.paraVenta)} para esta venta
                        {c.cantidad > c.paraVenta ? ` (+${formatear(c.cantidad - c.paraVenta)} para stock)` : ''}
                        {' · '}
                        {c.estadoRecepcion === 'received'
                          ? 'recibido'
                          : c.llegadaEstimada
                            ? `llega ${fechaCorta(c.llegadaEstimada)}`
                            : 'sin fecha de llegada'}
                        {c.estadoRecepcion === 'partially_received' ? ` · ${RECEPCION[c.estadoRecepcion]} (${formatear(c.recibido)})` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {generando ? (
        <ModalGenerarCompra
          tipo={tipo}
          numero={numero}
          moneda={moneda}
          lineas={lineas}
          onCerrar={() => setGenerando(false)}
        />
      ) : null}
    </div>
  )
}
