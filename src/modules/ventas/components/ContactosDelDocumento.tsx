import { Icon } from '@/components/icons/Icon'
import { detalleDeContacto } from '../lib/contactos'
import type { OpcionContacto } from '../services/opciones'
import { BuscadorContacto } from './BuscadorContacto'
import styles from './ContactosDelDocumento.module.css'

export interface ContactosDelDocumentoProps {
  contactos: readonly OpcionContacto[]
  /** El principal. `''` si el documento no tiene ninguno. */
  principal: string
  /** Los demás, en el orden en que se muestran y se imprimen. */
  secundarios: readonly string[]
  disabled?: boolean | undefined
  cargando?: boolean | undefined
  onCambiar: (principal: string, secundarios: string[]) => void
}

/**
 * El equipo del cliente que sigue esta venta (Fase 40).
 *
 * Una venta la siguen dos o tres personas —el de compras que pide, el
 * ingeniero que especifica, el de pagos que recibe la factura— y hasta ahora
 * había que elegir a una y escribir las otras en las observaciones, donde no
 * sirven para nada: no se puede filtrar por ellas ni mandarles el documento.
 *
 * **El principal se distingue de los demás, y no es decoración.** Es el que
 * viaja en `contact_id`, el que sale impreso como «Contacto» y el que usan el
 * sync de STEL y el módulo de emails. Los secundarios acompañan.
 *
 * Cambiar quién es el principal es UN clic sobre la estrella del que
 * corresponda: el que estaba baja a secundario solo. Esa es la operación que
 * más se repite —«ahora lo lleva Juan»— y por eso no está escondida en un
 * menú ni pide confirmación.
 *
 * Todo esto es estado del borrador: no se escribe hasta que se guarda el
 * documento, como cualquier otro campo de la cabecera.
 */
export function ContactosDelDocumento({
  contactos,
  principal,
  secundarios,
  disabled = false,
  cargando = false,
  onCambiar,
}: ContactosDelDocumentoProps) {
  const porId = new Map(contactos.map((c) => [c.id, c]))
  const elegidos = [principal, ...secundarios].filter((id) => id !== '')

  /**
   * Agregar.
   *
   * El primero que entra es el principal: un documento con secundarios y sin
   * principal es una cabecera que se imprime sin contacto, y nadie lo quiso
   * así; lo quiso quien agregó al primero de la lista.
   */
  const agregar = (id: string) => {
    if (id === '' || elegidos.includes(id)) return
    if (principal === '') onCambiar(id, [...secundarios])
    else onCambiar(principal, [...secundarios, id])
  }

  /**
   * Hacer principal: un intercambio, no dos pasos.
   *
   * El que estaba sube a la lista de secundarios en el lugar del que baja, así
   * la lista no se reordena sola debajo del cursor.
   */
  const hacerPrincipal = (id: string) => {
    const resto = secundarios.filter((x) => x !== id)
    onCambiar(id, principal === '' ? resto : [...resto, principal])
  }

  const quitar = (id: string) => {
    if (id === principal) {
      // Al sacar al principal, el primer secundario ocupa su lugar. Dejar el
      // documento con secundarios y sin principal sería dejarlo peor.
      const [primero, ...resto] = secundarios
      onCambiar(primero ?? '', resto)
      return
    }
    onCambiar(principal, secundarios.filter((x) => x !== id))
  }

  return (
    <div className={styles.caja}>
      {elegidos.length === 0 ? (
        <p className={styles.vacio}>
          {cargando ? 'Cargando…' : 'Sin contactos. Agregá al menos uno si querés que figure en el documento.'}
        </p>
      ) : (
        <ul className={styles.lista}>
          {elegidos.map((id) => {
            const c = porId.get(id)
            const esPrincipal = id === principal
            const nombre = c?.nombre ?? 'Contacto no accesible'
            const detalle = c ? detalleDeContacto(c) : ''
            return (
              <li key={id} className={esPrincipal ? styles.itemPrincipal : styles.item}>
                <div className={styles.quien}>
                  <span className={styles.nombre}>
                    {nombre}
                    {esPrincipal ? <span className={styles.marca}>Principal</span> : null}
                    {c && !c.activo ? <span className={styles.inactivo}>desactivado</span> : null}
                  </span>
                  {detalle ? <span className={styles.detalle}>{detalle}</span> : null}
                </div>

                {disabled ? null : (
                  <div className={styles.acciones}>
                    {/* La estrella llena/vacía dice de un vistazo quién manda,
                        y tocarla es la operación que más se repite. */}
                    <button
                      type="button"
                      className={esPrincipal ? styles.estrellaActiva : styles.estrella}
                      aria-pressed={esPrincipal}
                      disabled={esPrincipal}
                      title={esPrincipal ? 'Es el contacto principal' : `Hacer principal a ${nombre}`}
                      aria-label={esPrincipal ? `${nombre} es el principal` : `Hacer principal a ${nombre}`}
                      onClick={() => hacerPrincipal(id)}
                    >
                      <Icon name="star" size={16} />
                    </button>
                    <button
                      type="button"
                      className={styles.quitar}
                      aria-label={`Quitar a ${nombre} del documento`}
                      title="Quitar del documento"
                      onClick={() => quitar(id)}
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
        <BuscadorContacto
          modo="agregar"
          contactos={contactos}
          valor=""
          excluir={elegidos}
          cargando={cargando}
          onElegir={agregar}
        />
      )}
    </div>
  )
}
