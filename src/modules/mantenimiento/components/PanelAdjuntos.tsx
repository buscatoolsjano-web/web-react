import { useRef, useState } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { formatearFecha } from '../lib/formato'
import {
  type ClaseAdjunto,
  type EntidadMantenimiento,
  adjuntosDe,
  borrarAdjunto,
  formatearBytes,
  subirAdjunto,
  urlDeDescarga,
} from '../services/adjuntos'
import { SkeletonRows } from '@/components/ui/Skeleton'
import styles from './PanelAdjuntos.module.css'

export interface PanelAdjuntosProps {
  entidad: EntidadMantenimiento
  entidadId: string
  clases: readonly ClaseAdjunto[]
  puedeEditar: boolean
}

/**
 * Los archivos de un equipo o de una orden.
 *
 * El bucket es privado: cada apertura pide una **URL firmada de cinco
 * minutos** en el momento. No se guarda ninguna URL, ni se arma una lista de
 * enlaces que alguien pueda copiar: una URL pública es una URL que se reenvía
 * y queda viva para siempre.
 *
 * Se puede adjuntar también en una orden cerrada. Es deliberado y es la única
 * excepción al congelamiento: un informe o una foto que aparece después no
 * cambia lo que pasó, y prohibirlo obligaría a reabrir la orden —que
 * justamente no se puede— para guardar un papel.
 *
 * Fase 13 · E6: borrar pide confirmación en un ConfirmDialog (antes era
 * directo). La mutación y el archivo que se borra son los mismos.
 */
export function PanelAdjuntos({ entidad, entidadId, clases, puedeEditar }: PanelAdjuntosProps) {
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [clase, setClase] = useState<string>(clases[0]?.valor ?? 'other')
  const [aBorrar, setABorrar] = useState<{ id: string; ruta: string; nombre: string } | null>(null)

  const clave = ['mantenimiento', activa?.companyId, 'adjuntos', entidad, entidadId]

  const adjuntos = useQuery({
    queryKey: clave,
    queryFn: () => adjuntosDe(activa!.companyId, entidad, entidadId),
    enabled: !!activa,
    staleTime: 30_000,
  })

  const subir = useMutation({
    mutationFn: (archivo: File) =>
      subirAdjunto(activa!.companyId, entidad, entidadId, archivo, clase),
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
    clases.find((c) => c.valor === v)?.etiqueta ?? v ?? '—'

  if (adjuntos.isPending) return <SkeletonRows rows={2} columns={3} label="Cargando los archivos…" />

  if (adjuntos.error) {
    return (
      <p className={styles.error} role="alert">
        {adjuntos.error.message}
      </p>
    )
  }

  const filas = adjuntos.data ?? []

  return (
    <div className={styles.panel}>
      {filas.length === 0 ? (
        <p className={styles.nota}>Todavía no hay archivos.</p>
      ) : (
        <ul className={styles.lista}>
          {filas.map((a) => (
            <li key={a.id} className={styles.item}>
              <button type="button" className={styles.nombre} onClick={() => void abrir(a.ruta)}>
                {a.nombre}
              </button>
              <span className={styles.meta}>
                {etiquetaDeClase(a.clase)} · {formatearBytes(a.bytes)} ·{' '}
                {formatearFecha(a.subidoEn)}
              </span>
              {puedeEditar ? (
                <IconButton
                  icon="trash"
                  variant="danger"
                  size="sm"
                  className={styles.borrar}
                  aria-label={`Borrar ${a.nombre}`}
                  disabled={borrar.isPending}
                  onClick={() => setABorrar({ id: a.id, ruta: a.ruta, nombre: a.nombre })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar ? (
        <div className={styles.acciones}>
          <Field label="Tipo de archivo" hideLabel>
            <Select value={clase} onChange={(e) => setClase(e.target.value)}>
              {clases.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.etiqueta}
                </option>
              ))}
            </Select>
          </Field>
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
          <Button variant="secondary" icon={<Icon name="upload" size={16} />} loading={subir.isPending} onClick={() => entrada.current?.click()}>
            {subir.isPending ? 'Subiendo…' : 'Adjuntar archivo'}
          </Button>
          <span className={styles.ayuda}>Foto, PDF o planilla. Hasta 20 MB.</span>
        </div>
      ) : null}

      <p className={styles.nota}>
        Los archivos son privados: cada vez que abrís uno se genera un enlace que vence a los cinco
        minutos.
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={aBorrar !== null}
        tone="danger"
        title={`¿Borrar «${aBorrar?.nombre ?? ''}»?`}
        description="El archivo se borra del almacenamiento y no se puede recuperar."
        confirmLabel={borrar.isPending ? 'Borrando…' : 'Borrar archivo'}
        busy={borrar.isPending}
        onCancel={() => setABorrar(null)}
        onConfirm={() => {
          if (aBorrar) borrar.mutate({ id: aBorrar.id, ruta: aBorrar.ruta }, { onSettled: () => setABorrar(null) })
        }}
      />
    </div>
  )
}
