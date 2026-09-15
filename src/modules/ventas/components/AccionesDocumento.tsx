import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { DOC_TYPE_DE, MENSAJES_WORKFLOW, mensajeErrorVentas, motivoBloqueo } from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { borrarDocumento, cancelarDocumento, duplicarDocumento } from '../services/acciones'
import { ETIQUETA_DE, RUTA_DE, type DocumentoDetalle } from '../types'
import { ModalImpresion } from './ModalImpresion'

export interface AccionesDocumento {
  /** Ver/Imprimir y Duplicar. */
  secundarias: ReactNode
  /** Cancelar documento y Eliminar. */
  peligro: ReactNode
  /** Motivo de Duplicar bloqueado por STEL. */
  motivo: ReactNode
  /** Error de la última acción. */
  error: ReactNode
  /** Vista de impresión y confirmaciones (montar una vez en la página). */
  capas: ReactNode
}

/**
 * Ver/Imprimir, Duplicar, Cancelar y Eliminar.
 *
 * Son las mismas del menú «Más» del legacy, menos las que no tenían sentido
 * migrar. Lo que decide si una acción se puede hacer NO son estos botones:
 * borrar un documento histórico, uno con documentos derivados o un remito que
 * ya movió stock lo rechaza un trigger de la base.
 *
 * Fase 13: devuelve las piezas en vez de pintar su propia barra, para que la
 * página arme UNA barra de acciones. Las mutaciones y las condiciones son las
 * de antes; los `window.confirm` pasan a `ConfirmDialog` y los botones de
 * escritura se muestran a quien escribe (admin y employee).
 */
export function useAccionesDocumento(doc: DocumentoDetalle | null | undefined): AccionesDocumento {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const [imprimiendo, setImprimiendo] = useState(false)
  const [confirmar, setConfirmar] = useState<'cancelar' | 'eliminar' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const escribe = escribeVentas(activa?.rol)
  // Fase 12 E2.5: duplicar consume la numeración del tipo del documento.
  const autoridad = useAutoridadNumeracion()
  const stelDuplicar = doc ? autoridad.stel(DOC_TYPE_DE[doc.tipo]) : false
  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })

  const duplicar = useMutation({
    mutationFn: () =>
      duplicarDocumento(doc!.tipo as 'cotizacion' | 'pedido', activa!.companyId, doc!.id),
    onSuccess: (nuevoId) => {
      setError(null)
      void refrescar()
      void navegar(`${RUTA_DE[doc!.tipo]}/${nuevoId}`)
    },
    onError: (e: Error) => setError(mensajeErrorVentas(e)),
  })

  const cancelar = useMutation({
    mutationFn: () => cancelarDocumento(doc!.tipo, doc!.id, doc!.estado),
    onSuccess: () => {
      setError(null)
      setConfirmar(null)
      void refrescar()
    },
    onError: (e: Error) => {
      setConfirmar(null)
      setError(mensajeErrorVentas(e))
    },
  })

  const borrar = useMutation({
    mutationFn: () => borrarDocumento(doc!.tipo, doc!.id),
    onSuccess: () => {
      setError(null)
      setConfirmar(null)
      void refrescar()
      void navegar(RUTA_DE[doc!.tipo], { replace: true })
    },
    onError: (e: Error) => {
      setConfirmar(null)
      setError(mensajeErrorVentas(e))
    },
  })

  if (!doc) return { secundarias: null, peligro: null, motivo: null, error: null, capas: null }

  // Fase 14 E3: un remito despachado ya movió stock; la base rechaza cancelarlo
  // (DELIVERY_ALREADY_DISPATCHED), así que la acción no se ofrece.
  const remitoDespachado = doc.tipo === 'entrega' && (doc.estado === 'shipped' || doc.estado === 'delivered')
  const cerrado =
    doc.estado === 'rejected' || doc.estado === 'cancelled' || doc.estado === 'accepted' || remitoDespachado
  const sePuedeDuplicar = escribe && doc.tipo !== 'entrega'
  const idMotivo = `motivo-duplicar-${doc.id}`
  const nombre = ETIQUETA_DE[doc.tipo].singular

  return {
    secundarias: (
      <>
        <Button variant="secondary" icon={<Icon name="printer" size={16} />} onClick={() => setImprimiendo(true)}>
          Ver / Imprimir
        </Button>
        {sePuedeDuplicar ? (
          <Button
            variant="secondary"
            loading={duplicar.isPending}
            disabled={stelDuplicar || autoridad.cargando}
            aria-describedby={stelDuplicar ? idMotivo : undefined}
            onClick={() => duplicar.mutate()}
          >
            {duplicar.isPending ? 'Duplicando…' : 'Duplicar'}
          </Button>
        ) : null}
      </>
    ),
    peligro:
      escribe && (!cerrado || !doc.esHistorico) ? (
        <>
          {!cerrado ? (
            <Button variant="secondary" disabled={cancelar.isPending} onClick={() => setConfirmar('cancelar')}>
              Cancelar {nombre}
            </Button>
          ) : null}
          {!doc.esHistorico && !remitoDespachado ? (
            <Button variant="danger" icon={<Icon name="trash" size={16} />} disabled={borrar.isPending} onClick={() => setConfirmar('eliminar')}>
              Eliminar
            </Button>
          ) : null}
        </>
      ) : null,
    motivo: (
      <>
        {sePuedeDuplicar && stelDuplicar ? <p id={idMotivo}>{motivoBloqueo(DOC_TYPE_DE[doc.tipo])}</p> : null}
        {escribe && remitoDespachado ? <p>{MENSAJES_WORKFLOW.DELIVERY_ALREADY_DISPATCHED}</p> : null}
      </>
    ),
    error,
    capas: (
      <>
        {imprimiendo ? <ModalImpresion doc={doc} onCerrar={() => setImprimiendo(false)} /> : null}
        <ConfirmDialog
          open={confirmar === 'cancelar'}
          tone="danger"
          title={`¿Cancelar ${nombre} ${doc.numero}?`}
          description="El documento queda registrado como cancelado; no se borra."
          confirmLabel={`Cancelar ${nombre}`}
          cancelLabel="Volver"
          busy={cancelar.isPending}
          onCancel={() => setConfirmar(null)}
          onConfirm={() => cancelar.mutate()}
        />
        <ConfirmDialog
          open={confirmar === 'eliminar'}
          tone="danger"
          title={`¿Eliminar ${nombre} ${doc.numero}?`}
          description="Se borra el documento y sus líneas. No se puede deshacer."
          confirmLabel="Eliminar"
          cancelLabel="Volver"
          busy={borrar.isPending}
          onCancel={() => setConfirmar(null)}
          onConfirm={() => borrar.mutate()}
        />
      </>
    ),
  }
}
