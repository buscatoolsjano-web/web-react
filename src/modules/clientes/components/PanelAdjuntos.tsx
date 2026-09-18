import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import { useAdjuntosDeCliente } from '../hooks/useClientes'
import {
  CLASES,
  CLASE_POR_DEFECTO,
  TIPOS_ACEPTADOS,
  borrarAdjunto,
  formatearBytes,
  subirAdjunto,
  urlDeDescarga,
} from '../services/adjuntos'
import { formatearFecha } from '../lib/formato'
import type { AdjuntoCliente } from '../types'
import styles from './PanelAdjuntos.module.css'

export interface PanelAdjuntosProps {
  clienteId: string
  /**
   * Lo decide el rol y el cliente; lo IMPIDE la policy. Un cliente dado de
   * baja se lee pero no se le sube ni se le borra nada (§ 27 de la entrega).
   */
  puedeEditar: boolean
}

const ETIQUETA: Record<string, string> = Object.fromEntries(
  CLASES.map((c) => [c.valor, c.etiqueta]),
)

/**
 * Adjuntos del cliente (Fase 17 · E4).
 *
 * Misma tabla `attachments` y mismo bucket privado que Ventas y Compras: el
 * contrato, el acuerdo de confidencialidad o la constancia de inscripción de
 * un cliente no son de un documento en particular, son de él.
 *
 * Cada descarga usa una URL firmada de cinco minutos. Una URL pública es una
 * URL que se reenvía por mail y queda accesible para siempre.
 */
export function PanelAdjuntos({ clienteId, puedeEditar }: PanelAdjuntosProps) {
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const companyId = activa?.companyId ?? null
  const entrada = useRef<HTMLInputElement>(null)
  const [clase, setClase] = useState<string>(CLASE_POR_DEFECTO)
  const [confirmando, setConfirmando] = useState<AdjuntoCliente | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  const adjuntos = useAdjuntosDeCliente(clienteId, true)

  /**
   * Qué quedó viejo después de subir o borrar: **sólo** la lista de adjuntos y
   * la trazabilidad, donde el trigger dejó el evento. La memoria de productos,
   * los precios y el historial no cambiaron porque alguien adjuntó un PDF.
   */
  const alTerminar = () => {
    void queryClient.invalidateQueries({
      queryKey: ['clientes', companyId, 'adjuntos', clienteId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['clientes', companyId, 'trazabilidad', clienteId],
    })
  }

  const subir = useMutation({
    mutationFn: (archivo: File) => subirAdjunto(companyId!, clienteId, archivo, clase),
    onSuccess: alTerminar,
  })

  const borrar = useMutation({
    mutationFn: (a: AdjuntoCliente) => borrarAdjunto(a.id, a.ruta),
    onSuccess: alTerminar,
  })

  const descargar = async (a: AdjuntoCliente) => {
    setFallo(null)
    try {
      const url = await urlDeDescarga(a.ruta)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'No se pudo abrir el archivo.')
    }
  }

  const filas = adjuntos.data ?? []

  return (
    <div className={styles.wrap}>
      {puedeEditar ? (
        <div className={styles.subida}>
          <Field label="Tipo de archivo" id="clase-adjunto">
            <Select value={clase} onChange={(e) => setClase(e.target.value)}>
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
              const archivo = e.target.files?.[0]
              if (!archivo) return
              setFallo(null)
              subir.mutate(archivo, { onSettled: () => (e.target.value = '') })
            }}
          />
          <Button
            variant="secondary"
            icon={<Icon name="plus" size={16} />}
            loading={subir.isPending}
            onClick={() => entrada.current?.click()}
          >
            {subir.isPending ? 'Subiendo…' : 'Adjuntar archivo'}
          </Button>
          <p className={styles.ayuda}>PDF, imágenes, planillas o texto. Hasta 20 MB.</p>
        </div>
      ) : null}

      {subir.error || borrar.error || fallo ? (
        <Alert tone="danger" role="alert" title="No se pudo completar">
          <p>{subir.error?.message ?? borrar.error?.message ?? fallo}</p>
        </Alert>
      ) : null}

      {adjuntos.isPending ? (
        <SkeletonRows rows={3} columns={4} label="Cargando adjuntos…" />
      ) : filas.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          icon="paperclip"
          title="Sin adjuntos"
          description={
            puedeEditar
              ? 'Acá van los archivos del cliente: contrato, constancia de inscripción, acuerdo de confidencialidad. Los de una cotización o un remito van en ese documento.'
              : 'Este cliente no tiene archivos adjuntos.'
          }
        />
      ) : (
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <caption className="sr-only">Archivos adjuntos del cliente</caption>
            <thead>
              <tr>
                <th scope="col">Archivo</th>
                <th scope="col">Tipo</th>
                <th scope="col">Tamaño</th>
                <th scope="col">Subido por</th>
                <th scope="col">Fecha</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id}>
                  <td className={tabla.texto}>{a.nombre}</td>
                  <td className={tabla.nowrap}>{ETIQUETA[a.clase ?? ''] ?? 'General'}</td>
                  <td className={tabla.num}>{formatearBytes(a.bytes)}</td>
                  <td className={tabla.texto}>{a.subidoPor ?? '—'}</td>
                  <td className={tabla.nowrap}>{formatearFecha(a.subidoEn)}</td>
                  <td className={tabla.nowrap}>
                    <div className={styles.acciones}>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Icon name="download" size={16} />}
                        onClick={() => void descargar(a)}
                      >
                        Descargar
                      </Button>
                      {puedeEditar ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={styles.peligro}
                          icon={<Icon name="trash" size={16} />}
                          onClick={() => setConfirmando(a)}
                        >
                          Borrar
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmando !== null}
        tone="danger"
        title={`¿Borrar ${confirmando?.nombre ?? ''}?`}
        description="Se borra el archivo del almacenamiento. No se puede deshacer."
        confirmLabel="Borrar adjunto"
        cancelLabel="Volver"
        busy={borrar.isPending}
        onConfirm={() => {
          if (!confirmando) return
          borrar.mutate(confirmando, {
            onSuccess: () => setConfirmando(null),
            onError: () => setConfirmando(null),
          })
        }}
        onCancel={() => setConfirmando(null)}
      />
    </div>
  )
}
