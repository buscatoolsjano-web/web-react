import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { useBuscarClientesParaFiltro, useNombreDeCliente } from '../hooks/useDocumentos'
import styles from './FiltroCliente.module.css'

export interface FiltroClienteProps {
  /** El cliente por el que se está filtrando, o `null` por todos. */
  valor: string | null
  onElegir: (id: string | null) => void
}

/**
 * Filtrar el listado por cliente, escribiendo (Fase 40).
 *
 * Antes era un `<select>` con los primeros 500 clientes por orden alfabético.
 * Dos problemas, y el segundo es el grave:
 *
 * 1. Mil opciones no se eligen scrolleando, y en el teléfono menos.
 * 2. El maestro tiene 1.010, así que **faltaban 510**: la lista se cortaba en
 *    «Industrial Deckert S.R.L.» y se veía completa igual. Whirlpool es el
 *    puesto 994 y tiene 29 cotizaciones; quien las buscara por cliente
 *    concluía que no existían.
 *
 * Se parece al buscador del alta a propósito —es el mismo gesto en toda la
 * app—, pero no es el mismo: éste ofrece también los clientes dados de baja,
 * marcados, porque sus documentos siguen existiendo y hay que poder llegar a
 * ellos.
 */
export function FiltroCliente({ valor, onElegir }: FiltroClienteProps) {
  const id = useId()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  const caja = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)

  // Se escribe letra por letra: se espera a que la persona pare antes de
  // pedirle nada al servidor.
  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])

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

  const elegido = useNombreDeCliente(valor)
  const resultados = useBuscarClientesParaFiltro(consulta, abierto)

  const termino = consulta.trim()
  const opciones = resultados.data ?? []
  const sinCoincidencias = termino.length >= 2 && !resultados.isFetching && opciones.length === 0

  function cerrar() {
    setAbierto(false)
    disparador.current?.focus()
  }

  function elegir(nuevo: string | null) {
    onElegir(nuevo)
    setTexto('')
    setConsulta('')
    cerrar()
  }

  /**
   * Qué dice el botón cuando está cerrado.
   *
   * Con un cliente elegido tiene que decir CUÁL: es el único lugar donde se ve
   * que el listado está recortado, y un filtro invisible hace que alguien jure
   * que un documento no existe.
   */
  const etiqueta =
    valor === null
      ? 'Todos los clientes'
      : elegido.isPending
        ? 'Cargando…'
        : (elegido.data?.nombre ?? 'Cliente no accesible')

  return (
    <div className={styles.caja} ref={caja}>
      <button
        type="button"
        ref={disparador}
        className={styles.disparador}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={valor === null ? 'Filtrar por cliente' : `Filtrado por ${etiqueta}. Cambiar el cliente`}
        onClick={() => setAbierto((v) => !v)}
      >
        <span className={valor === null ? styles.todos : styles.nombre}>{etiqueta}</span>
        {elegido.data?.dadoDeBaja ? <span className={styles.baja}>de baja</span> : null}
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
            id={id}
            type="search"
            className={styles.entrada}
            value={texto}
            placeholder="Nombre, CUIT o referencia…"
            aria-label="Buscar cliente"
            autoFocus
            onChange={(e) => setTexto(e.target.value)}
          />

          <ul className={styles.lista} role="listbox" aria-label="Clientes">
            {/* Siempre primero: quitar el filtro es lo que más se hace una vez
                puesto, y mandarlo al final de una lista que cambia de largo lo
                dejaría en un lugar distinto cada vez. */}
            <li>
              <button
                type="button"
                role="option"
                aria-selected={valor === null}
                className={styles.opcion}
                onClick={() => elegir(null)}
              >
                Todos los clientes
              </button>
            </li>

            {opciones.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === valor}
                  className={styles.opcion}
                  onClick={() => elegir(c.id)}
                >
                  {c.referencia ? <span className={styles.referencia}>{c.referencia}</span> : null}
                  <span className={styles.opcionNombre}>{c.nombre}</span>
                  {c.dadoDeBaja ? <span className={styles.baja}>de baja</span> : null}
                </button>
              </li>
            ))}

            {resultados.error ? (
              <li className={styles.nota} role="alert">
                {resultados.error.message}
              </li>
            ) : resultados.isFetching ? (
              <li className={styles.nota}>Buscando…</li>
            ) : sinCoincidencias ? (
              <li className={styles.nota}>Ningún cliente coincide.</li>
            ) : termino.length < 2 ? (
              <li className={styles.nota}>Escribí al menos dos letras.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
