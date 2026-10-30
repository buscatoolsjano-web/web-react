/**
 * Persistir y leer credenciales OAuth desde el servicio PÚBLICO, SIN service key.
 *
 * El servicio público no tiene la service key (a propósito), pero necesita dos
 * cosas privilegiadas para el modo `oauth_user`:
 *   · guardar el refresh token al conectar una casilla (`email_vincular_oauth`),
 *   · leerlo para acuñar access tokens al enviar/abrir (`email_leer_refresh_firmado`).
 *
 * Las dos RPC son `SECURITY DEFINER` y están abiertas a `anon`, pero exigen una
 * FIRMA HMAC que sólo este backend puede producir (la misma clave y el mismo
 * `app.firma_email_api_valida` que firma los envíos), más un timestamp fresco
 * contra replay. Es el mismo patrón que `RegistroSupabase`.
 *
 * El mensaje firmado tiene que coincidir carácter por carácter con el que arma
 * la RPC (`concat_ws('|', ...)`), así que acá se arma a mano con el mismo orden.
 */
import { firmar } from './registro.js'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface DatosVinculo {
  company: string
  email: string
  display: string | null
  refreshToken: string
  scope: string
  connectedBy: string
}

export class AlmacenOauthFirmado {
  constructor(
    private readonly url: string,
    private readonly clavePublica: string,
    private readonly clave: Buffer,
    private readonly pedir: Fetch = fetch,
    private readonly ahora: () => number = () => Date.now(),
  ) {
    if (clave.length < 32) throw new Error('EMAIL_API_HMAC demasiado corta')
  }

  private async rpc(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown> {
    // Sin JWT de usuario: el callback de Google no lo trae. Se usa la clave
    // publicable como anon; lo que autoriza la escritura es la firma HMAC.
    const r = await this.pedir(`${this.url}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: {
        apikey: this.clavePublica,
        Authorization: `Bearer ${this.clavePublica}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
    })
    const txt = await r.text()
    if (r.ok) return txt ? JSON.parse(txt) : null
    const mensaje = (() => {
      try {
        return String((JSON.parse(txt) as { message?: unknown }).message ?? '')
      } catch {
        return txt.slice(0, 120)
      }
    })()
    throw new Error(`rpc ${nombre}: HTTP ${r.status} ${mensaje.slice(0, 120)}`)
  }

  /** Guarda (o rota) la casilla OAuth. Devuelve el accountId. */
  async vincular(d: DatosVinculo): Promise<string> {
    const ts = this.ahora()
    const email = d.email.trim().toLowerCase()
    const mensaje = ['email_vincular_oauth', ts, d.company, email, d.connectedBy, d.scope].join('|')
    const r = await this.rpc('email_vincular_oauth', {
      p_company: d.company,
      p_email: email,
      p_display: d.display,
      p_refresh_token: d.refreshToken,
      p_scope: d.scope,
      p_connected_by: d.connectedBy,
      p_ts: ts,
      p_firma: firmar(this.clave, mensaje),
    })
    return r as string
  }

  /** El refresh token descifrado, para acuñar un access token. `null` si no hay. */
  async leerRefresh(accountId: string): Promise<string | null> {
    const ts = this.ahora()
    const mensaje = ['email_leer_refresh', ts, accountId].join('|')
    const r = await this.rpc('email_leer_refresh_firmado', {
      p_account: accountId,
      p_ts: ts,
      p_firma: firmar(this.clave, mensaje),
    })
    return typeof r === 'string' && r.length > 0 ? r : null
  }
}
