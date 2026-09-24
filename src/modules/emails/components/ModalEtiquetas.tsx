import { useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Dialog } from '@/components/modals/Dialog'
import { Icon } from '@/components/icons/Icon'
import { useBorrarEtiqueta, useEtiquetas, useGuardarEtiqueta } from '../hooks/useEmails'
import { COLORES_ETIQUETA, type ColorEtiqueta, type EtiquetaEmail } from '../types'
import styles from './Emails.module.css'

export interface ModalEtiquetasProps {
  onCerrar: () => void
}

const NOMBRE_COLOR: Record<ColorEtiqueta, string> = {
  neutral: 'Gris',
  info: 'Azul',
  brand: 'Naranja',
  success: 'Verde',
  warning: 'Ámbar',
  danger: 'Rojo',
}

/**
 * Crear, renombrar y borrar etiquetas (Fase 28 · E8).
 *
 * Son etiquetas DEL ERP. Las de Gmail —INBOX, SENT, las que se hayan creado
 * allá— llegan en `gmail_labels` y son de sólo lectura: el navegador nunca
 * habla con Gmail. Por eso no aparecen acá: mostrarlas en una lista donde todo
 * lo demás se puede renombrar y borrar sería prometer algo que no se cumple.
 *
 * Borrar una etiqueta la saca de todos los hilos que la tenían. Ningún correo
 * se toca, y se pregunta antes.
 */
export function ModalEtiquetas({ onCerrar }: ModalEtiquetasProps) {
  const etiquetas = useEtiquetas()
  const guardar = useGuardarEtiqueta()
  const borrar = useBorrarEtiqueta()

  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState<ColorEtiqueta>('neutral')
  const [editando, setEditando] = useState<EtiquetaEmail | null>(null)
  const [aBorrar, setABorrar] = useState<EtiquetaEmail | null>(null)

  const limpiar = () => {
    setEditando(null)
    setNombre('')
    setColor('neutral')
  }

  const enviar = () => {
    if (nombre.trim() === '') return
    guardar.mutate({ id: editando?.id ?? null, nombre: nombre.trim(), color }, { onSuccess: limpiar })
  }

  const error = guardar.error ?? borrar.error

  return (
    <Dialog
      open
      onClose={onCerrar}
      title="Etiquetas"
      description="Son del ERP. Las de Gmail llegan solas y no se editan desde acá."
      size="md"
      footer={
        <Button variant="secondary" onClick={onCerrar}>
          Listo
        </Button>
      }
    >
      {error ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar">
          <p>{error.message}</p>
        </Alert>
      ) : null}

      <form
        className={styles.formEtiqueta}
        onSubmit={(e) => {
          e.preventDefault()
          enviar()
        }}
      >
        <Field label={editando ? `Renombrar «${editando.nombre}»` : 'Nueva etiqueta'}>
          <Input
            value={nombre}
            maxLength={40}
            placeholder="Cotizar, Reclamo, Urgente…"
            onChange={(e) => setNombre(e.target.value)}
          />
        </Field>
        <Field label="Color">
          <Select value={color} onChange={(e) => setColor(e.target.value as ColorEtiqueta)}>
            {COLORES_ETIQUETA.map((c) => (
              <option key={c} value={c}>
                {NOMBRE_COLOR[c]}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.accionesEtiqueta}>
          <Button type="submit" disabled={nombre.trim() === ''} loading={guardar.isPending}>
            {editando ? 'Guardar' : 'Crear'}
          </Button>
          {editando ? (
            <Button type="button" variant="secondary" onClick={limpiar}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </form>

      {etiquetas.isPending ? (
        <p className={styles.nota}>Cargando…</p>
      ) : (etiquetas.data ?? []).length === 0 ? (
        <p className={styles.nota}>Todavía no hay etiquetas.</p>
      ) : (
        <ul className={styles.listaEtiquetas} aria-label="Etiquetas de la empresa">
          {(etiquetas.data ?? []).map((e) => (
            <li key={e.id} className={styles.filaEtiqueta}>
              <Badge tone={e.color}>{e.nombre}</Badge>
              <span className={styles.accionesEtiqueta}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Icon name="edit" size={16} />}
                  aria-label={`Renombrar ${e.nombre}`}
                  onClick={() => {
                    setEditando(e)
                    setNombre(e.nombre)
                    setColor(e.color)
                  }}
                >
                  Renombrar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Icon name="trash" size={16} />}
                  aria-label={`Borrar ${e.nombre}`}
                  onClick={() => setABorrar(e)}
                >
                  Borrar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={aBorrar !== null}
        tone="danger"
        title={`¿Borrar la etiqueta «${aBorrar?.nombre ?? ''}»?`}
        description="Se saca de todos los hilos que la tengan. Ningún correo se borra."
        confirmLabel="Borrar etiqueta"
        cancelLabel="Volver"
        busy={borrar.isPending}
        onCancel={() => setABorrar(null)}
        onConfirm={() => aBorrar && borrar.mutate(aBorrar.id, { onSettled: () => setABorrar(null) })}
      />
    </Dialog>
  )
}
