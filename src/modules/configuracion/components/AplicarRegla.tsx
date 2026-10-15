import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/feedback/Alert'
import { Dialogo } from './Dialogo'
import {
  aplicarReglaAhora,
  mensajeDeRegla,
  previsualizarRegla,
  type PasadaDeRegla,
} from '../services/reglasCorreo'
import type { ReglaCorreo } from '../lib/reglasCorreo'
import styles from './ReglasCorreo.module.css'

export interface AplicarReglaProps {
  regla: ReglaCorreo
  onCerrar: () => void
  /** Para refrescar lo que haya quedado distinto después de aplicar. */
  onAplicada: () => void
}

/** Lo que se acumula al recorrer el correo de a tandas. */
interface Acumulado {
  mirados: number
  total: number
  coinciden: number
  acciones: Record<string, number>
  ejemplos: PasadaDeRegla['ejemplos']
}

const VACIO: Acumulado = { mirados: 0, total: 0, coinciden: 0, acciones: {}, ejemplos: [] }

const sumar = (a: Acumulado, p: PasadaDeRegla): Acumulado => {
  const acciones = { ...a.acciones }
  for (const [k, v] of Object.entries(p.acciones)) acciones[k] = (acciones[k] ?? 0) + v
  return {
    mirados: a.mirados + p.mirados,
    total: p.total,
    coinciden: a.coinciden + p.coinciden,
    acciones,
    /* Los ejemplos son para reconocer de qué correo habla, así que alcanza con
       los de la primera tanda que traiga alguno. */
    ejemplos: a.ejemplos.length > 0 ? a.ejemplos : p.ejemplos,
  }
}

const ETIQUETA_ACCION: Record<string, (n: number) => string> = {
  etiquetar: (n) => `${n} ${n === 1 ? 'etiqueta' : 'etiquetas'}`,
  asignar: (n) => `${n} ${n === 1 ? 'asignación' : 'asignaciones'}`,
  estado: (n) => `${n} ${n === 1 ? 'cambio de estado' : 'cambios de estado'}`,
  sacar_de_bandeja: (n) => `${n} ${n === 1 ? 'sacado' : 'sacados'} de la bandeja`,
}

/**
 * Aplicar una regla a los correos que ya están (Fase 70 · E3).
 *
 * ── Primero mira, después hace ──────────────────────────────────────────────
 *
 * Se abre MIRANDO: recorre el correo sin tocar nada y dice cuántos coincidirían
 * y qué les pasaría. Recién con eso a la vista aparece el botón de aplicar. Una
 * regla mal escrita sobre dos mil correos es un desastre difícil de deshacer
 * —sobre todo «sacarlo de la bandeja»—, y mirar primero cuesta lo mismo que
 * hacer.
 *
 * Lo que promete la previa es exactamente lo que después pasa: es la MISMA
 * función del servidor con un parámetro que le dice que no escriba.
 *
 * ── Por qué va de a tandas ──────────────────────────────────────────────────
 *
 * Está medido en el script de la Fase 70: una regla con «es cliente» tarda 6,5
 * ms por hilo, o sea trece segundos sobre los dos mil que hay. Eso no entra en
 * el tiempo que el servidor le da a una consulta. Se piden de a doscientos, y
 * de paso se puede mostrar un avance de verdad en vez de una rueda girando.
 */
export function AplicarRegla({ regla, onCerrar, onAplicada }: AplicarReglaProps) {
  const [fase, setFase] = useState<'mirando' | 'miré' | 'aplicando' | 'listo'>('mirando')
  const [acumulado, setAcumulado] = useState<Acumulado>(VACIO)
  const [error, setError] = useState<string | null>(null)
  /* Para no seguir recorriendo cuando se cerró el diálogo: son varias idas y
     vueltas al servidor, y la última vuelve con la pantalla ya desmontada. */
  const vivo = useRef(true)
  useEffect(() => () => void (vivo.current = false), [])

  async function recorrer(simulado: boolean) {
    let acc = VACIO
    let desde = 0
    try {
      for (;;) {
        const p = simulado ? await previsualizarRegla(regla.id, desde) : await aplicarReglaAhora(regla.id, desde)
        if (!vivo.current) return
        acc = sumar(acc, p)
        setAcumulado(acc)
        desde += p.mirados
        if (p.quedan === 0 || p.mirados === 0) break
      }
      setFase(simulado ? 'miré' : 'listo')
      if (!simulado) onAplicada()
    } catch (e) {
      if (!vivo.current) return
      setError(mensajeDeRegla(e))
      setFase(simulado ? 'miré' : 'listo')
    }
  }

  /*
   * Al abrir, mira. Una sola vez: la regla no cambia mientras el diálogo está
   * abierto, y el estado inicial ya es «mirando», así que acá no hay nada que
   * poner antes de arrancar.
   */
  useEffect(() => {
    /* El aviso de «no llames a setState en un efecto» apunta a los renders en
       cascada; acá lo que hay es una carga: el primer setState llega después
       de una ida al servidor, que es exactamente para lo que sirve un efecto. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recorrer(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Empezar de nuevo, ahora aplicando de verdad. */
  const aplicar = () => {
    setError(null)
    setAcumulado(VACIO)
    setFase('aplicando')
    void recorrer(false)
  }

  const trabajando = fase === 'mirando' || fase === 'aplicando'
  const porciento = acumulado.total === 0 ? 0 : Math.round((acumulado.mirados / acumulado.total) * 100)
  const resumen = Object.entries(acumulado.acciones)
    .map(([k, n]) => (ETIQUETA_ACCION[k] ?? ((x: number) => `${x} ${k}`))(n))
    .join(' · ')

  return (
    <Dialogo
      titulo={`Aplicar «${regla.nombre}» a los que ya están`}
      bloqueado={trabajando}
      onCerrar={onCerrar}
      pie={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={trabajando}>
            {fase === 'listo' ? 'Cerrar' : 'Cancelar'}
          </Button>
          {fase === 'miré' && acumulado.coinciden > 0 ? (
            <Button onClick={aplicar}>
              Aplicar a {acumulado.coinciden} {acumulado.coinciden === 1 ? 'correo' : 'correos'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.previa}>
        {trabajando ? (
          <>
            <p className={styles.detalle}>
              {fase === 'mirando' ? 'Mirando' : 'Aplicando'}… {acumulado.mirados} de {acumulado.total || '…'}
            </p>
            <div className={styles.avance} aria-hidden="true">
              <div className={styles.avanceRelleno} style={{ width: `${porciento}%` }} />
            </div>
          </>
        ) : null}

        {!trabajando ? (
          <>
            <p className={styles.contador} role="status">
              {acumulado.coinciden === 0
                ? 'Ningún correo coincide con esta regla.'
                : fase === 'listo'
                  ? `Listo: ${acumulado.coinciden} ${acumulado.coinciden === 1 ? 'correo' : 'correos'}.`
                  : `Coinciden ${acumulado.coinciden} de ${acumulado.total}.`}
            </p>
            {resumen !== '' ? (
              <p className={styles.detalle}>
                {fase === 'listo' ? 'Se hizo: ' : 'Se haría: '}
                {resumen}.
              </p>
            ) : null}
          </>
        ) : null}

        {/* Los ejemplos: para reconocer de qué correos habla antes de apretar.
            Un número suelto no alcanza para animarse a tocar dos mil correos. */}
        {acumulado.ejemplos.length > 0 ? (
          <ul className={styles.ejemplos}>
            {acumulado.ejemplos.map((e, i) => (
              <li key={i} className={styles.ejemplo}>
                <span>{e.asunto ?? '(sin asunto)'}</span>
                <span className={styles.ejemploDe}>{e.de ?? 'Remitente desconocido'}</span>
                <span className={styles.ejemploQue}>
                  {e.que.map((q) => (q.detalle ? `${q.tipo}: ${q.detalle}` : q.tipo)).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          Lo que la regla NO va a hacer, dicho antes de apretar.

          Es la diferencia entre «aplicar» y «rehacer»: sobre un hilo que
          alguien ya tomó, la regla sólo agrega lo que falta. Sin este cartel,
          el número de «coinciden» se lee como si fuera a pisar todo.
        */}
        {fase === 'miré' && acumulado.coinciden > 0 ? (
          <Alert tone="info" role="note">
            <p>
              Lo que ya tocó una persona no se pisa: no cambia el asignado si ya tiene uno, ni el estado
              si alguien lo movió, ni saca de la bandeja un correo que alguien devolvió.
            </p>
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="danger" role="alert" title="No se pudo terminar">
            <p>{error}</p>
          </Alert>
        ) : null}
      </div>
    </Dialogo>
  )
}
