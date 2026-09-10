import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { GrillaRecepcion } from '../components/GrillaRecepcion'
import { permisosDe } from '../lib/permisos'
import { formatearFecha } from '../lib/formato'
import { usePedido } from '../hooks/usePedidos'
import { useCrearRecepcion, useDepositos, usePendienteDePedido } from '../hooks/useRecepciones'
import type { CantidadARecibir } from '../services/recepciones'
import styles from './ProveedorDetallePage.module.css'

const hoy = () => new Date().toISOString().slice(0, 10)

/**
 * Alta de recepción, desde un pedido de compra confirmado.
 *
 * Tiene ruta propia —`#/compras/recepciones/nueva?pedido=<id>`— y no vive
 * dentro de la ficha del pedido por dos razones: una recepción es un documento
 * con sus propios datos (depósito, fecha, remito del proveedor) y meterla
 * adentro mezclaría dos documentos en una pantalla; y con el pedido en la URL,
 * la pantalla se comparte y el «atrás» del navegador vuelve al pedido.
 *
 * La recepción **nace en borrador y no mueve stock**. Confirmarla es otra
 * acción, desde su ficha.
 */
export function RecepcionNuevaPage() {
  const [params] = useSearchParams()
  const pedidoId = params.get('pedido')
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const navegar = useNavigate()

  const { data: pedido, isPending: cargandoPedido } = usePedido(pedidoId ?? undefined)
  const depositos = useDepositos()
  const crear = useCrearRecepcion()

  const [depositoId, setDepositoId] = useState<string | null>(null)
  const [fecha, setFecha] = useState(hoy())
  const [documento, setDocumento] = useState('')
  const [notas, setNotas] = useState('')
  const [cantidades, setCantidades] = useState<Map<string, number>>(new Map())

  // El depósito por defecto se elige una vez, cuando llegan los depósitos. Se
  // ajusta DURANTE el render, no en un useEffect.
  const [depositosVistos, setDepositosVistos] = useState(false)
  if (!depositosVistos && (depositos.data ?? []).length > 0) {
    setDepositosVistos(true)
    const lista = depositos.data ?? []
    // Si hay uno solo, o hay uno marcado por defecto, se preselecciona. Nunca
    // se hardcodea un código ni un uuid.
    const elegido = lista.length === 1 ? lista[0] : lista.find((d) => d.esPorDefecto)
    if (elegido) setDepositoId(elegido.id)
  }

  const pendiente = usePendienteDePedido(pedidoId ?? undefined, depositoId)

  if (!permisos.crearProveedor) {
    return (
      <div className={styles.page}>
        <Link to="/compras/recepciones" className={styles.volver}>
          ← Notas de entrada
        </Link>
        <p className={styles.nota}>Tu rol no puede registrar recepciones.</p>
      </div>
    )
  }

  if (!pedidoId) {
    return (
      <div className={styles.page}>
        <Link to="/compras/pedidos" className={styles.volver}>
          ← Pedidos de compra
        </Link>
        <p className={styles.nota}>
          Una recepción se crea desde un pedido de compra confirmado. Abrí el pedido y usá
          «Recibir mercadería».
        </p>
      </div>
    )
  }

  if (cargandoPedido) return <p className={styles.nota}>Cargando…</p>

  if (!pedido) {
    return (
      <div className={styles.page}>
        <Link to="/compras/pedidos" className={styles.volver}>
          ← Pedidos de compra
        </Link>
        <p className={styles.nota}>No se encontró el pedido, o no tenés acceso.</p>
      </div>
    )
  }

  if (pedido.estado !== 'confirmed') {
    return (
      <div className={styles.page}>
        <Link to={`/compras/pedidos/${pedido.id}`} className={styles.volver}>
          ← {pedido.numero}
        </Link>
        <p className={styles.nota}>
          Sólo se recibe contra un pedido <strong>confirmado</strong>. Este está en{' '}
          {pedido.estado === 'draft' ? 'borrador' : 'estado cancelado'}.
        </p>
      </div>
    )
  }

  const lineas = pendiente.data ?? []
  const cambiar = (id: string, cantidad: number) =>
    setCantidades((m) => {
      const n = new Map(m)
      if (cantidad <= 0) n.delete(id)
      else n.set(id, cantidad)
      return n
    })

  const recibirTodo = () =>
    setCantidades(
      new Map(lineas.filter((l) => l.pendiente > 0).map((l) => [l.purchaseOrderLineId, l.pendiente])),
    )

  const excede = lineas.some((l) => (cantidades.get(l.purchaseOrderLineId) ?? 0) > l.pendiente)
  const hayAlgo = [...cantidades.values()].some((v) => v > 0)

  const guardar = () => {
    if (!depositoId || !hayAlgo || excede) return
    const aRecibir: CantidadARecibir[] = lineas
      .filter((l) => (cantidades.get(l.purchaseOrderLineId) ?? 0) > 0)
      .map((l) => ({
        purchaseOrderLineId: l.purchaseOrderLineId,
        productId: l.productId,
        sku: l.sku,
        descripcion: l.descripcion,
        cantidad: cantidades.get(l.purchaseOrderLineId) ?? 0,
      }))
    crear.mutate(
      {
        datos: {
          pedidoId: pedido.id,
          proveedorId: pedido.proveedorId,
          depositoId,
          fecha,
          documentoProveedor: documento,
          notas,
        },
        lineas: aRecibir,
      },
      { onSuccess: ({ id }) => void navegar(`/compras/recepciones/${id}`) },
    )
  }

  return (
    <div className={styles.page}>
      <Link to={`/compras/pedidos/${pedido.id}`} className={styles.volver}>
        ← {pedido.numero}
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>Recibir mercadería</h1>
          <p className={styles.subtitulo}>
            {pedido.numero} · {pedido.proveedor} · {formatearFecha(pedido.fecha)}
          </p>
        </div>
      </header>

      <p className={styles.avisoBaja} role="note">
        La recepción se guarda en <strong>borrador</strong> y no mueve stock. El stock entra
        cuando la confirmes, desde su ficha.
      </p>

      <section className={styles.bloque}>
        <dl className={styles.datos}>
          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Depósito *</dt>
            <dd className={styles.datoValor}>
              {depositos.isPending ? (
                'Cargando…'
              ) : (depositos.data ?? []).length === 0 ? (
                <span className={styles.falta}>No hay depósitos activos en esta empresa.</span>
              ) : (depositos.data ?? []).length === 1 ? (
                <>
                  {(depositos.data ?? [])[0]!.nombre}
                  <span className={styles.falta}> · único depósito activo</span>
                </>
              ) : (
                <select
                  className={styles.selectDato}
                  value={depositoId ?? ''}
                  aria-label="Depósito"
                  onChange={(e) => setDepositoId(e.target.value || null)}
                >
                  <option value="">Elegí un depósito</option>
                  {(depositos.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}
                      {d.esPorDefecto ? ' (por defecto)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Fecha de recepción</dt>
            <dd className={styles.datoValor}>
              <input
                type="date"
                className={styles.selectDato}
                value={fecha}
                aria-label="Fecha de recepción"
                onChange={(e) => setFecha(e.target.value)}
              />
            </dd>
          </div>

          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Remito del proveedor</dt>
            <dd className={styles.datoValor}>
              <input
                className={styles.selectDato}
                value={documento}
                placeholder="opcional"
                aria-label="Remito del proveedor"
                onChange={(e) => setDocumento(e.target.value)}
              />
            </dd>
          </div>
        </dl>

        <div className={styles.dato} style={{ marginTop: 'var(--space-4)' }}>
          <dt className={styles.datoEtiqueta}>Notas</dt>
          <dd className={styles.datoValor}>
            <textarea
              className={styles.areaDato}
              rows={2}
              value={notas}
              aria-label="Notas"
              onChange={(e) => setNotas(e.target.value)}
            />
          </dd>
        </div>
      </section>

      <section className={styles.bloque}>
        {pendiente.isPending ? (
          <p className={styles.nota}>Cargando lo pendiente…</p>
        ) : pendiente.error ? (
          <p className={styles.error} role="alert">
            {pendiente.error.message}
          </p>
        ) : (
          <GrillaRecepcion
            lineas={lineas}
            cantidades={cantidades}
            editable
            onCambiar={cambiar}
            onRecibirTodo={recibirTodo}
          />
        )}

        {crear.error ? (
          <p className={styles.error} role="alert">
            {crear.error.message}
          </p>
        ) : null}

        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.primario}
            disabled={crear.isPending || !depositoId || !hayAlgo || excede}
            onClick={guardar}
          >
            {crear.isPending ? 'Guardando…' : 'Crear recepción en borrador'}
          </button>
          <button
            type="button"
            className={styles.secundario}
            disabled={crear.isPending}
            onClick={() => void navegar(`/compras/pedidos/${pedido.id}`)}
          >
            Cancelar
          </button>
        </div>
      </section>
    </div>
  )
}
