import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Spinner } from '@/components/ui/Spinner'
import type { AccionesPosibles } from '../lib/seleccion'
import styles from './Emails.module.css'

export interface BarraSeleccionProps {
  acciones: AccionesPosibles
  trabajando: boolean
  onMarcarLeidos: () => void
  onEliminar: () => void
  onRestaurar: () => void
  onLimpiar: () => void
}

/**
 * Qué hacer con los hilos elegidos (Fase 59 · E3).
 *
 * Aparece SÓLO con algo elegido. Una barra siempre visible con todo apagado
 * ocupa el lugar donde se leen los correos para no ofrecer nada.
 *
 * Los botones que no aplican no se dibujan, en vez de dibujarse grises:
 * «marcar como leído» cuando ya están todos leídos no es algo que esté
 * temporalmente impedido, es algo que no tiene sentido pedir. Eliminar y
 * restaurar son la misma acción en dos sentidos y nunca aparecen juntas.
 */
export function BarraSeleccion({
  acciones,
  trabajando,
  onMarcarLeidos,
  onEliminar,
  onRestaurar,
  onLimpiar,
}: BarraSeleccionProps) {
  if (acciones.cuantas === 0) return null

  return (
    /*
     * `role="status"` y no una región cualquiera: que un lector de pantalla
     * anuncie cuántos quedaron elegidos al marcar o desmarcar, que es lo único
     * que se ve en pantalla cuando cambia la cuenta.
     */
    <div className={styles.barraSeleccion} role="status">
      <span className={styles.seleccionCuenta}>
        {acciones.cuantas === 1 ? '1 hilo elegido' : `${acciones.cuantas} hilos elegidos`}
      </span>

      {trabajando ? <Spinner size={16} /> : null}

      {acciones.marcarLeido ? (
        <Button variant="secondary" onClick={onMarcarLeidos} disabled={trabajando} icon={<Icon name="check" size={16} />}>
          {/* Dice cuántos VAN A CAMBIAR, no cuántos hay elegidos: si de 5
              elegidos hay 2 sin leer, el botón toca 2. */}
          Marcar {acciones.sinLeer === 1 ? '1' : `los ${acciones.sinLeer}`} como leído
          {acciones.sinLeer === 1 ? '' : 's'}
        </Button>
      ) : null}

      {acciones.eliminar ? (
        <Button variant="ghost" onClick={onEliminar} disabled={trabajando} icon={<Icon name="trash" size={16} />}>
          Eliminar{acciones.aEliminar < acciones.cuantas ? ' ' + acciones.aEliminar : ''}
        </Button>
      ) : null}

      {/* El mismo ícono que usa la acción de una sola fila, para que se lea
          como la misma acción hecha a varios. */}
      {acciones.restaurar ? (
        <Button variant="ghost" onClick={onRestaurar} disabled={trabajando} icon={<Icon name="refresh" size={16} />}>
          Restaurar{acciones.aRestaurar < acciones.cuantas ? ' ' + acciones.aRestaurar : ''}
        </Button>
      ) : null}

      <Button variant="ghost" onClick={onLimpiar} disabled={trabajando}>
        Quitar la selección
      </Button>
    </div>
  )
}
