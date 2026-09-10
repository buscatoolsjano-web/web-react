import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { formatearFecha } from '../lib/formato'
import {
  borrarAdjunto,
  formatearBytes,
  listarAdjuntos,
  subirAdjunto,
  urlDeDescarga,
} from '../services/adjuntos'
import type { TipoDocumento } from '../types'
import styles from './PanelAdjuntos.module.css'

export interface PanelAdjuntosProps {
  tipo: TipoDocumento
  documentoId: string
}

/**
 * Adjuntos del documento.
 *
 * Archivo en Storage, metadata en la base. El bucket es privado y cada
 * descarga usa una URL firmada de cinco minutos: una URL pública es una URL
 * que se reenvía y queda accesible para siempre, y acá hay órdenes de compra
 * y comprobantes de clientes.
 */
export function PanelAdjuntos({ tipo, documentoId }: PanelAdjuntosProps) {
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false
  const clave = ['ventas', activa?.companyId, 'adjuntos', tipo, documentoId]

  const adjuntos = useQuery({
    queryKey: clave,
    queryFn: () => listarAdjuntos(activa!.companyId, tipo, documentoId),
    enabled: !!activa,
    staleTime: 30_000,
  })

  const subir = useMutation({
    mutationFn: (archivo: File) => subirAdjunto(activa!.companyId, tipo, documentoId, archivo),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: clave })
    },
    onError: (e: Error) => setError(e.message),
  })

  const borrar = useMutation({
    mutationFn: ({ id, ruta }: { id: string; ruta: string }) => borrarAdjunto(id, ruta),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: clave }),
    onError: (e: Error) => setError(e.message),
  })

  const abrir = async (ruta: string) => {
    try {
      const url = await urlDeDescarga(ruta)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo')
    }
  }

  if (adjuntos.isPending) return <p className={styles.nota}>Cargando adjuntos…</p>

  return (
    <div className={styles.panel}>
      {(adjuntos.data ?? []).length === 0 ? (
        <p className={styles.nota}>Sin archivos adjuntos.</p>
      ) : (
        <ul className={styles.lista}>
          {(adjuntos.data ?? []).map((a) => (
            <li key={a.id} className={styles.item}>
              <button type="button" className={styles.nombre} onClick={() => void abrir(a.ruta)}>
                {a.nombre}
              </button>
              <span className={styles.meta}>
                {formatearBytes(a.bytes)} · {formatearFecha(a.subidoEn)}
              </span>
              {esInterno ? (
                <button
                  type="button"
                  className={styles.borrar}
                  aria-label={`Borrar ${a.nombre}`}
                  disabled={borrar.isPending}
                  onClick={() => borrar.mutate({ id: a.id, ruta: a.ruta })}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {esInterno ? (
        <div className={styles.acciones}>
          <input
            ref={entrada}
            type="file"
            className={styles.archivo}
            aria-label="Elegir archivo"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) subir.mutate(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className={styles.boton}
            disabled={subir.isPending}
            onClick={() => entrada.current?.click()}
          >
            {subir.isPending ? 'Subiendo…' : 'Adjuntar archivo'}
          </button>
          <span className={styles.ayuda}>PDF, imagen, planilla o texto. Hasta 20 MB.</span>
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
