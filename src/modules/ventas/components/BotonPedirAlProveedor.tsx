import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { estadoDelPedido, pedidoDeCotizacion, pedirAlProveedor } from '../services/pedidoAlProveedor'

/**
 * La acción principal de la cotización de un distribuidor (Fase 4): una vez
 * aceptada, pedirle la mercadería al proveedor. Ya pedida, muestra el número y
 * cómo va.
 */
export function BotonPedirAlProveedor({ quoteId, aceptada }: { quoteId: string; aceptada: boolean }) {
  const qc = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  const clave = ['distribuidor', 'pedido-de-cotizacion', quoteId] as const
  const pedido = useQuery({ queryKey: clave, queryFn: () => pedidoDeCotizacion(quoteId), staleTime: 60_000 })
  const pedir = useMutation({
    mutationFn: () => pedirAlProveedor(quoteId),
    onSuccess: () => {
      setConfirmando(false)
      void qc.invalidateQueries({ queryKey: clave })
    },
  })

  if (pedido.data) {
    return (
      <Button variant="secondary" disabled icon={<Icon name="check" size={16} />} title={`Pedido ${pedido.data.numero} a ${pedido.data.proveedor}`}>
        Pedido {pedido.data.numero} · {estadoDelPedido(pedido.data)}
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="primary"
        icon={<Icon name="arrow-right" size={16} />}
        disabled={!aceptada || pedido.isPending}
        title={aceptada ? undefined : 'Se pide al proveedor cuando el cliente acepta la cotización'}
        onClick={() => setConfirmando(true)}
      >
        Pedir al proveedor
      </Button>
      <ConfirmDialog
        open={confirmando}
        title="¿Pedirle esta cotización al proveedor?"
        description="Le llega como pedido con los productos de su catálogo y las cantidades de esta cotización, a tu precio de distribuidor. Las líneas libres (fletes, servicios) no se piden. Tu cliente y tus precios de venta no se mandan."
        confirmLabel="Pedir"
        busy={pedir.isPending}
        onConfirm={() => pedir.mutate()}
        onCancel={() => setConfirmando(false)}
      >
        {pedir.error ? <p role="alert">{pedir.error.message}</p> : null}
      </ConfirmDialog>
    </>
  )
}
