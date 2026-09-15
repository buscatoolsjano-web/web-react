import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { POR_PAGINA_STOCK, useMovimientosStock } from '../hooks/useStock'
import { descargarCsv, nombreArchivo } from '../lib/csv'
import { movimientosACsv } from '../lib/csvStock'
import { enlaceOrigen, ETIQUETA_TIPO_MOVIMIENTO, etiquetaOrigen, etiquetaTipoMovimiento, formatearCantidad, formatearFechaHora, textoOrigen } from '../lib/stock'
import { ErrorInforme } from '../services/actividad'
import { exportarMovimientos } from '../services/stock'
import type { FiltrosMovimientos, ResumenStock } from '../types'
import { Paginador } from './Paginador'
import styles from './Informes.module.css'

interface Props {
  mes: string | null
  etiquetaMes: string
  resumen: ResumenStock
}

const n = (v: number) => new Intl.NumberFormat('es-AR').format(v)

/**
 * Movimientos del mes elegido: conteos (no unidades: no se suman productos
 * distintos) y la lista paginada con su origen.
 */
export function MovimientosStock({ mes, etiquetaMes, resumen }: Props) {
  const idTitulo = useId()
  const companyId = useEmpresa().activa?.companyId ?? null
  const [filtros, setFiltros] = useState<FiltrosMovimientos>({ deposito: null, tipo: null, sentido: null })
  const [pagina, setPagina] = useState(0)
  const movs = useMovimientosStock(mes, filtros, pagina)
  const filas = movs.data ?? []
  const total = Number(filas[0]?.total_filas ?? 0)
  const m = resumen.movimientosMes

  const aplicar = (c: Partial<FiltrosMovimientos>) => {
    setFiltros((f) => ({ ...f, ...c }))
    setPagina(0)
  }

  const exportar = useMutation({
    mutationFn: () => exportarMovimientos(companyId!, mes, filtros),
    onSuccess: (todas) => {
      const dep = resumen.depositos.find((d) => d.id === filtros.deposito)?.codigo
      descargarCsv(
        nombreArchivo(['movimientos-stock', resumen.mes.desde.slice(0, 7), filtros.tipo, filtros.sentido, dep]),
        movimientosACsv(todas),
      )
    },
  })

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Movimientos · {etiquetaMes}</h2>
        <p className={styles.nota}>Se cuentan movimientos y productos, no unidades: no se suman cantidades de productos distintos.</p>
      </header>

      <ul className={styles.kpis}>
        <li className={styles.kpi}><span className={styles.kpiValor}>{n(m.movimientos)}</span><span className={styles.kpiTitulo}>Movimientos</span></li>
        <li className={styles.kpi}><span className={styles.kpiValor}>{n(m.entradas)}</span><span className={styles.kpiTitulo}>Entradas</span><span className={styles.docs}>cantidad mayor que 0</span></li>
        <li className={styles.kpi}><span className={styles.kpiValor}>{n(m.salidas)}</span><span className={styles.kpiTitulo}>Salidas</span><span className={styles.docs}>cantidad menor que 0</span></li>
        <li className={styles.kpi}><span className={styles.kpiValor}>{n(m.productos)}</span><span className={styles.kpiTitulo}>Productos</span></li>
        <li className={styles.kpi}><span className={styles.kpiValor}>{n(m.depositos)}</span><span className={styles.kpiTitulo}>Depósitos</span></li>
        <li className={styles.kpi}><span className={styles.kpiValor}>{n(m.sinDocumento)}</span><span className={styles.kpiTitulo}>Sin documento origen</span></li>
      </ul>

      {resumen.porTipo.length > 0 ? (
        <div className={styles.tarjetas}>
          <article className={styles.tarjeta}>
            <h3 className={styles.tarjetaTitulo}>Por tipo</h3>
            <dl className={styles.lista2}>
              {resumen.porTipo.map((t) => <div key={t.clave} className={styles.parLista}><dt>{etiquetaTipoMovimiento(t.clave)}</dt><dd>{n(t.cantidad)}</dd></div>)}
            </dl>
          </article>
          <article className={styles.tarjeta}>
            <h3 className={styles.tarjetaTitulo}>Por origen</h3>
            <dl className={styles.lista2}>
              {resumen.porOrigen.map((t) => <div key={t.clave} className={styles.parLista}><dt>{etiquetaOrigen(t.clave)}</dt><dd>{n(t.cantidad)}</dd></div>)}
            </dl>
          </article>
        </div>
      ) : null}

      <div className={styles.tarjeta}>
        <div className={styles.controlesRanking}>
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Tipo</span>
            <select className={styles.select} value={filtros.tipo ?? ''} onChange={(e) => aplicar({ tipo: e.target.value || null })}>
              <option value="">Todos</option>
              {Object.entries(ETIQUETA_TIPO_MOVIMIENTO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Sentido</span>
            <select className={styles.select} value={filtros.sentido ?? ''} onChange={(e) => aplicar({ sentido: (e.target.value || null) as FiltrosMovimientos['sentido'] })}>
              <option value="">Entradas y salidas</option>
              <option value="entrada">Entradas</option>
              <option value="salida">Salidas</option>
            </select>
          </label>
          {resumen.depositos.length > 1 ? (
            <label className={styles.control}>
              <span className={styles.controlEtiqueta}>Depósito</span>
              <select className={styles.select} value={filtros.deposito ?? ''} onChange={(e) => aplicar({ deposito: e.target.value || null })}>
                <option value="">Todos</option>
                {resumen.depositos.map((d) => <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        {movs.isPending ? (
          <SkeletonRows rows={5} columns={5} label="Leyendo movimientos…" />
        ) : movs.error ? (
          <ErrorState compact title={movs.error instanceof ErrorInforme ? movs.error.message : 'No se pudieron leer los movimientos.'} />
        ) : filas.length === 0 ? (
          <p className={styles.vacio}>Sin movimientos en {etiquetaMes} con esos filtros.</p>
        ) : (
          <div className={`${styles.tablaScroll} ${styles.tarjetaPeriodos}`}>
            <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
              <caption className={styles.oculto}>Movimientos de stock de {etiquetaMes}</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Depósito</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className={styles.num}>Cantidad</th>
                  <th scope="col">Origen</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const enlace = enlaceOrigen(f.source_type, f.source_id)
                  const origen = textoOrigen(f.source_type, f.source_id, f.referencia)
                  return (
                    <tr key={f.movimiento_id}>
                      <td data-etiqueta="Fecha"><span className={styles.conteo}>{formatearFechaHora(f.fecha)}</span></td>
                      <th scope="row" className={styles.categoria}>
                        {f.producto ?? 'Producto no visible'}
                        <span className={styles.docs}>{f.sku}</span>
                        {f.producto_activo === false ? <span className={styles.marcas}><span className={styles.marca}>Inactivo</span></span> : null}
                      </th>
                      <td data-etiqueta="Depósito"><span className={styles.conteo}>{f.deposito_codigo}</span></td>
                      <td data-etiqueta="Tipo"><span className={styles.conteo}>{etiquetaTipoMovimiento(f.movement_type)}</span></td>
                      <td className={styles.num} data-etiqueta="Cantidad">
                        <span className={styles.importe}>{formatearCantidad(f.quantity, true)}</span>
                        <span className={styles.docs}>{f.sentido === 'entrada' ? 'entrada' : 'salida'}</span>
                      </td>
                      <td data-etiqueta="Origen">
                        {enlace ? <Link to={enlace} className={styles.enlaceTabla}>{origen}</Link> : <span className={styles.conteo}>{origen}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.accionesRanking}>
          <Paginador pagina={pagina} porPagina={POR_PAGINA_STOCK} total={total} onCambiar={setPagina} cargando={movs.isFetching} sustantivo={{ singular: 'movimiento', plural: 'movimientos' }} />
          <Button
            variant="secondary"
            icon={<Icon name="download" size={16} />}
            loading={exportar.isPending}
            disabled={exportar.isPending || total === 0}
            onClick={() => exportar.mutate()}
            aria-label={`Exportar a CSV los movimientos de ${etiquetaMes} con los filtros actuales`}
          >
            {exportar.isPending ? 'Exportando…' : `Exportar CSV${total > 0 ? ` (${total} filas)` : ''}`}
          </Button>
          {exportar.error ? <span className={styles.errorEnLinea} role="alert">No se pudo exportar: {exportar.error.message}</span> : null}
        </div>
      </div>
    </section>
  )
}
