import { useNavigate } from 'react-router-dom'
import { Dialog } from '@/components/modals/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { DESTINOS, cruzaDeLado, rutaDeCopia, type TipoCopiable } from '@/services/copiarDocumento'
import styles from './DialogoDuplicarComo.module.css'

/**
 * Elegir en qué documento convertir la copia (Fase 233).
 *
 * Cada opción abre el ALTA de ese documento con las líneas ya cargadas: nada
 * se guarda hasta apretar «Crear». Cuando se cruza de venta a compra (o al
 * revés) se dice qué pasa con el precio, que es lo único que no viaja igual.
 */
export function DialogoDuplicarComo({
  origen,
  id,
  numero,
  onCerrar,
}: {
  origen: TipoCopiable
  id: string
  numero: string | null
  onCerrar: () => void
}) {
  const navegar = useNavigate()
  const destinos = DESTINOS.filter((d) => d.tipo !== origen)

  return (
    <Dialog
      open
      onClose={onCerrar}
      title={numero ? `Duplicar ${numero} como…` : 'Duplicar como…'}
      description="Se abre el documento nuevo con las mismas líneas. Revisalo y guardalo: hasta entonces no se crea nada."
      size="sm"
      footer={
        <Button variant="secondary" onClick={onCerrar}>
          Cancelar
        </Button>
      }
    >
      <ul className={styles.lista}>
        {destinos.map((d) => (
          <li key={d.tipo}>
            <button
              type="button"
              className={`${styles.opcion} ${d.lado === 'compra' ? styles.compra : styles.venta}`}
              onClick={() => {
                onCerrar()
                void navegar(rutaDeCopia(d.tipo, origen, id))
              }}
            >
              <span className={styles.icono} aria-hidden="true">
                <Icon name={d.lado === 'compra' ? 'truck' : 'cart'} size={20} />
              </span>
              <span className={styles.texto}>
                <span className={styles.nombre}>{d.nombre}</span>
                <span className={styles.nota}>
                  {cruzaDeLado(origen, d.tipo)
                    ? d.lado === 'compra'
                      ? 'Elegís el proveedor; el precio de compra se escribe (con el último pagado al lado).'
                      : 'Elegís el cliente; el precio sale de la tarifa.'
                    : 'Mismas líneas y precios; elegís o confirmás el cliente.'}
                </span>
              </span>
              <Icon name="chevron-right" size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
