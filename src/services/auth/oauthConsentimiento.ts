/**
 * El consentimiento de OAuth: «¿le dejás a esta app entrar con tu cuenta?».
 *
 * Supabase es el servidor de autorización, pero la pantalla donde la persona
 * aprueba la tiene que servir la aplicación. Esto es la capa de acceso de esa
 * pantalla: el SDK por un lado, y por el otro una forma que el componente
 * pueda pintar sin saber nada de OAuth.
 *
 * Para qué sirve: una app MCP de ChatGPT entra con la cuenta de cada persona,
 * y lo que ve es exactamente lo que esa persona puede ver, porque la RLS no
 * cambia. El consentimiento es el momento en que eso se autoriza.
 */
import { supabase } from '@/services/supabase/client'

export interface ClienteQuePide {
  nombre: string
  uri: string
  logo: string
}

export type Pedido =
  /** Hay que preguntarle. */
  | {
      clase: 'consentir'
      id: string
      cliente: ClienteQuePide
      alcances: string[]
      correo: string
      /**
       * A dónde la va a mandar después de aprobar.
       *
       * Se muestra en pantalla, y no es decoración: es el ÚNICO dato que
       * distingue a la app de verdad de una que se llame igual. El nombre y el
       * logo los elige quien registra el cliente; el destino es a dónde van a
       * parar las llaves.
       */
      destino: string
    }
  /** Ya había consentido estos alcances: no se pregunta de nuevo. */
  | { clase: 'listo'; url: string }
  | { clase: 'error'; mensaje: string }

export type Decision = { ok: true; url: string } | { ok: false; mensaje: string }

/**
 * El `authorization_id` de la URL, venga como venga.
 *
 * ── Por qué no alcanza `useSearchParams()` ──────────────────────────────────
 *
 * La aplicación usa un router de HASH, porque se sirve desde GitHub Pages y un
 * path suelto da 404. Entonces el id puede llegar de dos formas según cómo
 * arme Supabase la redirección:
 *
 *   https://app…/#/oauth/consent?authorization_id=x   ← dentro del hash
 *   https://app…/oauth/consent?authorization_id=x     ← en el query de verdad
 *
 * El primero lo lee el router; el segundo no, y encima el path suelto no
 * existe en el servidor. Se leen los dos y además se deja el fallback de
 * `404.html`, que traduce el segundo al primero. Es la clase de detalle que
 * no se puede probar hasta que falla en producción, así que se cubre entero.
 */
export function idDeLaUrl(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  const directo = url.searchParams.get('authorization_id')
  if (directo !== null && directo !== '') return directo

  // Lo que venga después del `?` dentro del hash.
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const corte = hash.indexOf('?')
  if (corte === -1) return null
  const dentro = new URLSearchParams(hash.slice(corte + 1)).get('authorization_id')
  return dentro !== null && dentro !== '' ? dentro : null
}

/** Los alcances vienen separados por espacios; vacío es «ninguno», no `['']`. */
export function alcancesDe(scope: string): string[] {
  return scope.split(/\s+/).filter((s) => s !== '')
}

export async function leerPedido(id: string): Promise<Pedido> {
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id)

  if (error) {
    return {
      clase: 'error',
      mensaje:
        'No pude leer el pedido de autorización. Puede que ya lo hayas resuelto o que ' +
        'haya vencido: volvé a empezar desde la aplicación que te trajo.',
    }
  }

  // El SDK devuelve una de dos cosas y se distinguen por esta clave.
  if ('authorization_id' in data) {
    return {
      clase: 'consentir',
      id: data.authorization_id,
      cliente: {
        nombre: data.client.name,
        uri: data.client.uri,
        logo: data.client.logo_uri,
      },
      alcances: alcancesDe(data.scope),
      correo: data.user.email,
      destino: data.redirect_uri,
    }
  }

  return { clase: 'listo', url: data.redirect_url }
}

export async function aprobar(id: string): Promise<Decision> {
  const { data, error } = await supabase.auth.oauth.approveAuthorization(id)
  if (error || !data) return { ok: false, mensaje: 'No se pudo autorizar. Probá de nuevo.' }
  return { ok: true, url: data.redirect_url }
}

export async function rechazar(id: string): Promise<Decision> {
  const { data, error } = await supabase.auth.oauth.denyAuthorization(id)
  if (error || !data) return { ok: false, mensaje: 'No se pudo cancelar. Probá de nuevo.' }
  return { ok: true, url: data.redirect_url }
}
