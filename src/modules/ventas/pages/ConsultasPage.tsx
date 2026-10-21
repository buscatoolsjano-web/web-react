import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { formatearFecha } from '@/modules/ventas/lib/formato'
import {
  listarConsultas,
  marcarConsulta,
  type Consulta,
  type EstadoConsulta,
} from '../services/consultas'
import styles from './ConsultasPage.module.css'

/**
 * Las consultas del sitio público, para atenderlas (Fase 87 · E4).
 *
 * «Que nos llegue a nosotros en el ERP.» Acá llega: cada pedido de cotización
 * que alguien dejó sin iniciar sesión, con sus datos de contacto y lo que
 * tenía en la lista. Desde acá se marca «contactada» cuando se le escribió, y
 * «cerrada» cuando terminó —así deja de aparecer en el aviso de la campana—.
 *
 * ── POR QUÉ UN FILTRO Y NO TRES LISTAS ──────────────────────────────────────
 *
 * Porque es la misma lista mirada por su estado, y lo que importa casi siempre
 * son las nuevas: son un cliente esperando respuesta. Arranca en «nuevas» y
 * desde ahí se puede ver el resto.
 */
const FILTROS: { valor: EstadoConsulta | 'todas'; etiqueta: string }[] = [
  { valor: 'nueva', etiqueta: 'Nuevas' },
  { valor: 'contactada', etiqueta: 'Contactadas' },
  { valor: 'cerrada', etiqueta: 'Cerradas' },
  { valor: 'todas', etiqueta: 'Todas' },
]

export function ConsultasPage() {
  const companyId = useEmpresa().activa?.companyId ?? null
  const qc = useQueryClient()
  const [filtro, setFiltro] = useState<EstadoConsulta | 'todas'>('nueva')

  const q = useQuery({
    queryKey: ['consultas', companyId, filtro],
    queryFn: () => listarConsultas(companyId!, filtro),
    enabled: companyId !== null,
  })

  const cambiar = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoConsulta }) =>
      marcarConsulta(id, estado),
    onSuccess: () => {
      // Se recarga la lista y el contador de la campana, que comparte estos
      // datos: marcar una contactada tiene que bajar el globito también.
      void qc.invalidateQueries({ queryKey: ['consultas', companyId] })
      void qc.invalidateQueries({ queryKey: ['notificaciones', companyId] })
    },
  })

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Consultas del sitio"
        subtitle="Pedidos de cotización que llegaron del catálogo público"
        subtitleInline
      />

      <div className={styles.filtros} role="tablist" aria-label="Estado">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="tab"
            aria-selected={filtro === f.valor}
            className={filtro === f.valor ? styles.filtroActivo : styles.filtro}
            onClick={() => setFiltro(f.valor)}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <div className={styles.centrado} role="status">
          <Spinner size={24} />
        </div>
      ) : q.isError ? (
        <ErrorState title="No se pudieron cargar las consultas." onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className={styles.vacio}>
          {filtro === 'nueva'
            ? 'No hay consultas sin atender. Cuando alguien pida una cotización desde el catálogo, aparece acá.'
            : 'No hay consultas en este estado.'}
        </p>
      ) : (
        <ul className={styles.lista}>
          {q.data.map((c) => (
            <TarjetaConsulta
              key={c.id}
              consulta={c}
              cambiando={cambiar.isPending && cambiar.variables?.id === c.id}
              onMarcar={(estado) => cambiar.mutate({ id: c.id, estado })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TarjetaConsulta({
  consulta: c,
  cambiando,
  onMarcar,
}: {
  consulta: Consulta
  cambiando: boolean
  onMarcar: (estado: EstadoConsulta) => void
}) {
  // El asunto y el cuerpo de un mail armado con los datos de la consulta: un
  // clic y se contesta, sin copiar y pegar.
  const asunto = encodeURIComponent('Tu consulta en Buscatools')
  const cuerpo = encodeURIComponent(`Hola ${c.nombre.split(' ')[0] ?? ''},\n\n`)

  return (
    <li className={`${styles.tarjeta} ${styles[`estado_${c.estado}`] ?? ''}`}>
      <div className={styles.cabecera}>
        <div>
          <p className={styles.quien}>
            {c.nombre}
            {c.empresa ? <span className={styles.empresa}> · {c.empresa}</span> : null}
          </p>
          <p className={styles.contacto}>
            <a href={`mailto:${c.email}?subject=${asunto}&body=${cuerpo}`}>{c.email}</a>
            {c.telefono ? <span> · {c.telefono}</span> : null}
          </p>
        </div>
        <div className={styles.meta}>
          <span className={styles.chip} data-estado={c.estado}>
            {c.estado === 'nueva' ? 'Nueva' : c.estado === 'contactada' ? 'Contactada' : 'Cerrada'}
          </span>
          <time className={styles.fecha}>{formatearFecha(c.cuando)}</time>
        </div>
      </div>

      {c.mensaje ? <p className={styles.mensaje}>{c.mensaje}</p> : null}

      {c.items.length > 0 ? (
        <table className={styles.items}>
          <tbody>
            {c.items.map((i) => (
              <tr key={i.sku}>
                <td className={styles.itemCant}>{i.cantidad}×</td>
                <td className={styles.itemSku}>{i.sku}</td>
                <td className={styles.itemNombre}>{i.nombre}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className={styles.acciones}>
        {c.estado !== 'contactada' ? (
          <button
            type="button"
            className={styles.accion}
            disabled={cambiando}
            onClick={() => onMarcar('contactada')}
          >
            <Icon name="check" size={16} /> Marcar contactada
          </button>
        ) : null}
        {c.estado !== 'cerrada' ? (
          <button
            type="button"
            className={styles.accionGhost}
            disabled={cambiando}
            onClick={() => onMarcar('cerrada')}
          >
            Cerrar
          </button>
        ) : null}
        {c.estado !== 'nueva' ? (
          <button
            type="button"
            className={styles.accionGhost}
            disabled={cambiando}
            onClick={() => onMarcar('nueva')}
          >
            Reabrir
          </button>
        ) : null}
      </div>
    </li>
  )
}
