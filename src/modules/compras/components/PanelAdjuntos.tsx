import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { formatearFecha } from '../lib/formato'
import {
  CLASES,
  borrarAdjunto,
  formatearBytes,
  listarAdjuntos,
  subirAdjunto,
  urlDeDescarga,
} from '../services/adjuntos'
import styles from './PanelAdjuntos.module.css'

export interface PanelAdjuntosProps {
  proveedorId: string
  puedeEditar: boolean
}

/**
 * Adjuntos del proveedor.
 *
 * Misma tabla `attachments` y mismo bucket privado que Ventas. Cada descarga
 * usa una URL firmada de cinco minutos: una URL pública es una URL que se
 * reenvía y queda accesible para siempre, y acá hay listas de precios.
 */
export function PanelAdjuntos({ proveedorId, puedeEditar }: PanelAdjuntosProps) {
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [clase, setClase] = useState<string>('other')

  const clave = ['compras', activa?.companyId, 'adjuntos-proveedor', proveedorId]

  const adjuntos = useQuery({
    queryKey: clave,
    queryFn: () => listarAdjuntos(activa!.companyId, proveedorId),
    enabled: !!activa,
    staleTime: 30_000,
  })

  const subir = useMutation({
    mutationFn: (archivo: File) => subirAdjunto(activa!.companyId, proveedorId, archivo, clase),
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

  const etiquetaDeClase = (v: string | null) =>
    CLASES.find((c) => c.valor === v)?.etiqueta ?? v ?? '—'

  if (adjuntos.isPending) return <p className={styles.nota}>Cargando adjuntos…</p>

  if (adjuntos.error) {
    return (
      <p className={styles.error} role="alert">
        {adjuntos.error.message}
      </p>
    )
  }

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
                {etiquetaDeClase(a.clase)} · {formatearBytes(a.bytes)} ·{' '}
                {formatearFecha(a.subidoEn)}
              </span>
              {puedeEditar ? (
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

      {puedeEditar ? (
        <div className={styles.acciones}>
          <select
            className={styles.select}
            value={clase}
            aria-label="Tipo de archivo"
            onChange={(e) => setClase(e.target.value)}
          >
            {CLASES.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </select>
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
