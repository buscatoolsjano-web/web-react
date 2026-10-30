import { useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Pagination } from '@/components/tables/Pagination'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FiltrosEmails } from '../components/FiltrosEmails'
import { ListadoEmails } from '../components/ListadoEmails'
import { ModalEtiquetas } from '../components/ModalEtiquetas'
import { SinAccesoEmails } from '../components/SinAccesoEmails'
import {
  useAsignables,
  useAsignarDesdeBandeja,
  useBandeja,
  useCuentas,
  useEliminarHilo,
  useEtiquetarHilo,
  useEtiquetas,
  useFiltrosEmails,
} from '../hooks/useEmails'
import { useRealtimeEmails } from '../hooks/useRealtimeEmails'
import { iniciarConexionGmail } from '../services/conexion'
import { TAMANOS_BANDEJA } from '../lib/filtros'
import { puedeUsarEmails } from '../lib/permisos'
import type { CarpetaBandeja, EtiquetaEmail, FilaBandeja } from '../types'
import styles from '../components/Emails.module.css'

const HILO = { singular: 'hilo', plural: 'hilos' }

/**
 * Las carpetas (Fase 28 · E2, rehechas en la Fase 40).
 *
 * RECIBIDOS ABRE LA PANTALLA, y «Todos» ya no existe. Mezclar lo que entró con
 * lo que mandamos era el origen del «1515 pendientes»: de 1516 hilos, 250 los
 * habíamos mandado nosotros y 311 eran borradores.
 *
 * «Archivados» no es un cajón de sastre: son los 274 hilos que alguien archivó
 * en Gmail y que, sin esta pestaña, no se podrían ver desde ninguna parte.
 */
const CARPETAS: readonly TabItem<CarpetaBandeja>[] = [
  { key: 'recibidos', label: 'Recibidos' },
  { key: 'enviados', label: 'Enviados' },
  { key: 'borradores', label: 'Borradores' },
  { key: 'archivados', label: 'Archivados' },
  { key: 'eliminados', label: 'Eliminados' },
]

const VACIA: Record<CarpetaBandeja, string> = {
  recibidos: 'No hay correo recibido',
  enviados: 'Todavía no enviaste ninguno',
  borradores: 'No tenés borradores sin terminar',
  archivados: 'No hay correo archivado',
  eliminados: 'No eliminaste ningún hilo',
}

/** Traduce el código que trae el callback de conexión a algo legible. */
function textoErrorConexion(codigo: string): string {
  if (codigo === 'access_denied') return 'Cancelaste el permiso en Google. Si querés conectarla, volvé a intentarlo.'
  if (codigo === 'no_admin') return 'Sólo un administrador de la empresa puede conectar una casilla.'
  if (codigo === 'sin_refresh_token')
    return 'Google no otorgó el acceso continuo. Volvé a intentarlo y aceptá todos los permisos.'
  if (codigo === 'sin_email') return 'No se pudo leer la dirección de la casilla. Probá de nuevo.'
  if (codigo.startsWith('state_')) return 'El pedido venció o no es válido. Volvé a iniciar la conexión.'
  return 'No se pudo completar la conexión. Volvé a intentarlo.'
}

/**
 * La bandeja.
 *
 * Sale de `email_threads`, nunca de Gmail: metadata, paginada en el servidor,
 * de a 25. El legacy mandaba 766 kB por request, 716 de ellos en `body_text`.
 *
 * Fase 13 · E5: sigue siendo una bandeja —filas densas de remitente, asunto,
 * extracto y fecha—, ahora con PageHeader, FilterBar, Pagination y estados
 * comunes. Nada de la carga ni del tiempo real cambió.
 */
export function EmailsPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) return <SinAccesoEmails titulo="Emails" />
  return <Bandeja />
}

function Bandeja() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esAdmin = activa?.rol === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const conectado = searchParams.get('correo_conectado')
  const errorConexion = searchParams.get('correo_error')
  const [conectando, setConectando] = useState(false)
  const [errorConectar, setErrorConectar] = useState<string | null>(null)

  const conectar = () => {
    if (!companyId) return
    setConectando(true)
    setErrorConectar(null)
    // Redirige a Google si sale bien; si falla antes, se muestra el error.
    iniciarConexionGmail(companyId).catch((e) => {
      setErrorConectar((e as Error).message)
      setConectando(false)
    })
  }

  const cerrarBanner = () => {
    const p = new URLSearchParams(searchParams)
    p.delete('correo_conectado')
    p.delete('correo_error')
    setSearchParams(p, { replace: true })
  }

  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosEmails()
  const cuentas = useCuentas()
  const asignables = useAsignables()
  const bandeja = useBandeja(filtros)
  const { canal, reconectar } = useRealtimeEmails()
  const pestanas = useId()
  const eliminar = useEliminarHilo()
  const asignarRapido = useAsignarDesdeBandeja(filtros)
  const etiquetar = useEtiquetarHilo(filtros)
  const etiquetas = useEtiquetas()
  const [etiquetasAbiertas, setEtiquetasAbiertas] = useState(false)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  /** Las tres acciones de la fila bloquean esa fila mientras van y vuelven. */
  const enFila = <T,>(fila: FilaBandeja, correr: (opciones: { onSettled: () => void }) => T) => {
    setTrabajando(fila.id)
    correr({ onSettled: () => setTrabajando(null) })
  }

  const alEliminar = (fila: FilaBandeja, quitar: boolean) =>
    enFila(fila, (o) => eliminar.mutate({ fila, eliminar: quitar }, o))

  const alAsignar = (fila: FilaBandeja, usuario: string | null, nombre: string | null) =>
    enFila(fila, (o) => asignarRapido.mutate({ fila, usuario, nombre }, o))

  const alEtiquetar = (fila: FilaBandeja, etiqueta: EtiquetaEmail, poner: boolean) =>
    enFila(fila, (o) => etiquetar.mutate({ fila, etiqueta, poner }, o))

  const errorDeFila = eliminar.error ?? asignarRapido.error ?? etiquetar.error

  const buzones = useMemo(
    () => new Map((cuentas.data ?? []).map((c) => [c.id, c.direccion] as const)),
    [cuentas.data],
  )
  const conError = (cuentas.data ?? []).filter((c) => c.errorSync)
  const total = bandeja.data?.total ?? 0
  const sinLeer = bandeja.data?.totalSinLeer ?? 0
  const unaCuenta = cuentas.data?.length === 1 ? cuentas.data[0] : null
  const filas = bandeja.data?.filas ?? []
  const actualizando = bandeja.isFetching && !bandeja.isPending

  // El paginador va ARRIBA y abajo de la lista (Fase 202, pedido del usuario):
  // con 58 páginas, tener que bajar hasta el final para pasar de página era un
  // viaje. Es el mismo control en los dos lugares.
  const paginador =
    total > 0 ? (
      <Pagination
        label="Paginación de la bandeja"
        offset={(filtros.pagina - 1) * filtros.porPagina}
        pageSize={filtros.porPagina}
        total={total}
        noun={HILO}
        loading={bandeja.isFetching}
        onChange={(offset) => aplicar({ pagina: Math.floor(offset / filtros.porPagina) + 1 })}
        pageSizeOptions={TAMANOS_BANDEJA}
        onPageSizeChange={(porPagina) => aplicar({ porPagina })}
      />
    ) : null

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Emails"
        subtitle={
          bandeja.isPending
            ? 'Cargando…'
            : `${total} ${total === 1 ? HILO.singular : HILO.plural} · ${sinLeer} sin leer${unaCuenta ? ` · ${unaCuenta.direccion}` : ''}`
        }
        actions={
          <>
            <Button
              variant="ghost"
              icon={<Icon name="refresh" size={16} />}
              onClick={reconectar}
              loading={actualizando}
              disabled={bandeja.isFetching}
              aria-label="Actualizar la bandeja"
            >
              {actualizando ? 'Actualizando…' : 'Actualizar'}
            </Button>
            <Button variant="ghost" icon={<Icon name="star" size={16} />} onClick={() => setEtiquetasAbiertas(true)}>
              Etiquetas
            </Button>
            {/* Reglas y plantillas de correo viven acá, al lado de las etiquetas
                (Fase 167): todo lo del correo en un solo lugar. */}
            <LinkButton to="/emails/reglas" variant="ghost" icon={<Icon name="filter" size={16} />}>
              Reglas
            </LinkButton>
            <LinkButton to="/emails/plantillas" variant="ghost" icon={<Icon name="mail" size={16} />}>
              Plantillas
            </LinkButton>
            <LinkButton to="/emails/borradores" icon={<Icon name="edit" size={16} />}>
              Borradores
            </LinkButton>
            <LinkButton
              to="/emails/redactar"
              variant="primary"
              icon={<Icon name="plus" size={16} />}
            >
              Nuevo email
            </LinkButton>
          </>
        }
      />

      {canal === 'caido' ? (
        <Alert
          tone="warning"
          role="status"
          title="La actualización en vivo se desconectó"
          action={
            <Button variant="secondary" size="sm" onClick={reconectar}>
              Reconectar
            </Button>
          }
        >
          <p>Lo nuevo no va a aparecer solo.</p>
        </Alert>
      ) : null}

      {conError.map((c) => (
        <Alert
          key={c.id}
          tone="warning"
          role="status"
          title={`La sincronización de ${c.direccion} tuvo un problema`}
        >
          <p>
            {c.errorSyncEn ? `Desde el ${new Date(c.errorSyncEn).toLocaleString('es-AR')}. ` : ''}
            Puede faltar correo reciente hasta que se recupere.
          </p>
        </Alert>
      ))}

      {conectado ? (
        <Alert
          tone="success"
          role="status"
          title="Casilla conectada"
          action={
            <Button variant="secondary" size="sm" onClick={cerrarBanner}>
              Entendido
            </Button>
          }
        >
          <p>
            Se conectó <strong>{conectado}</strong>. El correo va a empezar a sincronizarse en unos
            minutos.
          </p>
        </Alert>
      ) : null}

      {errorConexion ? (
        <Alert
          tone="danger"
          role="alert"
          title="No se pudo conectar la casilla"
          action={
            <Button variant="secondary" size="sm" onClick={cerrarBanner}>
              Cerrar
            </Button>
          }
        >
          <p>{textoErrorConexion(errorConexion)}</p>
        </Alert>
      ) : null}

      <Tabs
        id={pestanas}
        items={CARPETAS}
        value={filtros.carpeta}
        onChange={(carpeta) => aplicar({ carpeta })}
        label="Carpeta de la bandeja"
      />

      <TabPanel tabsId={pestanas} tabKey={filtros.carpeta} className={styles.panelCarpeta}>
        <FiltrosEmails
          filtros={filtros}
          hayFiltros={hayFiltros}
          cuentas={cuentas.data ?? []}
          asignables={asignables.data ?? []}
          etiquetas={etiquetas.data ?? []}
          onAplicar={aplicar}
          onLimpiar={limpiar}
        />

        {/* Paginador de arriba: sólo cuando hay lista para paginar. */}
        {filas.length > 0 ? paginador : null}

        {errorDeFila ? (
          <Alert tone="danger" role="alert" title="No se pudo aplicar el cambio">
            <p>{errorDeFila.message}</p>
          </Alert>
        ) : null}

        {bandeja.error ? (
          <ErrorState
            title="No se pudo leer la bandeja."
            description={bandeja.error.message}
            onRetry={() => void bandeja.refetch()}
            retrying={bandeja.isFetching}
          />
        ) : cuentas.data && cuentas.data.length === 0 ? (
          <>
            {errorConectar ? (
              <Alert tone="danger" role="alert" title="No se pudo iniciar la conexión">
                <p>{errorConectar}</p>
              </Alert>
            ) : null}
            <EmptyState
              icon="mail"
              title="Sin cuenta de correo"
              description={
                esAdmin
                  ? 'Conectá una casilla de Gmail para ver y responder el correo de esta empresa desde acá.'
                  : 'Esta empresa no tiene ninguna casilla conectada. Pedile a un administrador que conecte una.'
              }
              action={
                esAdmin ? (
                  <Button
                    variant="primary"
                    icon={<Icon name="mail" size={16} />}
                    onClick={conectar}
                    loading={conectando}
                  >
                    {conectando ? 'Abriendo Google…' : 'Conectar casilla de Gmail'}
                  </Button>
                ) : undefined
              }
            />
          </>
        ) : bandeja.isPending ? (
          <div className={styles.lista}>
            <SkeletonRows rows={6} columns={3} label="Cargando la bandeja…" />
          </div>
        ) : total === 0 ? (
          hayFiltros ? (
            <EmptyState
              icon="search"
              title="Ningún hilo coincide con los filtros"
              action={
                <Button variant="secondary" onClick={limpiar}>
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState icon="inbox" title={VACIA[filtros.carpeta]} />
          )
        ) : filas.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No hay hilos en esta página"
            action={
              <Button variant="secondary" onClick={() => aplicar({ pagina: 1 })}>
                Ir a la primera página
              </Button>
            }
          />
        ) : (
          <ListadoEmails
            filas={filas}
            buzones={buzones}
            asignables={asignables.data ?? []}
            etiquetas={etiquetas.data ?? []}
            onAsignar={alAsignar}
            onEtiquetar={alEtiquetar}
            onEliminar={alEliminar}
            trabajando={trabajando}
          />
        )}

        {paginador}
      </TabPanel>

      {etiquetasAbiertas ? <ModalEtiquetas onCerrar={() => setEtiquetasAbiertas(false)} /> : null}
    </div>
  )
}
