import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Composer } from '@/modules/emails/components/Composer'
import { useCuentas } from '@/modules/emails/hooks/useEmails'
import { useParamsUrl } from '@/modules/emails/hooks/useParamsUrl'
import { nuevaClave, type OpcionesComposer } from '@/modules/emails/hooks/useComposer'
import type { AdjuntoRedaccion } from '@/modules/emails/types'
import { asuntoDeDocumento, cuerpoDeDocumento, destinatariosDeDocumento } from '../lib/mailDocumento'
import { base64DeBlob, nombreDePdf, pdfDeHoja } from '../lib/pdfDeHoja'
import type { OpcionesImpresion } from '../lib/impresion'
import { HojaParaPdf } from './HojaParaPdf'
import type { DocumentoDetalle, LineaDocumento } from '../types'

export interface ModalEnviarPorMailProps {
  doc: DocumentoDetalle
  /** Las mismas que dibuja la hoja de la pantalla: el PDF tiene que ser ESA hoja. */
  lineas: readonly LineaDocumento[]
  /** Y con las mismas opciones: si en pantalla está sin precios, el PDF también. */
  opciones: OpcionesImpresion
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
 * Lo que agrega esta pantalla son dos cosas. La SEMILLA —a quién va, el
 * asunto con el número y un cuerpo corto—, todo editable porque lo que se
 * abre es un borrador. Y el PDF de la hoja, que se arma ANTES de mostrar el
 * composer: el adjunto tiene que estar puesto cuando el formulario aparece,
 * porque después el composer es dueño de su estado y meterle un archivo por
 * atrás sería pelearle.
 *
 * Si el PDF falla, el mail se escribe igual y se avisa. Quedarse sin mandar
 * una cotización porque no se pudo dibujar un adjunto sería lo peor de los
 * dos mundos.
 */
export function ModalEnviarPorMail({ doc, lineas, opciones, onCerrar }: ModalEnviarPorMailProps) {
  const [params, cambiarUrl] = useParamsUrl()
  const cuentas = useCuentas()
  const cuenta = cuentas.data?.[0] ?? null
  const [enviado, setEnviado] = useState(false)

  /** El PDF: mientras se arma el composer no se monta. */
  const [pdf, setPdf] = useState<{ adjunto: AdjuntoRedaccion | null; aviso: string | null } | null>(null)

  // Se congelan al montar: que el composer escriba en la URL no lo reinicia.
  const [inicial] = useState(() => ({ borrador: params.get('borrador'), envio: params.get('envio') }))

  const armar = useCallback(
    (nodo: HTMLElement) => {
      void (async () => {
        try {
          const blob = await pdfDeHoja(nodo)
          setPdf({
            adjunto: {
              clave: nuevaClave(),
              tipo: 'nuevo',
              nombre: nombreDePdf(doc.tipo, doc.numero),
              mime: 'application/pdf',
              tamano: blob.size,
              datos: await base64DeBlob(blob),
            },
            aviso: null,
          })
        } catch (e) {
          setPdf({
            adjunto: null,
            aviso: e instanceof Error ? e.message : 'No se pudo armar el PDF.',
          })
        }
      })()
    },
    [doc.tipo, doc.numero],
  )

  const sinPdf = useCallback((mensaje: string) => setPdf({ adjunto: null, aviso: mensaje }), [])

  const opcionesComposer = useMemo<OpcionesComposer | null>(() => {
    if (!cuenta || !pdf) return null
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
        adjuntos: pdf.adjunto ? [pdf.adjunto] : [],
      },
    }
  }, [cuenta, doc, inicial, cambiarUrl, pdf])

  const cerrar = () => {
    // La URL vuelve como estaba: el borrador ya está guardado en Gmail y se
    // retoma desde Emails → Borradores, pero dejar los parámetros colgados en
    // la cotización haría que el próximo «Enviar por mail» abriera el borrador
    // viejo sin que nadie lo pidiera.
    cambiarUrl({ borrador: null, envio: null })
    onCerrar()
  }

  const nombreCorto = doc.tipo === 'cotizacion' ? 'la cotización' : doc.tipo === 'pedido' ? 'el pedido' : 'el remito'

  return (
    <Dialog
      open
      onClose={cerrar}
      title={TITULO[doc.tipo]}
      description={cuenta ? `Desde ${cuenta.direccion}` : undefined}
      size="lg"
      closeOnOverlay={false}
    >
      {/* La hoja de la que sale la foto. Vive fuera de la pantalla y se
          desmonta en cuanto el PDF está. */}
      {cuenta && pdf === null ? (
        <HojaParaPdf doc={doc} lineas={lineas} opciones={opciones} onLista={armar} onFallo={sinPdf} />
      ) : null}

      {cuentas.isPending ? (
        <SkeletonRows rows={4} columns={1} label="Cargando la cuenta de correo…" />
      ) : !cuenta ? (
        <EmptyState
          icon="mail"
          title="Sin cuenta de correo"
          description="Esta empresa no tiene ninguna cuenta conectada, así que no hay desde dónde mandarlo."
        />
      ) : pdf === null ? (
        <p role="status">
          <Spinner size={16} /> Armando el PDF de {nombreCorto}…
        </p>
      ) : enviado ? (
        <Alert tone="success" role="status" title="El mail salió">
          <p>
            Va a aparecer en <Link to="/emails">la bandeja</Link> en cuanto Gmail lo sincronice.
          </p>
          <Button onClick={cerrar}>Cerrar</Button>
        </Alert>
      ) : (
        <>
          {pdf.aviso ? (
            <Alert tone="warning" role="status" title="El PDF no se pudo armar">
              <p>
                {pdf.aviso} El mail se puede mandar igual: adjuntá {nombreCorto} a mano desde «Ver /
                Imprimir» → «Guardar como PDF».
              </p>
            </Alert>
          ) : null}
          {opcionesComposer ? (
            <Composer
              opciones={opcionesComposer}
              titulo={TITULO[doc.tipo]}
              mostrarTitulo={false}
              onCerrar={cerrar}
              onEnviado={() => setEnviado(true)}
            />
          ) : null}
        </>
      )}
    </Dialog>
  )
}
