import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { FILTROS_STOCK_INICIALES, POR_PAGINA_STOCK, useStockActual } from '../hooks/useStock'
import { descargarCsv, nombreArchivo } from '../lib/csv'
import { stockACsv } from '../lib/csvStock'
import { ETIQUETA_FILTRO_ESTADO, etiquetaEstado, formatearCantidad, formatearFechaHora, hoyAR } from '../lib/stock'
import { ErrorInforme } from '../services/actividad'
import { exportarStock } from '../services/stock'
import type { DepositoResumen, FiltroEstadoStock, FiltrosStock } from '../types'
import type { ProductoKardex } from './KardexProducto'
import { Paginador } from './Paginador'
import styles from './Informes.module.css'

interface Props {
  depositos: DepositoResumen[]
  onVerKardex: (p: ProductoKardex) => void
}

/** Saldos por producto y depósito, filtrados y paginados en el servidor. */
export function TablaStock({ depositos, onVerKardex }: Props) {
  const idTitulo = useId()
  const companyId = useEmpresa().activa?.companyId ?? null
  const [texto, setTexto] = useState('')
  const [filtros, setFiltros] = useState<FiltrosStock>(FILTROS_STOCK_INICIALES)
  const [pagina, setPagina] = useState(0)
  const stock = useStockActual(filtros, pagina)
  const filas = stock.data ?? []
  const total = Number(filas[0]?.total_filas ?? 0)

  const aplicar = (c: Partial<FiltrosStock>) => {
    setFiltros((f) => ({ ...f, ...c }))
    setPagina(0)
  }

  const exportar = useMutation({
    mutationFn: () => exportarStock(companyId!, filtros),
    onSuccess: (todas) => {
      const dep = depositos.find((d) => d.id === filtros.deposito)?.codigo
      descargarCsv(nombreArchivo(['stock', filtros.estado, dep, filtros.busqueda ? 'busqueda' : null, hoyAR()]), stockACsv(todas))
    },
  })

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Stock por producto y depósito</h2>
      </header>

      <div className={styles.tarjeta}>
        <form
          className={styles.controlesRanking}
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            aplicar({ busqueda: texto })
          }}
        >
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Producto o SKU</span>
            <input className={styles.inputTexto} type="search" value={texto} maxLength={100} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar" />
          </label>
          <Button type="submit" variant="secondary" icon={<Icon name="search" size={16} />}>Buscar</Button>
          {depositos.length > 1 ? (
            <label className={styles.control}>
              <span className={styles.controlEtiqueta}>Depósito</span>
              <select className={styles.select} value={filtros.deposito ?? ''} onChange={(e) => aplicar({ deposito: e.target.value || null })}>
                <option value="">Todos</option>
                {depositos.map((d) => <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>)}
              </select>
            </label>
          ) : null}
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Estado</span>
            <select className={styles.select} value={filtros.estado ?? ''} onChange={(e) => aplicar({ estado: (e.target.value || null) as FiltroEstadoStock | null })}>
              <option value="">Todos</option>
              {Object.entries(ETIQUETA_FILTRO_ESTADO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
        </form>

        {stock.isPending ? (
          <SkeletonRows rows={5} columns={5} label="Leyendo saldos…" />
        ) : stock.error ? (
          <ErrorState compact title={stock.error instanceof ErrorInforme ? stock.error.message : 'No se pudieron leer los saldos.'} />
        ) : filas.length === 0 ? (
          <p className={styles.vacio}>Ningún saldo coincide con los filtros.</p>
        ) : (
          <div className={`${styles.tablaScroll} ${styles.tarjetaPeriodos}`}>
            <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
              <caption className={styles.oculto}>Stock por producto y depósito</caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Depósito</th>
                  <th scope="col" className={styles.num}>En stock</th>
                  <th scope="col" className={styles.num}>Reservado</th>
                  <th scope="col" className={styles.num}>Disponible</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Último movimiento</th>
                  <th scope="col"><span className={styles.oculto}>Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const estados = etiquetaEstado(f)
                  const problema = f.estado === 'negativo' || f.disponible_negativo
                  return (
                    <tr key={`${f.producto_id}:${f.warehouse_id}`} className={problema ? styles.filaSinMoneda : undefined}>
                      <th scope="row" className={styles.categoria}>
                        {f.producto}
                        <span className={styles.docs}>{f.sku}</span>
                        {!f.producto_activo ? <span className={styles.marcas}><span className={styles.marca}>Inactivo</span></span> : null}
                      </th>
                      <td data-etiqueta="Depósito"><span className={styles.conteo}>{f.deposito_codigo}</span></td>
                      <td className={styles.num} data-etiqueta="En stock"><span className={styles.importe}>{formatearCantidad(f.on_hand)}</span></td>
                      <td className={styles.num} data-etiqueta="Reservado"><span className={styles.conteo}>{formatearCantidad(f.reserved)}</span></td>
                      <td className={styles.num} data-etiqueta="Disponible"><span className={styles.conteo}>{formatearCantidad(f.available)}</span></td>
                      <td data-etiqueta="Estado">
                        <span className={styles.marcas}>
                          {estados.map((e) => <span key={e} className={e === 'Con stock' ? styles.marca : styles.marcaAtipica}>{e}</span>)}
                        </span>
                      </td>
                      <td data-etiqueta="Último movimiento"><span className={styles.conteo}>{formatearFechaHora(f.ultimo_movimiento)}</span></td>
                      <td data-etiqueta="">
                        <button
                          type="button"
                          className={styles.botonChico}
                          onClick={() => onVerKardex({ id: f.producto_id, sku: f.sku, nombre: f.producto })}
                          aria-label={`Ver kardex de ${f.sku}`}
                        >
                          Kardex
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.accionesRanking}>
          <Paginador pagina={pagina} porPagina={POR_PAGINA_STOCK} total={total} onCambiar={setPagina} cargando={stock.isFetching} sustantivo={{ singular: 'saldo', plural: 'saldos' }} />
          <Button
            variant="secondary"
            icon={<Icon name="download" size={16} />}
            loading={exportar.isPending}
            disabled={exportar.isPending || total === 0}
            onClick={() => exportar.mutate()}
            aria-label="Exportar a CSV el stock con los filtros actuales"
          >
            {exportar.isPending ? 'Exportando…' : `Exportar CSV${total > 0 ? ` (${total} filas)` : ''}`}
          </Button>
          {exportar.error ? <span className={styles.errorEnLinea} role="alert">No se pudo exportar: {exportar.error.message}</span> : null}
        </div>
      </div>
    </section>
  )
}
