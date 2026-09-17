import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { LinkButton } from '@/components/ui/LinkButton'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { Chat } from '../components/Chat'
import { ListaConversaciones } from '../components/ListaConversaciones'
import { PanelCliente } from '../components/PanelCliente'
import { PanelActividad } from '../components/PanelActividad'
import { PanelContexto, type PestanaContexto } from '../components/PanelContexto'
import { PanelIA } from '../components/PanelIA'
import styles from '../components/Whatsapp.module.css'
import { nombreVisible } from '../lib/nombre'
import { puedeAsignar, puedeUsarWhatsapp } from '../lib/permisos'
import { asignar, marcarLeida } from '../services/conversaciones'
import { FalloDeEnvio, enviarTexto } from '../services/mensajes'
import { FalloAnalisis, pedirAnalisis, resolverItemIA } from '../services/ia'
import type { EstadoItemIA } from '../lib/ia'
import {
  useConversacion,
  useConversaciones,
  useCorridasIA,
  useItemsIA,
  useMensajes,
  useRealtimeWhatsapp,
  useResumenIA,
  useSenales,
} from '../hooks/useWhatsapp'
import type { FiltroBandeja } from '../types'

/**
 * Bandeja de WhatsApp.
 *
 * Tres paneles en escritorio —conversaciones, chat y contexto del cliente—,
 * dos en tablet y uno por vez en el teléfono, donde elegir una conversación
 * navega al chat y hay un botón para volver.
 *
 * Todo lo que se ve acá llega por Realtime. No hay un solo `setInterval`: el
 * sistema anterior consultaba cada dos segundos y eso fue el 80 % del egreso.
 */
export function WhatsappPage() {
  const { activa } = useEmpresa()
  const usuarioId = useAuth().user?.id ?? null
  const queryClient = useQueryClient()

  const [filtro, setFiltro] = useState<FiltroBandeja>('todos')
  // Un enlace desde el informe abre la conversación y lleva al mensaje fuente:
  // /whatsapp?conversacion=<id>&mensaje=<id>
  const [params, setParams] = useSearchParams()
  const [abierta, setAbierta] = useState<string | null>(() => params.get('conversacion'))
  const [pestana, setPestana] = useState<PestanaContexto>(() => (params.get('mensaje') ? 'ia' : 'contacto'))
  const [resaltado, setResaltado] = useState<string | null>(() => params.get('mensaje'))
  const [pedidoResaltado, setPedidoResaltado] = useState(0)
  const [avisoIA, setAvisoIA] = useState<string | null>(null)
  const [errorIA, setErrorIA] = useState<string | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [enviosOk, setEnviosOk] = useState(0)

  const rol = activa?.rol
  const puedeVer = puedeUsarWhatsapp(rol)
  const asigna = puedeAsignar(rol)

  const conversaciones = useConversaciones(filtro)
  const conversacion = useConversacion(abierta)
  const mensajes = useMensajes(abierta)
  const canal = useRealtimeWhatsapp(abierta)

  // La IA se lee sólo si alguien mira la pestaña; los ítems también alimentan
  // el contador de la pestaña, así que ésos sí se piden al abrir.
  const resumenIA = useResumenIA(pestana === 'ia' ? abierta : null)
  const itemsIA = useItemsIA(abierta)
  const corridasIA = useCorridasIA(abierta, pestana === 'actividad' && asigna)
  const idsVisibles = useMemo(() => (conversaciones.data ?? []).map((c) => c.id), [conversaciones.data])
  const senales = useSenales(idsVisibles)

  // Los parámetros del enlace se consumen una vez: quedarse en la URL haría
  // que volver a la bandeja reabra siempre la misma conversación.
  useEffect(() => {
    if (params.has('conversacion') || params.has('mensaje')) setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al montar
  }, [])

  // Abrir una conversación la marca leída PARA ESTA PERSONA. En el sistema
  // anterior el contador era global: si alguien abría un chat, se apagaba
  // para todo el mundo.
  useEffect(() => {
    if (!abierta) return
    marcarLeida(abierta)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'conversaciones'] }),
      )
      .catch(() => {
        /* no poder marcar leída no rompe la pantalla */
      })
  }, [abierta, activa?.companyId, queryClient, mensajes.data?.mensajes.length])

  const enviar = useMutation({
    mutationFn: ({ texto }: { texto: string }) =>
      // El id lo genera el navegador: es lo que hace que dos clics en Enviar
      // dejen UN mensaje. Meta no tiene clave de idempotencia propia.
      enviarTexto(abierta!, texto, crypto.randomUUID()),
    onSuccess: () => {
      setErrorEnvio(null)
      setEnviosOk((n) => n + 1)
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'mensajes', abierta] })
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'conversaciones'] })
    },
    onError: (e: Error) =>
      setErrorEnvio(e instanceof FalloDeEnvio ? e.message : 'No se pudo enviar el mensaje.'),
  })

  const analizar = useMutation({
    mutationFn: () => pedirAnalisis(abierta!),
    onMutate: () => {
      setErrorIA(null)
      setAvisoIA(null)
    },
    onSuccess: (r) => {
      setAvisoIA(
        r.estado === 'sin_cambios'
          ? 'No hay mensajes nuevos desde el último análisis.'
          : r.estado === 'reciente'
            ? 'Se analizó hace instantes; se muestra ese resultado.'
            : r.estado === 'ok'
              ? `Resumen actualizado${r.nuevos > 0 ? ` · ${r.nuevos} sugerencia(s) nueva(s)` : ''}.`
              : null,
      )
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'ia'] })
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'senales'] })
    },
    // El resumen anterior NO se toca: sólo se avisa.
    onError: (e: Error) => setErrorIA(e instanceof FalloAnalisis ? e.message : 'No se pudo actualizar el resumen.'),
  })

  const resolver = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoItemIA }) => resolverItemIA(id, estado),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'ia', 'items', abierta] })
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId, 'senales'] })
    },
    onError: (e: Error) => setErrorIA(e.message),
  })

  const elegir = (id: string | null) => {
    setErrorEnvio(null)
    setErrorIA(null)
    setAvisoIA(null)
    setResaltado(null)
    setAbierta(id)
  }

  const cambiarAsignacion = useMutation({
    mutationFn: (usuario: string | null) => asignar(abierta!, usuario),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', activa?.companyId] })
    },
  })

  if (!puedeVer) {
    return (
      <EmptyState
        headingLevel={1}
        icon="message-circle"
        title="WhatsApp no está disponible para tu rol"
        description="La bandeja es para administración, empleados y vendedores con conversaciones asignadas."
      />
    )
  }

  if (conversaciones.error) {
    return <ErrorState title="No se pudo leer la bandeja." description={conversaciones.error.message} />
  }

  const detalle = conversacion.data ?? null

  return (
    <div className={styles.pagina}>
      <PageHeader
        title="WhatsApp"
        subtitle="Conversaciones del número de la empresa"
        actions={
          <LinkButton to="/whatsapp/informes" variant="secondary" size="sm" icon={<Icon name="bar-chart" size={16} />}>
            Informes
          </LinkButton>
        }
        status={
          canal === 'conectado' ? (
            <Badge tone="success" dot>En vivo</Badge>
          ) : canal === 'conectando' ? (
            <Badge tone="neutral" dot>Conectando…</Badge>
          ) : (
            <Badge tone="warning" dot>Sin conexión en vivo</Badge>
          )
        }
      />

      {canal === 'caido' ? (
        <Alert
          tone="warning"
          title="Se perdió la conexión en vivo"
          action={<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Reconectar</Button>}
        >
          <p>Los mensajes nuevos pueden tardar en aparecer hasta que se restablezca.</p>
        </Alert>
      ) : null}

      <div className={cx(styles.tablero, abierta && styles.tableroConChat)}>
        <div className={cx(styles.panelLista, abierta && styles.panelOculto)}>
          <ListaConversaciones
            conversaciones={conversaciones.data ?? []}
            cargando={conversaciones.isPending}
            seleccionada={abierta}
            filtro={filtro}
            onFiltro={setFiltro}
            onElegir={elegir}
            senales={senales.data}
          />
        </div>

        <div className={cx(styles.panelChat, !abierta && styles.panelOculto)}>
          {!abierta ? (
            <div className={styles.sinSeleccion}>
              <EmptyState
                icon="message-circle"
                title="Elegí una conversación"
                description="La lista de la izquierda muestra las conversaciones que podés ver."
              />
            </div>
          ) : (
            <>
              <div className={styles.chatCabecera}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.volver}
                  icon={<Icon name="arrow-left" size={16} />}
                  onClick={() => elegir(null)}
                >
                  Conversaciones
                </Button>
                <h2 className={styles.chatTitulo}>{detalle ? nombreVisible(detalle) : 'Cargando…'}</h2>
                {detalle && !detalle.clienteId ? <Badge tone="neutral" outline>Sin vincular</Badge> : null}
              </div>

              <Chat
                mensajes={mensajes.data?.mensajes ?? []}
                cargando={mensajes.isPending}
                ventanaVenceEn={detalle?.ventanaVenceEn ?? null}
                puedeEnviar={puedeVer}
                enviando={enviar.isPending}
                errorEnvio={errorEnvio}
                enviosOk={enviosOk}
                onEnviar={(texto) => enviar.mutate({ texto })}
                onCerrarError={() => setErrorEnvio(null)}
                resaltado={resaltado}
                pedidoResaltado={pedidoResaltado}
                onFuenteFaltante={() =>
                  setAvisoIA('El mensaje de origen es anterior a los mensajes cargados o ya no está disponible.')
                }
              />
            </>
          )}
        </div>

        {detalle ? (
          <div className={styles.panelContexto}>
            <PanelContexto
              pestana={pestana}
              onPestana={setPestana}
              abiertos={(itemsIA.data ?? []).filter((i) => i.estado === 'open').length}
              senales={(senales.data?.[detalle.id] ?? []).length}
              contacto={
                <PanelCliente
                  conversacion={detalle}
                  puedeAsignar={asigna}
                  usuarioId={usuarioId}
                  asignando={cambiarAsignacion.isPending}
                  onAsignar={(u) => cambiarAsignacion.mutate(u)}
                />
              }
              ia={
                <PanelIA
                  resumen={resumenIA.data ?? null}
                  items={itemsIA.data ?? []}
                  cargando={resumenIA.isPending || itemsIA.isPending}
                  errorLectura={resumenIA.error?.message ?? itemsIA.error?.message ?? null}
                  errorAnalisis={errorIA}
                  aviso={avisoIA}
                  analizando={analizar.isPending}
                  resolviendo={resolver.isPending ? (resolver.variables?.id ?? null) : null}
                  onActualizar={() => analizar.mutate()}
                  onResolver={(id, estado) => resolver.mutate({ id, estado })}
                  onIrAFuente={(mensajeId) => {
                    setAvisoIA(null)
                    setResaltado(mensajeId)
                    setPedidoResaltado((n) => n + 1)
                  }}
                />
              }
              actividad={
                <PanelActividad
                  motivos={senales.data?.[detalle.id] ?? []}
                  corridas={asigna ? (corridasIA.data ?? []) : null}
                  cargando={corridasIA.isPending && asigna}
                />
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
