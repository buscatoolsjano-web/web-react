import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Dialog } from '@/components/modals/Dialog'
import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { formatearFecha } from '../lib/formato'
import {
  ATAJOS_CONTACTO,
  MOTIVOS_PERDIDA,
  estadoContacto,
  etiquetaMotivo,
  sumarDias,
  type MotivoPerdida,
} from '../lib/seguimiento'
import {
  guardarProximoContacto,
  leerSeguimiento,
  marcarPerdida,
  reabrirCotizacion,
} from '../services/seguimiento'
import styles from './PanelSeguimiento.module.css'

function hoyLocal(): string {
  return new Date().toLocaleDateString('sv-SE')
}

export interface PanelSeguimientoProps {
  quoteId: string
  /** Quien sólo mira no cambia nada. */
  escribe: boolean
  /** Con pedido la cotización está ganada: no se pierde ni se persigue. */
  yaTienePedido: boolean
  /** Para refrescar el resto de la pantalla (el chip de estado, el listado). */
  onCambio: () => void
}

/**
 * El seguimiento de la cotización (2026-11), arriba de las líneas.
 *
 * Abierta: cuándo volver a llamar, con atajos de un clic, y «Marcar perdida».
 * Perdida: el motivo y la nota, y «Reabrir» por si fue un error. Ganada (tiene
 * pedido): no muestra nada, lo dice el estado.
 */
export function PanelSeguimiento({ quoteId, escribe, yaTienePedido, onCambio }: PanelSeguimientoProps) {
  const qc = useQueryClient()
  const clave = ['ventas', 'seguimiento', quoteId]
  const q = useQuery({ queryKey: clave, queryFn: () => leerSeguimiento(quoteId) })
  const hoy = hoyLocal()

  const [editandoContacto, setEditandoContacto] = useState(false)
  const [fecha, setFecha] = useState('')
  const [nota, setNota] = useState('')
  const [perdiendo, setPerdiendo] = useState(false)
  const [motivo, setMotivo] = useState<MotivoPerdida>('precio')
  const [notaPerdida, setNotaPerdida] = useState('')

  const listo = () => {
    void qc.invalidateQueries({ queryKey: clave })
    onCambio()
  }

  const contacto = useMutation({
    mutationFn: ({ f, n }: { f: string | null; n: string | null }) => guardarProximoContacto(quoteId, f, n),
    onSuccess: () => {
      setEditandoContacto(false)
      listo()
    },
  })
  const perder = useMutation({
    mutationFn: () => marcarPerdida(quoteId, motivo, notaPerdida),
    onSuccess: () => {
      setPerdiendo(false)
      listo()
    },
  })
  const reabrir = useMutation({ mutationFn: () => reabrirCotizacion(quoteId), onSuccess: listo })

  const s = q.data
  if (!s || yaTienePedido || s.estado === 'accepted') return null
  const error = contacto.error ?? perder.error ?? reabrir.error

  if (s.estado === 'rejected') {
    return (
      <section className={`${styles.panel} ${styles.perdida}`} aria-label="Seguimiento">
        <Icon name="alert-circle" size={20} />
        <div className={styles.texto}>
          <strong>Perdida{s.motivoPerdida ? `: ${etiquetaMotivo(s.motivoPerdida)}` : ''}</strong>
          {s.notaPerdida ? <span className={styles.nota}>{s.notaPerdida}</span> : null}
          {s.perdidaEn ? <span className={styles.fecha}>el {formatearFecha(s.perdidaEn)}</span> : null}
        </div>
        {escribe ? (
          <Button variant="ghost" size="sm" loading={reabrir.isPending} onClick={() => reabrir.mutate()}>
            Reabrir
          </Button>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error.message}</p> : null}
      </section>
    )
  }

  const estado = estadoContacto(s.proximoContacto, hoy)
  const abrirEdicion = () => {
    setFecha(s.proximoContacto ?? '')
    setNota(s.notaContacto ?? '')
    setEditandoContacto(true)
  }

  return (
    <section
      className={`${styles.panel} ${estado === 'atrasado' ? styles.atrasado : estado === 'hoy' ? styles.hoy : ''}`}
      aria-label="Seguimiento"
    >
      <Icon name="calendar" size={20} />
      {editandoContacto ? (
        <div className={styles.edicion}>
          <div className={styles.atajos}>
            {ATAJOS_CONTACTO.map((a) => (
              <button key={a.dias} type="button" className={styles.atajo} onClick={() => setFecha(sumarDias(hoy, a.dias))}>
                {a.etiqueta}
              </button>
            ))}
          </div>
          <div className={styles.campos}>
            <Input type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha del próximo contacto" />
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Qué hay que hacer: llamar a compras, mandar alternativa…"
              aria-label="Nota del próximo contacto"
            />
            <Button
              size="sm"
              disabled={fecha === ''}
              loading={contacto.isPending}
              onClick={() => contacto.mutate({ f: fecha, n: nota })}
            >
              Guardar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditandoContacto(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.texto}>
          {s.proximoContacto ? (
            <>
              <strong>
                {estado === 'atrasado'
                  ? `Contacto atrasado: era el ${formatearFecha(s.proximoContacto)}`
                  : estado === 'hoy'
                    ? 'Contactar hoy'
                    : `Próximo contacto: ${formatearFecha(s.proximoContacto)}`}
              </strong>
              {s.notaContacto ? <span className={styles.nota}>{s.notaContacto}</span> : null}
            </>
          ) : (
            <span className={styles.nota}>Sin próximo contacto. Agendalo para que no se enfríe.</span>
          )}
        </div>
      )}

      {escribe && !editandoContacto ? (
        <div className={styles.acciones}>
          <Button variant="secondary" size="sm" onClick={abrirEdicion}>
            {s.proximoContacto ? 'Reprogramar' : 'Agendar contacto'}
          </Button>
          {s.proximoContacto ? (
            <Button variant="ghost" size="sm" loading={contacto.isPending} onClick={() => contacto.mutate({ f: null, n: null })}>
              Quitar
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setPerdiendo(true)}>
            Marcar perdida…
          </Button>
        </div>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error.message}</p> : null}

      <Dialog
        open={perdiendo}
        onClose={() => setPerdiendo(false)}
        title="Marcar la cotización como perdida"
        description="El motivo queda guardado y sirve para ver dónde se pierden ventas."
        size="sm"
        busy={perder.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPerdiendo(false)} disabled={perder.isPending}>
              Cancelar
            </Button>
            <Button variant="danger" loading={perder.isPending} onClick={() => perder.mutate()}>
              Marcar perdida
            </Button>
          </>
        }
      >
        <Field label="Motivo">
          <Select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoPerdida)}>
            {MOTIVOS_PERDIDA.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Detalle" optional>
          <Textarea
            value={notaPerdida}
            onChange={(e) => setNotaPerdida(e.target.value)}
            rows={3}
            placeholder="Ej.: compraron a X a 10 % menos; necesitaban entrega en 15 días."
          />
        </Field>
      </Dialog>
    </section>
  )
}
