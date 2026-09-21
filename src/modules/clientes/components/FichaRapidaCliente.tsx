import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { escribeVentas } from '@/modules/ventas/lib/permisos'
import { motivoBloqueo } from '@/modules/ventas/lib/autoridad'
import { useAperturaDeAlta, type AperturaDeAlta } from '@/modules/ventas/hooks/useAperturaDeAlta'
import { useAutoridadNumeracion } from '@/modules/ventas/hooks/useAutoridadNumeracion'
import { useCliente360 } from '../hooks/useCliente360'
import { nombreDelMes } from '../lib/kpis'
import { formatearCuit, formatearFecha, formatearImporte, nombreVisible } from '../lib/formato'
import type { Cliente360, DocumentoReciente, TipoDeDocumento } from '../types'
import { GraficoDoceMeses } from './GraficoDoceMeses'
import { KpisComerciales } from './KpisComerciales'
import styles from './FichaRapidaCliente.module.css'

export interface FichaRapidaClienteProps {
  clienteId: string
  /** El id del encabezado, para que el panel lo use en `aria-labelledby`. */
  tituloId?: string
}

const RUTA: Record<TipoDeDocumento, string> = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
  entrega: '/ventas/entregas',
}

const TITULO_DOC: Record<TipoDeDocumento, string> = {
  cotizacion: 'Última cotización',
  pedido: 'Último pedido',
  entrega: 'Última nota de entrega',
}

/** Los estados que devuelve la base, en castellano y sin inventar ninguno. */
const ESTADO: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  pending: 'Pendiente',
  partially_reserved: 'Reservado en parte',
  reserved: 'Reservado',
  partially_delivered: 'Entregado en parte',
  delivered: 'Entregado',
  shipped: 'Despachado',
}

const tono = (estado: string | null): 'neutral' | 'success' | 'warning' | 'danger' => {
  if (estado === 'accepted' || estado === 'confirmed' || estado === 'delivered') return 'success'
  if (estado === 'rejected' || estado === 'cancelled' || estado === 'expired') return 'danger'
  if (estado === 'sent' || estado === 'pending' || estado === 'partially_delivered') return 'warning'
  return 'neutral'
}

/** La inicial del nombre. Un avatar sin foto es una letra, no un ícono genérico. */
function inicial(nombre: string): string {
  return (nombre.trim()[0] ?? '?').toUpperCase()
}

/**
 * La ficha rápida de un cliente.
 *
 * Contesta siete preguntas en cinco segundos —quién es, cuánto compra, qué
 * está pasando, qué compró, qué queda pendiente, quién lo atiende y cómo llego
 * a la ficha completa— y **no es la ficha completa comprimida**: no edita, no
 * tiene nueve pestañas y no trae el historial entero.
 *
 * Es un componente suelto a propósito. Hoy lo abre el listado de Clientes;
 * mañana lo abren la cotización, el pedido, el remito y la bandeja de
 * WhatsApp, y ninguno de ésos debería tener que importar `ClientesPage`.
 */
export function FichaRapidaCliente({ clienteId, tituloId }: FichaRapidaClienteProps) {
  const { data, isPending, error, refetch, isFetching } = useCliente360(clienteId)
  const { activa } = useEmpresa()
  const autoridad = useAutoridadNumeracion()
  /**
   * Fase 19 · E3: abrir el alta no emite nada, así que la puerta ya no la
   * cierra la autoridad general. Adentro decide la serie elegida.
   */
  const apertura = useAperturaDeAlta('cotizacion', escribeVentas(activa?.rol))
  const [copiado, setCopiado] = useState(false)

  if (error) {
    return (
      <div className={styles.estado}>
        {/* El panel NO se cierra por un error: se queda abierto con el motivo
            y con «Reintentar». Cerrarlo obligaría a buscar la fila de nuevo. */}
        <Alert tone="danger" role="alert" title="No se pudo leer la ficha">
          <p>{error.message}</p>
        </Alert>
        <Button variant="secondary" onClick={() => void refetch()} loading={isFetching}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className={styles.estado}>
        <SkeletonRows rows={6} columns={2} label="Cargando la ficha del cliente…" />
      </div>
    )
  }

  if (data === null) {
    return (
      <div className={styles.estado}>
        <Alert tone="warning" title="No se puede ver este cliente">
          <p>
            No existe, o no está entre los clientes que podés ver. Si creés que debería estarlo,
            pedile a un administrador que te lo asigne.
          </p>
        </Alert>
      </div>
    )
  }

  return (
    <Contenido
      data={data}
      tituloId={tituloId}
      copiado={copiado}
      setCopiado={setCopiado}
      stel={autoridad.stel}
      cargandoAutoridad={autoridad.cargando}
      apertura={apertura}
      rol={activa?.rol ?? null}
    />
  )
}

interface ContenidoProps {
  data: Cliente360
  tituloId: string | undefined
  copiado: boolean
  setCopiado: (v: boolean) => void
  stel: (d: 'quote' | 'sales_order' | 'delivery') => boolean
  cargandoAutoridad: boolean
  apertura: AperturaDeAlta
  rol: string | null
}

function Contenido({ data, tituloId, copiado, setCopiado, stel, cargandoAutoridad, apertura, rol }: ContenidoProps) {
  const { cliente, comercial, kpis, totales } = data
  const nombre = nombreVisible(cliente.razonSocial, cliente.nombreComercial)
  const mes = nombreDelMes(kpis.mes)

  // «Nuevo pedido» NO está: la Fase 19 habilita primero la cotización (§40) y
  // un botón que lleva a una pantalla que la base va a rechazar no es una
  // acción, es una trampa.
  const puedeVender = escribeVentas(rol)
  // Fase 19 · E3: se abre si hay una serie que el ERP numere. Con la de por
  // defecto, el «Crear» del alta sigue bloqueado y lo explica ahí.
  const cotizacionBloqueada = !apertura.abierta || apertura.cargando || cargandoAutoridad

  const copiarCuit = async () => {
    if (!cliente.cuit) return
    try {
      await navigator.clipboard.writeText(cliente.cuit)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles no se hace nada: el CUIT está en pantalla
      // y se puede seleccionar a mano.
    }
  }

  return (
    <div className={styles.ficha}>
      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <header className={styles.cabecera}>
        <span className={styles.avatar} aria-hidden="true">
          {inicial(nombre)}
        </span>
        <div className={styles.identidad}>
          <h2 className={styles.nombre} id={tituloId}>
            {nombre}
          </h2>
          {cliente.nombreComercial ? (
            <p className={styles.razonSocial}>{cliente.razonSocial}</p>
          ) : null}
          <p className={styles.meta}>
            {formatearCuit(cliente.cuit)}
            {cliente.referencia ? ` · ${cliente.referencia}` : ''}
            {cliente.rubro ? ` · ${cliente.rubro}` : ''}
          </p>
          {cliente.dadoDeBaja || cliente.necesitaRevision ? (
            <p className={styles.estados}>
              {cliente.dadoDeBaja ? (
                <Badge tone="danger" outline>
                  Dado de baja
                </Badge>
              ) : null}
              {cliente.necesitaRevision ? (
                <Badge tone="warning" dot>
                  Necesita revisión
                </Badge>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>

      <dl className={styles.contacto}>
        <div>
          <dt>Contacto</dt>
          <dd>
            {comercial.contacto ? (
              <>
                {comercial.contacto.nombre}
                {comercial.contacto.rol ? <span className={styles.rol}> · {comercial.contacto.rol}</span> : null}
                {comercial.contacto.email ? (
                  <a className={styles.enlace} href={`mailto:${comercial.contacto.email}`}>
                    {comercial.contacto.email}
                  </a>
                ) : null}
              </>
            ) : (
              <span className={styles.vacio}>Sin contacto principal</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Vendedor</dt>
          <dd>{comercial.vendedor ?? <span className={styles.vacio}>Sin asignar</span>}</dd>
        </div>
        <div>
          <dt>Tarifa</dt>
          <dd>{comercial.tarifa ?? <span className={styles.vacio}>La general</span>}</dd>
        </div>
      </dl>

      {/* ── Acciones ───────────────────────────────────────────────────── */}
      <div className={styles.acciones}>
        <LinkButton to={`/clientes/${cliente.id}`} variant="primary">
          Abrir ficha
        </LinkButton>

        {puedeVender && !cotizacionBloqueada ? (
          <LinkButton
            to={`/ventas/cotizaciones/nueva?cliente=${cliente.id}`}
            variant="secondary"
            icon={<Icon name="plus" size={16} />}
          >
            Nueva cotización
          </LinkButton>
        ) : null}
        {puedeVender && cotizacionBloqueada ? (
          <Button variant="secondary" icon={<Icon name="plus" size={16} />} disabled aria-describedby="ficha-motivo-stel">
            Nueva cotización
          </Button>
        ) : null}

        {cliente.cuit ? (
          <Button variant="ghost" onClick={() => void copiarCuit()}>
            {copiado ? 'CUIT copiado' : 'Copiar CUIT'}
          </Button>
        ) : null}
      </div>
      {puedeVender && stel('quote') ? (
        <p id="ficha-motivo-stel" className={styles.motivo}>
          {cotizacionBloqueada
            ? motivoBloqueo('quote', 'sales_order')
            : 'La serie por defecto la numera STEL: para emitir desde el ERP hay que elegir una serie del ERP al crear.'}
        </p>
      ) : null}

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="ficha-kpis">
        <h3 className={styles.tituloSeccion} id="ficha-kpis">
          En {mes}
        </h3>
        <KpisComerciales valores={kpis.valores} mes={kpis.mes} />
      </section>

      {/* ── Doce meses ─────────────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="ficha-grafico">
        <h3 className={styles.tituloSeccion} id="ficha-grafico">
          Últimos doce meses
        </h3>
        <GraficoDoceMeses filas={data.meses} cargando={false} />
      </section>

      {/* ── Actividad reciente ─────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="ficha-recientes">
        <h3 className={styles.tituloSeccion} id="ficha-recientes">
          Actividad reciente
        </h3>
        {data.recientes.length === 0 ? (
          <p className={styles.vacio}>Todavía no tiene documentos.</p>
        ) : (
          <ul className={styles.lista}>
            {data.recientes.map((d) => (
              <Reciente key={`${d.tipo}-${d.id}`} doc={d} />
            ))}
          </ul>
        )}
        <p className={styles.pie}>
          {totales.cotizaciones} cotizaciones · {totales.pedidos} pedidos · {totales.entregas}{' '}
          entregas · última actividad {formatearFecha(totales.ultimaActividad)}
        </p>
      </section>

      {/* ── Productos ──────────────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="ficha-productos">
        <h3 className={styles.tituloSeccion} id="ficha-productos">
          Productos
        </h3>
        {data.productos.length === 0 ? (
          <p className={styles.vacio}>Todavía no cotizó ni pidió ningún producto.</p>
        ) : (
          <ul className={styles.productos}>
            {data.productos.map((p) => (
              <li key={`${p.productId ?? p.sku}`} className={styles.producto}>
                <span className={styles.sku}>{p.sku ?? '—'}</span>
                <span className={styles.productoNombre}>{p.nombre ?? 'Sin nombre'}</span>
                <span className={styles.productoMeta}>
                  {formatearFecha(p.fecha)}
                  {p.cantidad !== null ? ` · ${p.cantidad} u.` : ''}
                  {p.precio !== null ? ` · ${formatearImporte(p.precio, p.moneda)}` : ''}
                  {/* De dónde salió el precio importa: uno cerrado en un pedido
                      no es lo mismo que uno ofrecido en una cotización. */}
                  <span className={styles.origen}>
                    {p.origen === 'pedido' ? ' (pedido)' : ' (cotizado)'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Reciente({ doc }: { doc: DocumentoReciente }) {
  return (
    <li className={styles.item}>
      <Link to={`${RUTA[doc.tipo]}/${doc.id}`} className={styles.itemEnlace}>
        <span className={styles.itemTitulo}>{TITULO_DOC[doc.tipo]}</span>
        <span className={styles.itemNumero}>{doc.numero ?? 'Sin número'}</span>
      </Link>
      <span className={styles.itemMeta}>
        {formatearFecha(doc.fecha)}
        {doc.total !== null ? ` · ${formatearImporte(doc.total, doc.moneda)}` : ''}
      </span>
      <span className={styles.itemEstado}>
        <Badge tone={tono(doc.estado)}>{ESTADO[doc.estado ?? ''] ?? doc.estado ?? '—'}</Badge>
        {doc.tipo === 'pedido' && doc.entrega ? (
          <Badge tone={tono(doc.entrega)} outline>
            {ESTADO[doc.entrega] ?? doc.entrega}
          </Badge>
        ) : null}
      </span>
    </li>
  )
}
