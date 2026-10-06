import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import {
  contactosOfrecidos,
  detalleDeContacto,
  etiquetaDeContacto,
  filtrarContactos,
} from '../lib/contactos'
import type { OpcionContacto } from '../services/opciones'
import styles from './BuscadorContacto.module.css'

export interface BuscadorContactoProps {
  contactos: readonly OpcionContacto[]
  /** El contacto del documento, o `''` si no tiene. */
  valor: string
  disabled?: boolean | undefined
  cargando?: boolean | undefined
  /**
   * Qué hace el control (Fase 40).
   *
   * `elegir`: es EL campo del documento, muestra cuál está elegido y ofrece
   * «Sin contacto» para vaciarlo.
   *
   * `agregar`: es el botón de sumar a una lista que se ve al lado. No muestra
   * ninguno elegido —los elegidos están en la lista— y no ofrece vaciar, que
   * ahí lo hace el «Quitar» de cada uno.
   */
  modo?: 'elegir' | 'agregar' | undefined
  /** Los que ya están en la lista: no se vuelven a ofrecer. */
  excluir?: readonly string[] | undefined
  onElegir: (id: string) => void
}

/**
 * Elegir el contacto del documento, escribiendo (Fase 40).
 *
 * Antes era un `<select>`. Con dos o tres contactos daba igual; el cliente más
 * poblado del maestro tiene **22**, y veintidós nombres en un desplegable se
 * recorren a ciegas, sobre todo en el teléfono.
 *
 * Se busca por nombre, cargo, email y teléfono —muchas veces lo que uno
 * recuerda es el mail y no el apellido— y cada opción muestra el cargo y el
 * email debajo, que es lo que distingue a dos homónimos. El `<select>` sólo
 * podía mostrar una línea de texto plano.
 *
 * El filtro es en memoria: los contactos del cliente ya están cargados y son
 * pocos. Pedirle al servidor una búsqueda sobre tres filas que están en
 * pantalla sería agregar latencia para no ganar nada.
 */
export function BuscadorContacto({
  contactos,
  valor,
  disabled = false,
  cargando = false,
  modo = 'elegir',
  excluir,
  onElegir,
}: BuscadorContactoProps) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const caja = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)

  // Cerrar al tocar afuera. `pointerdown` y no `click` para que el panel no
  // siga abierto mientras se arrastra sobre la página.
  useEffect(() => {
    if (!abierto) return
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('pointerdown', afuera)
    return () => document.removeEventListener('pointerdown', afuera)
  }, [abierto])

  const agregando = modo === 'agregar'
  const elegidoId = valor === '' ? null : valor
  const yaEstan = new Set(excluir ?? [])
  const ofrecidos = contactosOfrecidos(contactos, elegidoId).filter((c) => !yaEstan.has(c.id))
  const elegido = agregando ? undefined : contactos.find((c) => c.id === valor)
  const coincidencias = filtrarContactos(ofrecidos, texto)

  function cerrar() {
    setAbierto(false)
    disparador.current?.focus()
  }

  function elegir(id: string) {
    onElegir(id)
    setTexto('')
    cerrar()
  }

  return (
    <div className={styles.caja} ref={caja}>
      <button
        type="button"
        ref={disparador}
        className={styles.disparador}
        disabled={disabled || cargando}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={
          agregando
            ? 'Agregar contacto'
            : elegido
              ? `Contacto: ${elegido.nombre}. Cambiarlo`
              : 'Elegir contacto'
        }
        onClick={() => {
          setTexto('')
          setAbierto((v) => !v)
        }}
      >
        <span className={elegido ? styles.nombre : styles.vacio}>
          {cargando ? 'Cargando…' : agregando ? 'Agregar contacto…' : etiquetaDeContacto(elegido)}
        </span>
        {elegido && !elegido.activo ? <span className={styles.inactivo}>desactivado</span> : null}
        <Icon name="chevron-down" size={16} className={styles.flecha} />
      </button>

      {abierto ? (
        <div
          className={styles.panel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cerrar()
          }}
        >
          <input
            type="search"
            className={styles.entrada}
            value={texto}
            placeholder="Nombre, cargo, email o teléfono…"
            aria-label="Buscar contacto"
            autoFocus
            onChange={(e) => setTexto(e.target.value)}
          />

          <ul className={styles.lista} role="listbox" aria-label="Contactos del cliente">
            {/* «Sin contacto» va primero y siempre: quitarlo es lo que más se
                hace una vez puesto, y mandarlo al final de una lista que cambia
                de largo lo dejaría en un lugar distinto cada vez.

                En modo «agregar» no existe: vaciar es el «Quitar» de cada uno
                en la lista de al lado, y una opción que hace lo mismo que otro
                botón a diez píxeles es una forma de confundir. */}
            {agregando ? null : (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={valor === ''}
                  className={styles.opcion}
                  onClick={() => elegir('')}
                >
                  Sin contacto
                </button>
              </li>
            )}

            {coincidencias.map((c) => {
              const detalle = detalleDeContacto(c)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.id === valor}
                    className={styles.opcion}
                    onClick={() => elegir(c.id)}
                  >
                    <span className={styles.opcionNombre}>
                      {c.nombre}
                      {c.esPrincipal ? <span className={styles.principal}>principal</span> : null}
                      {c.activo ? null : <span className={styles.inactivo}>desactivado</span>}
                    </span>
                    {detalle ? <span className={styles.detalle}>{detalle}</span> : null}
                  </button>
                </li>
              )
            })}

            {coincidencias.length === 0 ? (
              <li className={styles.nota}>
                {ofrecidos.length === 0
                  ? agregando && contactos.length > 0
                    ? 'Ya están todos en el documento.'
                    : 'Este cliente todavía no tiene contactos cargados.'
                  : 'Ningún contacto coincide.'}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
