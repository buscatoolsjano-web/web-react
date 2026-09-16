import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MetaList, Missing } from '@/components/document/DocSection'
import { Icon } from '@/components/icons/Icon'
import type { DetalleConversacion } from '../types'
import styles from './Whatsapp.module.css'

export interface PanelClienteProps {
  conversacion: DetalleConversacion
  puedeAsignar: boolean
  usuarioId: string | null
  asignando: boolean
  onAsignar: (usuarioId: string | null) => void
}

const ORIGEN: Record<string, string> = {
  exacto: 'Vinculado por teléfono exacto',
  normalizado: 'Vinculado por coincidencia del número',
  manual: 'Vinculado a mano',
}

/**
 * Quién es el del otro lado y qué se puede hacer con eso.
 *
 * Las acciones son de NAVEGACIÓN: llevan a Ventas, no crean documentos desde
 * acá. Emitir una cotización tiene sus propios guardrails —la autoridad de
 * numeración, hoy en STEL— y un atajo desde WhatsApp sería justamente la forma
 * de saltárselos.
 */
export function PanelCliente({
  conversacion,
  puedeAsignar,
  usuarioId,
  asignando,
  onAsignar,
}: PanelClienteProps) {
  const c = conversacion
  const esMio = c.asignadoA !== null && c.asignadoA === usuarioId

  return (
    <aside className={styles.contexto} aria-label="Contexto del cliente">
      <section className={styles.bloque}>
        <h2 className={styles.bloqueTitulo}>Contacto</h2>
        <MetaList
          items={[
            { label: 'Perfil de WhatsApp', value: c.perfil ?? <Missing>Sin nombre</Missing> },
            { label: 'Teléfono', value: c.telefono ?? <Missing /> },
          ]}
        />
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.bloqueTitulo}>Cliente</h2>
        {c.clienteId ? (
          <>
            <MetaList
              items={[
                { label: 'Razón social', value: c.clienteNombre ?? <Missing /> },
                { label: 'Contacto', value: c.contactoNombre ?? <Missing>Sin contacto asignado</Missing> },
                { label: 'CUIT', value: c.clienteCuit ?? <Missing /> },
              ]}
            />
            {c.vinculoOrigen ? (
              <p className={styles.vinculo}>{ORIGEN[c.vinculoOrigen] ?? c.vinculoOrigen}</p>
            ) : null}
            <div className={styles.acciones}>
              <Link to={`/clientes/${c.clienteId}`} className={styles.accion}>
                <Icon name="external-link" size={16} /> Abrir cliente
              </Link>
              <Link to={`/ventas/cotizaciones?cliente=${c.clienteId}`} className={styles.accion}>
                <Icon name="external-link" size={16} /> Ver cotizaciones
              </Link>
              <Link to={`/ventas/pedidos?cliente=${c.clienteId}`} className={styles.accion}>
                <Icon name="external-link" size={16} /> Ver pedidos
              </Link>
            </div>
          </>
        ) : (
          <>
            <Badge tone="neutral" outline>Sin vincular</Badge>
            <p className={styles.sinVinculo}>
              Este número no coincide con ningún cliente, o coincide con más de uno. Cuando hay
              dudas <strong>no se vincula solo</strong>: una conversación atada al cliente
              equivocado es peor que una sin vincular.
            </p>
          </>
        )}
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.bloqueTitulo}>Asignación</h2>
        <p className={styles.asignado}>
          {c.asignadoNombre ? `A cargo: ${c.asignadoNombre}` : 'Sin asignar'}
        </p>
        {puedeAsignar ? (
          <div className={styles.acciones}>
            {!esMio && usuarioId ? (
              <Button variant="secondary" size="sm" loading={asignando} onClick={() => onAsignar(usuarioId)}>
                Asignarme
              </Button>
            ) : null}
            {c.asignadoA ? (
              <Button variant="ghost" size="sm" loading={asignando} onClick={() => onAsignar(null)}>
                Quitar asignación
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </aside>
  )
}
