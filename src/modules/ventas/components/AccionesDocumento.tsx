import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { borrarDocumento, cancelarDocumento, duplicarDocumento } from '../services/acciones'
import { RUTA_DE, type DocumentoDetalle } from '../types'
import { ModalImpresion } from './ModalImpresion'
import styles from './AccionesDocumento.module.css'

export interface AccionesDocumentoProps {
  doc: DocumentoDetalle
}

/**
 * Ver/Imprimir, Duplicar, Cancelar y Eliminar.
 *
 * Son las mismas del menú «Más» del legacy, menos las que no tenían sentido
 * migrar. Lo que decide si una acción se puede hacer NO son estos botones:
 * borrar un documento histórico, uno con documentos derivados o un remito que
 * ya movió stock lo rechaza un trigger de la base.
 */
export function AccionesDocumento({ doc }: AccionesDocumentoProps) {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const [imprimiendo, setImprimiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false
  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })

  const duplicar = useMutation({
    mutationFn: () =>
      duplicarDocumento(doc.tipo as 'cotizacion' | 'pedido', activa!.companyId, doc.id),
    onSuccess: (nuevoId) => {
      setError(null)
      void refrescar()
      void navegar(`${RUTA_DE[doc.tipo]}/${nuevoId}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const cancelar = useMutation({
    mutationFn: () => cancelarDocumento(doc.tipo, doc.id, doc.estado),
    onSuccess: () => {
      setError(null)
      void refrescar()
    },
    onError: (e: Error) => setError(e.message),
  })

  const borrar = useMutation({
    mutationFn: () => borrarDocumento(doc.tipo, doc.id),
    onSuccess: () => {
      setError(null)
      void refrescar()
      void navegar(RUTA_DE[doc.tipo], { replace: true })
    },
    onError: (e: Error) => setError(e.message),
  })

  const cerrado =
    doc.estado === 'rejected' || doc.estado === 'cancelled' || doc.estado === 'accepted'
  const sePuedeDuplicar = esInterno && doc.tipo !== 'entrega'

  return (
    <>
      <div className={styles.barra}>
        <button type="button" className={styles.primario} onClick={() => setImprimiendo(true)}>
          Ver / Imprimir
        </button>

        {sePuedeDuplicar ? (
          <button
            type="button"
            className={styles.boton}
            disabled={duplicar.isPending}
            onClick={() => duplicar.mutate()}
          >
            {duplicar.isPending ? 'Duplicando…' : 'Duplicar'}
          </button>
        ) : null}

        {esInterno && !cerrado ? (
          <button
            type="button"
            className={styles.boton}
            disabled={cancelar.isPending}
            onClick={() => {
              if (window.confirm(`¿Cancelar ${doc.numero}? El documento queda registrado.`)) {
                cancelar.mutate()
              }
            }}
          >
            Cancelar documento
          </button>
        ) : null}

        {esInterno && !doc.esHistorico ? (
          <button
            type="button"
            className={styles.peligro}
            disabled={borrar.isPending}
            onClick={() => {
              if (window.confirm(`¿Eliminar ${doc.numero}? No se puede deshacer.`)) {
                borrar.mutate()
              }
            }}
          >
            Eliminar
          </button>
        ) : null}

        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>

      {imprimiendo ? <ModalImpresion doc={doc} onCerrar={() => setImprimiendo(false)} /> : null}
    </>
  )
}
