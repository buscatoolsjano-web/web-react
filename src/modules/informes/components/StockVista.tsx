import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useMesInformes } from '../hooks/useMesInformes'
import { useResumenStock } from '../hooks/useStock'
import { etiquetaTramo } from '../lib/actividad'
import { ErrorInforme } from '../services/actividad'
import { KardexProducto, type ProductoKardex } from './KardexProducto'
import { MovimientosStock } from './MovimientosStock'
import { ResumenStockSeccion } from './ResumenStock'
import { SelectorMes } from './SelectorMes'
import { TablaStock } from './TablaStock'
import styles from './Informes.module.css'

/**
 * Informes · Stock (Entrega 4). Cantidades físicas del ERP nuevo: saldo por
 * producto y depósito, reservas, movimientos y kardex. Nada de valor, costo ni
 * «stock crítico».
 */
export function StockVista() {
  const { mes } = useMesInformes()
  const companyId = useEmpresa().activa?.companyId ?? null
  const queryClient = useQueryClient()
  const resumen = useResumenStock(mes)
  const actualizando = useIsFetching({ queryKey: ['informes', companyId, 'stock'] }) > 0
  const [producto, setProducto] = useState<ProductoKardex | null>(null)
  const kardexRef = useRef<HTMLDivElement>(null)

  const verKardex = (p: ProductoKardex) => {
    setProducto(p)
    // Después del render: la sección ya tiene el producto.
    requestAnimationFrame(() => kardexRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className={styles.vista}>
      <header className={styles.encabezado}>
        <div>
          <h2 className={styles.tituloVista}>Stock</h2>
          <p className={styles.subtitulo}>Cantidades físicas del ERP. Sin valorización, costo ni stock crítico.</p>
        </div>
        <div className={styles.accionesEncabezado}>
          <SelectorMes etiqueta="Mes de movimientos" />
          <Button
            variant="ghost"
            icon={<Icon name="refresh" size={16} />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['informes', companyId, 'stock'] })}
            loading={actualizando}
          >
            {actualizando ? 'Actualizando…' : 'Actualizar'}
          </Button>
        </div>
      </header>

      <details className={styles.reglas}>
        <summary>Cómo se calcula</summary>
        <ul>
          <li><b>Stock</b> es el saldo de cada producto <b>en cada depósito</b> (<code>stock_balances</code>), que mantienen los movimientos. <b>Disponible</b> = en stock − reservado.</li>
          <li><b>Stock negativo</b> (en stock menor que 0) y <b>disponible negativo</b> (reservas mayores que el stock) son problemas distintos y se cuentan por separado. Informes los muestra, no los corrige.</li>
          <li>Los conteos son sobre <b>saldos producto·depósito existentes</b>, no sobre el catálogo. Un producto sin saldo nunca tuvo movimientos: no es «stock 0».</li>
          <li><b>Entrada</b> y <b>salida</b> salen del <b>signo</b> de la cantidad, no del tipo de movimiento. No se suman unidades de productos distintos: se cuentan movimientos y productos.</li>
          <li>El <b>kardex</b> muestra el saldo después de cada movimiento sólo si la suma de todos coincide con el saldo actual del depósito.</li>
          <li>Sin <b>valorización</b>, <b>costo</b>, <b>margen</b>, <b>stock crítico</b> ni <b>punto de pedido</b>: no hay datos aprobados para calcularlos.</li>
        </ul>
      </details>

      {resumen.isPending ? (
        <div className={styles.cargando}>
          <SkeletonRows rows={4} columns={4} label="Leyendo el stock…" />
        </div>
      ) : resumen.error ? (
        <ErrorState
          title={resumen.error instanceof ErrorInforme ? resumen.error.message : 'No se pudo leer el stock.'}
          onRetry={resumen.error instanceof ErrorInforme && resumen.error.codigo !== 'desconocido' ? undefined : () => void resumen.refetch()}
          retrying={resumen.isFetching}
        />
      ) : (
        <>
          <ResumenStockSeccion resumen={resumen.data} />
          <TablaStock depositos={resumen.data.depositos} onVerKardex={verKardex} />
          <MovimientosStock
            mes={mes}
            etiquetaMes={etiquetaTramo({ ...resumen.data.mes, parcial: resumen.data.mes.hasta.slice(8, 10) !== String(new Date(Date.UTC(Number(resumen.data.mes.hasta.slice(0, 4)), Number(resumen.data.mes.hasta.slice(5, 7)), 0)).getUTCDate()) })}
            resumen={resumen.data}
          />
          <div ref={kardexRef}>
            <KardexProducto producto={producto} onElegir={setProducto} depositos={resumen.data.depositos} />
          </div>
        </>
      )}
    </div>
  )
}
