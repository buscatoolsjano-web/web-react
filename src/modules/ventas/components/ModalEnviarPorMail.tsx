import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Composer } from '@/modules/emails/components/Composer'
import { useCuentas } from '@/modules/emails/hooks/useEmails'
import { useParamsUrl } from '@/modules/emails/hooks/useParamsUrl'
import type { OpcionesComposer } from '@/modules/emails/hooks/useComposer'
import { asuntoDeDocumento, cuerpoDeDocumento, destinatariosDeDocumento } from '../lib/mailDocumento'
import type { DocumentoDetalle } from '../types'

export interface ModalEnviarPorMailProps {
  doc: DocumentoDetalle
  onCerrar: () => void
}

const TITULO: Record<DocumentoDetalle['tipo'], string> = {
  cotizacion: 'Enviar la cotización por mail',
  pedido: 'Enviar el pedido por mail',
  entrega: 'Enviar el remito por mail',
}

/**
 * Mandarle el documento al cliente sin salir del documento (Fase 84).
 *
 * Adentro va el MISMO composer que la sección de Emails, no una copia: el
 * mail sale de la cuenta de la empresa, se guarda solo como borrador en
 * Gmail, el envío es idempotente y el hilo después aparece en la bandeja del
 * ERP como cualquier otro. Un formulario propio acá habría sido un segundo
 * camino de envío que hay que mantener y que se iba a comportar distinto.
 *
 * Lo único que agrega esta pantalla es la SEMILLA: a quién va, el asunto con
 * el número del documento y un cuerpo corto. Todo editable: lo que se abre es
 * un borrador, y quien vende lo lee antes de apretar «Enviar».
 *
 * Por qué los parámetros van a la URL de la cotización: el composer escribe
 * ahí el id del borrador y el del envío, y de eso depende que un refresh en
 * el medio no mande el mail dos veces. Son los mismos nombres que usa la
 * sección de Emails.
 */
export function ModalEnviarPorMail({ doc, onCerrar }: ModalEnviarPorMailProps) {
  const [params, cambiarUrl] = useParamsUrl()
  const cuentas = useCuentas()
  const cuenta = cuentas.data?.[0] ?? null
  const [enviado, setEnviado] = useState(false)

  // Se congelan al montar: que el composer escriba en la URL no lo reinicia.
  const [inicial] = useState(() => ({ borrador: params.get('borrador'), envio: params.get('envio') }))

  const opciones = useMemo<OpcionesComposer | null>(() => {
    if (!cuenta) return null
    const destinos = destinatariosDeDocumento(doc)
    return {
      accountId: cuenta.id,
      propia: cuenta.direccion,
      modo: 'nuevo',
      threadId: null,
      refMensaje: null,
      draftId: inicial.borrador,
      clientRequestId: inicial.envio,
      alCambiarUrl: cambiarUrl,
      semilla: {
        para: destinos.para,
        cc: destinos.cc,
        asunto: asuntoDeDocumento(doc),
        texto: cuerpoDeDocumento(doc),
      },
    }
  }, [cuenta, doc, inicial, cambiarUrl])

  const cerrar = () => {
    // La URL vuelve como estaba: el borrador ya está guardado en Gmail y se
    // retoma desde Emails → Borradores, pero dejar los parámetros colgados en
    // la cotización haría que el próximo «Enviar por mail» abriera el borrador
    // viejo sin que nadie lo pidiera.
    cambiarUrl({ borrador: null, envio: null })
    onCerrar()
  }

  return (
    <Dialog
      open
      onClose={cerrar}
      title={TITULO[doc.tipo]}
      description={cuenta ? `Desde ${cuenta.direccion}` : undefined}
      size="lg"
      closeOnOverlay={false}
    >
      {cuentas.isPending ? (
        <SkeletonRows rows={4} columns={1} label="Cargando la cuenta de correo…" />
      ) : !cuenta || !opciones ? (
        <EmptyState
          icon="mail"
          title="Sin cuenta de correo"
          description="Esta empresa no tiene ninguna cuenta conectada, así que no hay desde dónde mandarlo."
        />
      ) : enviado ? (
        <Alert tone="success" role="status" title="El mail salió">
          <p>
            Va a aparecer en <Link to="/emails">la bandeja</Link> en cuanto Gmail lo sincronice.
          </p>
          <Button onClick={cerrar}>Cerrar</Button>
        </Alert>
      ) : (
        <Composer
          opciones={opciones}
          titulo={TITULO[doc.tipo]}
          mostrarTitulo={false}
          onCerrar={cerrar}
          onEnviado={() => setEnviado(true)}
        />
      )}
    </Dialog>
  )
}
