import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { nombreVisible } from '@/layouts/sesion'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/icons/Icon'
import {
  FalloAsistente,
  estadoAsistente,
  preguntar,
  type MensajeChat,
  type PasoAsistente,
  type PropuestaCotizacion,
} from '../services/asistente'
import { pedazos } from '../lib/formatoRespuesta'
import { TarjetaCotizacion } from './TarjetaCotizacion'
import styles from './ChatAsistente.module.css'

/**
 * El asistente (Fase 31 · E4).
 *
 * Una conversación con el agente general, que deriva a los especialistas. Lo
 * único que esta pantalla sabe hacer es mandar el hilo y dibujar lo que vuelve:
 * quién contestó, a quién consultó y qué buscó.
 *
 * La traza se muestra y no se esconde. Un asistente que contesta un número sin
 * decir de dónde salió obliga a creerle o a ir a comprobarlo a mano, y en un
 * ERP eso es peor que no tenerlo: acá abajo de cada respuesta dice qué
 * consultó, y el que revisa puede decidir si le alcanza.
 */

interface Turno {
  rol: 'usuario' | 'agente'
  texto: string
  pasos?: PasoAsistente[]
  /** El borrador de cotización, si armó uno. */
  propuesta?: PropuestaCotizacion | null
  corte?: 'ninguno' | 'vueltas' | 'presupuesto'
  error?: boolean
}

/**
 * Los atajos de arranque. No son decoración: muestran el ALCANCE.
 *
 * Sin ellos nadie sabe si puede preguntar por stock, por precios o por
 * correos, y la primera pregunta se desperdicia averiguándolo. Cada uno apunta
 * a un agente distinto a propósito, para que se vea que hay más de uno.
 */
const EJEMPLOS: { icono: IconName; texto: string }[] = [
  { icono: 'package', texto: '¿Tenemos puntas Philips PH2 con stock?' },
  { icono: 'bar-chart', texto: '¿Cuál fue el mejor cliente del mes pasado?' },
  { icono: 'cart', texto: '¿A qué precio le cotizamos a Mirgor la última vez?' },
  { icono: 'mail', texto: '¿Qué correos quedaron sin responder?' },
]

export function ChatAsistente() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  /**
   * El nombre de pila, si lo hay.
   *
   * «Hola, Juan Manuel Jesús» suena a carta del banco, así que va sólo el
   * primero. Y si la cuenta no tiene nombre cargado —pasa: hay usuarios que
   * son un buzón, como info@—, se saluda sin nombre. Inventar un relleno a
   * partir del correo daría «Hola, Info», que es peor que no saludar por
   * nombre.
   */
  const primerNombre = (nombreVisible(useAuth().user) ?? '').split(' ')[0] ?? ''

  const [turnos, setTurnos] = useState<Turno[]>([])
  const [texto, setTexto] = useState('')
  const finRef = useRef<HTMLDivElement>(null)

  const estado = useQuery({
    queryKey: ['asistente', 'estado'],
    queryFn: estadoAsistente,
    staleTime: 5 * 60_000,
  })

  const consultar = useMutation({
    mutationFn: (hilo: readonly MensajeChat[]) => preguntar({ companyId: companyId!, mensajes: hilo }),
    onSuccess: (r) => {
      setTurnos((t) => [
        ...t,
        { rol: 'agente', texto: r.texto, pasos: r.pasos, corte: r.corte, propuesta: r.propuesta },
      ])
    },
    onError: (e) => {
      const msg = e instanceof FalloAsistente ? e.message : 'No pude responder en este momento.'
      setTurnos((t) => [...t, { rol: 'agente', texto: msg, error: true }])
    },
  })

  /**
   * Que la respuesta nueva quede a la vista sin tener que bajar a mano.
   *
   * Se comprueba que el método exista: bajar el hilo es una comodidad, y no
   * puede ser la razón por la que la pantalla entera se caiga donde no esté
   * implementado. Lo encontró un test, que corre en jsdom y no lo tiene.
   */
  useEffect(() => {
    const fin = finRef.current
    if (typeof fin?.scrollIntoView === 'function') fin.scrollIntoView({ block: 'end' })
  }, [turnos, consultar.isPending])

  const enviar = (t: string) => {
    const limpio = t.trim()
    if (limpio === '' || companyId === null || consultar.isPending) return
    /**
     * Se manda el hilo ENTERO, no el último mensaje.
     *
     * Los agentes no guardan nada entre llamadas: la conversación ES el
     * contexto. Sin esto, «¿y de ese cliente qué pendiente hay?» llega sin
     * saber de qué cliente se habla.
     */
    const hilo: MensajeChat[] = [
      ...turnos.filter((x) => !x.error).map((x) => ({ rol: x.rol, texto: x.texto })),
      { rol: 'usuario' as const, texto: limpio },
    ]
    setTurnos((prev) => [...prev, { rol: 'usuario', texto: limpio }])
    setTexto('')
    consultar.mutate(hilo)
  }

  const titulo = (id: string) => estado.data?.agentes.find((a) => a.id === id)?.titulo ?? id

  return (
    <div className={styles.pagina}>
      {estado.data && !estado.data.listo ? (
        <Alert tone="warning" title="La IA todavía no está encendida">
          <p>
            El asistente está desplegado pero sin proveedor configurado, así que contesta siempre lo
            mismo. Se enciende con el secreto <code>IA_PROVIDER</code> de la función.
          </p>
        </Alert>
      ) : null}

      <div className={styles.hilo}>
        {turnos.length === 0 ? (
          <div className={styles.vacio}>
            <span className={styles.vacioIcono} aria-hidden="true">
              <Icon name="sparkles" size={32} />
            </span>
            <h3 className={styles.vacioTitulo}>{primerNombre === '' ? 'Hola' : `Hola, ${primerNombre}`}</h3>
            <p className={styles.vacioAyuda}>
              Consulto el ERP en vivo: catálogo, ventas, compras y correo.
              <br />
              Preguntame lo que quieras.
            </p>
            <ul className={styles.ejemplos}>
              {EJEMPLOS.map((e) => (
                <li key={e.texto}>
                  <button type="button" className={styles.ejemplo} onClick={() => enviar(e.texto)}>
                    <Icon name={e.icono} size={16} className={styles.ejemploIcono} />
                    <span>{e.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {turnos.map((t, i) => (
          <article
            key={i}
            className={t.rol === 'usuario' ? styles.mio : styles.suyo}
            aria-label={t.rol === 'usuario' ? 'Lo que preguntaste' : 'Respuesta del asistente'}
          >
            {/* Las negritas se arman con elementos de React, no con HTML: el
                texto del modelo no puede inyectar nada en la página. */}
            <p className={t.error ? styles.textoError : styles.texto}>
              {pedazos(t.texto).map((z, k) =>
                z.negrita ? <strong key={k}>{z.texto}</strong> : <span key={k}>{z.texto}</span>,
              )}
            </p>

            {/* El borrador va DEBAJO de lo que dijo, como una tarjeta
                aparte: es lo que va a pasar si apretás, no algo que dijo. */}
            {t.propuesta ? <TarjetaCotizacion propuesta={t.propuesta} /> : null}

            {t.corte && t.corte !== 'ninguno' ? (
              <p className={styles.aviso}>
                La consulta llegó a su tope y se cortó: puede estar incompleta.
              </p>
            ) : null}

            {t.pasos && t.pasos.length > 0 ? (
              <details className={styles.traza}>
                <summary>
                  {t.pasos.filter((p) => p.tipo === 'consulta').length > 0
                    ? `Consultó a ${[...new Set(t.pasos.filter((p) => p.tipo === 'consulta').map((p) => titulo(p.nombre)))].join(', ')}`
                    : `${t.pasos.length} consulta${t.pasos.length === 1 ? '' : 's'} a los datos`}
                </summary>
                <ol className={styles.pasos}>
                  {t.pasos.map((p, j) => (
                    <li key={j}>
                      <span className={styles.pasoAgente}>{titulo(p.agente)}</span>
                      {p.tipo === 'consulta' ? (
                        <>
                          {' le preguntó a '}
                          <strong>{titulo(p.nombre)}</strong>
                        </>
                      ) : (
                        <>
                          {' usó '}
                          <code>{p.nombre}</code>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </article>
        ))}

        {consultar.isPending ? (
          <article className={styles.suyo} aria-live="polite">
            <p className={styles.pensando}>Pensando…</p>
          </article>
        ) : null}

        <div ref={finRef} />
      </div>

      <form
        className={styles.barra}
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
      >
        <label className="sr-only" htmlFor="asistente-entrada">
          Tu pregunta
        </label>
        <input
          id="asistente-entrada"
          className={styles.entrada}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Preguntá algo sobre el catálogo, las ventas o los correos…"
          autoComplete="off"
          disabled={companyId === null}
        />
        <Button
          type="submit"
          icon={<Icon name="arrow-right" size={16} />}
          disabled={texto.trim() === '' || consultar.isPending || companyId === null}
        >
          Preguntar
        </Button>
      </form>
    </div>
  )
}
