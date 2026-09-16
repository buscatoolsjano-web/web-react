import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { cx } from '@/utils/cx'
import { nombreVisible } from '../lib/nombre'
import { presentarVentana } from '../lib/ventana'
import { FILTROS, type ConversacionListado, type FiltroBandeja } from '../types'
import styles from './Whatsapp.module.css'

export interface ListaConversacionesProps {
  conversaciones: readonly ConversacionListado[]
  cargando: boolean
  seleccionada: string | null
  filtro: FiltroBandeja
  onFiltro: (f: FiltroBandeja) => void
  onElegir: (id: string) => void
}

/** `HH:mm` si es de hoy, `DD/MM` si no. Lo que se mira de un vistazo. */
function cuando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hoy = new Date()
  const mismoDia =
    d.getDate() === hoy.getDate() && d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear()
  return new Intl.DateTimeFormat('es-AR', mismoDia ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { day: '2-digit', month: '2-digit' }).format(d)
}

export function ListaConversaciones({
  conversaciones,
  cargando,
  seleccionada,
  filtro,
  onFiltro,
  onElegir,
}: ListaConversacionesProps) {
  return (
    <div className={styles.lista}>
      <div className={styles.filtros} role="group" aria-label="Filtrar conversaciones">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            className={cx(styles.filtro, filtro === f.valor && styles.filtroActivo)}
            aria-pressed={filtro === f.valor}
            onClick={() => onFiltro(f.valor)}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className={styles.listaCarga}>
          <SkeletonRows rows={5} columns={1} label="Cargando conversaciones…" />
        </div>
      ) : conversaciones.length === 0 ? (
        <EmptyState
          icon="message-circle"
          title={filtro === 'todos' ? 'Todavía no hay conversaciones' : 'No hay conversaciones con ese filtro'}
          description={
            filtro === 'todos'
              ? 'Cuando alguien le escriba al número de la empresa, la conversación aparece acá.'
              : 'Probá con «Todos».'
          }
        />
      ) : (
        <ul className={styles.listaItems}>
          {conversaciones.map((c) => {
            const ventana = presentarVentana(c.ventanaVenceEn)
            const nombre = nombreVisible(c)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={cx(styles.item, seleccionada === c.id && styles.itemActivo)}
                  aria-current={seleccionada === c.id ? 'true' : undefined}
                  onClick={() => onElegir(c.id)}
                >
                  <span className={styles.itemFila}>
                    <span className={styles.itemNombre}>{nombre}</span>
                    <span className={styles.itemHora}>{cuando(c.ultimoMensajeEn)}</span>
                  </span>

                  <span className={styles.itemFila}>
                    <span className={styles.itemPreview}>
                      {c.ultimaDireccion === 'out' ? <span className={styles.itemSalida}>Vos: </span> : null}
                      {c.ultimoMensaje ?? 'Sin mensajes'}
                    </span>
                    {c.noLeidos > 0 ? (
                      <span className={styles.itemNoLeidos}>
                        {c.noLeidos}
                        <span className="sr-only"> mensajes sin leer</span>
                      </span>
                    ) : null}
                  </span>

                  <span className={styles.itemEtiquetas}>
                    {c.clienteNombre ? null : <Badge tone="neutral" outline>Sin vincular</Badge>}
                    {c.asignadoNombre ? <Badge tone="info">{c.asignadoNombre}</Badge> : null}
                    {ventana.estado === 'cerrada' ? <Badge tone="warning">Ventana cerrada</Badge> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
