import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ChipRecepcionDoc } from '../components/ChipEstado'
import { GrillaRecepcion } from '../components/GrillaRecepcion'
import { formatearFecha, formatearFechaHora, formatearNumero } from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import {
  useDepositos,
  useEditarRecepcion,
  useLineasDeRecepcion,
  usePendienteDePedido,
  useRecepcion,
} from '../hooks/useRecepciones'
import type { CantidadARecibir } from '../services/recepciones'
import styles from './ProveedorDetallePage.module.css'

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={styles.dato}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={styles.datoValor}>{children}</dd>
    </div>
  )
}

function Falta({ children }: { children: ReactNode }) {
  return <span className={styles.falta}>{children}</span>
}

/**
 * La ficha de una recepción.
 *
 * En **borrador** se pueden ajustar el depósito, la fecha, el remito, las
 * notas y las cantidades; se puede borrar; y se puede confirmar.
 *
 * **Confirmada está congelada**: no se edita, no vuelve a borrador y no se
 * borra. Lo imponen triggers, no los botones de acá. Revertir una recepción
 * confirmada sería un contramovimiento explícito de stock y eso no está en v1.
 */
export function RecepcionDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const navegar = useNavigate()

  const { data: recepcion, isPending, error } = useRecepcion(id)
  const lineasGuardadas = useLineasDeRecepcion(id)
  const depositos = useDepositos()
  const acciones = useEditarRecepcion(id ?? '')

  const [editando, setEditando] = useState(false)
  const [cantidades, setCantidades] = useState<Map<string, number> | null>(null)
  const [depositoId, setDepositoId] = useState<string | null>(null)
  const [fecha, setFecha] = useState<string | null>(null)
  const [documento, setDocumento] = useState<string | null>(null)
  const [notas, setNotas] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  // Lo pendiente del pedido, excluyendo ESTA recepción: si no, sus propias
  // cantidades aparecerían como «en borrador» compitiendo consigo mismas.
  const pendiente = usePendienteDePedido(
    recepcion?.pedidoId ?? undefined,
    (depositoId ?? recepcion?.depositoId) ?? null,
    id ?? null,
  )

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer la recepción: {error.message}
      </p>
    )
  }

  if (!recepcion) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró la recepción. Puede que no exista o que no tengas acceso: Compras es de
          administradores y empleados.
        </p>
        <Link to="/compras/recepciones" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  const esBorrador = recepcion.estado === 'draft'
  const escribe = permisos.editarProveedor
  const guardadas = lineasGuardadas.data ?? []

  // Lo que se ve en la grilla: lo pendiente del pedido más lo que esta
  // recepción ya tiene anotado, para poder ajustarlo.
  const porLinea = new Map(guardadas.map((l) => [l.purchaseOrderLineId ?? '', l.cantidad]))
  const actuales = cantidades ?? porLinea
  const lineasPendiente = (pendiente.data ?? []).map((l) => ({
    ...l,
    // Lo ya anotado por ESTA recepción vuelve a estar disponible para ella.
    pendiente: l.pendiente,
  }))

  const empezar = () => {
    setCantidades(new Map(porLinea))
    setDepositoId(recepcion.depositoId)
    setFecha(recepcion.fecha)
    setDocumento(recepcion.documentoProveedor ?? '')
    setNotas(recepcion.notas ?? '')
    setEditando(true)
  }

  const salir = () => {
    setCantidades(null)
    setDepositoId(null)
    setFecha(null)
    setDocumento(null)
    setNotas(null)
    setEditando(false)
  }

  const excede = lineasPendiente.some(
    (l) => (actuales.get(l.purchaseOrderLineId) ?? 0) > l.pendiente,
  )
  const hayAlgo = [...actuales.values()].some((v) => v > 0)

  const guardarTodo = async () => {
    if (excede || !hayAlgo) return
    try {
      await acciones.cabecera.mutateAsync({
        depositoId: depositoId ?? recepcion.depositoId,
        fecha: fecha ?? recepcion.fecha,
        documentoProveedor: documento ?? '',
        notas: notas ?? '',
      })
      const aRecibir: CantidadARecibir[] = lineasPendiente
        .filter((l) => (actuales.get(l.purchaseOrderLineId) ?? 0) > 0)
        .map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          productId: l.productId,
          sku: l.sku,
          descripcion: l.descripcion,
          cantidad: actuales.get(l.purchaseOrderLineId) ?? 0,
        }))
      await acciones.lineas.mutateAsync(aRecibir)
      salir()
    } catch {
      // El mensaje queda en `acciones.*.error`; no se sale de edición para no
      // perder lo cargado.
    }
  }

  const errorAlGuardar =
    acciones.cabecera.error?.message ?? acciones.lineas.error?.message ?? null

  const unidades = guardadas.reduce((a, l) => a + l.cantidad, 0)

  return (
    <div className={styles.page}>
      <Link to="/compras/recepciones" className={styles.volver}>
        ← Notas de entrada
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{recepcion.numero}</h1>
          <p className={styles.subtitulo}>
            <Link className={styles.enlace} to={`/compras/proveedores/${recepcion.proveedorId}`}>
              {recepcion.proveedor}
            </Link>
            {' · '}
            {formatearFecha(recepcion.fecha)}
            {' · '}
            {recepcion.deposito}
          </p>
          <div className={styles.chipsEstado}>
            <ChipRecepcionDoc estado={recepcion.estado} />
          </div>
        </div>

        {!editando ? (
          <div className={styles.acciones}>
            {escribe && esBorrador ? (
              <button type="button" className={styles.secundario} onClick={empezar}>
                Editar
              </button>
            ) : null}

            {escribe && esBorrador ? (
              confirmando ? (
                <>
                  <button
                    type="button"
                    className={styles.primario}
                    disabled={acciones.confirmar.isPending}
                    onClick={() =>
                      acciones.confirmar.mutate(undefined, {
                        onSuccess: (r) => {
                          setConfirmando(false)
                          setAviso(
                            r.yaEstaba
                              ? 'Esta recepción ya estaba confirmada: el stock no se sumó dos veces.'
                              : `Confirmada. ${r.movimientos} ${r.movimientos === 1 ? 'movimiento' : 'movimientos'} de stock.`,
                          )
                        },
                      })
                    }
                  >
                    {acciones.confirmar.isPending ? 'Confirmando…' : 'Sí, confirmar y sumar stock'}
                  </button>
                  <button
                    type="button"
                    className={styles.secundario}
                    onClick={() => setConfirmando(false)}
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.primario}
                  onClick={() => setConfirmando(true)}
                >
                  Confirmar recepción
                </button>
              )
            ) : null}

            {/* Facturar lo que llegó. Sólo desde una recepción confirmada:
                facturar lo que todavía no entró no es facturar, es adelantar.
                La grilla de la factura vuelve a preguntarle al servidor qué
                queda pendiente, así que si ya está toda facturada la pantalla
                lo dice sola. */}
            {escribe && !esBorrador ? (
              <Link
                to={`/compras/facturas/nueva?recepcion=${recepcion.id}&proveedor=${recepcion.proveedorId}`}
                className={styles.primario}
              >
                Facturar
              </Link>
            ) : null}

            {escribe && esBorrador ? (
              borrando ? (
                <>
                  <button
                    type="button"
                    className={styles.peligro}
                    disabled={acciones.borrar.isPending}
                    onClick={() =>
                      acciones.borrar.mutate(undefined, {
                        onSuccess: () => void navegar('/compras/recepciones'),
                      })
                    }
                  >
                    {acciones.borrar.isPending ? 'Borrando…' : 'Sí, borrar el borrador'}
                  </button>
                  <button
                    type="button"
                    className={styles.secundario}
                    onClick={() => setBorrando(false)}
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.secundario}
                  onClick={() => setBorrando(true)}
                >
                  Borrar borrador
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </header>

      {esBorrador ? (
        <p className={styles.avisoBaja} role="note">
          Esta recepción está en <strong>borrador</strong>: todavía no movió stock. Las
          cantidades anotadas acá <strong>no están reservadas</strong>; si otra recepción de las
          mismas líneas se confirma primero, ésta va a fallar por sobre-recepción.
        </p>
      ) : (
        <p className={styles.avisoBaja} role="note">
          Esta recepción está <strong>confirmada</strong>: movió stock y quedó congelada. No se
          edita, no vuelve a borrador y no se borra. Para deshacerla haría falta un movimiento de
          stock en contra, y eso todavía no existe.
        </p>
      )}

      {aviso ? (
        <p className={styles.avisoBaja} role="status">
          {aviso}
        </p>
      ) : null}
      {acciones.confirmar.error || acciones.borrar.error ? (
        <p className={styles.error} role="alert">
          {acciones.confirmar.error?.message ?? acciones.borrar.error?.message}
        </p>
      ) : null}

      <section className={styles.bloque}>
        <dl className={styles.datos}>
          <Dato etiqueta="Pedido de compra">
            {recepcion.pedidoId && recepcion.pedidoNumero ? (
              <Link className={styles.enlace} to={`/compras/pedidos/${recepcion.pedidoId}`}>
                {recepcion.pedidoNumero}
              </Link>
            ) : (
              <Falta>sin pedido</Falta>
            )}
          </Dato>
          <Dato etiqueta="Proveedor">
            <Link className={styles.enlace} to={`/compras/proveedores/${recepcion.proveedorId}`}>
              {recepcion.proveedor}
            </Link>
          </Dato>
          <Dato etiqueta="Depósito">
            {editando && (depositos.data ?? []).length > 1 ? (
              <select
                className={styles.selectDato}
                value={depositoId ?? recepcion.depositoId}
                aria-label="Depósito"
                onChange={(e) => setDepositoId(e.target.value)}
              >
                {(depositos.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            ) : (
              recepcion.deposito
            )}
          </Dato>
          <Dato etiqueta="Fecha de recepción">
            {editando ? (
              <input
                type="date"
                className={styles.selectDato}
                value={fecha ?? recepcion.fecha}
                aria-label="Fecha de recepción"
                onChange={(e) => setFecha(e.target.value)}
              />
            ) : (
              formatearFecha(recepcion.fecha)
            )}
          </Dato>
          <Dato etiqueta="Remito del proveedor">
            {editando ? (
              <input
                className={styles.selectDato}
                value={documento ?? ''}
                placeholder="opcional"
                aria-label="Remito del proveedor"
                onChange={(e) => setDocumento(e.target.value)}
              />
            ) : (
              recepcion.documentoProveedor ?? <Falta>sin remito</Falta>
            )}
          </Dato>
          <Dato etiqueta="Creada por">{recepcion.autor ?? <Falta>—</Falta>}</Dato>
          {!esBorrador ? (
            <Dato etiqueta="Confirmada">
              {formatearFechaHora(recepcion.confirmadaEn)}
              {recepcion.confirmadaPor ? ` · ${recepcion.confirmadaPor}` : ''}
            </Dato>
          ) : null}
          <Dato etiqueta="Unidades recibidas">{formatearNumero(unidades)}</Dato>
        </dl>

        {editando ? (
          <div className={styles.dato} style={{ marginTop: 'var(--space-4)' }}>
            <dt className={styles.datoEtiqueta}>Notas</dt>
            <dd className={styles.datoValor}>
              <textarea
                className={styles.areaDato}
                rows={2}
                value={notas ?? ''}
                aria-label="Notas"
                onChange={(e) => setNotas(e.target.value)}
              />
            </dd>
          </div>
        ) : recepcion.notas ? (
          <p className={styles.notas}>{recepcion.notas}</p>
        ) : null}
      </section>

      <section className={styles.bloque}>
        {editando ? (
          <>
            {pendiente.isPending ? (
              <p className={styles.nota}>Cargando lo pendiente…</p>
            ) : (
              <GrillaRecepcion
                lineas={lineasPendiente}
                cantidades={actuales}
                editable
                onCambiar={(lineaId, cantidad) =>
                  setCantidades((m) => {
                    const n = new Map(m ?? porLinea)
                    if (cantidad <= 0) n.delete(lineaId)
                    else n.set(lineaId, cantidad)
                    return n
                  })
                }
                onRecibirTodo={() =>
                  setCantidades(
                    new Map(
                      lineasPendiente
                        .filter((l) => l.pendiente > 0)
                        .map((l) => [l.purchaseOrderLineId, l.pendiente]),
                    ),
                  )
                }
              />
            )}

            {errorAlGuardar ? (
              <p className={styles.error} role="alert">
                {errorAlGuardar}
              </p>
            ) : null}

            <div className={styles.acciones}>
              <button
                type="button"
                className={styles.primario}
                disabled={acciones.cabecera.isPending || acciones.lineas.isPending || excede || !hayAlgo}
                onClick={() => void guardarTodo()}
              >
                {acciones.cabecera.isPending || acciones.lineas.isPending
                  ? 'Guardando…'
                  : 'Guardar cambios'}
              </button>
              <button type="button" className={styles.secundario} onClick={salir}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <div className={styles.scrollLineas}>
            <table className={styles.tablaLineas}>
              <thead>
                <tr>
                  <th scope="col">Referencia</th>
                  <th scope="col">Descripción</th>
                  <th scope="col" className={styles.derecha}>
                    Cantidad
                  </th>
                </tr>
              </thead>
              <tbody>
                {guardadas.map((l) => (
                  <tr key={l.id}>
                    <td className={styles.mono}>{l.sku ?? '—'}</td>
                    <td>
                      {l.descripcion ?? '—'}
                      {l.productId === null ? (
                        <span className={styles.falta}> · no mueve stock</span>
                      ) : null}
                    </td>
                    <td className={styles.derecha}>{formatearNumero(l.cantidad)}</td>
                  </tr>
                ))}
                {guardadas.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={styles.nota}>
                      Esta recepción no tiene líneas.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
