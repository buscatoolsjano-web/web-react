import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { HojaImpresa } from '@/modules/ventas/components/HojaImpresa'
import { EtiquetaQr, type DatosEtiqueta } from './EtiquetaQr'
import styles from './EtiquetasQr.module.css'

export interface ModalEtiquetasQrProps {
  /** Para el título: «CP7406» o «24 equipos filtrados». */
  descripcion: string
  /** Identifica la carga en la caché: los filtros, o el id del equipo. */
  clave: readonly unknown[]
  cargar: () => Promise<DatosEtiqueta[]>
  onCerrar: () => void
}

const COPIAS = [1, 2, 3, 4, 6] as const

/**
 * Las etiquetas QR, vistas e impresas (2026-11).
 *
 * En papel van en una hoja A4 común, tres por fila de 62 × 30 mm, para
 * recortar —o en hojas de etiquetas autoadhesivas del mismo tamaño—. Se
 * imprime con la misma maquinaria que los documentos (`HojaImpresa`): sale
 * sólo la hoja, sin la app de fondo.
 */
export function ModalEtiquetasQr({ descripcion, clave, cargar, onCerrar }: ModalEtiquetasQrProps) {
  const { activa } = useEmpresa()
  const empresa = activa?.companyName ?? ''
  const origen = window.location.origin
  const [copias, setCopias] = useState<number>(1)
  const idCopias = useId()

  const q = useQuery({ queryKey: ['mantenimiento', 'etiquetas-qr', ...clave], queryFn: cargar })
  const equipos = q.data ?? []
  const etiquetas = equipos.flatMap((e) => Array.from({ length: copias }, (_, i) => ({ equipo: e, clave: `${e.id}-${i}` })))

  const hoja = (
    <div className={styles.hoja}>
      {etiquetas.map((x) => (
        <EtiquetaQr key={x.clave} equipo={x.equipo} empresa={empresa} origen={origen} />
      ))}
    </div>
  )

  return (
    <>
      <Dialog
        open
        onClose={onCerrar}
        title={`Etiquetas QR · ${descripcion}`}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={onCerrar}>
              Cerrar
            </Button>
            <Button
              icon={<Icon name="printer" size={16} />}
              disabled={etiquetas.length === 0}
              onClick={() => window.print()}
            >
              Imprimir {etiquetas.length > 0 ? `${etiquetas.length} ${etiquetas.length === 1 ? 'etiqueta' : 'etiquetas'}` : ''}
            </Button>
          </>
        }
      >
        <div className={styles.opciones}>
          <label htmlFor={idCopias}>Copias por equipo</label>
          <select id={idCopias} value={copias} onChange={(e) => setCopias(Number(e.target.value))} className={styles.select}>
            {COPIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className={styles.nota}>
            Escaneada con el celular abre la ficha del equipo. Hace falta estar logueado en el ERP.
          </span>
        </div>

        {q.error ? (
          <Alert tone="danger" role="alert" title="No se pudieron traer los equipos">
            <p>{q.error instanceof Error ? q.error.message : 'Probá de nuevo.'}</p>
          </Alert>
        ) : q.isPending ? (
          <SkeletonRows rows={3} columns={3} label="Armando las etiquetas…" />
        ) : etiquetas.length === 0 ? (
          <p className={styles.nota}>No hay equipos para etiquetar.</p>
        ) : (
          <div className={styles.previa}>{hoja}</div>
        )}
      </Dialog>

      {etiquetas.length > 0 ? (
        <HojaImpresa prioridad="modal" papel="A4">
          {() => hoja}
        </HojaImpresa>
      ) : null}
    </>
  )
}
