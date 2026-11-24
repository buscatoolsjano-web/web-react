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
import { obtenerCliente } from '@/modules/clientes/services/clientes'
import { datosDeEmpresa } from '@/modules/ventas/services/empresa'
import type { EmpresaImpresion } from '@/modules/ventas/lib/impresion'
import { VistaImpresion } from '@/modules/ventas/components/VistaImpresion'
import type { DocumentoImprimible as HojaVentas } from '@/modules/ventas/lib/impresion'

export interface ModalEnviarPresupuestoProps {
  /** La hoja que se vuelve PDF: la de una orden o la de un lote. */
  hoja: HojaVentas
  numero: string
  clienteId: string
  asunto: string
  texto: string
  /** Dónde queda la constancia del envío. */
  tipo: 'orden_mantenimiento' | 'lote_mantenimiento'
  documentoId: string
  /** Lo que se refresca después de enviar (el historial de la orden o del lote). */
  claveHistorial: readonly unknown[]
  onCerrar: () => void
}

/**
 * Mandarle el presupuesto del servicio al cliente, con el PDF adjunto.
 *
 * Lo que el sitio viejo del taller hacía con «Enviar por mail». Es el mismo
 * composer de Emails y la misma hoja que una cotización comercial; va a los
 * mails del cliente y se pueden cambiar antes de mandar. Al salir queda el
 * evento en el historial de la orden o del lote.
 */
export function ModalEnviarPresupuesto({
  hoja,
  numero,
  clienteId,
  asunto,
  texto,
  tipo,
  documentoId,
  claveHistorial,
  onCerrar,
}: ModalEnviarPresupuestoProps) {
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
  const cliente = useQuery({
    queryKey: ['clientes', activa?.companyId, 'detalle', clienteId],
    queryFn: () => obtenerCliente(activa!.companyId, clienteId),
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
    const elemento = nodo.current
    void (async () => {
      try {
        const { pdfDeHoja, base64DeBlob } = await import('@/modules/ventas/lib/pdfDeHoja')
        const blob = await pdfDeHoja(elemento)
        const adjunto: AdjuntoRedaccion = {
          clave: nuevaClave(),
          tipo: 'nuevo',
          nombre: `Presupuesto-${numero}.pdf`,
          mime: 'application/pdf',
          tamano: blob.size,
          datos: await base64DeBlob(blob),
        }
        setPdf({ adjunto, aviso: null })
      } catch (e) {
        setPdf({ adjunto: null, aviso: e instanceof Error ? e.message : 'No se pudo armar el PDF.' })
      }
    })()
  }, [listo, numero])

  const emails = useMemo(() => (cliente.data?.emails ?? []).filter((e) => e.includes('@')), [cliente.data])

  const opciones = useMemo<OpcionesComposer | null>(() => {
    if (!cuenta || !pdf || cliente.isPending) return null
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
        para: emails.slice(0, 1),
        cc: emails.slice(1),
        asunto,
        texto,
        adjuntos: pdf.adjunto ? [pdf.adjunto] : [],
      },
    }
  }, [cuenta, pdf, cliente.isPending, emails, asunto, texto])

  return (
    <Dialog
      open
      onClose={onCerrar}
      title="Enviar el presupuesto al cliente"
      description={cuenta ? `Desde ${cuenta.direccion}` : undefined}
      size="lg"
      closeOnOverlay={false}
    >
      {/* La hoja de la que sale el PDF, fuera de la pantalla y a tamaño real. */}
      {cuenta && pdf === null ? (
        <div ref={nodo} aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 0 }}>
          <VistaImpresion
            doc={hoja}
            empresa={empresa}
            opciones={{ formato: 'valorado', preciosConImpuestos: false, papel: 'A4', conFotos: false }}
          />
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
          <Spinner size={16} /> Armando el PDF del presupuesto…
        </p>
      ) : enviado ? (
        <Alert tone="success" role="status" title="El mail salió">
          <p>
            Quedó registrado en el historial. Va a aparecer en <Link to="/emails">la bandeja</Link> en
            cuanto Gmail lo sincronice.
          </p>
          <Button onClick={onCerrar}>Cerrar</Button>
        </Alert>
      ) : (
        <>
          {pdf.aviso ? (
            <Alert tone="warning" role="status" title="El PDF no se pudo armar">
              <p>{pdf.aviso}</p>
            </Alert>
          ) : null}
          {!cliente.isPending && emails.length === 0 ? (
            <Alert tone="info" role="status">
              <p>El cliente no tiene un email cargado: escribilo en «Para».</p>
            </Alert>
          ) : null}
          {opciones ? (
            <Composer
              opciones={opciones}
              titulo="Enviar el presupuesto al cliente"
              mostrarTitulo={false}
              onCerrar={onCerrar}
              onEnviado={(_hilo, envio) => {
                setEnviado(true)
                void import('@/services/envioDocumento')
                  .then((m) => m.registrarEnvioDocumento(tipo, documentoId, envio))
                  .then(() => qc.invalidateQueries({ queryKey: [...claveHistorial] }))
              }}
            />
          ) : null}
        </>
      )}
    </Dialog>
  )
}
