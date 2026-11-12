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
import { estadoDeEntrega, tramosDeEntrega, type FiltroEntrega } from '../lib/pendienteEntregar'
import { pendienteDeEntregar } from '../services/pendienteEntregar'

/**
 * Ventas › Pendiente de entregar (Fase 238).
 *
 * «Ir acumulando por productos qué está pendiente y ver bien qué se pidió, qué
 * falta pedir, qué está parcial. Jugá con los colores para que se lea rápido.»
 *
 * Una fila por producto con lo pendiente de TODOS los pedidos de venta
 * confirmados. La barra dice de un vistazo cómo se cubre: entregado (verde),
 * con stock (turquesa), en camino de proveedores (azul) y falta pedir (ámbar).
 * Las tarjetas de arriba filtran; tocar una fila abre los pedidos de cada
 * cliente con su número.
 */
export function PendienteEntregarPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [rango, setRango] = useState<Rango>(6)
  const [filtro, setFiltro] = useState<FiltroEntrega>('todos')
  const [texto, setTexto] = useState('')
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set())
  const desde = desdeDe(rango)

  const datos = useQuery({
    queryKey: ['ventas', companyId, 'pendiente-entregar', desde],
    queryFn: () => pendienteDeEntregar(companyId!, desde),
    enabled: companyId !== null,
    staleTime: 60_000,
  })

  const productos = useMemo(() => datos.data ?? [], [datos.data])
  const totales = useMemo(() => {
    let unidades = 0
    let falta = 0
    let productosFalta = 0
    let camino = 0
    let conStock = 0
    for (const p of productos) {
      const t = tramosDeEntrega(p)
      unidades += p.pendiente
      falta += t.falta
      camino += t.enCamino
      conStock += t.conStock
      if (t.falta > 0) productosFalta += 1
    }
    return { unidades, falta, productosFalta, camino, conStock }
  }, [productos])

  const q = texto.trim().toLowerCase()
  const visibles = productos.filter(
    (p) =>
      (filtro === 'todos' || estadoDeEntrega(p).filtro === filtro) &&
      (q === '' || `${p.sku ?? ''} ${p.nombre ?? ''}`.toLowerCase().includes(q)),
  )

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const filtrar = (f: FiltroEntrega) => setFiltro((x) => (x === f ? 'todos' : f))

  return (
    <div className={`${docUi.pagina} ${styles.pagina}`}>
      <PageHeader
        title="Pendiente de entregar"
        subtitle="Lo vendido en pedidos confirmados que todavía no se entregó, por producto: qué cubre el stock, qué viene en camino y qué falta pedir."
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
        <Kpi tono="tNeutro" valor={fmt(productos.length)} texto={`productos · ${fmt(totales.unidades)} u. pendientes`} activo={filtro === 'todos'} onClick={() => setFiltro('todos')} />
        <Kpi tono="tFalta" valor={fmt(totales.falta)} texto={`u. falta pedir · ${fmt(totales.productosFalta)} productos`} activo={filtro === 'falta'} onClick={() => filtrar('falta')} />
        <Kpi tono="tCamino" valor={fmt(totales.camino)} texto="u. en camino de proveedores" activo={filtro === 'camino'} onClick={() => filtrar('camino')} />
        <Kpi tono="tStock" valor={fmt(totales.conStock)} texto="u. que cubre el stock" activo={filtro === 'stock'} onClick={() => filtrar('stock')} />
      </div>

      <Leyenda
        items={[
          { tono: 'tEntregado', texto: 'Entregado' },
          { tono: 'tStock', texto: 'Con stock' },
          { tono: 'tCamino', texto: 'En camino (comprado)' },
          { tono: 'tFalta', texto: 'Falta pedir' },
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
          {productos.length === 0 ? 'No hay nada pendiente de entregar en este período.' : 'Ningún producto coincide con el filtro.'}
        </p>
      ) : null}

      <ul className={styles.lista}>
        {visibles.map((p) => {
          const t = tramosDeEntrega(p)
          const estado = estadoDeEntrega(p)
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
                      { tono: 'tEntregado', valor: t.entregado, texto: 'Entregado' },
                      { tono: 'tStock', valor: t.conStock, texto: 'Con stock' },
                      { tono: 'tCamino', valor: t.enCamino, texto: 'En camino' },
                      { tono: 'tFalta', valor: t.falta, texto: 'Falta pedir' },
                    ]}
                  />
                  <span className={styles.cifras}>
                    <span>Vendido {fmt(p.pedido)}</span>
                    {t.entregado > 0 ? <span className={styles.tEntregado}><b>{fmt(t.entregado)}</b> entregado</span> : null}
                    {t.conStock > 0 ? <span className={styles.tStock}><b>{fmt(t.conStock)}</b> con stock</span> : null}
                    {t.enCamino > 0 ? <span className={styles.tCamino}><b>{fmt(t.enCamino)}</b> en camino</span> : null}
                    {t.falta > 0 ? <span className={styles.tFalta}><b>{fmt(t.falta)}</b> falta pedir</span> : null}
                  </span>
                </span>
                <span className={styles.grande}>
                  <span className={styles.grandeValor}>{fmt(p.pendiente)}</span>
                  <span className={styles.grandeTexto}>por entregar</span>
                </span>
                <span>
                  <Estado tono={estado.tono}>{t.entregado > 0 ? `Parcial · ${estado.texto}` : estado.texto}</Estado>{' '}
                  <Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={16} aria-hidden="true" />
                </span>
              </button>
              {abierto ? (
                <div className={styles.detalle}>
                  <table className={styles.tabla}>
                    <thead>
                      <tr>
                        <th scope="col">Pedido</th>
                        <th scope="col">Fecha</th>
                        <th scope="col">Cliente</th>
                        <th scope="col" className={styles.num}>Vendido</th>
                        <th scope="col" className={styles.num}>Entregado</th>
                        <th scope="col" className={styles.num}>Pendiente</th>
                        <th scope="col" className={styles.num}>En camino</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.documentos.map((d) => (
                        <tr key={`${d.pedidoId}-${d.numero}-${d.pedido}`}>
                          <td>
                            <Link className={styles.enlace} to={`/ventas/pedidos/${d.pedidoId}`}>
                              {d.numero}
                            </Link>
                            {d.borrador ? <> <Estado tono="tNeutro">borrador</Estado></> : null}
                          </td>
                          <td>{fechaCorta(d.fecha)}</td>
                          <td>{d.cliente ?? '—'}</td>
                          <td className={styles.num}>{fmt(d.pedido)}</td>
                          <td className={styles.num}>{fmt(d.entregado)}</td>
                          <td className={`${styles.num} ${styles.tFalta}`}><b>{fmt(d.pendiente)}</b></td>
                          <td className={styles.num}>{d.enCamino > 0 ? fmt(d.enCamino) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={styles.nota}>Stock disponible del producto: {fmt(p.stock)} u.</p>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
