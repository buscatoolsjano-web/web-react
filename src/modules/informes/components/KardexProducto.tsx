import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { POR_PAGINA_STOCK, useKardex, useStockActual } from '../hooks/useStock'
import { enlaceOrigen, etiquetaTipoMovimiento, formatearCantidad, formatearFechaHora, formatearSaldo, textoOrigen } from '../lib/stock'
import { ErrorInforme } from '../services/actividad'
import type { DepositoResumen } from '../types'
import { Paginador } from './Paginador'
import styles from './Informes.module.css'

export interface ProductoKardex {
  id: string
  sku: string
  nombre: string
}

interface Props {
  producto: ProductoKardex | null
  onElegir: (p: ProductoKardex | null) => void
  depositos: DepositoResumen[]
}

/**
 * Kardex de UN producto: sus movimientos paginados, con el saldo después de
 * cada uno SÓLO si el servidor lo verificó contra el saldo actual.
 *
 * El producto se busca entre los que tienen saldo (un producto sin saldo nunca
 * tuvo movimientos: no tiene kardex).
 */
export function KardexProducto({ producto, onElegir, depositos }: Props) {
  const idTitulo = useId()
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [deposito, setDeposito] = useState<string | null>(null)
  const [orden, setOrden] = useState<'asc' | 'desc'>('desc')
  const [pagina, setPagina] = useState(0)
  const candidatos = useStockActual({ busqueda, deposito: null, estado: null }, 0, busqueda !== '' && producto === null)
  const kardex = useKardex(producto?.id ?? null, deposito, orden, pagina)
  const filas = kardex.data ?? []
  const total = Number(filas[0]?.total_filas ?? 0)
  const noVerificado = filas.some((f) => !f.saldo_verificado)
  const saldosActuales = [...new Map(filas.map((f) => [f.warehouse_id, f])).values()]

  const elegir = (p: ProductoKardex | null) => {
    onElegir(p)
    setPagina(0)
  }

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Kardex por producto</h2>
        <p className={styles.nota}>Movimientos de un producto con el saldo resultante en cada depósito.</p>
      </header>

      <div className={styles.tarjeta}>
        {!producto ? (
          <>
            <form
              className={styles.controlesRanking}
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                setBusqueda(texto.trim())
              }}
            >
              <label className={styles.control}>
                <span className={styles.controlEtiqueta}>Producto o SKU</span>
                <input className={styles.inputTexto} type="search" value={texto} maxLength={100} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto con stock registrado" />
              </label>
              <Button type="submit" variant="secondary" icon={<Icon name="search" size={16} />}>Buscar</Button>
            </form>
            {busqueda === '' ? (
              <p className={styles.nota}>Elegí un producto con «Kardex» en la tabla de stock, o buscalo acá.</p>
            ) : candidatos.isPending ? (
              <p className={styles.nota}>Buscando…</p>
            ) : (candidatos.data ?? []).length === 0 ? (
              <p className={styles.vacio}>Ningún producto con stock registrado coincide con «{busqueda}». Un producto sin movimientos no tiene kardex.</p>
            ) : (
              <ul className={styles.listaCandidatos}>
                {[...new Map((candidatos.data ?? []).map((c) => [c.producto_id, c])).values()].slice(0, 10).map((c) => (
                  <li key={c.producto_id}>
                    <button type="button" className={styles.botonCandidato} onClick={() => elegir({ id: c.producto_id, sku: c.sku, nombre: c.producto })}>
                      <span>{c.producto}</span>
                      <span className={styles.docs}>{c.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className={styles.controlesRanking}>
              <div className={styles.productoElegido}>
                <span className={styles.tarjetaTitulo}>{producto.nombre}</span>
                <span className={styles.docs}>{producto.sku}</span>
              </div>
              {depositos.length > 1 ? (
                <label className={styles.control}>
                  <span className={styles.controlEtiqueta}>Depósito</span>
                  <select className={styles.select} value={deposito ?? ''} onChange={(e) => { setDeposito(e.target.value || null); setPagina(0) }}>
                    <option value="">Todos</option>
                    {depositos.map((d) => <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>)}
                  </select>
                </label>
              ) : null}
              <div className={styles.monedas} role="group" aria-label="Orden">
                {(['desc', 'asc'] as const).map((o) => (
                  <button key={o} type="button" className={orden === o ? styles.chipActivo : styles.chip} aria-pressed={orden === o} onClick={() => { setOrden(o); setPagina(0) }}>
                    {o === 'desc' ? 'Más recientes primero' : 'Más antiguos primero'}
                  </button>
                ))}
              </div>
              <Button variant="ghost" onClick={() => elegir(null)}>Cambiar producto</Button>
            </div>

            {saldosActuales.length > 0 ? (
              <p className={styles.tarjetaSub}>
                Saldo actual: {saldosActuales.map((f) => `${f.deposito_codigo ?? ''} ${formatearCantidad(f.saldo_actual)}`).join(' · ')}
                {saldosActuales.every((f) => f.inicia_con_apertura) ? ' · el primer movimiento es un saldo inicial' : ''}
              </p>
            ) : null}
            {noVerificado ? (
              <p className={styles.notaAviso} role="status">
                En algún depósito la suma de los movimientos no coincide con el saldo actual: el saldo después de cada movimiento no se muestra ahí.
              </p>
            ) : null}

            {kardex.isPending ? (
              <SkeletonRows rows={5} columns={5} label="Leyendo movimientos…" />
            ) : kardex.error ? (
              <ErrorState compact title={kardex.error instanceof ErrorInforme ? kardex.error.message : 'No se pudo leer el kardex.'} />
            ) : filas.length === 0 ? (
              <p className={styles.vacio}>Sin movimientos registrados para este producto.</p>
            ) : (
              <div className={`${styles.tablaScroll} ${styles.tarjetaPeriodos}`}>
                <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
                  <caption className={styles.oculto}>Kardex de {producto.sku}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fecha</th>
                      <th scope="col">Depósito</th>
                      <th scope="col">Movimiento</th>
                      <th scope="col" className={styles.num}>Cantidad</th>
                      <th scope="col" className={styles.num}>Saldo</th>
                      <th scope="col">Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => {
                      const enlace = enlaceOrigen(f.source_type, f.source_id)
                      const origen = textoOrigen(f.source_type, f.source_id, f.referencia)
                      return (
                        <tr key={f.movimiento_id}>
                          <th scope="row" className={styles.categoria}><span className={styles.conteo}>{formatearFechaHora(f.fecha)}</span></th>
                          <td data-etiqueta="Depósito"><span className={styles.conteo}>{f.deposito_codigo}</span></td>
                          <td data-etiqueta="Movimiento"><span className={styles.conteo}>{etiquetaTipoMovimiento(f.movement_type)}</span></td>
                          <td className={styles.num} data-etiqueta="Cantidad">
                            <span className={styles.importe}>{formatearCantidad(f.quantity, true)}</span>
                            <span className={styles.docs}>{f.sentido}</span>
                          </td>
                          <td className={styles.num} data-etiqueta="Saldo">
                            <span className={styles.importe}>{formatearSaldo(f.saldo, f.saldo_verificado)}</span>
                            {!f.saldo_verificado ? <span className={styles.docs}>no verificable</span> : null}
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
              <Paginador pagina={pagina} porPagina={POR_PAGINA_STOCK} total={total} onCambiar={setPagina} cargando={kardex.isFetching} sustantivo={{ singular: 'movimiento', plural: 'movimientos' }} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
