import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { ActionBar } from '@/components/document/ActionBar'
import docUi from '@/components/document/Document.module.css'
import { ChipFactura } from '../components/ChipEstado'
import { ModalImpresionCompras } from '../components/ModalImpresionCompras'
import { PanelAdjuntosCompras } from '../components/PanelAdjuntosCompras'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelTotales } from '../components/PanelTotales'
import { editabilidadDeFactura } from '../lib/estados'
import { diferenciasConPedido, repartoDeLineas } from '../lib/facturacion'
import { imprimibleFactura } from '../lib/impresion'
import { etiquetaDeTratamiento } from '../lib/tratamientos'
import {
  formatearFecha,
  formatearFechaHora,
  formatearImporte,
  formatearNumero,
} from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import { CLASES_FACTURA } from '../services/adjuntosCompras'
import {
  useEditarFactura,
  useFactura,
  useHistorialDeFactura,
  useLineasDeFactura,
  useRelacionadosDeFactura,
} from '../hooks/useFacturas'
import styles from './ProveedorDetallePage.module.css'
import listado from '../components/ListadoPedidos.module.css'

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
 * La ficha de una factura de proveedor.
 *
 * **No mueve stock, en ningún estado.** El stock entró con la recepción.
 *
 * En borrador se puede editar y descartar. Registrada queda congelada y sólo
 * puede anularse; anularla **libera lo facturado**, porque lo pendiente cuenta
 * sólo las registradas. Lo imponen triggers, no los botones de acá.
 *
 * Las diferencias con el pedido se **derivan** comparando cada línea con el
 * snapshot de su `purchase_order_line`. No hay tabla de discrepancias.
 */
export function FacturaDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const navegar = useNavigate()

  const { data: factura, isPending, error } = useFactura(id)
  const lineas = useLineasDeFactura(id)
  const relacionados = useRelacionadosDeFactura(id)
  const historial = useHistorialDeFactura(id)
  const acciones = useEditarFactura(id ?? '')

  const [registrando, setRegistrando] = useState(false)
  const [anulando, setAnulando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState(false)

  if (isPending) {
    return (
      <p className={styles.nota} role="status">
        <Spinner size={20} /> Cargando factura…
      </p>
    )
  }

  if (error) {
    return <ErrorState title="No se pudo leer la factura." description={error.message} />
  }

  if (!factura) {
    return (
      <EmptyState
        headingLevel={1}
        icon="search"
        title="No se encontró la factura"
        description="Puede que no exista o que no tengas acceso: Compras es de administradores y empleados."
        action={
          <LinkButton to="/compras/facturas" icon={<Icon name="arrow-left" size={16} />}>
            Volver a Facturas de proveedor
          </LinkButton>
        }
      />
    )
  }

  const puede = editabilidadDeFactura(factura.estado)
  const escribe = permisos.editarProveedor
  const filas = lineas.data ?? []
  const diferencias = diferenciasConPedido(filas)
  const reparto = repartoDeLineas(filas)

  return (
    <div className={docUi.pagina}>
      {imprimiendo ? (
        <ModalImpresionCompras
          doc={imprimibleFactura(factura, filas, etiquetaDeTratamiento, [
            ...(relacionados.data?.recepciones ?? []).map((r) => r.numero),
            ...(relacionados.data?.pedidos ?? []).map((x) => x.numero),
          ])}
          onCerrar={() => setImprimiendo(false)}
        />
      ) : null}

      <PageHeader
        back={{ to: '/compras/facturas', label: 'Facturas de proveedor' }}
        title={factura.numeroProveedor ?? <Falta>sin número del proveedor</Falta>}
        status={<ChipFactura estado={factura.estado} />}
        subtitle={
          <>
            <Link className={docUi.enlace} to={`/compras/proveedores/${factura.proveedorId}`}>
              {factura.proveedor}
            </Link>
            {' · '}
            {formatearFecha(factura.fecha)}
            {' · ref. '}
            {factura.numero}
          </>
        }
        actions={
          <div className={docUi.importe}>
            <span className={docUi.importeValor}>{formatearImporte(factura.total, factura.moneda)}</span>
            <span className={docUi.importeLabel}>Total</span>
          </div>
        }
      />

      {factura.estado === 'draft' ? (
        <Alert tone="warning">
          <p>
            Esta factura está en <strong>borrador</strong>. Las cantidades anotadas acá{' '}
            <strong>no están reservadas</strong>: si otra factura de las mismas líneas se registra
            primero, ésta va a fallar por sobre-facturación.
          </p>
        </Alert>
      ) : factura.estado === 'registered' ? (
        <Alert tone="info">
          <p>
            Esta factura está <strong>registrada</strong> y quedó congelada. Una factura no mueve
            stock —el stock entró con la recepción—, así que anularla no deshace nada físico: lo
            que hace es liberar lo facturado.
          </p>
        </Alert>
      ) : (
        <Alert tone="neutral">
          <p>
            Esta factura está <strong>anulada</strong>. No se modifica, y lo que facturaba volvió a
            quedar pendiente de facturar.
          </p>
        </Alert>
      )}

      {aviso ? (
        <Alert tone="success" role="status">
          <p>{aviso}</p>
        </Alert>
      ) : null}
      {acciones.registrar.error || acciones.anular.error || acciones.borrar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo completar la acción">
          <p>
            {acciones.registrar.error?.message ??
              acciones.anular.error?.message ??
              acciones.borrar.error?.message}
          </p>
        </Alert>
      ) : null}

      <ActionBar
        primary={
          escribe && puede.registrar ? (
            <Button icon={<Icon name="check" size={16} />} onClick={() => setRegistrando(true)}>
              Registrar factura
            </Button>
          ) : null
        }
        secondary={
          // Imprimir: se imprime lo que el proveedor facturó, sin arreglar
          // nada. Si facturó a otro precio que la orden, sale ese precio.
          <Button variant="secondary" icon={<Icon name="printer" size={16} />} onClick={() => setImprimiendo(true)}>
            Imprimir
          </Button>
        }
        danger={
          (escribe && puede.anular) || (escribe && puede.borrar) ? (
            <>
              {escribe && puede.anular ? (
                <Button variant="secondary" onClick={() => setAnulando(true)}>
                  Anular factura
                </Button>
              ) : null}
              {escribe && puede.borrar ? (
                <Button variant="danger" icon={<Icon name="trash" size={16} />} onClick={() => setBorrando(true)}>
                  Borrar borrador
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {diferencias.length > 0 ? (
        <div className={styles.revision} role="note">
          <strong>Hay diferencias con lo que decía el pedido.</strong>
          <ul className={styles.motivos}>
            {diferencias.map((d, i) => (
              <li key={`${d.lineaId}-${d.tipo}-${i}`}>
                Línea {d.numeroLinea}:{' '}
                {d.tipo === 'precio'
                  ? `el pedido decía ${formatearImporte(Number(d.enPedido), factura.moneda)} y la factura dice ${formatearImporte(Number(d.enFactura), factura.moneda)}`
                  : `el pedido decía ${etiquetaDeTratamiento(d.enPedido)} y la factura dice ${etiquetaDeTratamiento(d.enFactura)}`}
              </li>
            ))}
          </ul>
          Es un aviso, no un error: el proveedor puede facturar distinto de lo que se le pidió.
          El pedido <strong>no se modificó</strong>.
        </div>
      ) : null}

      <section className={styles.bloque}>
        <dl className={styles.datos}>
          <Dato etiqueta="Número del proveedor">
            {factura.numeroProveedor ?? <Falta>sin número</Falta>}
          </Dato>
          <Dato etiqueta="Referencia interna">{factura.numero}</Dato>
          <Dato etiqueta="Proveedor">
            <Link className={styles.enlace} to={`/compras/proveedores/${factura.proveedorId}`}>
              {factura.proveedor}
            </Link>
          </Dato>
          <Dato etiqueta="Fecha">{formatearFecha(factura.fecha)}</Dato>
          <Dato etiqueta="Vencimiento">
            {factura.vencimiento ? formatearFecha(factura.vencimiento) : <Falta>sin vencimiento</Falta>}
          </Dato>
          <Dato etiqueta="Moneda">{factura.moneda}</Dato>
          <Dato etiqueta="Tipo de cambio">
            {factura.tipoCambio ?? <Falta>sin tipo de cambio</Falta>}
          </Dato>
          <Dato etiqueta="Condición de pago">
            {factura.formaPago ?? <Falta>no definida</Falta>}
          </Dato>
          <Dato etiqueta="Cargada por">{factura.autor ?? <Falta>—</Falta>}</Dato>
          <Dato etiqueta="Última modificación">
            {formatearFechaHora(factura.actualizadoEn)}
          </Dato>
        </dl>

        {factura.notas ? <p className={styles.notas}>{factura.notas}</p> : null}
      </section>

      <section className={styles.bloque}>
        <div className={listado.scroll}>
          <table className={listado.tabla}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Origen</th>
                <th scope="col">Referencia</th>
                <th scope="col">Descripción</th>
                <th scope="col" className={listado.derecha}>
                  Cantidad
                </th>
                <th scope="col" className={listado.derecha}>
                  Precio
                </th>
                <th scope="col">Impuesto</th>
                <th scope="col" className={listado.derecha}>
                  Neto
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((l) => (
                <tr key={l.id}>
                  <td className={listado.numero}>{l.numeroLinea}</td>
                  <td className={listado.numero}>
                    {l.recepcionNumero ?? <span className={listado.falta}>sin recepción</span>}
                  </td>
                  <td className={listado.numero}>{l.sku ?? '—'}</td>
                  <td className={listado.recorta} title={l.descripcion ?? undefined}>
                    {l.descripcion ?? '—'}
                  </td>
                  <td className={listado.derecha}>{formatearNumero(l.cantidad)}</td>
                  <td className={listado.derecha}>
                    {formatearImporte(l.precioUnitario, factura.moneda)}
                  </td>
                  <td>{etiquetaDeTratamiento(l.tratamientoImpuesto)}</td>
                  <td className={listado.derecha}>
                    {formatearImporte(l.netoServidor, factura.moneda)}
                  </td>
                </tr>
              ))}
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={8} className={styles.nota}>
                    Esta factura no tiene líneas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {reparto.sinRecepcion > 0 ? (
          <p className={styles.nota}>
            {reparto.conRecepcion} {reparto.conRecepcion === 1 ? 'línea sale' : 'líneas salen'} de
            mercadería recibida ({formatearImporte(reparto.netoConRecepcion, factura.moneda)}) y{' '}
            {reparto.sinRecepcion} {reparto.sinRecepcion === 1 ? 'es' : 'son'} conceptos sin
            recepción ({formatearImporte(reparto.netoSinRecepcion, factura.moneda)}). Ninguna
            mueve stock.
          </p>
        ) : null}

        <PanelTotales
          moneda={factura.moneda}
          servidor={{
            subtotal: factura.subtotal,
            impuesto: factura.impuesto,
            total: factura.total,
          }}
          previo={{
            bruto: factura.subtotal,
            descuento: 0,
            subtotal: factura.subtotal,
            impuesto: factura.impuesto,
            total: factura.total,
          }}
          sinGuardar={false}
        />
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.datoEtiqueta}>Documentos relacionados</h2>
        {relacionados.isPending ? (
          <p className={styles.nota}>Cargando…</p>
        ) : (relacionados.data?.recepciones.length ?? 0) === 0 &&
          (relacionados.data?.pedidos.length ?? 0) === 0 ? (
          <p className={styles.nota}>
            Esta factura no sale de ninguna recepción: son todos conceptos sueltos.
          </p>
        ) : (
          <>
            <p className={styles.nota}>
              Se derivan por las líneas —factura → recepción → pedido—, no por una clave en la
              cabecera: una factura puede tocar varias recepciones y varios pedidos.
            </p>
            <ul className={styles.chipsLista}>
              {(relacionados.data?.recepciones ?? []).map((r) => (
                <li key={r.id}>
                  <Link className={styles.enlace} to={`/compras/recepciones/${r.id}`}>
                    {r.numero}
                  </Link>{' '}
                  <span className={styles.falta}>· {formatearFecha(r.fecha)}</span>
                </li>
              ))}
              {(relacionados.data?.pedidos ?? []).map((p) => (
                <li key={p.id}>
                  <Link className={styles.enlace} to={`/compras/pedidos/${p.id}`}>
                    {p.numero}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.datoEtiqueta}>Adjuntos</h2>
        <p className={styles.nota}>
          El PDF o el XML de la factura, el remito que vino con la mercadería. Bucket privado y la
          misma RLS que el resto de Compras: cada descarga usa un enlace firmado de cinco minutos.
        </p>
        <PanelAdjuntosCompras
          entidad="supplier_invoice"
          entidadId={factura.id}
          clases={CLASES_FACTURA}
          puedeEditar={escribe && factura.estado !== 'cancelled'}
        />
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.datoEtiqueta}>Historial</h2>
        <PanelHistorial
          eventos={historial.data ?? []}
          cargando={historial.isPending}
          esHistorico={false}
        />
      </section>
      <ConfirmDialog
        open={registrando}
        title={`¿Registrar la factura ${factura.numeroProveedor ?? factura.numero}?`}
        description="Queda congelada y lo facturado deja de estar pendiente. Una factura no mueve stock."
        confirmLabel="Registrar factura"
        cancelLabel="Volver"
        busy={acciones.registrar.isPending}
        onCancel={() => setRegistrando(false)}
        onConfirm={() =>
          acciones.registrar.mutate(undefined, {
            onSuccess: (r) => {
              setRegistrando(false)
              setAviso(r.yaEstaba ? 'Esta factura ya estaba registrada.' : `Registrada. ${r.lineas} ${r.lineas === 1 ? 'línea' : 'líneas'}.`)
            },
            onError: () => setRegistrando(false),
          })
        }
      />
      <ConfirmDialog
        open={anulando}
        tone="danger"
        title={`¿Anular la factura ${factura.numeroProveedor ?? factura.numero}?`}
        description="No se puede deshacer: la factura queda anulada y lo que facturaba vuelve a estar pendiente de facturar."
        confirmLabel="Anular factura"
        cancelLabel="Volver"
        busy={acciones.anular.isPending}
        onCancel={() => setAnulando(false)}
        onConfirm={() =>
          acciones.anular.mutate(undefined, {
            onSuccess: (ok) => {
              setAnulando(false)
              if (!ok) setAviso('Alguien más ya cambió el estado de esta factura.')
            },
            onError: () => setAnulando(false),
          })
        }
      />
      <ConfirmDialog
        open={borrando}
        tone="danger"
        title={`¿Borrar el borrador ${factura.numero}?`}
        description="Se borra la factura en borrador y sus líneas. No se puede deshacer."
        confirmLabel="Borrar borrador"
        cancelLabel="Volver"
        busy={acciones.borrar.isPending}
        onCancel={() => setBorrando(false)}
        onConfirm={() =>
          acciones.borrar.mutate(undefined, {
            onSuccess: () => void navegar('/compras/facturas'),
            onError: () => setBorrando(false),
          })
        }
      />
    </div>
  )
}
