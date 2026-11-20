import { useRef, useState } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { ConfirmBorrado } from '@/components/modals/ConfirmBorrado'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { formatearFecha } from '../lib/formato'
import {
  type ClaseAdjunto,
  type EntidadMantenimiento,
  adjuntosDe,
  borrarAdjunto,
  esVideo,
  formatearBytes,
  subirAdjunto,
  urlDeDescarga,
} from '../services/adjuntos'
import {
  type VideoMantenimiento,
  conectarYoutube,
  estadoYoutube,
  quitarVideo,
  subirVideo,
  urlDeYoutube,
  videosDe,
} from '../services/videos'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
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

  const claveVideos = ['mantenimiento', activa?.companyId, 'videos', entidad, entidadId]
  const videos = useQuery({
    queryKey: claveVideos,
    queryFn: () => videosDe(activa!.companyId, entidad, entidadId),
    enabled: !!activa,
    staleTime: 30_000,
  })
  const youtube = useQuery({
    queryKey: ['mantenimiento', activa?.companyId, 'youtube'],
    queryFn: () => estadoYoutube(activa!.companyId),
    enabled: !!activa,
    staleTime: 5 * 60_000,
  })
  const [progreso, setProgreso] = useState<number | null>(null)
  const [aQuitar, setAQuitar] = useState<VideoMantenimiento | null>(null)

  const subir = useMutation({
    mutationFn: (archivo: File) =>
      esVideo(archivo)
        ? subirVideo(activa!.companyId, entidad, entidadId, archivo, setProgreso)
        : subirAdjunto(activa!.companyId, entidad, entidadId, archivo, clase),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: clave })
      void queryClient.invalidateQueries({ queryKey: claveVideos })
    },
    onError: (e: Error) => setError(e.message),
    onSettled: () => setProgreso(null),
  })

  const quitar = useMutation({
    mutationFn: (id: string) => quitarVideo(activa!.companyId, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: claveVideos }),
    onError: (e: Error) => setError(e.message),
    onSettled: () => setAQuitar(null),
  })

  const conectar = useMutation({
    mutationFn: () => conectarYoutube(activa!.companyId),
    onError: (e: Error) => setError(e.message),
  })

  const borrar = useMutation({
    mutationFn: ({ id, ruta, motivo }: { id: string; ruta: string; motivo: string }) =>
      borrarAdjunto(id, ruta, motivo),
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
  const listaVideos = videos.data ?? []
  const esAdmin = activa?.rol === 'admin'

  return (
    <div className={styles.panel}>
      {listaVideos.length > 0 ? (
        <ul className={styles.lista} aria-label="Videos en YouTube">
          {listaVideos.map((v) => (
            <li key={v.id} className={styles.item}>
              <a className={styles.nombre} href={urlDeYoutube(v.youtubeId)} target="_blank" rel="noopener noreferrer">
                <Icon name="video" size={16} aria-hidden="true" /> {v.titulo}
              </a>
              <span className={styles.meta}>
                Video en YouTube (privado) · {formatearBytes(v.bytes)} · {formatearFecha(v.subidoEn)}
              </span>
              {puedeEditar ? (
                <IconButton
                  icon="trash"
                  variant="danger"
                  size="sm"
                  className={styles.borrar}
                  aria-label={`Quitar el video ${v.titulo}`}
                  disabled={quitar.isPending}
                  onClick={() => setAQuitar(v)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {youtube.data ? (
        <p className={styles.nota}>
          {youtube.data.conectado ? (
            <>
              Los videos van a YouTube como <strong>privados</strong>, al canal «{youtube.data.canal ?? '—'}», con el
              nombre de {entidad === 'maintenance_order' ? 'la orden' : 'el equipo'}. Para verlos hay que entrar a
              YouTube con esa cuenta.
            </>
          ) : (
            <>
              Los videos van a YouTube, y <strong>YouTube todavía no está conectado</strong>: hasta conectarlo no se
              pueden subir videos.{' '}
              {esAdmin ? (
                <Button size="sm" variant="secondary" loading={conectar.isPending} onClick={() => conectar.mutate()}>
                  Conectar YouTube
                </Button>
              ) : (
                'Lo tiene que conectar un administrador.'
              )}
            </>
          )}
        </p>
      ) : null}

      {filas.length === 0 && listaVideos.length === 0 ? (
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
            {subir.isPending
              ? progreso !== null
                ? `Subiendo a YouTube… ${Math.round(progreso * 100)} %`
                : 'Subiendo…'
              : 'Adjuntar archivo'}
          </Button>
          <span className={styles.ayuda}>Foto, PDF o planilla hasta 20 MB. Videos hasta 1 GB, a YouTube.</span>
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

      <ConfirmBorrado
        open={aBorrar !== null}
        que={`«${aBorrar?.nombre ?? ''}»`}
        description="El archivo se borra del almacenamiento y no se puede recuperar. El motivo y sus datos quedan en Configuración → Borrados."
        confirmLabel={borrar.isPending ? 'Borrando…' : 'Borrar archivo'}
        busy={borrar.isPending}
        onCancel={() => setABorrar(null)}
        onConfirm={(motivo) => {
          if (aBorrar) borrar.mutate({ id: aBorrar.id, ruta: aBorrar.ruta, motivo }, { onSettled: () => setABorrar(null) })
        }}
      />

      <ConfirmDialog
        open={aQuitar !== null}
        title="Quitar el video"
        description={`«${aQuitar?.titulo ?? ''}» se borra también de YouTube y no se puede recuperar.`}
        confirmLabel={quitar.isPending ? 'Quitando…' : 'Quitar el video'}
        tone="danger"
        busy={quitar.isPending}
        onCancel={() => setAQuitar(null)}
        onConfirm={() => {
          if (aQuitar) quitar.mutate(aQuitar.id)
        }}
      />
    </div>
  )
}
