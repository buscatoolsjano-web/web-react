import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import { fechaBandeja } from '@/modules/emails/lib/formato'
import type { CorreoNombrado } from '../services/asistente'
import styles from './TarjetasCorreos.module.css'

export interface TarjetasCorreosProps {
  correos: readonly CorreoNombrado[]
}

/**
 * Los correos que el asistente nombró, como tarjetas con su botón (Fase 69).
 *
 * EL PROBLEMA QUE RESUELVE, que es el mismo que el de las tarjetas de producto
 * una fase antes. «¿Qué correos quedaron sin responder?» contestaba con
 * veinticinco renglones de «remitente — asunto — fecha — sin asignar», en
 * prosa. Para hacer algo con uno había que leer el renglón, acordarse del
 * asunto, cerrar el panel, ir a la bandeja y buscarlo. La respuesta era
 * correcta y no servía para nada.
 *
 * Ahora cada correo es una tarjeta: quién lo mandó, de qué se trata, cuándo
 * llegó, y «Ver mail» que abre ESE hilo. Los datos vienen ESTRUCTURADOS en la
 * respuesta —con el id del hilo—, no sacados del texto del modelo: el botón no
 * depende de que haya escrito un uuid sin equivocarse, que es la clase de cosa
 * que anda en las pruebas y falla en producción.
 */
export function TarjetasCorreos({ correos }: TarjetasCorreosProps) {
  if (correos.length === 0) return null

  return (
    <ul className={styles.lista} aria-label="Correos de la respuesta">
      {correos.map((c) => (
        <li key={c.id} className={c.sinLeer ? `${styles.tarjeta} ${styles.nuevo}` : styles.tarjeta}>
          <div className={styles.encabezado}>
            <span className={styles.de} title={c.de ?? undefined}>
              {quienEs(c.de)}
            </span>
            {c.fecha ? (
              <time className={styles.fecha} dateTime={c.fecha}>
                {fechaBandeja(c.fecha)}
              </time>
            ) : null}
          </div>

          <span className={styles.asunto}>{c.asunto}</span>

          {/*
            Lo de abajo sólo aparece cuando dice algo. Un «Sin asignar» en cada
            una de veinticinco tarjetas es ruido que se lee veinticinco veces;
            lo que importa marcar es lo excepcional: que no se leyó, que ya
            tiene dueño, que viene de un cliente conocido.
          */}
          {c.sinLeer || c.adjuntos || c.asignadoA !== null || c.cliente !== null ? (
            <span className={styles.marcas}>
              {c.sinLeer ? <span className={styles.sinLeer}>Sin leer</span> : null}
              {c.cliente !== null ? <span className={styles.dato}>{c.cliente}</span> : null}
              {c.asignadoA !== null ? <span className={styles.dato}>Asignado: {c.asignadoA}</span> : null}
              {c.adjuntos ? (
                <span className={styles.dato} title="Tiene adjuntos">
                  <Icon name="paperclip" size={16} />
                  <span className="sr-only">Tiene adjuntos</span>
                </span>
              ) : null}
            </span>
          ) : null}

          {/* Un link de verdad y no un botón: se puede abrir en otra pestaña
              sin perder la conversación con el asistente. */}
          <Link to={`/emails/${c.id}`} className={styles.ver}>
            <Icon name="mail" size={16} />
            Ver mail
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * El remitente como se lee, no como viaja.
 *
 * `last_message_from` llega en el formato del correo: `"Compras Mirgor"
 * <compras@mirgor.com.ar>`. Lo que identifica de un vistazo es el nombre; la
 * dirección entera va en el `title`, para cuando hace falta la exacta.
 */
function quienEs(de: string | null): string {
  if (de === null || de.trim() === '') return 'Remitente desconocido'
  const conNombre = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(de)
  return conNombre?.[1]?.trim() || de.trim()
}
