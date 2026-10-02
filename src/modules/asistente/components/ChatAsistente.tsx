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
  leerAdjunto,
  preguntar,
  transcribir,
  type Adjunto,
  type MensajeChat,
  type PasoAsistente,
  type PropuestaCotizacion,
} from '../services/asistente'
import { pedazos } from '../lib/formatoRespuesta'
import { TarjetaCotizacion } from './TarjetaCotizacion'
import { empezarAGrabar, FalloGrabacion, sePuedeGrabar, type Grabacion } from '../lib/grabador'
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
  /* El micrófono sólo aparece si el navegador puede grabar: un botón que no
     hace nada es peor que no tenerlo. */
  const [grabando, setGrabando] = useState<Grabacion | null>(null)
  const [avisoAudio, setAvisoAudio] = useState<string | null>(null)
  /* El documento adjuntado, ya pasado a texto. Uno por vez: dos documentos en
     una sola pregunta se mezclan y el modelo no sabe cuál es cuál. */
  const [adjunto, setAdjunto] = useState<Adjunto | null>(null)
  const entradaArchivo = useRef<HTMLInputElement>(null)

  const leyendo = useMutation({
    mutationFn: leerAdjunto,
    onSuccess: setAdjunto,
    onError: (e) => setAvisoAudio(e instanceof Error ? e.message : 'No pude leer el archivo.'),
  })
  const puedeGrabar = sePuedeGrabar()

  const transcribiendo = useMutation({
    mutationFn: transcribir,
    onSuccess: (t) => {
      /* Lo dicho ENTRA AL CUADRO, no se manda. Ver el comentario del servicio:
         la transcripción se equivoca con los SKU y una consulta armada sobre
         una referencia mal oída trae el producto equivocado. */
      setTexto((antes) => (antes.trim() === '' ? t : `${antes} ${t}`))
      setAvisoAudio(null)
    },
    onError: (e) => setAvisoAudio(e instanceof Error ? e.message : 'No pude entender el audio.'),
  })

  const alternarMicrofono = async () => {
    setAvisoAudio(null)
    if (grabando) {
      const g = grabando
      setGrabando(null)
      transcribiendo.mutate(await g.detener())
      return
    }
    try {
      setGrabando(await empezarAGrabar())
    } catch (e) {
      setAvisoAudio(e instanceof FalloGrabacion ? e.message : 'No pude abrir el micrófono.')
    }
  }
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
    /**
     * El documento viaja DENTRO de la pregunta, no como un campo aparte.
     *
     * Así el bucle de agentes no se entera de que hubo un adjunto: para él es
     * una consulta más larga. No hubo que tocar ni el bucle ni las
     * herramientas para que esto funcione.
     */
    const conAdjunto =
      adjunto === null
        ? limpio
        : [
            `[Documento adjunto: ${adjunto.nombre}${adjunto.recortado ? ' · recortado' : ''}]`,
            adjunto.texto,
            '',
            '[Pregunta]',
            limpio,
          ].join('\n')

    const hilo: MensajeChat[] = [
      ...turnos.filter((x) => !x.error).map((x) => ({ rol: x.rol, texto: x.texto })),
      { rol: 'usuario' as const, texto: conAdjunto },
    ]
    /* En pantalla se ve lo que la persona ESCRIBIÓ, con el nombre del
       archivo: volcar el documento entero en la burbuja haría ilegible la
       conversación. */
    setTurnos((prev) => [
      ...prev,
      {
        rol: 'usuario',
        texto: adjunto === null ? limpio : `${adjunto.nombre} — ${limpio}`,
      },
    ])
    setAdjunto(null)
    setTexto('')
    consultar.mutate(hilo)
  }

  /* `titulo()` se fue con la traza: era lo que traducía «catalogo» a
     «Catálogo» para mostrarlo. Los agentes siguen llegando en `estado.data`
     por si hay que volver a dibujarla. */

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

            {/*
              La traza ya NO se dibuja (Fase 39).

              Decía «Consultó a Catálogo · Catálogo usó buscar_productos». Era
              útil mientras se construía esto —para ver por qué un dato salía
              raro— y es ruido para quien sólo quiere la respuesta: nombra
              piezas internas que no le significan nada a quien pregunta.

              Lo que NO cambia es lo de abajo: el asistente sigue derivando a
              sus especialistas igual que antes. Esto es la pantalla, no el
              mecanismo. `pasos` sigue llegando y sigue guardado en el mensaje,
              así que volver a mostrarlo —o volcarlo a un log cuando algo
              parezca mal— es dibujar de nuevo este bloque y nada más.
            */}
          </article>
        ))}

        {consultar.isPending ? <Progreso /> : null}

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
        {/* El clip. Un solo archivo por vez: dos documentos en una pregunta
            se mezclan y el modelo no sabe cuál es cuál. */}
        <input
          ref={entradaArchivo}
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            setAvisoAudio(null)
            if (f) leyendo.mutate(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className={styles.micro}
          aria-label="Adjuntar un PDF"
          disabled={leyendo.isPending}
          onClick={() => entradaArchivo.current?.click()}
        >
          <Icon name="paperclip" size={20} />
        </button>

        {/* El micrófono sólo si el navegador puede grabar. Y el estado se
            dice con PALABRAS además de color: «Grabando» en el rótulo
            accesible, no sólo un botón rojo. */}
        {puedeGrabar ? (
          <button
            type="button"
            className={grabando ? `${styles.micro} ${styles.microActivo}` : styles.micro}
            aria-label={grabando ? 'Cortar y transcribir' : 'Dictar la consulta'}
            aria-pressed={grabando !== null}
            disabled={transcribiendo.isPending}
            onClick={() => void alternarMicrofono()}
          >
            <Icon name={grabando ? 'check' : 'mic'} size={20} />
          </button>
        ) : null}

        <Button
          type="submit"
          icon={<Icon name="arrow-right" size={16} />}
          disabled={texto.trim() === '' || consultar.isPending || companyId === null}
        >
          Preguntar
        </Button>
      </form>

      {/* El archivo adjuntado, con su nombre y cómo sacarlo. Sin esto no se
          sabe si quedó puesto, y se manda la pregunta sin él o con uno viejo. */}
      {adjunto !== null ? (
        <p className={styles.adjunto}>
          <Icon name="paperclip" size={16} />
          <span className={styles.adjuntoNombre}>{adjunto.nombre}</span>
          {adjunto.paginas !== null ? (
            <span className={styles.adjuntoDato}>
              {adjunto.paginas} pág.{adjunto.recortado ? ' · recortado' : ''}
            </span>
          ) : null}
          <button type="button" className={styles.quitar} onClick={() => setAdjunto(null)}>
            Quitar
          </button>
        </p>
      ) : null}

      {leyendo.isPending ? <p className={styles.estadoAudio}>Leyendo el documento…</p> : null}

      {grabando !== null || transcribiendo.isPending || avisoAudio !== null ? (
        <p className={styles.estadoAudio} role="status">
          {grabando !== null
            ? 'Grabando… tocá el tilde para terminar.'
            : transcribiendo.isPending
              ? 'Pasando a texto…'
              : avisoAudio}
        </p>
      ) : null}
    </div>
  )
}

/**
 * La barra mientras el asistente trabaja (Fase 39).
 *
 * Antes decía «Pensando…» y nada más. Una consulta tarda entre 20 y 45
 * segundos —el asistente deriva a un especialista y ése consulta la base
 * varias veces— y medio minuto mirando un texto quieto se siente como un
 * cuelgue: lo primero que uno hace es volver a apretar.
 *
 * LA BARRA NO MIENTE, Y ESO DEFINE CÓMO ESTÁ HECHA.
 *
 * No hay progreso real que informar: el servidor contesta de una sola vez al
 * final, así que nadie sabe cuánto falta. Entonces avanza rápido al principio
 * y se va frenando sola, acercándose al 92 % sin llegar nunca. Cuando la
 * respuesta llega, la barra desaparece junto con el cartel.
 *
 * Una barra que llega al 100 % y SIGUE esperando es peor que no tener barra:
 * la primera vez molesta y a partir de la segunda ya no se le cree a ninguna.
 *
 * Por eso tampoco lleva `aria-valuenow`: un `progressbar` sin valor es, por
 * definición, indeterminado, que es exactamente lo que esto es. Poner un
 * número inventado ahí le mentiría al lector de pantalla con más precisión
 * todavía.
 */
function Progreso() {
  const [avance, setAvance] = useState(0)

  useEffect(() => {
    const inicio = performance.now()
    // 14 segundos de constante: a los 14 va por el 51 %, a los 30 por el 88,
    // y de ahí en más se arrastra. Está elegido contra los tiempos medidos
    // (20 a 45 s), para que la mayor parte del avance ocurra mientras la
    // espera todavía se siente corta.
    const id = window.setInterval(() => {
      const t = (performance.now() - inicio) / 1000
      setAvance(Math.min(0.92, 1 - Math.exp(-t / 14)))
    }, 120)
    return () => window.clearInterval(id)
  }, [])

  return (
    <article className={styles.suyo}>
      <div
        className={styles.barra}
        role="progressbar"
        aria-label="El asistente está buscando la respuesta"
      >
        <div className={styles.barraRelleno} style={{ width: `${Math.round(avance * 100)}%` }} />
      </div>
      <p className={styles.pensando} aria-live="polite">
        Buscando en el ERP…
      </p>
    </article>
  )
}
