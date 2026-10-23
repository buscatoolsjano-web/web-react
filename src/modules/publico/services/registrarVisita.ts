import { getEnv } from '@/lib/env'

/**
 * Avisar al servidor que alguien vio una página del sitio público (Fase 115).
 *
 * Fetch directo con la clave pública, como `pedirCotizacion`: no usa el cliente
 * de Supabase para no pegarle un token de sesión. La función corre sin JWT y
 * resuelve la empresa sola (la del catálogo público). Falla en silencio: un
 * contador que no sube no puede romperle la página a quien está mirando.
 *
 * El `visitor_id` es un uuid que vive en el `localStorage` del visitante —sirve
 * para contar visitantes únicos sin guardar nada personal (ni IP, ni nombre)—.
 */
const CLAVE_VISITANTE = 'bt_visitante'

function visitorId(): string | null {
  try {
    let v = localStorage.getItem(CLAVE_VISITANTE)
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem(CLAVE_VISITANTE, v)
    }
    return v
  } catch {
    return null
  }
}

export function registrarVisita(path: string): void {
  if (typeof document === 'undefined') return // nunca durante el prerender
  let env: ReturnType<typeof getEnv>
  try {
    env = getEnv()
  } catch {
    return
  }
  const body = JSON.stringify({
    path,
    visitor_id: visitorId(),
    referrer: document.referrer || null,
  })
  try {
    void fetch(`${env.VITE_SUPABASE_URL}/functions/v1/web-visita`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      },
      body,
    }).catch(() => {})
  } catch {
    /* sin red: no pasa nada */
  }
}
