import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { Chat } from '../components/Chat'
import { ListaConversaciones } from '../components/ListaConversaciones'
import { PanelCliente } from '../components/PanelCliente'
import styles from '../components/Whatsapp.module.css'
import { nombreVisible } from '../lib/nombre'
import { puedeAsignar, puedeUsarWhatsapp } from '../lib/permisos'
import { asignar, marcarLeida } from '../services/conversaciones'
import { FalloDeEnvio, enviarTexto } from '../services/mensajes'
import { useConversacion, useConversaciones, useMensajes, useRealtimeWhatsapp } from '../hooks/useWhatsapp'
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
  const [abierta, setAbierta] = useState<string | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [enviosOk, setEnviosOk] = useState(0)

  const rol = activa?.rol
  const puedeVer = puedeUsarWhatsapp(rol)
  const asigna = puedeAsignar(rol)

  const conversaciones = useConversaciones(filtro)
  const conversacion = useConversacion(abierta)
  const mensajes = useMensajes(abierta)
  const canal = useRealtimeWhatsapp(abierta)

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
            onElegir={(id) => {
              setErrorEnvio(null)
              setAbierta(id)
            }}
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
                  onClick={() => setAbierta(null)}
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
              />
            </>
          )}
        </div>

        {detalle ? (
          <div className={styles.panelContexto}>
            <PanelCliente
              conversacion={detalle}
              puedeAsignar={asigna}
              usuarioId={usuarioId}
              asignando={cambiarAsignacion.isPending}
              onAsignar={(u) => cambiarAsignacion.mutate(u)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
