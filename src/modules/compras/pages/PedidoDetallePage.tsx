import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ChipEstado, ChipRecepcion } from '../components/ChipEstado'
import { FormularioPedido } from '../components/FormularioPedido'
import { ModalImpresionCompras } from '../components/ModalImpresionCompras'
import { PanelAdjuntosCompras } from '../components/PanelAdjuntosCompras'
import { PanelRelacionadosPedido } from '../components/PanelRelacionadosPedido'
import { editabilidadDe } from '../lib/estados'
import { problemasDeLinea } from '../lib/lineas'
import { formatearFecha, formatearFechaHora, formatearImporte } from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import { imprimiblePedido } from '../lib/impresion'
import { etiquetaDeTratamiento } from '../lib/tratamientos'
import { CLASES_PEDIDO } from '../services/adjuntosCompras'
import { validarPedido, type DatosPedidoCompra, type ErrorDePedido } from '../lib/validacion'
import {
  useEstadoPedido,
  useGuardarPedido,
  useLineasDePedido,
  usePedido,
  useRelacionadosDePedido,
} from '../hooks/usePedidos'
import { obtenerProveedorBreve, type ProveedorBuscado } from '../services/catalogo'
import type { LineaPedidoCompra, PedidoCompraDetalle } from '../types'
import styles from './ProveedorDetallePage.module.css'

type Pestana = 'pedido' | 'adjuntos' | 'relacionados'

const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'pedido', etiqueta: 'Pedido' },
  { clave: 'adjuntos', etiqueta: 'Adjuntos' },
  { clave: 'relacionados', etiqueta: 'Relacionados' },
]

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

function aFormulario(p: PedidoCompraDetalle): DatosPedidoCompra {
  return {
    proveedorId: p.proveedorId,
    moneda: p.moneda,
    tipoCambio: p.tipoCambio === null ? '' : String(p.tipoCambio),
    fecha: p.fecha,
    fechaEstimada: p.fechaEstimada ?? '',
    formaPago: p.formaPago ?? '',
    notas: p.notas ?? '',
  }
}

/**
 * La ficha del pedido de compra.
 *
 * Qué se puede tocar lo decide el estado, y lo decide **el servidor**: los
 * triggers `app.proteger_estado_pedido_compra()` y
 * `app.proteger_lineas_pedido_compra()` rechazan lo que no corresponde aunque
 * la escritura venga de un script. Los controles deshabilitados de acá son
 * para no ofrecer una acción que va a fallar.
 *
 * **Confirmar no mueve stock.** Es una transición comercial: el pedido se le
 * mandó al proveedor. El stock entra recién con la nota de entrada.
 */
export function PedidoDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const navegar = useNavigate()

  const { data: pedido, isPending, error } = usePedido(id)
  const lineasServidor = useLineasDePedido(id)
  const relacionados = useRelacionadosDePedido(id)
  const guardar = useGuardarPedido(id ?? '')
  const estado = useEstadoPedido(id ?? '')

  const [pestana, setPestana] = useState<Pestana>('pedido')
  const [editando, setEditando] = useState(false)
  const [datos, setDatos] = useState<DatosPedidoCompra | null>(null)
  const [lineas, setLineas] = useState<LineaPedidoCompra[] | null>(null)
  const [errores, setErrores] = useState<ErrorDePedido[]>([])
  const [confirmando, setConfirmando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState(false)

  const proveedor = useQuery<ProveedorBuscado | null>({
    queryKey: ['compras', companyId, 'proveedor-breve', pedido?.proveedorId],
    queryFn: () => obtenerProveedorBreve(companyId!, pedido!.proveedorId),
    enabled: companyId !== null && !!pedido,
    staleTime: 5 * 60_000,
  })

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer el pedido: {error.message}
      </p>
    )
  }

  if (!pedido) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró el pedido. Puede que no exista o que no tengas acceso: Compras es de
          administradores y empleados.
        </p>
        <Link to="/compras/pedidos" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  const puede = editabilidadDe(pedido.estado, pedido.conRecepcion)
  const escribe = permisos.editarProveedor
  const datosActuales = datos ?? aFormulario(pedido)
  const lineasActuales = lineas ?? lineasServidor.data ?? []
  const sinGuardar = editando && (datos !== null || lineas !== null)

  const empezarEdicion = () => {
    setDatos(aFormulario(pedido))
    setLineas([...(lineasServidor.data ?? [])])
    setErrores([])
    setEditando(true)
  }

  const salirDeEdicion = () => {
    setDatos(null)
    setLineas(null)
    setErrores([])
    setEditando(false)
  }

  const problemas = lineasActuales.flatMap((l) => problemasDeLinea(l))

  const guardarTodo = async () => {
    const encontrados = validarPedido(datosActuales)
    setErrores(encontrados)
    if (encontrados.length > 0 || problemas.length > 0) return
    try {
      await guardar.cabecera.mutateAsync({
        datos: datosActuales,
        puedeIdentidad: puede.identidad,
      })
      if (puede.lineas) await guardar.lineas.mutateAsync(lineasActuales)
      salirDeEdicion()
    } catch {
      // El mensaje ya queda en `guardar.*.error`; no se sale de edición para
      // no perder lo escrito.
    }
  }

  const errorAlGuardar = guardar.cabecera.error?.message ?? guardar.lineas.error?.message ?? null

  return (
    <div className={styles.page}>
      <Link to="/compras/pedidos" className={styles.volver}>
        ← Pedidos de compra
      </Link>

      {imprimiendo ? (
        <ModalImpresionCompras
          doc={imprimiblePedido(pedido, lineasServidor.data ?? [], etiquetaDeTratamiento)}
          onCerrar={() => setImprimiendo(false)}
        />
      ) : null}

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{pedido.numero}</h1>
          <p className={styles.subtitulo}>
            <Link className={styles.enlace} to={`/compras/proveedores/${pedido.proveedorId}`}>
              {pedido.proveedor}
            </Link>
            {' · '}
            {formatearFecha(pedido.fecha)}
            {' · '}
            {formatearImporte(pedido.total, pedido.moneda)}
          </p>
          <div className={styles.chipsEstado}>
            <ChipEstado estado={pedido.estado} />
            <ChipRecepcion estado={pedido.estadoRecepcion} />
          </div>
        </div>

        {!editando ? (
          <div className={styles.acciones}>
            {escribe && puede.cabecera ? (
              <button type="button" className={styles.secundario} onClick={empezarEdicion}>
                Editar
              </button>
            ) : null}

            {/* Imprimir: el pedido es lo que se le manda al proveedor. Se
                arma con los snapshots guardados, nunca con el catálogo de hoy. */}
            <button
              type="button"
              className={styles.secundario}
              onClick={() => setImprimiendo(true)}
            >
              Imprimir
            </button>

            {escribe && puede.confirmar ? (
              confirmando ? (
                <>
                  <button
                    type="button"
                    className={styles.primario}
                    disabled={estado.confirmar.isPending}
                    onClick={() =>
                      estado.confirmar.mutate(undefined, {
                        onSuccess: (ok) => {
                          setConfirmando(false)
                          if (!ok) setAviso('Alguien más ya cambió el estado de este pedido.')
                        },
                      })
                    }
                  >
                    {estado.confirmar.isPending ? 'Confirmando…' : 'Sí, confirmar'}
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
                  Confirmar pedido
                </button>
              )
            ) : null}

            {escribe && puede.cancelar ? (
              cancelando ? (
                <>
                  <button
                    type="button"
                    className={styles.peligro}
                    disabled={estado.cancelar.isPending}
                    onClick={() =>
                      estado.cancelar.mutate(undefined, {
                        onSuccess: (ok) => {
                          setCancelando(false)
                          if (!ok) setAviso('Alguien más ya cambió el estado de este pedido.')
                        },
                      })
                    }
                  >
                    {estado.cancelar.isPending ? 'Cancelando…' : 'Sí, cancelar'}
                  </button>
                  <button
                    type="button"
                    className={styles.secundario}
                    onClick={() => setCancelando(false)}
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.secundario}
                  onClick={() => setCancelando(true)}
                >
                  Cancelar pedido
                </button>
              )
            ) : null}

            {/* Recibir mercadería. Sólo desde un pedido confirmado y mientras
                quede algo por recibir: un pedido ya recibido del todo no
                necesita otra nota de entrada. */}
            {escribe &&
            pedido.estado === 'confirmed' &&
            pedido.estadoRecepcion !== 'received' ? (
              <Link to={`/compras/recepciones/nueva?pedido=${pedido.id}`} className={styles.primario}>
                Recibir mercadería
              </Link>
            ) : null}

            {/* Facturar. Se factura lo RECIBIDO, no lo pedido: el enlace lleva
                a la pantalla con el proveedor puesto y ahí aparece lo pendiente
                de facturar de todas sus recepciones confirmadas —que puede
                venir de este pedido y de otros—. Por eso no se filtra por
                pedido: una factura no es de un pedido. */}
            {escribe && pedido.estado === 'confirmed' && pedido.estadoRecepcion !== 'pending' ? (
              <Link
                to={`/compras/facturas/nueva?proveedor=${pedido.proveedorId}`}
                className={styles.secundario}
              >
                Facturar
              </Link>
            ) : null}

            {escribe ? (
              <button
                type="button"
                className={styles.secundario}
                disabled={estado.duplicar.isPending}
                onClick={() =>
                  estado.duplicar.mutate(undefined, {
                    onSuccess: (nuevo) => void navegar(`/compras/pedidos/${nuevo}`),
                  })
                }
              >
                {estado.duplicar.isPending ? 'Duplicando…' : 'Duplicar'}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {pedido.estado === 'cancelled' ? (
        <p className={styles.avisoBaja} role="note">
          Este pedido está <strong>cancelado</strong>: no se modifica ni se reabre. Si hace falta
          uno parecido, duplicalo.
        </p>
      ) : null}

      {pedido.conRecepcion ? (
        <p className={styles.avisoBaja} role="note">
          Este pedido ya tiene mercadería recibida: <strong>sus líneas están congeladas</strong> y
          no se puede cancelar. La llegada estimada, la condición de pago y las notas sí se pueden
          ajustar, y cada cambio queda registrado.
        </p>
      ) : pedido.estado === 'confirmed' ? (
        <p className={styles.avisoBaja} role="note">
          Este pedido está confirmado: el proveedor ya lo tiene. El proveedor, la moneda y la
          fecha no se cambian, y <strong>cada cambio queda registrado</strong>.
        </p>
      ) : null}

      {aviso ? (
        <p className={styles.error} role="alert">
          {aviso}
        </p>
      ) : null}
      {estado.confirmar.error || estado.cancelar.error || estado.duplicar.error ? (
        <p className={styles.error} role="alert">
          {estado.confirmar.error?.message ??
            estado.cancelar.error?.message ??
            estado.duplicar.error?.message}
        </p>
      ) : null}

      <nav className={styles.pestanas} aria-label="Secciones del pedido">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            className={p.clave === pestana ? styles.pestanaActiva : styles.pestana}
            aria-current={p.clave === pestana ? 'true' : undefined}
            onClick={() => setPestana(p.clave)}
          >
            {p.etiqueta}
          </button>
        ))}
      </nav>

      <section className={styles.bloque}>
        {pestana === 'pedido' && editando ? (
          <>
            {sinGuardar ? (
              <p className={styles.sinGuardar} role="note">
                Hay cambios sin guardar. Los totales que se ven son una cuenta provisoria; el que
                vale lo calcula el servidor al guardar.
              </p>
            ) : null}

            <FormularioPedido
              datos={datosActuales}
              errores={errores}
              lineas={lineasActuales}
              proveedor={proveedor.data ?? null}
              moneda={datosActuales.moneda}
              editaIdentidad={puede.identidad}
              editaLogistica={puede.logistica}
              editaLineas={puede.lineas}
              totalesServidor={{
                subtotal: pedido.subtotal,
                impuesto: pedido.impuesto,
                total: pedido.total,
              }}
              sinGuardar={sinGuardar}
              onCambiarCabecera={(cambios) => {
                const siguiente = { ...datosActuales, ...cambios }
                setDatos(siguiente)
                if (errores.length > 0) setErrores(validarPedido(siguiente))
              }}
              onProveedor={(p) => setDatos({ ...datosActuales, proveedorId: p?.id ?? '' })}
              onCambiarLineas={setLineas}
            />

            {errorAlGuardar ? (
              <p className={styles.error} role="alert">
                {errorAlGuardar}
              </p>
            ) : null}

            <div className={styles.acciones}>
              <button
                type="button"
                className={styles.primario}
                disabled={guardar.cabecera.isPending || guardar.lineas.isPending}
                onClick={() => void guardarTodo()}
              >
                {guardar.cabecera.isPending || guardar.lineas.isPending
                  ? 'Guardando…'
                  : 'Guardar cambios'}
              </button>
              <button type="button" className={styles.secundario} onClick={salirDeEdicion}>
                Cancelar
              </button>
            </div>
          </>
        ) : null}

        {pestana === 'pedido' && !editando ? (
          <>
            <dl className={styles.datos}>
              <Dato etiqueta="Proveedor">
                <Link className={styles.enlace} to={`/compras/proveedores/${pedido.proveedorId}`}>
                  {pedido.proveedor}
                </Link>
              </Dato>
              <Dato etiqueta="Fecha del pedido">{formatearFecha(pedido.fecha)}</Dato>
              <Dato etiqueta="Llegada estimada">
                {pedido.fechaEstimada ? (
                  formatearFecha(pedido.fechaEstimada)
                ) : (
                  <Falta>todavía no se sabe</Falta>
                )}
              </Dato>
              <Dato etiqueta="Moneda">{pedido.moneda}</Dato>
              <Dato etiqueta="Tipo de cambio">
                {pedido.tipoCambio ?? <Falta>sin tipo de cambio</Falta>}
              </Dato>
              <Dato etiqueta="Condición de pago">
                {pedido.formaPago ?? <Falta>no definida</Falta>}
              </Dato>
              <Dato etiqueta="Creado por">{pedido.autor ?? <Falta>—</Falta>}</Dato>
              <Dato etiqueta="Última modificación">
                {formatearFechaHora(pedido.actualizadoEn)}
              </Dato>
            </dl>

            {pedido.notas ? <p className={styles.notas}>{pedido.notas}</p> : null}

            <FormularioPedido
              datos={datosActuales}
              errores={[]}
              lineas={lineasActuales}
              proveedor={proveedor.data ?? null}
              moneda={pedido.moneda}
              editaIdentidad={false}
              editaLogistica={false}
              editaLineas={false}
              mostrarCabecera={false}
              totalesServidor={{
                subtotal: pedido.subtotal,
                impuesto: pedido.impuesto,
                total: pedido.total,
              }}
              sinGuardar={false}
              onCambiarCabecera={() => {}}
              onProveedor={() => {}}
              onCambiarLineas={() => {}}
            />
          </>
        ) : null}

        {pestana === 'adjuntos' ? (
          <PanelAdjuntosCompras
            entidad="purchase_order"
            entidadId={pedido.id}
            clases={CLASES_PEDIDO}
            puedeEditar={escribe && pedido.estado !== 'cancelled'}
          />
        ) : null}

        {pestana === 'relacionados' ? (
          <PanelRelacionadosPedido
            pedido={pedido}
            datos={relacionados.data}
            cargando={relacionados.isPending}
          />
        ) : null}
      </section>
    </div>
  )
}
