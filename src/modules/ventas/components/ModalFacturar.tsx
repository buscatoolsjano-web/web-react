import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { obtenerCliente } from '@/modules/clientes/services/clientes'
import { DatosFiscalesCliente } from '@/modules/clientes/components/DatosFiscalesCliente'
import { etiquetaCondicionIva, pideCuit } from '@/modules/clientes/lib/condicionIva'
import { useCrearFacturaDesdePedido } from '../hooks/useFacturasVenta'
import { formatearImporte } from '../lib/formato'

export interface ModalFacturarProps {
  pedidoId: string
  pedidoNumero: string
  clienteId: string | null
  clienteNombre: string
  total: number | null
  moneda: string | null
  formaPago: string | null
  onCerrar: () => void
}

/**
 * «Generar factura» con confirmación y con los datos fiscales a la vista.
 *
 * Antes era un click sin preguntar nada y sin mirar si el cliente tenía CUIT
 * o condición de IVA. Ahora: se muestra a quién y por cuánto, y si al cliente
 * le falta lo fiscal se carga ACÁ, sin ir a su ficha, y se factura.
 */
export function ModalFacturar({ pedidoId, pedidoNumero, clienteId, clienteNombre, total, moneda, formaPago, onCerrar }: ModalFacturarProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const qc = useQueryClient()
  const navegar = useNavigate()
  const facturar = useCrearFacturaDesdePedido()
  const [fecha, setFecha] = useState(() => new Date().toLocaleDateString('sv-SE'))

  const cliente = useQuery({
    queryKey: ['clientes', companyId, 'detalle', clienteId],
    queryFn: () => obtenerCliente(companyId!, clienteId!),
    enabled: companyId !== null && clienteId !== null,
    staleTime: 0,
  })

  const c = cliente.data
  const faltanDatos = c ? c.condicionIva === null || (pideCuit(c.condicionIva) && !c.cuit) : false

  const generar = () =>
    facturar.mutate(
      { orderId: pedidoId, fecha },
      { onSuccess: (r) => void navegar(`/ventas/facturas/${r.id}`) },
    )

  // El error de la base cuando faltan datos fiscales se reconoce por su prefijo.
  const errorFiscal = facturar.error?.message.startsWith('datos_fiscales')
  const mensajeError = facturar.error ? facturar.error.message.replace(/^datos_fiscales:\s*/, '') : null

  return (
    <Dialog
      open
      onClose={onCerrar}
      title={`Facturar ${pedidoNumero}`}
      size="md"
      busy={facturar.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={facturar.isPending}>
            Cancelar
          </Button>
          <Button onClick={generar} loading={facturar.isPending} disabled={cliente.isPending || faltanDatos}>
            Generar factura
          </Button>
        </>
      }
    >
      <p>
        <strong>{clienteNombre}</strong>
        {total !== null ? <> · {formatearImporte(total, moneda)}</> : null}
        {formaPago ? <> · {formaPago}</> : null}
      </p>

      <label>
        Fecha de la factura{' '}
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </label>

      {c && !faltanDatos ? (
        <p>
          {etiquetaCondicionIva(c.condicionIva)}
          {c.cuit ? ` · CUIT ${c.cuit}` : ''}
        </p>
      ) : null}

      {c && faltanDatos ? (
        <Alert tone="warning" role="status" title="Faltan los datos fiscales del cliente">
          <p>Sin la condición frente al IVA (y el CUIT, salvo consumidor final o exterior) no se puede facturar.</p>
          <DatosFiscalesCliente
            clienteId={c.id}
            condicion={c.condicionIva}
            cuit={c.cuit}
            textoBoton="Guardar datos"
            onGuardado={() => void qc.invalidateQueries({ queryKey: ['clientes', companyId] })}
          />
        </Alert>
      ) : null}

      {mensajeError && !errorFiscal ? (
        <Alert tone="danger" role="alert" title="No se pudo facturar">
          <p>{mensajeError}</p>
        </Alert>
      ) : null}
      {errorFiscal ? (
        <Alert tone="warning" role="alert" title="Faltan los datos fiscales del cliente">
          <p>{mensajeError}</p>
        </Alert>
      ) : null}

      <p>
        La factura nace en borrador con número interno. Cuando la emitas en Tango, cargale el número fiscal desde la
        factura.
      </p>
    </Dialog>
  )
}
