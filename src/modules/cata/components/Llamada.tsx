import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { pedazos } from '@/modules/asistente/lib/formatoRespuesta'
import { useLlamada } from '../hooks/useLlamada'
import styles from './Llamada.module.css'

/**
 * La llamada con Cata (Fase 85).
 *
 * ── POR QUÉ SE PARECE A UN TELÉFONO Y NO A UN CHAT ──────────────────────────
 *
 * Porque es lo que es. En un chat la atención está en la caja de escribir; acá
 * no hay nada que escribir, así que el centro de la pantalla es el ESTADO: si
 * te está escuchando, si está pensando o si está hablando. Eso es lo único
 * que hay que saber mientras se habla.
 *
 * ── Y POR QUÉ LO DE ABAJO SÍ ES UN CHAT ─────────────────────────────────────
 *
 * «Que se note la diferencia, que sea como un chat verdadero.» La
 * transcripción tenía los dos lados pintados casi igual, y en una conversación
 * hablada eso importa más que en una escrita: no hay cursor ni nombre que
 * diga quién dijo qué, así que el único indicio es de qué lado está y de qué
 * color. Lo suyo va a la izquierda, con su nombre; lo de uno a la derecha.
 *
 * Es también donde se anota un SKU dictado: por eso al colgar no se borra.
 */
export function Llamada() {
  const l = useLlamada()
  const finDelHilo = useRef<HTMLDivElement>(null)

  /**
   * Mientras se habla, lo último dicho es lo que importa.
   *
   * La comprobación del tipo no es paranoia: `scrollIntoView` no está en
   * jsdom, así que sin ella el componente explota en los tests. Es el mismo
   * problema que ya tenía el chat del asistente.
   */
  useEffect(() => {
    const fin = finDelHilo.current
    if (typeof fin?.scrollIntoView === 'function') fin.scrollIntoView({ block: 'end' })
  }, [l.turnos, l.parcial])

  const activa = l.estado !== 'inactiva' && l.estado !== 'cortada'

  return (
    <div className={styles.pagina}>
      {/* ── El estado, grande ─────────────────────────────────────────────── */}
      <div className={styles.cartel}>
        <div className={`${styles.ruedo} ${activa ? styles[l.estado] : ''}`} aria-hidden="true">
          {/* El micrófono mientras le toca a uno —escuchando o buscando—; el
              teléfono el resto del tiempo. Es el mismo dato que el cartel,
              dicho con una forma: se ve de reojo sin leer. */}
          <Icon
            name={l.estado === 'escuchando' || l.estado === 'pensando' ? 'mic' : 'phone'}
            size={32}
          />
        </div>

        {/* `aria-live`: quien no ve la pantalla necesita saber cuándo le toca
            hablar, y es el único dato que cambia sin que nadie haga nada. */}
        <p className={styles.estado} aria-live="polite">
          {l.estado === 'inactiva' && 'Cata, el catálogo por teléfono'}
          {l.estado === 'escuchando' && 'Te escucho…'}
          {l.estado === 'pensando' && 'Buscando en el catálogo…'}
          {l.estado === 'hablando' && 'Hablando'}
          {l.estado === 'cortada' && 'Se cortó la llamada'}
        </p>

        <p className={styles.ayuda}>
          {l.estado === 'cortada' || (l.estado === 'inactiva' && l.error !== '')
            ? l.error
            : l.estado === 'inactiva'
              ? l.sePuede
                ? 'Sabe de productos: si existen, a cuánto están y si hay stock. De clientes y documentos no sabe nada: para eso está el Asistente Digital.'
                : l.porQueNo
              : l.parcial !== ''
                ? l.parcial
                : /* Que se puede interrumpir hay que decirlo: nadie le habla
                     encima a una máquina si no sabe que se la puede cortar. */
                  l.estado === 'hablando'
                  ? 'Hablá para interrumpirla.'
                  : 'Hablá tranquilo, el micrófono queda abierto.'}
        </p>

        {activa ? (
          <Button variant="danger" onClick={l.colgar}>
            <Icon name="phone" size={16} />
            Colgar
          </Button>
        ) : (
          <Button onClick={l.llamar} disabled={!l.sePuede}>
            <Icon name="phone" size={16} />
            Llamar a Cata
          </Button>
        )}
      </div>

      {/* ── La transcripción ──────────────────────────────────────────────── */}
      {l.turnos.length > 0 ? (
        <div className={styles.hilo}>
          {l.turnos.map((t, i) => (
            <div
              key={`${i}-${t.texto.slice(0, 12)}`}
              className={t.rol === 'usuario' ? styles.mio : styles.suyo}
            >
              {/* El nombre va sólo del lado de ella, y sólo cuando cambia de
                  lado: repetirlo en cada burbuja de una tanda es ruido, y del
                  lado propio no hace falta ninguno. */}
              {t.rol === 'cata' && l.turnos[i - 1]?.rol !== 'cata' ? (
                <span className={styles.quien}>Cata</span>
              ) : null}
              <p className={styles.burbuja}>
                {/* El modelo resalta con asteriscos aunque se le pida que no.
                    En la voz se los saca `textoParaDecir`; acá se RESALTA, que
                    es lo que quiso decir. Verlos crudos parece un error. */}
                {pedazos(t.texto).map((z, k) =>
                  z.negrita ? <strong key={k}>{z.texto}</strong> : <span key={k}>{z.texto}</span>,
                )}
              </p>
            </div>
          ))}
          {l.parcial !== '' ? (
            <div className={styles.mio}>
              <p className={`${styles.burbuja} ${styles.oyendo}`}>{l.parcial}</p>
            </div>
          ) : null}
          <div ref={finDelHilo} />
        </div>
      ) : null}

      {/* Lo que se paga y lo que no, dicho donde se decide usarlo. Escuchar y
          hablar los hace el navegador y son gratis; la respuesta la paga el
          mismo proveedor que el asistente escrito. */}
      <p className={styles.pie}>
        Escucha y habla con el navegador, sin costo. Sólo la respuesta usa la IA.
      </p>
    </div>
  )
}
