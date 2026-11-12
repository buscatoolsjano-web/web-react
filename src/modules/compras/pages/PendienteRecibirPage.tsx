import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import docUi from '@/components/document/Document.module.css'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Barra, Chips, Estado, Kpi, Leyenda } from '@/features/pendientes/piezas'
import { RANGOS, desdeDe, fechaCorta, fmt, type Rango } from '@/features/pendientes/util'
import styles from '@/features/pendientes/Pendientes.module.css'
import { estadoDeRecepcion, pasaFiltro, type FiltroRecepcion } from '../lib/pendienteRecibir'
import { pendienteDeRecibir } from '../services/pendienteRecibir'

/**
 * Compras › Pendiente de recibir (Fase 238).
 *
 * Lo pedido a proveedores (pedidos confirmados) que todavía no llegó, por
 * producto. La barra separa lo recibido (verde), lo que viene para VENTAS
 * (azul: ya tiene cliente esperando) y lo que viene para STOCK (ámbar). El
 * estado dice cuándo llega, y en rojo lo atrasado (la llegada estimada pasó).
 * Las tarjetas de arriba filtran; tocar una fila abre los pedidos a proveedor.
 */
export function PendienteRecibirPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [rango, setRango] = useState<Rango>(6)
  const [filtro, setFiltro] = useState<FiltroRecepcion>('todos')
  const [texto, setTexto] = useState('')
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set())
  const desde = desdeDe(rango)
  const hoy = new Date().toISOString().slice(0, 10)

  const datos = useQuery({
    queryKey: ['compras', companyId, 'pendiente-recibir', desde],
    queryFn: () => pendienteDeRecibir(companyId!, desde),
    enabled: companyId !== null,
    staleTime: 60_000,
  })

  const productos = useMemo(() => datos.data ?? [], [datos.data])
  const totales = useMemo(() => {
    let unidades = 0
    let paraVentas = 0
    let atrasados = 0
    let sinFecha = 0
    for (const p of productos) {
      unidades += p.pendiente
      paraVentas += p.paraVentas
      const e = estadoDeRecepcion(p, hoy)
      if (e.tono === 'tAtrasado') atrasados += 1
      if (e.tono === 'tNeutro') sinFecha += 1
    }
    return { unidades, paraVentas, atrasados, sinFecha }
  }, [productos, hoy])

  const q = texto.trim().toLowerCase()
  const visibles = productos.filter(
    (p) => pasaFiltro(p, filtro, hoy) && (q === '' || `${p.sku ?? ''} ${p.nombre ?? ''}`.toLowerCase().includes(q)),
  )

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const filtrar = (f: FiltroRecepcion) => setFiltro((x) => (x === f ? 'todos' : f))

  return (
    <div className={`${docUi.pagina} ${styles.pagina}`}>
      <PageHeader
        title="Pendiente de recibir"
        subtitle="Lo pedido a proveedores que todavía no llegó, por producto: cuánto es para ventas, cuánto para stock y cuándo llega."
      />

      <div className={styles.filtros}>
        <Chips etiqueta="Pedidos desde" opciones={RANGOS} valor={rango} onCambiar={setRango} />
        <input
          className={styles.buscar}
          type="search"
          placeholder="Buscar por referencia o nombre…"
          aria-label="Buscar producto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      <div className={styles.kpis}>
        <Kpi tono="tNeutro" valor={fmt(productos.length)} texto={`productos · ${fmt(totales.unidades)} u. por recibir`} activo={filtro === 'todos'} onClick={() => setFiltro('todos')} />
        <Kpi tono="tAtrasado" valor={fmt(totales.atrasados)} texto="productos atrasados" activo={filtro === 'atrasado'} onClick={() => filtrar('atrasado')} />
        <Kpi tono="tCamino" valor={fmt(totales.paraVentas)} texto="u. esperadas por clientes" activo={filtro === 'ventas'} onClick={() => filtrar('ventas')} />
        <Kpi tono="tNeutro" valor={fmt(totales.sinFecha)} texto="productos sin fecha de llegada" activo={filtro === 'sinFecha'} onClick={() => filtrar('sinFecha')} />
      </div>

      <Leyenda
        items={[
          { tono: 'tEntregado', texto: 'Recibido' },
          { tono: 'tCamino', texto: 'Por recibir · para ventas' },
          { tono: 'tFalta', texto: 'Por recibir · para stock' },
          { tono: 'tAtrasado', texto: 'Atrasado' },
        ]}
      />

      {datos.isPending ? <SkeletonRows rows={5} label="Juntando lo pendiente…" /> : null}
      {datos.error ? (
        <Alert tone="danger" role="alert">
          <p>{datos.error.message}</p>
        </Alert>
      ) : null}

      {datos.data && visibles.length === 0 ? (
        <p className={styles.vacio}>
          {productos.length === 0 ? 'No hay nada pendiente de recibir en este período.' : 'Ningún producto coincide con el filtro.'}
        </p>
      ) : null}

      <ul className={styles.lista}>
        {visibles.map((p) => {
          const estado = estadoDeRecepcion(p, hoy)
          const abierto = abiertos.has(p.productoId)
          return (
            <li key={p.productoId} className={`${styles.fila} ${styles[estado.tono]}`}>
              <button type="button" className={styles.resumenFila} aria-expanded={abierto} onClick={() => alternar(p.productoId)}>
                <span className={styles.producto}>
                  <span className={styles.sku}>{p.sku ?? '—'}</span>
                  <span className={styles.nombre} title={p.nombre ?? ''}>{p.nombre ?? '—'}</span>
                </span>
                <span className={styles.barraCelda}>
                  <Barra
                    total={p.pedido}
                    tramos={[
                      { tono: 'tEntregado', valor: p.recibido, texto: 'Recibido' },
                      { tono: 'tCamino', valor: p.paraVentas, texto: 'Para ventas' },
                      { tono: 'tFalta', valor: p.paraStock, texto: 'Para stock' },
                    ]}
                  />
                  <span className={styles.cifras}>
                    <span>Pedido {fmt(p.pedido)}</span>
                    {p.recibido > 0 ? <span className={styles.tEntregado}><b>{fmt(p.recibido)}</b> recibido</span> : null}
                    {p.paraVentas > 0 ? <span className={styles.tCamino}><b>{fmt(p.paraVentas)}</b> para ventas</span> : null}
                    {p.paraStock > 0 ? <span className={styles.tFalta}><b>{fmt(p.paraStock)}</b> para stock</span> : null}
                  </span>
                </span>
                <span className={styles.grande}>
                  <span className={styles.grandeValor}>{fmt(p.pendiente)}</span>
                  <span className={styles.grandeTexto}>
                    {p.proximaLlegada ? `llega ${fechaCorta(p.proximaLlegada)}` : 'por recibir'}
                  </span>
                </span>
                <span>
                  <Estado tono={estado.tono}>{estado.texto}</Estado>{' '}
                  <Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={16} aria-hidden="true" />
                </span>
              </button>
              {abierto ? (
                <div className={styles.detalle}>
                  <table className={styles.tabla}>
                    <thead>
                      <tr>
                        <th scope="col">Pedido</th>
                        <th scope="col">Proveedor</th>
                        <th scope="col">Llegada</th>
                        <th scope="col" className={styles.num}>Pedido</th>
                        <th scope="col" className={styles.num}>Recibido</th>
                        <th scope="col" className={styles.num}>Pendiente</th>
                        <th scope="col">Para</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.documentos.map((d) => {
                        const atrasado = d.llegadaEstimada !== null && d.llegadaEstimada < hoy
                        return (
                          <tr key={`${d.pedidoId}-${d.pedido}-${d.venta ?? ''}`}>
                            <td>
                              <Link className={styles.enlace} to={`/compras/pedidos/${d.pedidoId}`}>
                                {d.numero}
                              </Link>
                              {d.borrador ? <> <Estado tono="tNeutro">borrador</Estado></> : null}
                            </td>
                            <td>{d.proveedor ?? '—'}</td>
                            <td className={atrasado ? styles.tAtrasado : undefined}>
                              {atrasado ? <b>{fechaCorta(d.llegadaEstimada)}</b> : fechaCorta(d.llegadaEstimada)}
                            </td>
                            <td className={styles.num}>{fmt(d.pedido)}</td>
                            <td className={styles.num}>{fmt(d.recibido)}</td>
                            <td className={`${styles.num} ${styles.tCamino}`}><b>{fmt(d.pendiente)}</b></td>
                            <td>
                              {d.paraVenta > 0 ? (
                                <Estado tono="tCamino">{fmt(d.paraVenta)} {d.venta ? `para ${d.venta}` : 'para venta'}</Estado>
                              ) : null}{' '}
                              {d.pendiente - d.paraVenta > 0 ? <Estado tono="tFalta">{fmt(d.pendiente - d.paraVenta)} stock</Estado> : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
