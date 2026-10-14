import { useEffect, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import {
  aprobar,
  idDeLaUrl,
  leerPedido,
  rechazar,
  type Pedido,
} from '@/services/auth/oauthConsentimiento'
import styles from './ConsentimientoOAuthPage.module.css'

/**
 * «¿Le dejás a esta app entrar con tu cuenta del ERP?» (Fase 67 · E0).
 *
 * Supabase es el servidor de autorización, pero la pantalla donde la persona
 * aprueba la tiene que servir la aplicación: Auth la manda acá con un
 * `authorization_id` y espera que volvamos con un aprobado o un rechazo.
 *
 * ── Qué se muestra y por qué ────────────────────────────────────────────────
 *
 * El nombre y el logo del cliente los elige quien lo registra, así que no
 * prueban nada: una app que se llame «ChatGPT» con el logo de ChatGPT se
 * registra en dos minutos. Lo que de verdad distingue a la buena de la falsa
 * es **a dónde va**, y por eso el destino se muestra completo y no escondido
 * detrás de un «ver detalles».
 *
 * Y se dice derecho qué se está autorizando: no «acceso a tu cuenta», sino que
 * va a poder leer lo que esa persona puede leer. Es exactamente lo que pasa,
 * porque la RLS no cambia por venir de afuera.
 */
const SIN_PEDIDO =
  'Esta pantalla se abre sola cuando una aplicación te pide permiso. ' +
  'Si llegaste por tu cuenta, no hay nada que aprobar.'

export function ConsentimientoOAuthPage() {
  const id = idDeLaUrl(window.location.href)

  /*
   * Que no venga un id NO es un efecto: se sabe de la URL, en el primer
   * render, y la URL no cambia mientras esta pantalla vive. Resolverlo en el
   * estado inicial ahorra un render de más y, sobre todo, evita el parpadeo de
   * mostrar «Leyendo el pedido…» para algo que nunca se va a leer.
   */
  const [pedido, setPedido] = useState<Pedido | null>(() =>
    id === null ? { clase: 'error', mensaje: SIN_PEDIDO } : null,
  )
  const [decidiendo, setDecidiendo] = useState<'aprobar' | 'rechazar' | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    if (id === null) return

    let vivo = true
    void leerPedido(id).then((r) => {
      if (!vivo) return
      /*
       * Ya había consentido: se va derecho, sin pintar nada.
       *
       * Preguntar de nuevo por algo que ya se aprobó es la clase de clic que
       * enseña a la gente a aprobar sin leer, que es justo lo que no se quiere
       * de una pantalla de consentimiento.
       */
      if (r.clase === 'listo') {
        window.location.replace(r.url)
        return
      }
      setPedido(r)
    })
    return () => {
      vivo = false
    }
  }, [id])

  async function decidir(que: 'aprobar' | 'rechazar') {
    if (pedido?.clase !== 'consentir') return
    setFallo(null)
    setDecidiendo(que)

    const r = que === 'aprobar' ? await aprobar(pedido.id) : await rechazar(pedido.id)
    if (!r.ok) {
      setFallo(r.mensaje)
      setDecidiendo(null)
      return
    }
    // El `redirect_url` lo arma Supabase y ya trae el código y el `state`.
    window.location.replace(r.url)
  }

  if (pedido === null) {
    return (
      <div className={styles.esperando} role="status">
        <Spinner size={20} />
        <span>Leyendo el pedido…</span>
      </div>
    )
  }

  if (pedido.clase === 'error') {
    return (
      <Alert tone="danger" title="No se puede autorizar" role="alert">
        {pedido.mensaje}
      </Alert>
    )
  }

  // `listo` ya redirigió; sólo queda `consentir`.
  if (pedido.clase !== 'consentir') return null

  return (
    <div className={styles.wrap}>
      <h1 className={styles.titulo}>
        <strong>{pedido.cliente.nombre}</strong> quiere entrar con tu cuenta
      </h1>

      <p className={styles.quien}>
        Vas a autorizarla como <strong>{pedido.correo}</strong>.
      </p>

      <ul className={styles.lista}>
        <li>
          Va a poder <strong>leer lo mismo que vos</strong> en el ERP: productos, clientes,
          documentos, costos y correos, según tus permisos. Ni más ni menos.
        </li>
        <li>
          No puede cambiar tu contraseña ni entrar a la web por vos.
        </li>
        <li>Podés cortarle el acceso cuando quieras desde la configuración de tu cuenta.</li>
      </ul>

      {/*
        El destino, completo y sin esconder. Es el único dato que no puede
        falsificar quien registra el cliente, así que es el que hay que leer.
      */}
      <div className={styles.destino}>
        <span className={styles.destinoEtiqueta}>Te va a devolver a</span>
        <code className={styles.destinoUrl}>{pedido.destino}</code>
        <p className={styles.destinoNota}>
          Si eso no es la aplicación que estabas usando, cancelá.
        </p>
      </div>

      {pedido.alcances.length > 0 && (
        <p className={styles.alcances}>
          Permisos pedidos: {pedido.alcances.join(', ')}
        </p>
      )}

      {fallo !== null && (
        <Alert tone="danger" role="alert" className={styles.fallo}>
          {fallo}
        </Alert>
      )}

      <div className={styles.botones}>
        <Button
          variant="secondary"
          onClick={() => void decidir('rechazar')}
          disabled={decidiendo !== null}
          loading={decidiendo === 'rechazar'}
        >
          Cancelar
        </Button>
        <Button
          onClick={() => void decidir('aprobar')}
          disabled={decidiendo !== null}
          loading={decidiendo === 'aprobar'}
        >
          Conectar
        </Button>
      </div>
    </div>
  )
}
