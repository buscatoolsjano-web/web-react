import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { formatearFecha } from '../lib/formato'
import {
  CLASES,
  TIPOS_ACEPTADOS,
  borrarAdjunto,
  formatearBytes,
  listarAdjuntos,
  subirAdjunto,
  urlDeDescarga,
  type Adjunto,
} from '../services/adjuntos'
import type { TipoDocumento } from '../types'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Icon } from '@/components/icons/Icon'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { escribeVentas } from '../lib/permisos'
import { SkeletonRows } from '@/components/ui/Skeleton'
import styles from './PanelAdjuntos.module.css'

export interface PanelAdjuntosProps {
  tipo: TipoDocumento
  documentoId: string
}

const ETIQUETA_CLASE: Record<string, string> = Object.fromEntries(
  CLASES.map((c) => [c.valor, c.etiqueta]),
)

/** El tipo MIME, dicho como lo diría una persona. */
function tipoLegible(mime: string | null): string {
  if (!mime) return 'Archivo'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return 'Imagen'
  if (mime.includes('spreadsheet') || mime === 'text/csv') return 'Planilla'
  if (mime.includes('wordprocessing')) return 'Documento'
  if (mime.startsWith('text/')) return 'Texto'
  return 'Archivo'
}

/**
 * Adjuntos del documento.
 *
 * Archivo en Storage, metadata en la base. El bucket es privado y cada
 * descarga usa una URL firmada de cinco minutos: una URL pública es una URL
 * que se reenvía y queda accesible para siempre, y acá hay órdenes de compra
 * y comprobantes de clientes.
 *
 * Fase 15 · E6: se dice qué es cada archivo, quién lo subió y cuándo; borrar
 * pregunta antes; y la URL firmada se pide **al hacer clic**, no para los
 * cincuenta archivos de la lista que nadie va a abrir.
 */
export function PanelAdjuntos({ tipo, documentoId }: PanelAdjuntosProps) {
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [clase, setClase] = useState('other')
  const [aBorrar, setABorrar] = useState<Adjunto | null>(null)

  // Subir y borrar es de admin y employee (`attachments_write`); ver es de los internos.
  const escribe = escribeVentas(activa?.rol)
  const clave = ['ventas', activa?.companyId, 'adjuntos', tipo, documentoId]

  const adjuntos = useQuery({
    queryKey: clave,
    queryFn: () => listarAdjuntos(activa!.companyId, tipo, documentoId),
    enabled: !!activa,
    staleTime: 30_000,
  })

  const subir = useMutation({
    mutationFn: (archivo: File) => subirAdjunto(activa!.companyId, tipo, documentoId, archivo, clase),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: clave })
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, tipo, 'trazabilidad', documentoId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const borrar = useMutation({
    mutationFn: ({ id, ruta }: { id: string; ruta: string }) => borrarAdjunto(id, ruta),
    onSuccess: () => {
      setError(null)
      setABorrar(null)
      void queryClient.invalidateQueries({ queryKey: clave })
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, tipo, 'trazabilidad', documentoId] })
    },
    onError: (e: Error) => {
      setABorrar(null)
      setError(e.message)
      void queryClient.invalidateQueries({ queryKey: clave })
    },
  })

  const abrir = async (ruta: string) => {
    try {
      const url = await urlDeDescarga(ruta)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo')
    }
  }

  if (adjuntos.isPending) return <SkeletonRows rows={2} columns={3} label="Cargando adjuntos…" />

  const lista = adjuntos.data ?? []

  return (
    <div className={styles.panel}>
      {lista.length === 0 ? (
        <p className={styles.nota}>Sin archivos adjuntos.</p>
      ) : (
        <ul className={styles.lista}>
          {lista.map((a) => (
            <li key={a.id} className={styles.item}>
              <button
                type="button"
                className={styles.nombre}
                onClick={() => void abrir(a.ruta)}
                aria-label={`Descargar ${a.nombre}`}
              >
                {a.nombre}
              </button>
              <span className={styles.meta}>
                {[
                  tipoLegible(a.tipoMime),
                  a.clase && a.clase !== 'other' ? ETIQUETA_CLASE[a.clase] : null,
                  formatearBytes(a.bytes),
                  formatearFecha(a.subidoEn),
                  a.subidoPor,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {escribe ? (
                <IconButton
                  icon="trash"
                  variant="danger"
                  size="sm"
                  aria-label={`Eliminar ${a.nombre}`}
                  disabled={borrar.isPending}
                  onClick={() => setABorrar(a)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {escribe ? (
        <div className={styles.acciones}>
          <Field label="Qué es" optional className={styles.clase}>
            <Select value={clase} onChange={(e) => setClase(e.target.value)} disabled={subir.isPending}>
              {CLASES.map((c) => (
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
            accept={TIPOS_ACEPTADOS}
            aria-label="Elegir archivo para adjuntar"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) subir.mutate(f)
              e.target.value = ''
            }}
          />
          <Button
            variant="secondary"
            icon={<Icon name="paperclip" size={16} />}
            loading={subir.isPending}
            onClick={() => entrada.current?.click()}
          >
            {subir.isPending ? 'Subiendo…' : 'Subir archivo'}
          </Button>
          <span className={styles.ayuda}>PDF, imagen, planilla o texto. Hasta 20 MB.</span>
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={aBorrar !== null}
        tone="danger"
        title="¿Eliminar este archivo?"
        description={
          aBorrar
            ? `Se va a eliminar «${aBorrar.nombre}» del documento y del almacenamiento. No se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        busy={borrar.isPending}
        onCancel={() => setABorrar(null)}
        onConfirm={() => aBorrar && borrar.mutate({ id: aBorrar.id, ruta: aBorrar.ruta })}
      />
    </div>
  )
}
