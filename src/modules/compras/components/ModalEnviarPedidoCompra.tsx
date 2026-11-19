import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Composer } from '@/modules/emails/components/Composer'
import { useCuentas } from '@/modules/emails/hooks/useEmails'
import { nuevaClave, type OpcionesComposer } from '@/modules/emails/hooks/useComposer'
import { perdioElAcceso } from '@/modules/emails/lib/estadoCuenta'
import type { AdjuntoRedaccion } from '@/modules/emails/types'
import { datosDeEmpresa } from '@/modules/ventas/services/empresa'
import type { EmpresaImpresion } from '@/modules/ventas/lib/impresion'
import { VistaImpresion } from '@/modules/ventas/components/VistaImpresion'
import { aHojaDeVentas, opcionesDeHoja } from '../lib/hojaVentas'
import type { DocumentoImprimible } from '../lib/impresion'
import { obtenerProveedor } from '../services/proveedores'

export interface ModalEnviarPedidoCompraProps {
  pedidoId: string
  proveedorId: string
  doc: DocumentoImprimible
  onCerrar: () => void
}

/**
 * Mandarle el pedido al proveedor (Fase 84 para Ventas, ahora en Compras).
 *
 * El mismo composer de Emails y la misma hoja que se imprime, convertida en
 * PDF y adjunta. Va al mail del proveedor; se puede cambiar antes de mandar.
 * Al enviarse queda la constancia en la trazabilidad del pedido.
 */
export function ModalEnviarPedidoCompra({ pedidoId, proveedorId, doc, onCerrar }: ModalEnviarPedidoCompraProps) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const cuentas = useCuentas()
  const cuenta = cuentas.data?.[0] ?? null
  const [enviado, setEnviado] = useState(false)
  const [pdf, setPdf] = useState<{ adjunto: AdjuntoRedaccion | null; aviso: string | null } | null>(null)
  const nodo = useRef<HTMLDivElement>(null)
  const armado = useRef(false)

  const empresaDb = useQuery({
    queryKey: ['ventas', activa?.companyId, 'empresa-impresion'],
    queryFn: () => datosDeEmpresa(activa!.companyId),
    enabled: !!activa,
    staleTime: 10 * 60_000,
  })
  const proveedor = useQuery({
    queryKey: ['compras', activa?.companyId, 'proveedor', proveedorId],
    queryFn: () => obtenerProveedor(activa!.companyId, proveedorId),
    enabled: !!activa,
    staleTime: 60_000,
  })

  const empresa: EmpresaImpresion = empresaDb.data ?? {
    nombre: activa?.companyName ?? 'Empresa',
    razonSocial: null, cuit: null, direccion: null,
    telefono: null, email: null, web: null, color: '#1f2937',
  }

  // El PDF, una sola vez, cuando la hoja ya tiene los datos de la empresa.
  const listo = !!cuenta && !empresaDb.isPending
  useEffect(() => {
    if (!listo || armado.current || !nodo.current) return
    armado.current = true
    const hoja = nodo.current
    void (async () => {
      try {
        const { pdfDeHoja, base64DeBlob } = await import('@/modules/ventas/lib/pdfDeHoja')
        const blob = await pdfDeHoja(hoja)
        const adjunto: AdjuntoRedaccion = {
          clave: nuevaClave(),
          tipo: 'nuevo',
          nombre: `Pedido-${doc.numero}.pdf`,
          mime: 'application/pdf',
          tamano: blob.size,
          datos: await base64DeBlob(blob),
        }
        setPdf({ adjunto, aviso: null })
      } catch (e) {
        setPdf({ adjunto: null, aviso: e instanceof Error ? e.message : 'No se pudo armar el PDF.' })
      }
    })()
  }, [listo, doc.numero])

  const opciones = useMemo<OpcionesComposer | null>(() => {
    if (!cuenta || !pdf || proveedor.isPending) return null
    const email = proveedor.data?.email ?? null
    return {
      accountId: cuenta.id,
      propia: cuenta.direccion,
      modo: 'nuevo',
      threadId: null,
      refMensaje: null,
      draftId: null,
      clientRequestId: null,
      alCambiarUrl: () => {},
      semilla: {
        para: email && email.includes('@') ? [email] : [],
        cc: [],
        asunto: `Pedido de compra ${doc.numero}`,
        texto: `Hola,\n\nTe adjunto el pedido de compra ${doc.numero}. ¿Nos confirmás disponibilidad y fecha de entrega?\n\nGracias.`,
        adjuntos: pdf.adjunto ? [pdf.adjunto] : [],
      },
    }
  }, [cuenta, pdf, proveedor.isPending, proveedor.data, doc.numero])

  return (
    <Dialog
      open
      onClose={onCerrar}
      title="Enviar el pedido al proveedor"
      description={cuenta ? `Desde ${cuenta.direccion}` : undefined}
      size="lg"
      closeOnOverlay={false}
    >
      {/* La hoja de la que sale el PDF, fuera de la pantalla y a tamaño real. */}
      {cuenta && pdf === null ? (
        <div ref={nodo} aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 0 }}>
          <VistaImpresion doc={aHojaDeVentas(doc)} empresa={empresa} opciones={opcionesDeHoja(doc, 'A4')} />
        </div>
      ) : null}

      {cuentas.isPending ? (
        <SkeletonRows rows={4} columns={1} label="Cargando la cuenta de correo…" />
      ) : !cuenta ? (
        <EmptyState
          icon="mail"
          title="Sin cuenta de correo"
          description="Esta empresa no tiene ninguna cuenta conectada, así que no hay desde dónde mandarlo."
          action={<Link to="/emails">Conectar una cuenta en Emails</Link>}
        />
      ) : perdioElAcceso(cuenta.errorSync) ? (
        <Alert tone="danger" role="alert" title={`${cuenta.direccion} perdió el acceso a Gmail`}>
          <p>
            Hasta que un administrador la reconecte, no sale ningún mail desde esta empresa.{' '}
            <Link to="/emails">Reconectarla en Emails</Link>
          </p>
        </Alert>
      ) : pdf === null ? (
        <p role="status">
          <Spinner size={16} /> Armando el PDF del pedido…
        </p>
      ) : enviado ? (
        <Alert tone="success" role="status" title="El mail salió">
          <p>
            Va a aparecer en <Link to="/emails">la bandeja</Link> en cuanto Gmail lo sincronice.
          </p>
          <Button onClick={onCerrar}>Cerrar</Button>
        </Alert>
      ) : (
        <>
          {pdf.aviso ? (
            <Alert tone="warning" role="status" title="El PDF no se pudo armar">
              <p>{pdf.aviso} Adjuntalo a mano desde «Imprimir» → «Guardar como PDF».</p>
            </Alert>
          ) : null}
          {!proveedor.data?.email ? (
            <Alert tone="info" role="status">
              <p>El proveedor no tiene un email cargado: escribilo en «Para».</p>
            </Alert>
          ) : null}
          {opciones ? (
            <Composer
              opciones={opciones}
              titulo="Enviar el pedido al proveedor"
              mostrarTitulo={false}
              onCerrar={onCerrar}
              onEnviado={(_hilo, envio) => {
                setEnviado(true)
                void import('@/services/envioDocumento')
                  .then((m) => m.registrarEnvioDocumento('pedido_compra', pedidoId, envio))
                  .then(() => qc.invalidateQueries({ queryKey: ['compras', activa?.companyId, 'envios-pedido', pedidoId] }))
              }}
            />
          ) : null}
        </>
      )}
    </Dialog>
  )
}
