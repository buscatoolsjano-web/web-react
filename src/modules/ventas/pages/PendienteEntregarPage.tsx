import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon, type IconName } from '@/components/icons/Icon'
import docUi from '@/components/document/Document.module.css'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Barra, Chips, Estado } from '@/features/pendientes/piezas'
import { RANGOS, desdeDe, fechaCorta, fmt, type Rango } from '@/features/pendientes/util'
import styles from '@/features/pendientes/Pendientes.module.css'
import propios from './PendienteEntregar.module.css'
import {
  SECCIONES_ENTREGA,
  accionesDeEntrega,
  clientesDe,
  diasEsperando,
  estadoDeEntrega,
  tramosDeEntrega,
  type FiltroEntrega,
} from '../lib/pendienteEntregar'
import { pendienteDeEntregar, type ProductoPendienteEntrega } from '../services/pendienteEntregar'

const ICONOS: Record<Exclude<FiltroEntrega, 'todos'>, IconName> = { falta: 'cart', camino: 'truck', stock: 'package' }
/** Desde cuántos días esperando se marca en rojo. */
const DIAS_DEMORADO = 30

/**
 * Ventas › Pendiente de entregar (Fase 238; rediseño 2026-11).
 *
 * «Cuesta entender esto, quiero que sea más intuitivo y mejor visualmente.»
 * La versión anterior mostraba números para interpretar: el mismo «80» tres
 * veces por fila y una barra de un solo color. Ahora se lee por lo que hay que
 * HACER: arriba tres tarjetas —pedir al proveedor, esperando al proveedor,
 * listo para entregar— y la lista agrupada igual, lo más viejo primero. Cada
 * fila dice en palabras qué hacer («Pedí 80», «Entregá 30 ya»), para quién y
 * hace cuánto espera. La barra aparece sólo si el producto está repartido.
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
  const hoy = useMemo(() => new Date(), [])

  // Por sección: cuántos productos y cuántas unidades. Un producto puede
  // aportar a más de una (parte con stock, parte a pedir): las unidades se
  // cuentan donde caen; el producto, en la sección de lo más urgente.
  const resumen = useMemo(() => {
    const r = {
      unidades: 0,
      falta: { productos: 0, unidades: 0 },
      camino: { productos: 0, unidades: 0 },
      stock: { productos: 0, unidades: 0 },
    }
    for (const p of productos) {
      const t = tramosDeEntrega(p)
      r.unidades += p.pendiente
      r.falta.unidades += t.falta
      r.camino.unidades += t.enCamino
      r.stock.unidades += t.conStock
      if (t.falta > 0) r.falta.productos += 1
      if (t.enCamino > 0) r.camino.productos += 1
      if (t.conStock > 0) r.stock.productos += 1
    }
    return r
  }, [productos])

  const q = texto.trim().toLowerCase()
  const porSeccion = useMemo(() => {
    const coincide = (p: ProductoPendienteEntrega) =>
      q === '' ||
      `${p.sku ?? ''} ${p.nombre ?? ''} ${p.documentos.map((d) => `${d.cliente ?? ''} ${d.numero}`).join(' ')}`
        .toLowerCase()
        .includes(q)
    return SECCIONES_ENTREGA.map((s) => ({
      ...s,
      items: productos
        .filter((p) => estadoDeEntrega(p).filtro === s.filtro && coincide(p))
        // Lo que más espera, primero; a igual espera, lo de más unidades.
        .map((p) => ({ p, dias: diasEsperando(p, hoy) }))
        .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1) || b.p.pendiente - a.p.pendiente),
    })).filter((s) => filtro === 'todos' || s.filtro === filtro)
  }, [productos, q, filtro, hoy])

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const visibles = porSeccion.reduce((n, s) => n + s.items.length, 0)

  return (
    <div className={`${docUi.pagina} ${styles.pagina}`}>
      <PageHeader
        title="Pendiente de entregar"
        subtitle="Lo vendido que todavía no se entregó, ordenado por lo que hay que hacer."
      />

      <div className={styles.filtros}>
        <Chips etiqueta="Pedidos desde" opciones={RANGOS} valor={rango} onCambiar={setRango} />
        <input
          className={styles.buscar}
          type="search"
          placeholder="Buscar producto, cliente o pedido…"
          aria-label="Buscar producto, cliente o pedido"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      {datos.data ? (
        <p className={propios.resumen}>
          Hay <strong>{fmt(resumen.unidades)} unidades</strong> vendidas sin entregar, en{' '}
          <strong>{fmt(productos.length)} productos</strong>.
        </p>
      ) : null}

      <div className={propios.acciones}>
        {SECCIONES_ENTREGA.map((s) => {
          const r = resumen[s.filtro]
          return (
            <button
              key={s.filtro}
              type="button"
              className={`${propios.accion} ${styles[s.tono]}`}
              aria-pressed={filtro === s.filtro}
              disabled={!datos.data}
              onClick={() => setFiltro((f) => (f === s.filtro ? 'todos' : s.filtro))}
            >
              <span className={propios.accionIcono}>
                <Icon name={ICONOS[s.filtro]} size={20} aria-hidden="true" />
              </span>
              <span className={propios.accionTitulo}>{s.titulo}</span>
              <span className={propios.accionCifra}>
                {fmt(r.productos)}
                <small>
                  {r.productos === 1 ? 'producto' : 'productos'} · {fmt(r.unidades)} u.
                </small>
              </span>
              <span className={propios.accionAyuda}>{s.ayuda}</span>
            </button>
          )
        })}
      </div>

      {datos.isPending ? <SkeletonRows rows={5} label="Juntando lo pendiente…" /> : null}
      {datos.error ? (
        <Alert tone="danger" role="alert">
          <p>{datos.error.message}</p>
        </Alert>
      ) : null}

      {datos.data && visibles === 0 ? (
        <p className={styles.vacio}>
          {productos.length === 0 ? 'No hay nada pendiente de entregar en este período.' : 'Nada coincide con lo que buscás.'}
        </p>
      ) : null}

      {porSeccion
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <section key={s.filtro} className={`${propios.seccion} ${styles[s.tono]}`} aria-label={s.titulo}>
            <h2 className={propios.seccionTitulo}>
              {s.titulo} <span className={propios.seccionCuenta}>{fmt(s.items.length)}</span>
            </h2>
            <ul className={styles.lista}>
              {s.items.map(({ p, dias }) => {
                const t = tramosDeEntrega(p)
                const acciones = accionesDeEntrega(p)
                const abierto = abiertos.has(p.productoId)
                const pedidos = p.documentos.filter((d) => d.pendiente > 0).length
                // La barra sólo dice algo si el producto está repartido.
                const repartido = [t.entregado, t.conStock, t.enCamino, t.falta].filter((x) => x > 0).length > 1
                return (
                  <li key={p.productoId} className={`${styles.fila} ${styles[s.tono]}`}>
                    <button type="button" className={propios.fila} aria-expanded={abierto} onClick={() => alternar(p.productoId)}>
                      <span className={propios.producto}>
                        <span className={propios.nombre} title={p.nombre ?? ''}>
                          {p.nombre ?? '—'}
                        </span>
                        <span className={propios.meta}>
                          <span className={propios.sku}>{p.sku ?? '—'}</span>
                          {' · '}
                          {clientesDe(p)}
                          {' · '}
                          {pedidos} {pedidos === 1 ? 'pedido' : 'pedidos'}
                          {dias !== null ? (
                            <>
                              {' · '}
                              <span className={dias >= DIAS_DEMORADO ? propios.viejo : undefined}>
                                {dias === 0 ? 'desde hoy' : `espera hace ${dias} ${dias === 1 ? 'día' : 'días'}`}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className={propios.que}>
                        {acciones.map((a) => (
                          <span key={a.texto} className={`${propios.pastilla} ${styles[a.tono]}`}>
                            {a.texto}
                          </span>
                        ))}
                      </span>
                      <span className={propios.cuanto}>
                        <span>
                          <span className={propios.cuantoValor}>{fmt(p.pendiente)}</span>{' '}
                          <span className={propios.cuantoTexto}>
                            {t.entregado > 0 ? `de ${fmt(p.pedido)}` : 'u.'}
                          </span>
                        </span>
                        <Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={16} aria-hidden="true" />
                      </span>
                    </button>
                    {repartido ? (
                      <div className={propios.barraFila}>
                        <Barra
                          total={p.pedido}
                          tramos={[
                            { tono: 'tEntregado', valor: t.entregado, texto: 'Ya entregado' },
                            { tono: 'tStock', valor: t.conStock, texto: 'Con stock' },
                            { tono: 'tCamino', valor: t.enCamino, texto: 'En camino' },
                            { tono: 'tFalta', valor: t.falta, texto: 'Falta pedir' },
                          ]}
                        />
                      </div>
                    ) : null}
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
                              <th scope="col" className={styles.num}>Falta entregar</th>
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
                                <td className={styles.num}>{d.entregado > 0 ? fmt(d.entregado) : '—'}</td>
                                <td className={`${styles.num} ${styles.tFalta}`}>
                                  <b>{fmt(d.pendiente)}</b>
                                </td>
                                <td className={styles.num}>{d.enCamino > 0 ? fmt(d.enCamino) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className={styles.nota}>Stock disponible hoy: {fmt(p.stock)} u.</p>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </div>
  )
}
