import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import {
  agregarAlEquipo,
  hacerPrincipal,
  integrantes,
  quitarDelEquipo,
  type Equipo,
} from '../lib/equipo'
import type { OpcionVendedor } from '../services/opciones'
import styles from './ContactosDelDocumento.module.css'

export interface VendedoresDelDocumentoProps {
  vendedores: readonly OpcionVendedor[]
  /** El vendedor principal. `''` si el documento no tiene ninguno. */
  principal: string
  /** Los que acompañan, en orden. */
  acompanan: readonly string[]
  disabled?: boolean | undefined
  onCambiar: (principal: string, acompanan: string[]) => void
}

/**
 * Quién se lleva esta venta (Fase 40).
 *
 * Pasa seguido: uno abre la cuenta y otro la sigue, o la venta técnica la
 * lleva una persona y la comercial otra. Hasta ahora el documento tenía UN
 * vendedor y el otro no figuraba en ningún lado: no aparecía en los rankings,
 * no se podía filtrar por él y, a la hora de repartir, no había dato.
 *
 * **El principal se distingue, y no es decoración.** Es el que viaja en
 * `salesperson_id`, el que cuenta en los informes y el que sale impreso. Los
 * demás acompañan.
 *
 * Comparte el estilo y las reglas con el equipo de contactos —`lib/equipo`—
 * porque es el mismo gesto: uno manda, los demás acompañan, y ascender a
 * alguien es un clic. Lo que cambia es de dónde sale la gente: ahí del
 * cliente, acá de la empresa.
 *
 * La lista es corta —son los miembros de la empresa que venden— así que es un
 * desplegable y no un buscador: con cinco nombres, un campo de búsqueda es un
 * control de más que hay que mirar y descartar.
 */
export function VendedoresDelDocumento({
  vendedores,
  principal,
  acompanan,
  disabled = false,
  onCambiar,
}: VendedoresDelDocumentoProps) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!abierto) return
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('pointerdown', afuera)
    return () => document.removeEventListener('pointerdown', afuera)
  }, [abierto])

  const porId = new Map(vendedores.map((v) => [v.id, v]))
  const equipo: Equipo = { principal, acompanan: [...acompanan] }
  const elegidos = integrantes(equipo)
  const aplicar = (e: Equipo) => onCambiar(e.principal, e.acompanan)
  const disponibles = vendedores.filter((v) => !elegidos.includes(v.id))

  return (
    <div className={styles.caja} ref={caja}>
      {elegidos.length === 0 ? (
        <p className={styles.vacio}>Sin vendedor asignado.</p>
      ) : (
        <ul className={styles.lista}>
          {elegidos.map((id) => {
            const v = porId.get(id)
            const esPrincipal = id === principal
            const nombre = v?.nombre ?? 'Usuario no accesible'
            return (
              <li key={id} className={esPrincipal ? styles.itemPrincipal : styles.item}>
                <div className={styles.quien}>
                  <span className={styles.nombre}>
                    {nombre}
                    {esPrincipal ? <span className={styles.marca}>Principal</span> : null}
                  </span>
                </div>

                {disabled ? null : (
                  <div className={styles.acciones}>
                    <button
                      type="button"
                      className={esPrincipal ? styles.estrellaActiva : styles.estrella}
                      aria-pressed={esPrincipal}
                      disabled={esPrincipal}
                      title={esPrincipal ? 'Es el vendedor principal' : `Hacer principal a ${nombre}`}
                      aria-label={esPrincipal ? `${nombre} es el principal` : `Hacer principal a ${nombre}`}
                      onClick={() => aplicar(hacerPrincipal(equipo, id))}
                    >
                      <Icon name="star" size={16} />
                    </button>
                    <button
                      type="button"
                      className={styles.quitar}
                      aria-label={`Quitar a ${nombre} de la venta`}
                      title="Quitar de la venta"
                      onClick={() => aplicar(quitarDelEquipo(equipo, id))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {disabled ? null : (
        <div className={styles.caja}>
          <button
            type="button"
            ref={disparador}
            className={styles.agregar}
            aria-haspopup="listbox"
            aria-expanded={abierto}
            aria-label="Agregar vendedor"
            disabled={disponibles.length === 0}
            onClick={() => setAbierto((x) => !x)}
          >
            <Icon name="plus" size={16} />
            {disponibles.length === 0 ? 'Ya están todos' : 'Agregar vendedor'}
          </button>

          {abierto ? (
            <ul
              className={styles.opciones}
              role="listbox"
              aria-label="Vendedores de la empresa"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setAbierto(false)
                  disparador.current?.focus()
                }
              }}
            >
              {disponibles.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={styles.opcion}
                    onClick={() => {
                      aplicar(agregarAlEquipo(equipo, v.id))
                      setAbierto(false)
                      disparador.current?.focus()
                    }}
                  >
                    {v.nombre}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}
