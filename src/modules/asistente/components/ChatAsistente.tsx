import { useCallback, useEffect, useRef, useState } from 'react'
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
  preguntarEnVivo,
  transcribir,
  type Adjunto,
  type CorreoNombrado,
  type MensajeChat,
  type PasoAsistente,
  type ProductoNombrado,
  type PropuestaCotizacion,
} from '../services/asistente'
import { pedazos } from '../lib/formatoRespuesta'
import { podarDuplicados } from '../lib/podar'
import {
  EN_VIVO_INICIAL,
  TIC_MS,
  aplicar,
  avanzarConElTiempo,
  fraseDelPaso,
  type EstadoEnVivo,
} from '../lib/enVivo'
import { TarjetaCotizacion } from './TarjetaCotizacion'
import { TarjetasCorreos } from './TarjetasCorreos'
import { TarjetasProductos } from './TarjetasProductos'
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
  /** Los productos que nombró, para dibujarlos como tarjetas con sus botones. */
  productos?: ProductoNombrado[]
  /** Y los correos, por lo mismo. */
  correos?: CorreoNombrado[]
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
  /** El principio de la última respuesta, para mostrarla desde arriba. */
  const respuestaRef = useRef<HTMLElement>(null)

  const estado = useQuery({
    queryKey: ['asistente', 'estado'],
    queryFn: estadoAsistente,
    staleTime: 5 * 60_000,
  })

  /**
   * Lo que se ve mientras trabaja (Fase 65).
   *
   * Antes acá había una barra que avanzaba sola, porque el servidor contestaba
   * de una sola vez al final y no había NADA real que informar. Ahora el
   * servidor va contando, así que la barra inventada se fue: se muestra a
   * quién consultó, qué está buscando y la respuesta mientras se escribe.
   */
  const [enVivo, setEnVivo] = useState<EstadoEnVivo>(EN_VIVO_INICIAL)

  /* Un tic del reloj de la barra. Va acá —y no adentro de `EnVivo`— para que
     el estado siga teniendo un solo dueño: los avisos del servidor y el reloj
     empujan la MISMA barra, y por eso ninguno puede hacerla retroceder. */
  const avanzarLaBarra = useCallback(
    () => setEnVivo((e) => ({ ...e, avance: avanzarConElTiempo(e.avance) })),
    [],
  )

  /* El id del agente a como se lo nombra en pantalla. La lista la manda el
     servidor en `estado`, así que no hay una copia acá que se desincronice.
     Se usa AL DIBUJAR y no al recibir el aviso: ver `EstadoEnVivo`. */
  const tituloDeAgente = useCallback(
    (id: string) => estado.data?.agentes.find((a) => a.id === id)?.titulo ?? '',
    [estado.data],
  )

  const consultar = useMutation({
    mutationFn: (hilo: readonly MensajeChat[]) => {
      setEnVivo(EN_VIVO_INICIAL)
      return preguntarEnVivo({ companyId: companyId!, mensajes: hilo }, (aviso) =>
        setEnVivo((e) => aplicar(e, aviso)),
      )
    },
    onSuccess: (r) => {
      setTurnos((t) => [
        ...t,
        {
          rol: 'agente',
          texto: r.texto,
          pasos: r.pasos,
          corte: r.corte,
          propuesta: r.propuesta,
          productos: r.productos,
          correos: r.correos,
        },
      ])
    },
    onError: (e) => {
      const msg = e instanceof FalloAsistente ? e.message : 'No pude responder en este momento.'
      setTurnos((t) => [...t, { rol: 'agente', texto: msg, error: true }])
    },
  })

  /**
   * Dónde queda la vista cuando cambia el hilo (Fase 166).
   *
   * Mientras pregunta o apenas mandé mi mensaje, abajo: ahí está mi pregunta y
   * la barra de «pensando». Pero cuando LLEGA la respuesta, al PRINCIPIO de
   * ella, no al final: antes bajaba hasta el fondo —tarjetas incluidas— y había
   * que volver a subir para leer desde la primera línea. «Que me muestre lo
   * primero que me dice, no que me scrollee hasta abajo todo solo.»
   *
   * Se comprueba que el método exista: acomodar el hilo es una comodidad y no
   * puede tirar abajo la pantalla donde no esté implementado (jsdom, en tests).
   */
  useEffect(() => {
    const ultimo = turnos[turnos.length - 1]
    if (!consultar.isPending && ultimo?.rol === 'agente') {
      const resp = respuestaRef.current
      if (typeof resp?.scrollIntoView === 'function') {
        resp.scrollIntoView({ block: 'start' })
        return
      }
    }
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

        {turnos.map((t, i) => {
          /*
            Lo que se MUESTRA del texto (Fase 69).

            Si el modelo enumeró los productos o los correos que están ahí
            abajo como tarjetas, esos renglones se sacan: eran lo mismo escrito
            dos veces. Se poda al dibujar y no al guardar, porque el hilo que
            se le manda en la pregunta siguiente lleva el texto entero —un «¿y
            el tercero de la lista?» necesita la lista—. Ver `lib/podar`.
          */
          const visible = podarDuplicados(t.texto, {
            skus: (t.productos ?? []).map((p) => p.sku),
            correos: t.correos ?? [],
          })
          return (
            <article
              key={i}
              ref={t.rol === 'agente' && i === turnos.length - 1 ? respuestaRef : undefined}
              className={t.rol === 'usuario' ? styles.mio : styles.suyo}
              aria-label={t.rol === 'usuario' ? 'Lo que preguntaste' : 'Respuesta del asistente'}
            >
              {/* Las negritas se arman con elementos de React, no con HTML: el
                  texto del modelo no puede inyectar nada en la página.

                  Y si no quedó texto —porque todo lo que dijo ya está en las
                  tarjetas— no se dibuja un párrafo vacío: la respuesta son las
                  tarjetas. */}
              {visible !== '' ? (
                <p className={t.error ? styles.textoError : styles.texto}>
                  {pedazos(visible).map((z, k) =>
                    z.negrita ? <strong key={k}>{z.texto}</strong> : <span key={k}>{z.texto}</span>,
                  )}
                </p>
              ) : null}

              {/* El borrador va DEBAJO de lo que dijo, como una tarjeta
                  aparte: es lo que va a pasar si apretás, no algo que dijo. */}
              {t.propuesta ? <TarjetaCotizacion propuesta={t.propuesta} /> : null}

              {/* Y los productos que nombró, para poder hacer algo con ellos sin
                  copiar el SKU e irse al catálogo a buscarlo. */}
              {t.productos && t.productos.length > 0 ? (
                <TarjetasProductos productos={t.productos} />
              ) : null}

              {/* Y los correos, con su «Ver mail». */}
              {t.correos && t.correos.length > 0 ? <TarjetasCorreos correos={t.correos} /> : null}

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
          )
        })}

        {consultar.isPending ? <EnVivo estado={enVivo} titulo={tituloDeAgente} avanzar={avanzarLaBarra} /> : null}

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
 * Lo que se ve mientras el asistente trabaja (Fase 65, rehecho en la 71).
 *
 * Tres cosas: una barra, el porcentaje y la frase de en qué anda. Nada más.
 *
 * ── Por qué ya no se ve la respuesta escribiéndose ──────────────────────────
 *
 * Desde la Fase 65 el texto del modelo se mostraba a medida que llegaba. Para
 * una respuesta de dos frases estaba bien. Para «¿qué hay de ph1?» eran
 * veintinueve renglones de «SKU — nombre — precio — disponible» tecleándose en
 * pantalla durante quince segundos, y después, debajo, los mismos veintinueve
 * productos como tarjetas con foto y botones. Lo dicho por quien lo usa: «no
 * quiero ver cómo va escribiendo todo en texto plano y después me muestra los
 * productos; que muestre directo lo de abajo».
 *
 * Así que mientras espera no se muestra texto: se muestra que avanza y en qué
 * anda. La respuesta aparece una vez, entera, ya sin lo que repetía a las
 * tarjetas (ver `lib/podar`).
 *
 * Esto además arregla algo que el texto en vivo nunca resolvió bien: era
 * PROVISORIO. Un agente que empieza a redactar puede después decidir usar una
 * herramienta, y lo escrito se descarta (ver `aplicar` en `lib/enVivo`). Se
 * veían párrafos que nunca fueron la respuesta.
 *
 * Si alguna vez se lo quiere de vuelta —para las respuestas largas de prosa,
 * donde sí se leía bien—, es un bloque: `estado.texto` se sigue acumulando.
 *
 * `aria-live="polite"` va sobre la frase y sobre nada más: lo que se anuncia
 * es en qué anda, y la respuesta se lee entera cuando está.
 */
function EnVivo({
  estado,
  titulo,
  avanzar,
}: {
  estado: EstadoEnVivo
  titulo: (id: string) => string
  avanzar: () => void
}) {
  /*
   * El reloj de la barra (Fase 71).
   *
   * Vive acá y no en el estado del chat porque empieza y termina con este
   * cartel: mientras se ve, corre; cuando llega la respuesta, el cartel se
   * desmonta y el intervalo se va con él. Ver `avanzarConElTiempo`.
   */
  useEffect(() => {
    const reloj = setInterval(avanzar, TIC_MS)
    return () => clearInterval(reloj)
  }, [avanzar])

  const porciento = Math.round(estado.avance * 100)
  return (
    <article className={styles.suyo}>
      {/*
        La barra ARRIBA y la frase abajo (Fase 71).

        Las dos contestan preguntas distintas: la barra, cuánto falta; la
        frase, en qué anda. Y la barra va primero porque es lo que se mira de
        reojo mientras uno hace otra cosa.

        `aria-hidden` en la barra y en el número: el rótulo accesible lo da la
        frase, que es la que vive. Un lector de pantalla anunciando «treinta y
        siete por ciento» cinco veces por segundo tapa lo único que importa.
      */}
      <div className={styles.progreso} aria-hidden="true">
        <div className={styles.progresoRelleno} style={{ width: `${porciento}%` }} />
      </div>
      <p className={styles.pensando}>
        <span className={styles.porciento} aria-hidden="true">
          {porciento} %
        </span>
        <span aria-live="polite">{fraseDelPaso(estado.paso, titulo)}</span>
        <span className={styles.puntos} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </p>
    </article>
  )
}
